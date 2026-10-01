import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { preview, readCommentStyle, runCommentStyle, type CommentStyleRequest } from './check.ts';
import { codeIssues, findComments } from './comments.ts';
import { jev } from '../request.ts';

test('reports code issues and Jev answers above the threshold, one request per comment', async () => {
	const blocks = findComments('example.ts', 'run();\n// Flags, not counts; several can apply.\nrun();\n// Keeps the retry budget per host.\nrun();');
	const request: CommentStyleRequest = { pack: 'comment-style/test', comments: blocks.map(block => ({ ...block, issues: codeIssues(block), packageDoc: 'Package example explains shared terms.', previous: null })) };
	const states: unknown[] = [];

	const report = await runCommentStyle(request, jev('sk-or-test-key', async (_url, init) => {
		const body: unknown = JSON.parse(String(init?.body));
		states.push(typeof body === 'object' && body !== null && 'state' in body ? body.state : undefined);
		const jargon = states.length === 2 ? 0.9 : 0.6;

		return Response.json({
			model: 'jev',
			answers: { jargon: { type: 'noul', noul: jargon }, restates_code: { type: 'noul', noul: 0.1 }, status: { type: 'noul', noul: 0.1 }, unexplained_source: { type: 'noul', noul: 0.1 } },
			usage: { input_tokens: 10, output_tokens: 1, cost: 0.0001 },
		});
	}));

	assert.equal(states.length, 2);
	assert.deepEqual(states[0], { file: 'example.ts', comment: 'Flags, not counts; several can apply.', code_after: 'run();\n// Keeps the retry budget per host.\nrun();', package_doc: 'Package example explains shared terms.' });
	assert.equal(report.summary, 'comment-style: 2 of 2 comments need a look ($0.000200)');
	assert.match(report.findings[0] ?? '', /semicolon/);
	assert.doesNotMatch(report.findings[0] ?? '', /jargon/);
	assert.match(report.findings[1] ?? '', /jargon \(Jev 90%\): uses jargon where plain words would do\. Jev does not say which word/);
});

test('does not ask whether a Go doc comment on an exported name restates the code', async () => {
	const source = 'package mql\n\n// Kind returns "match".\nfunc (Matched) Kind() string { return "match" }\n\n// Keeps each lookup short.\nfunc lookup() {}\n';
	const blocks = findComments('evaluate.go', source);
	assert.deepEqual(blocks.map(block => block.goName), ['Kind', 'lookup']);
	const request: CommentStyleRequest = { pack: 'comment-style/test', comments: blocks.map(block => ({ ...block, issues: codeIssues(block), packageDoc: '', previous: null })) };
	const asked: string[][] = [];

	await runCommentStyle(request, jev('sk-or-test-key', async (_url, init) => {
		const body: unknown = JSON.parse(String(init?.body));
		const questions = typeof body === 'object' && body !== null && 'questions' in body && typeof body.questions === 'object' && body.questions !== null ? Object.keys(body.questions) : [];
		asked.push(questions);

		return Response.json({ model: 'jev', answers: Object.fromEntries(questions.map(name => [name, { type: 'noul', noul: 0.1 }])),
			usage: { input_tokens: 10, output_tokens: 1, cost: 0.0001 } });
	}));

	assert.deepEqual(asked.map(names => names.includes('restates_code')), [false, true]);
});

test('without Jev, code checks still run and nothing is sent', async () => {
	const blocks = findComments('example.ts', 'run();\n// Flags, not counts; several can apply.\nrun();');
	const request: CommentStyleRequest = { pack: 'comment-style/test', comments: blocks.map(block => ({ ...block, issues: codeIssues(block), packageDoc: '', previous: null })) };
	const report = await runCommentStyle(request, undefined);

	assert.equal(report.summary, 'comment-style: 1 of 1 comments need a look (code checks only, for Jev questions the user runs telegrapher auth in their own terminal)');
	assert.match(report.findings[0] ?? '', /semicolon/);
});

test('preview shortens a long first line at a word', () => {
	assert.equal(preview('short line'), 'short line');
	assert.equal(preview('Maps each file in a zero-context diff to the line numbers its new version adds or changes.', 40), 'Maps each file in a zero-context diff…');
	assert.equal(preview('x'.repeat(50), 10), `${'x'.repeat(9)}…`);
});

test('checks a draft comment as if it sat inside code of the named file', () => {
	const zigzag = ['// ntpReplyChecks adds reply checks that beevik lacks, without replacing its parser.', `// It rejects old versions, as systemd-timesyncd does, and missing receive timestamps (RFC 5905 section 6) too.`, '// It hands replies to caller.', 'type ntpReplyChecks struct {'].join('\n');
	const [comment] = readCommentStyle({ files: ['engine/ntp_query.go'], draft: zigzag }).comments;

	assert.equal(comment?.line, 1);
	assert.equal(comment?.goName, 'ntpReplyChecks');
	assert.deepEqual(comment?.issues.map(issue => issue.rule), ['uneven_lines']);
});

test('pairs a draft with the committed comment above the same code line, and asks Jev about lost meaning', async () => {
	const repo = mkdtempSync(join(tmpdir(), 'telegrapher-'));
	const run = (args: string[]) => execFileSync('git', args, { cwd: repo });
	run(['init', '-q']);
	writeFileSync(join(repo, 'x.go'), 'package x\n\nfunc a() {}\n\n// waits on the socket, as Go does: https://go.dev/x\nfunc b() {}\n');
	run(['add', '.']);
	run(['-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '-m', 'x']);

	const directory = process.cwd();
	process.chdir(repo);
	try {
		const request = readCommentStyle({ files: ['x.go'], draft: '// waits on the socket.\n// then closes it.\nfunc b() {}' });
		const [comment] = request.comments;
		assert.deepEqual(comment?.previous, ['waits on the socket, as Go does: https://go.dev/x']);
		assert.deepEqual(comment?.issues.map(issue => issue.rule).filter(rule => ['link_dropped', 'grew'].includes(rule)), ['link_dropped', 'grew']);

		const asked: { questions: string[]; previous: unknown }[] = [];
		await runCommentStyle(request, jev('sk-test', async (_, init) => {
			const body = JSON.parse(String(init?.body)) as { questions: Record<string, unknown>; state: Record<string, unknown> };
			asked.push({ questions: Object.keys(body.questions), previous: body.state.previous_comment });

			return Response.json({ model: 'jev', answers: Object.fromEntries(Object.keys(body.questions).map(name => [name, { type: 'noul', noul: 0.1 }])), usage: { input_tokens: 1, output_tokens: 1 } });
		}));
		assert.equal(asked[0]?.questions.includes('meaning_lost'), true);
		assert.equal(asked[0]?.previous, 'waits on the socket, as Go does: https://go.dev/x');
	} finally {
		process.chdir(directory);
	}
});
