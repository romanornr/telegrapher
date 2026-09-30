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
		'// Only top-level any over body.links reports matching links, found by second pass over every link.',
		'// https://github.com/cel-expr/cel-go/blob/f2039bc647bca407d882d90436fc8b91bab1ae62/parser/macro.go#L517-L525',
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

test('flags semicolons outside code spans, doc paths and ADR numbers', () => {
	assert.deepEqual(rules('run();\n// Flags, not counts; several can apply.\nrun();'), [['semicolon']]);
	assert.deepEqual(rules('run();\n// Joins with `a; b` inside code.\nrun();'), [[]]);
	assert.deepEqual(rules('run();\n// See docs/adr/0013-route.md for the policy.\nrun();'), [['doc_path']]);
	assert.deepEqual(rules('run();\n// ADR 0013 explains this.\nrun();'), [['doc_path']]);
});

test('limits comments inside code to four lines of text, but not overviews or doc comments', () => {
	const five = ['// One line of text here.', '// Two lines of text here.', '// Tri lines of text here.', '// Four line of text here.', '// Five line of text here.'].join('\n');

	assert.deepEqual(rules(`run();\n${five}\nrun();`), [['too_long']]);
	assert.deepEqual(rules(`${five}\nrun();`), [[]]);
	assert.deepEqual(rules(`run();\n/**\n${five.replaceAll('//', ' *')}\n */\nrun();`), [[]]);
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
