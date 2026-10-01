import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { changedLines, codeIssues, findComments } from './comments.ts';

function rules(source: string): string[][] {
	return findComments('example.ts', source).map(block => codeIssues(block).map(issue => issue.rule));
}

test('passes an even, one-sentence-per-line comment inside code', () => {
	const source = [
		'const x = 1;',
		'// Compiles MQL any(list, condition) into CEL loop, which counts each loop step against cost limit.',
		'// Each nested any gets own loop variable, so items never mix, and each loop stops at first match.',
		'// Only top-level any over body.links reports matching links, as cel-go macro expansion does: https://github.com/cel-expr/cel-go/blob/f2039bc647bca407d882d90436fc8b91bab1ae62/parser/macro.go#L517-L525',
		'function lowerAny() {}',
	].join('\n');

	assert.deepEqual(rules(source), [[]]);
});

test('flags a sentence wrapped onto the next line, and uneven lines', () => {
	const source = [
		'const x = 1;',
		'// Each MQL scope receives unique CEL binding. Evaluation stops at first true',
		'// element. Only outer loop produces witnesses.',
		'run();',
	].join('\n');

	assert.deepEqual(rules(source), [['wrapped_sentence', 'two_sentences', 'uneven_lines']]);
});

test('leaves lines that carry a link out of line balance', () => {
	const source = [
		'const x = 1;',
		'// Several reasons may appear together, and none is presented as sole cause.',
		'// Report refusals and rate limits as separate reasons, as ntpd-rs does: https://github.com/pendulum-project/ntpd-rs/blob/46ec9bb4/src.rs#L715',
		'run();',
	].join('\n');

	assert.deepEqual(rules(source), [[]]);
});

test('allows a link on its own line only under one or two lines of text', () => {
	const short = ['const x = 1;', '// Waits for callback, as Go context example does:', '// https://github.com/golang/go/blob/go1.27.0/src/context/example_test.go', 'run();'].join('\n');
	assert.deepEqual(rules(short), [[]]);
	const long = ['const x = 1;', '// Closing socket on cancel unblocks pending read of NTP library.', '// Library could overwrite deadline set here after dialer returns.', '// Closing via callback follows Go context example for connections.', '// https://github.com/golang/go/blob/go1.27.0/src/context/example_test.go', 'run();'].join('\n');
	assert.deepEqual(rules(long), [['link_line']]);
	assert.deepEqual(rules('run();\n// https://example.com/spec\nrun();'), [[]]);
});

test('flags a link followed by more text, but not a tail of source lines', () => {
	const middle = ['const x = 1;', '// Separating results from alarms follows sfptpd: https://github.com/Xilinx-CNS/sfptpd/blob/5ac5b58/src/sfptpd_engine.c#L2032', '// Previous clock error stays open across unknown results, which never count as recovery.', 'run();'].join('\n');
	assert.deepEqual(rules(middle), [['link_last']]);
	const tail = ['const x = 1;', '// Login flow is adapted from pi: https://github.com/earendil-works/pi/blob/8ce69e9/openrouter.ts', '// Callback server is adapted from pi too: https://github.com/earendil-works/pi/blob/8ce69e9/callback-server.ts', 'run();'].join('\n');
	assert.deepEqual(rules(tail), [[]]);
});

test('flags semicolons outside code spans, doc paths and ADR numbers', () => {
	assert.deepEqual(rules('run();\n// Flags, not counts; several can apply.\nrun();'), [['semicolon']]);
	assert.deepEqual(rules('run();\n// Joins with `a; b` inside code.\nrun();'), [[]]);
	assert.deepEqual(rules('run();\n// See docs/adr/0013-route.md for the policy.\nrun();'), [['doc_path']]);
	assert.deepEqual(rules('run();\n// ADR 0013 explains this.\nrun();'), [['doc_path']]);
});

test('limits comments inside code to three lines of text, but not overviews or doc comments', () => {
	const three = ['// One line of text here.', '// Two lines of text here.', '// Tri lines of text here.'].join('\n');
	const four = [three, '// Four line of text here.'].join('\n');

	assert.deepEqual(rules(`run();\n${three}\nrun();`), [[]]);
	assert.deepEqual(rules(`run();\n${four}\nrun();`), [['too_long']]);
	assert.deepEqual(rules(`${four}\nrun();`), [[]]);
	assert.deepEqual(rules(`run();\n/**\n${four.replaceAll('//', ' *')}\n */\nrun();`), [[]]);
});

