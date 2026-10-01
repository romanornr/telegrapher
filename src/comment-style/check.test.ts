import assert from 'node:assert/strict';
import test from 'node:test';
import { preview, runCommentStyle, type CommentStyleRequest } from './check.ts';
import { codeIssues, findComments } from './comments.ts';
import { jev } from '../request.ts';

test('reports code issues and Jev answers above the threshold, one request per comment', async () => {
	const blocks = findComments('example.ts', 'run();\n// Flags, not counts; several can apply.\nrun();\n// Keeps the retry budget per host.\nrun();');
	const request: CommentStyleRequest = { pack: 'comment-style/test', comments: blocks.map(block => ({ ...block, issues: codeIssues(block), packageDoc: 'Package example explains shared terms.' })) };
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
	assert.match(report.findings[1] ?? '', /jargon: uses a term a newcomer would need to look up \(Jev, 0\.90\)/);
});

test('does not ask whether a Go doc comment on an exported name restates the code', async () => {
	const source = 'package mql\n\n// Kind returns "match".\nfunc (Matched) Kind() string { return "match" }\n\n// Keeps each lookup short.\nfunc lookup() {}\n';
	const blocks = findComments('evaluate.go', source);
	assert.deepEqual(blocks.map(block => block.goName), ['Kind', 'lookup']);
	const request: CommentStyleRequest = { pack: 'comment-style/test', comments: blocks.map(block => ({ ...block, issues: codeIssues(block), packageDoc: '' })) };
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
	const request: CommentStyleRequest = { pack: 'comment-style/test', comments: blocks.map(block => ({ ...block, issues: codeIssues(block), packageDoc: '' })) };
	const report = await runCommentStyle(request, undefined);

	assert.equal(report.summary, 'comment-style: 1 of 1 comments need a look (code checks only, for Jev questions the user runs telegrapher auth in their own terminal)');
	assert.match(report.findings[0] ?? '', /semicolon/);
});

test('preview shortens a long first line at a word', () => {
	assert.equal(preview('short line'), 'short line');
	assert.equal(preview('Maps each file in a zero-context diff to the line numbers its new version adds or changes.', 40), 'Maps each file in a zero-context diff…');
	assert.equal(preview('x'.repeat(50), 10), `${'x'.repeat(9)}…`);
});
