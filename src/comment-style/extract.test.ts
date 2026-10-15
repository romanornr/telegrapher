import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { extractComments, findComments } from './extract.ts';
import { codeIssues, scopedRewriteIssues } from './comments.ts';

const rust = (body: string) => extractComments('x.rs', body);

test('all five vendored grammars parse their languages and exclude string markers', () => {
	for (const [path, source] of [
		['x.go', 'package x\nvar s = `// not a comment`\n// Explains the choice.\nfunc x() {}'],
		['x.ts', 'const s = `// not a comment`;\n// Explains the choice.\nfunction x() {}'],
		['x.tsx', 'const s = <div>{"// not a comment"}</div>;\n// Explains the choice.\nfunction x() {}'],
		['x.js', 'const s = /\/\//;\n// Explains the choice.\nfunction x() {}'],
		['x.rs', 'const S: &str = r###"// not a comment /* neither */"###;\n// Explains the choice.\nfn x() {}'],
	]) {
		const result = extractComments(path, source);
		assert.equal(result.parseError, false, path);
		assert.deepEqual(result.comments.map(block => block.text), [['Explains the choice.']], path);
	}
});

test('Rust doc markers, blank inner docs, ordinary markers and nested blocks retain their kind', () => {
	const source = '//! Crate docs.\n//!\n//! More docs.\n/*! Inner block. */\n/// Outer docs.\n/** Outer block. */\n//// Ordinary.\n/*** Ordinary block. */\n/**/\n/* Outer /* nested */ remains. */\nfn x() {}';
	const result = rust(source);
	assert.equal(result.parseError, false);
	assert.deepEqual(result.comments.map(block => block.kind), ['doc_inner', 'doc_inner', 'doc_outer', 'doc_outer', 'line', 'block', 'block']);
	assert.deepEqual(result.comments[0]?.text, ['Crate docs.', '', 'More docs.']);
	assert.equal(result.comments[0]?.endLine, 3);
	assert.deepEqual(result.comments.at(-1)?.text, ['Outer /* nested */ remains.']);
	assert.ok(result.exclusions.some(exclusion => exclusion.reason === 'empty comment'));
});

test('Rust attributes are code and lint reasons stay outside prose', () => {
	const result = rust('#![allow(dead_code, reason = "just the reason")]\n// Explains the choice.\n#[expect(unused, reason = "really just a reason")]\nfn x() {}');
	assert.equal(result.parseError, false);
	assert.equal(result.comments.length, 1);
	assert.equal(result.comments[0]?.overview, false);
	assert.deepEqual(result.comments[0]?.text, ['Explains the choice.']);
});

test('Rust docs and provenance split, trailing comments and directives are explicit exclusions', () => {
	const result = rust('/// Documents x.\n// Origin follows Vale coalesce.\nfn x() {} // Trailing.\n//@ compile-flags: --test\n// Explains a choice.\nfn y() {}\n#[doc = "Attribute documentation."]\nfn z() {}');
	assert.deepEqual(result.comments.map(block => block.kind), ['doc_outer', 'line', 'line']);
	assert.deepEqual(result.exclusions.map(exclusion => exclusion.reason), ['trailing comment', 'tool directive', 'attribute-based documentation is not supported']);
});

test('grouping requires equal kind, column and containing syntax', () => {
	const result = rust('fn x() {\n // First.\n  // Second.\n}\nfn y() {\n // Third.\n}');
	assert.deepEqual(result.comments.map(block => block.text), [['First.'], ['Second.'], ['Third.']]);
	assert.notEqual(result.comments[0]?.attachment, result.comments[2]?.attachment);
});

test('Rustdoc checks only prose and maps UTF-16 ranges through CRLF and markers', () => {
	const source = ['/// # Safety; just', '///', '/// The é🦀 caller just waits; then retries.', '///', '/// ```rust,no_run', '/// # let hidden = "just; really";', '/// ```', '///', '///     just; indented_code()', '///', '/// <div>just; HTML</div>', '///', '/// | just | really |', '/// | ---- | ------ |', '/// | a;   | b;     |', '///', '/// [target]: https://example.com/just;really', '/// [^note]: just; really', '///', '/// Uses [`Vec::len`] and [the target](https://example.com/just;really).', 'fn x() {}'].join('\r\n');
	const result = rust(source);
	assert.equal(result.parseError, false);
	const block = result.comments[0];
	assert.ok(block);
	assert.deepEqual(codeIssues(block, 'telegram').map(issue => [issue.rule, issue.severity]), [['semicolon', 'warning'], ['not_telegraphic', 'warning']]);
	assert.equal(block.prose.filter(line => line.includes('just')).length, 1);
	assert.ok(block.proseRanges.some(range => source.slice(range.start, range.end) === 'The é🦀 caller just waits; then retries.'));
	assert.equal(block.sourceMap.length, block.text.join('\n').length);
	for (let i = 0; i < block.sourceMap.length; i++) if (block.text.join('\n')[i] !== '\n') assert.equal(source[block.sourceMap[i]], block.text.join('\n')[i]);
	const changed = rust(source.replace('rust,no_run', 'rust,ignore')).comments[0];
	assert.ok(changed);
	assert.ok(scopedRewriteIssues(changed, block, new Set()).some(issue => issue.rule === 'protected_changed'));
});

test('SAFETY preserves articles, connectors, length and shape, with advisory prose only', () => {
	const source = 'fn x() {\n// SAFETY: the length was checked above, so the read stays in bounds.\n// The caller can still own the buffer.\n// Every allocation remains alive.\n// A final precondition also holds.\nunsafe { read(); }\n}';
	const [block] = findComments('x.rs', source);
	assert.ok(block?.safety);
	assert.deepEqual(codeIssues(block, 'telegram'), []);
	const [changed] = findComments('x.rs', source.replace('SAFETY:', 'Reason:'));
	assert.ok(changed);
	assert.ok(scopedRewriteIssues(changed, block, new Set()).some(issue => issue.rule === 'safety_rewrite'));
});

test('vendored grammar checksums and licences match their manifest', () => {
	const manifest: unknown = JSON.parse(readFileSync(new URL('../../vendor/grammars/manifest.json', import.meta.url), 'utf8'));
	assert.ok(Array.isArray(manifest));
	assert.equal(manifest.length, 5);
	for (const entry of manifest) {
		assert.equal(typeof entry.file, 'string');
		assert.match(entry.commit, /^[a-f0-9]{40}$/);
		assert.equal(createHash('sha256').update(readFileSync(new URL(`../../vendor/grammars/${entry.file}`, import.meta.url))).digest('hex'), entry.sha256);
		assert.match(readFileSync(new URL(`../../vendor/grammars/${entry.licenseFile}`, import.meta.url), 'utf8'), /MIT|Permission is hereby granted/);
	}
});