test('flags two links on one line, but not one link per sentence at the end', () => {
	const shared = ['const x = 1;', '// Rejects old versions and parses replies: https://github.com/systemd/systemd/blob/885fe07/timesyncd.c https://github.com/beevik/ntp/blob/953b636/ntp4.go', 'run();'].join('\n');
	assert.deepEqual(rules(shared), [['link_count']]);
	const each = ['const x = 1;', '// Rejects old NTP versions, as systemd-timesyncd does: https://github.com/systemd/systemd/blob/885fe07/timesyncd.c', '// Parsing stays in beevik, which lacks these checks: https://github.com/beevik/ntp/blob/953b636/ntp4.go', 'run();'].join('\n');
	assert.deepEqual(rules(each), [[]]);
});

test('flags a colon touching a link', () => {
	assert.deepEqual(rules('run();\n// Checks are missing from beevik v1.6.0:https://github.com/beevik/ntp\nrun();'), [['link_space']]);
	assert.deepEqual(rules('run();\n// Checks are missing from beevik v1.6.0: https://github.com/beevik/ntp\nrun();'), [[]]);
});

test('marks comments before code as overviews, allowing a Go package clause', () => {
	const blocks = findComments('example.go', '// Package overview.\npackage mql\n\nimport "fmt"\n\n// Inside code.\nfunc x() {}');

	assert.deepEqual(blocks.map(block => [block.line, block.overview]), [[1, true], [6, false]]);
});

test('skips tool directives and licence notices', () => {
	assert.deepEqual(findComments('example.ts', '// oxlint-disable-next-line no-console\nrun();\n// Licensed under the Apache License, Version 2.0.\nrun();'), []);
});

test('maps zero-context diff hunks to the new file line numbers', () => {
	const diff = ['+++ b/tools/a.ts', '@@ -3,0 +4,2 @@', '+x', '+y', '@@ -10 +12 @@', '+z', '+++ /dev/null', '@@ -1 +0,0 @@'].join('\n');

	assert.deepEqual([...changedLines(diff)].map(([path, lines]) => [path, [...lines]]), [['tools/a.ts', [4, 5, 12]]]);
});

// Stays free of imports, so the rules can move to their own package without Jev or git.
test('comment rules import nothing', async () => {
	const source = await readFile(new URL('comments.ts', import.meta.url), 'utf8');

	assert.doesNotMatch(source, /^import /m);
});

test('flags articles and filler for telegraphic style, ignoring code spans and quotes', () => {
	assert.deepEqual(rules('run();\n// Evaluates the right side only when the left side does not decide.\nrun();'), [['not_telegraphic']]);
	assert.deepEqual(rules('run();\n// Evaluates right side only when left side does not decide.\nrun();'), [[]]);
	assert.deepEqual(rules('run();\n// Returns `the a` or "the an", never empty string.\nrun();'), [[]]);
	const [block] = findComments('x.ts', 'run();\n// The cost of the search is just a guess.\nrun();');
	assert.equal(block === undefined ? '' : codeIssues(block).find(issue => issue.rule === 'not_telegraphic')?.detail, 'Drop where meaning survives: the ×2, just ×1, a ×1.');
});

test('flags two sentences on one line, but not decimals, dotted names or quotes', () => {
	assert.deepEqual(rules('run();\n// Groups gaps. Capability gaps need outside services.\nrun();'), [['two_sentences']]);
	assert.deepEqual(rules('run();\n// Took 0.1 seconds, like cel.bind in Go.\nrun();'), [[]]);
	assert.deepEqual(rules('run();\n// Returns "done. Next" on success.\nrun();'), [[]]);
});

test('Go comments start with the name declared below them', () => {
	const source = 'package mql\n\n// Turns any into loop.\nfunc lowerAny() {}\n\n// lowerAll turns all into loop.\nfunc lowerAll() {}\n\n// Kind returns match.\nfunc (Matched) Kind() string { return "" }\n\n// Groups of values.\nconst (\n\tx = 1\n)\n';
	assert.deepEqual(findComments('x.go', source).map(block => codeIssues(block).map(issue => issue.rule)), [['name_first'], [], [], []]);
	assert.deepEqual(findComments('x.ts', '// Turns any into loop.\nfunction lowerAny() {}\n').map(block => block.goName), [null]);
});

test('doc_path leaves out the period that ends the sentence', () => {
	const [block] = findComments('x.ts', 'run();\n// Retries are explained in docs/retries.md.\nrun();');
	assert.equal(block === undefined ? '' : codeIssues(block).find(issue => issue.rule === 'doc_path')?.detail, 'Points to docs/retries.md. State the reason in the comment instead.');
});
