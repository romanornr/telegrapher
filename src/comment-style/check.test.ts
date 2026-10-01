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

// inRepo commits each version of files in fresh repository, then runs check from inside it.
function inRepo<T>(versions: Record<string, string>[], check: (repo: string) => T): T {
	const repo = mkdtempSync(join(tmpdir(), 'telegrapher-'));
	const run = (args: string[]) => execFileSync('git', args, { cwd: repo });
	run(['init', '-q']);
	for (const files of versions) {
		for (const [path, content] of Object.entries(files)) writeFileSync(join(repo, path), content);
		run(['add', '.']);
		run(['-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '-m', 'x']);
	}

	const directory = process.cwd();
	process.chdir(repo);
	try {
		return check(repo);
	} finally {
		process.chdir(directory);
	}
}

const ntpRS = 'https://github.com/pendulum-project/ntpd-rs/blob/46ec9bb4d5b6cb24f814f5543d85b9138afb4cba/ntp-proto/src/source.rs#L1339';

test('pairs a draft given by absolute path, and says when no single committed comment fits', () => {
	const source = 'package x\n\n// Data type descriptors.\nconst (\n\ta = 1\n)\n\n// Job status descriptors.\nconst (\n\tb = 2\n)\n\n// waits on socket: https://go.dev/x\nfunc b() {}\n';
	inRepo([{ 'x.go': source }], repo => {
		const absolute = readCommentStyle({ files: [join(repo, 'x.go')], draft: '// waits on socket.\nfunc  b()  {}' });
		assert.deepEqual(absolute.comments[0]?.issues.map(issue => issue.rule), ['link_dropped']);

		const ambiguous = readCommentStyle({ files: ['x.go'], draft: '// Job status names.\nconst (' });
		assert.equal(ambiguous.comments[0]?.previous, null);
		assert.match(ambiguous.notes?.[0] ?? '', /rewrite checks were skipped/);
		const paired = readCommentStyle({ files: ['x.go'], draft: '// Job status names.\nconst (\n\tb = 2' });
		assert.deepEqual(paired.comments[0]?.previous, ['Job status descriptors.']);
	});
});

test('in a diff, flags a dropped link line and a comment deleted while its code stays', async () => {
	const before = {
		'q_test.go': `package engine\n\n// TestCorrelation checks replies reach caller only when they match request.\n// Matching kiss-o'-death cases follow ntpd-rs test_handle_kod: ${ntpRS}\nfunc TestCorrelation() {}\n`,
		'r.go': 'package engine\n\nfunc run() {\n\t// GCT keeps its raw UDP adapter for these checks.\n\tquery()\n\t// Reads clocks.\n\tread()\n}\n\n// Removed explains removed code.\nfunc Removed() {}\n',
	};
	const after = {
		'q_test.go': 'package engine\n\n// TestCorrelation checks replies reach caller only when they match request.\nfunc TestCorrelation() {}\n',
		'r.go': 'package engine\n\nfunc run() {\n\tquery()\n\tread()\n}\n',
	};

	const request = inRepo([before, after], () => readCommentStyle({ files: [], diff: 'HEAD~1..HEAD' }));
	const found = request.comments.map(comment => [comment.path, comment.text[0], comment.issues.map(issue => issue.rule)]);
	assert.deepEqual(found, [
		['q_test.go', 'TestCorrelation checks replies reach caller only when they match request.', ['link_dropped']],
		['r.go', 'GCT keeps its raw UDP adapter for these checks.', ['comment_deleted']],
		['r.go', 'Reads clocks.', ['comment_deleted']],
	]);

	// Jev may clear deleted comment that only repeats its code, never one citing source or documenting exported Go name.
	const report = await runCommentStyle(request, jev('sk-test', async (_, init) => {
		const body = JSON.parse(String(init?.body)) as { questions: Record<string, unknown>; state: { comment: string } };
		const restates = body.state.comment === 'Reads clocks.' ? 0.9 : 0.1;

		return Response.json({ model: 'jev', answers: Object.fromEntries(Object.keys(body.questions).map(name => [name, { type: 'noul', noul: name === 'restates_code' ? restates : 0.1 }])), usage: { input_tokens: 1, output_tokens: 1 } });
	}));
	assert.equal(report.findings.length, 2);
	assert.doesNotMatch(report.findings.join('\n'), /Reads clocks/);
});

test('always flags a deleted doc comment on an exported Go name', async () => {
	const request = inRepo([
		{ 'n.go': 'package engine\n\n// QueryNTP reads clock.\nfunc QueryNTP() {}\n' },
		{ 'n.go': 'package engine\n\nfunc QueryNTP() {}\n' },
	], () => readCommentStyle({ files: [], diff: 'HEAD~1..HEAD' }));
	let asked = 0;
	const report = await runCommentStyle(request, jev('sk-test', async () => {
		asked++;

		return Response.json({ model: 'jev', answers: { restates_code: { type: 'noul', noul: 0.9 } }, usage: { input_tokens: 1, output_tokens: 1 } });
	}));

	assert.equal(asked, 0);
	assert.match(report.findings[0] ?? '', /comment_deleted/);
});

test('a link moved with its fact into docs in same change is not dropped', () => {
	const nist = 'https://tf.nist.gov/tf-cgi/servers.cgi';
	const before = { 'm.go': `package engine\n\nfunc run() {\n\t// Checks every 15 minutes respect NIST's 4-second spacing: ${nist}\n\tcheck()\n}\n`, 'm.md': '# NTP\n' };
	const moved = { 'm.go': 'package engine\n\nfunc run() {\n\t// Checks every 15 minutes respect public server limits.\n\tcheck()\n}\n', 'm.md': `# NTP\n\nChecks respect NIST's 4-second spacing: ${nist}\n` };
	const dropped = { 'm.go': moved['m.go'], 'm.md': '# NTP\n' };

	const rules = (after: Record<string, string>) => inRepo([before, after], () => readCommentStyle({ files: [], diff: 'HEAD~1..HEAD' }).comments.flatMap(comment => comment.issues.map(issue => issue.rule)));
	assert.deepEqual(rules(moved), []);
	assert.deepEqual(rules(dropped), ['link_dropped']);
});

test('a draft says whether it is new or matches several committed comments', () => {
	inRepo([{ 'x.go': 'package x\n\n// A.\nconst (\n\ta = 1\n)\n\n// B.\nconst (\n\tb = 2\n)\n\nfunc c() {}\n' }], () => {
		assert.match(readCommentStyle({ files: ['x.go'], draft: '// C does work.\nfunc c() {}' }).notes?.[0] ?? '', /checked as new comment/);
		assert.match(readCommentStyle({ files: ['x.go'], draft: '// Values.\nconst (' }).notes?.[0] ?? '', /Pass more code lines/);
	});
});


test('second review: spacing-only code edits and repeated setups neither hide nor invent deletions', () => {
	const call = (sync: boolean) => `\t_, err = s.Convert(ctx, &Request{\n\t\tExchange: testExchange,\n\t\tAsset: spot,\n\t\tStart: start,\n\t\tEnd: end,\n\t\tInterval: hour,\n\t\tVerbose: true,${sync ? '\n\t\tSync: true,' : ''}\n\t})\n`;
	const before = { 't_test.go': `package engine\n\nfunc TestX() {\n\t// no trades test\n${call(false)}\t// sync run\n${call(true)}\t// db run\n${call(true)}}\n` };
	const removed = { 't_test.go': `package engine\n\nfunc TestX() {\n\t// sync run\n${call(true)}\t// db run\n${call(true)}}\n` };
	const found = inRepo([before, removed], () => readCommentStyle({ files: [], diff: 'HEAD~1..HEAD' }).comments.filter(comment => comment.deleted).map(comment => comment.text[0]));
	assert.deepEqual(found, []);

	const spaced = { 'p.go': 'package engine\n\nfunc run() {\n\t// Default fills here, never saved back to config.\n\tpools = defaultNTPServers\n}\n' };
	const squeezed = { 'p.go': 'package engine\n\nfunc run() {\n\tpools=defaultNTPServers\n}\n' };
	const deleted = inRepo([spaced, squeezed], () => readCommentStyle({ files: [], diff: 'HEAD~1..HEAD' }).comments.filter(comment => comment.deleted).map(comment => comment.text[0]));
	assert.deepEqual(deleted, ['Default fills here, never saved back to config.']);
});

test('a comment moved just above its old code is checked as rewrite, not deletion', () => {
	const before = { 'l.go': 'package orderbook\n\nfunc apply() {\n\tif price > 0 {\n\t\t// Only apply changes when zero values are not present, Bitmex\n\t\t// for example sends 0 price values.\n\t\tlevel.Price = price\n\t}\n}\n' };
	const after = { 'l.go': 'package orderbook\n\nfunc apply() {\n\t// Preserve existing price when amount-only update supplies zero price.\n\tif price > 0 {\n\t\tlevel.Price = price\n\t}\n}\n' };
	const comments = inRepo([before, after], () => readCommentStyle({ files: [], diff: 'HEAD~1..HEAD' }).comments);

	assert.deepEqual(comments.map(comment => [comment.deleted ?? false, comment.previous?.[0]]), [[false, 'Only apply changes when zero values are not present, Bitmex']]);
});

test('an unchanged comment above changed code is kept, not deleted', () => {
	const before = { 'k_test.go': 'package coinut\n\n// Please supply your own keys here to do better tests\nconst (\n\tapiKey = ""\n)\n\nfunc TestX() {}\n' };
	const after = { 'k_test.go': 'package coinut\n\n// Please supply your own keys here to do better tests\nvar (\n\tapiKey = ""\n\tclientID = ""\n)\n\nfunc TestX() {}\n' };
	const comments = inRepo([before, after], () => readCommentStyle({ files: [], diff: 'HEAD~1..HEAD' }).comments);

	assert.deepEqual(comments.filter(comment => comment.deleted), []);
});

test('third review: edge blanks, moved-link destinations, distant text and rewrapped code', () => {
	const one = { 'd.go': 'package engine\n\n// Data type descriptors\nconst (\n\ta = 1\n)\n\nfunc s() {\n\tswitch {\n\t}\n}\n' };
	const blanks = { 'd.go': 'package engine\n\n//\n// Data type descriptors\n//\nconst (\n\ta = 1\n)\n\nfunc s() {\n\tswitch {\n\t}\n}\n' };
	assert.deepEqual(inRepo([one, blanks], () => readCommentStyle({ files: [], diff: 'HEAD~1..HEAD' }).comments.flatMap(comment => comment.issues.map(issue => issue.rule))), ['grew']);

	const distant = { 'd.go': 'package engine\n\nconst (\n\ta = 1\n)\n\nfunc s() {\n\t// Data type descriptors\n\tswitch {\n\t}\n}\n' };
	assert.deepEqual(inRepo([one, distant], () => readCommentStyle({ files: [], diff: 'HEAD~1..HEAD' }).comments.filter(comment => comment.deleted).map(comment => comment.text[0])), ['Data type descriptors']);

	const link = 'https://github.com/syncthing/syncthing/blob/94c3c1c/lib/config/optionsconfiguration.go#L210';
	const sourced = { 'p.go': `package engine\n\nfunc run() {\n\t// Runtime expansion never changes saved config, as Syncthing does: ${link}\n\tpools = defaults\n}\n` };
	const tacked = { 'p.go': `package engine\n\nfunc run() {\n\t// Runtime expansion never changes saved config.\n\tpools = defaults\n}\n\nvar counter = 0 // ${link}\n` };
	assert.deepEqual(inRepo([sourced, tacked], () => readCommentStyle({ files: [], diff: 'HEAD~1..HEAD' }).comments.flatMap(comment => comment.issues.map(issue => issue.rule))), ['link_dropped']);

	const flat = { 'w.ts': '// Keeps callback server local, as RFC 8252 advises: https://www.rfc-editor.org/rfc/rfc8252\nexport async function start(complete: () => void, signal: AbortSignal): Promise<void> {}\n' };
	const wrapped = { 'w.ts': '// Keeps callback server local.\nexport async function start(\n\tcomplete: () => void,\n\tsignal: AbortSignal,\n): Promise<void> {}\n' };
	assert.deepEqual(inRepo([flat, wrapped], () => readCommentStyle({ files: [], diff: 'HEAD~1..HEAD' }).comments.flatMap(comment => comment.issues.map(issue => issue.rule))), ['link_dropped']);
});
