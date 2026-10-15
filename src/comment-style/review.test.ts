import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { readCommentStyle, runCommentStyle } from './check.ts';
import { findComments } from './extract.ts';
import { codeIssues } from './comments.ts';
import { loadConfiguration } from './config.ts';
import { credentialsPath } from '../credentials.ts';
import { jev } from '../request.ts';

function staged(path: string, before: string, after: string) {
	const root = mkdtempSync(join(tmpdir(), 'telegrapher-review-'));
	const git = (args: string[]) => execFileSync('git', args, { cwd: root });
	git(['init', '-q']);
	mkdirSync(dirname(join(root, path)), { recursive: true });
	writeFileSync(join(root, path), before);
	git(['add', '.']);
	git(['-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-qm', 'before']);
	writeFileSync(join(root, path), after);
	git(['add', '.']);
	const cwd = process.cwd();
	process.chdir(root);
	try { return readCommentStyle({ files: [] }); } finally { process.chdir(cwd); }
}

test('review: promoting a line comment to documentation is a rewrite, never deletion', async () => {
	for (const [path, before, after] of [
		['x.rs', '// Explains choice.\nfn x() {}', '/// Explains choice.\nfn x() {}'],
		['x.ts', '// Explains choice.\nfunction x() {}', '/** Explains choice. */\nfunction x() {}'],
		['x.go', 'package x\n// x explains choice.\nfunc x() {}', 'package x\n/* x explains choice. */\nfunc x() {}'],
	]) {
		const request = staged(path, before, after);
		assert.deepEqual(request.comments.map(comment => comment.deleted ?? false), [false], path);
		assert.equal((await runCommentStyle(request, undefined)).exitCode, 0, path);
	}
});

test('review: real Git quoted headers with spaces, Unicode and quotes retain coverage', async () => {
	for (const path of ['sub dir/naïve file.rs', 'sub dir/a" file.rs', 'sub dir/tab\t file.rs']) {
		const request = staged(path, '// Explains a choice.\nfn x() {}', '// Explains choice.\nfn x() {}');
		assert.deepEqual(request.coverage?.map(file => [file.path, file.status]), [[path, 'checked']]);
		assert.equal((await runCommentStyle(request, undefined)).exitCode, 0);
	}
});

test('review: rustdoc and SAFETY rewrites still reject invented links', async () => {
	for (const marker of ['///', '// SAFETY:']) {
		const request = staged('x.rs', `${marker} The allocation remains alive.\nfn x() {}`, `${marker} The allocation remains alive: https://evil.example/x\nfn x() {}`);
		assert.ok(request.comments[0]?.issues.some(issue => issue.rule === 'link_added'), marker);
		assert.equal((await runCommentStyle(request, undefined)).exitCode, 1);
	}
});

test('review: only a Rust line-leading SAFETY label changes rule scope', () => {
	for (const [path, text, safety] of [['x.rs', 'Thread safety: the lock just guards the field.', false], ['x.ts', 'SAFETY: the lock just guards the field.', false], ['x.rs', 'SAFETY: the lock just guards the field.', true]] as const) {
		const [block] = findComments(path, `// ${text}\n${path.endsWith('.rs') ? 'fn x() {}' : 'function x() {}'}`);
		assert.ok(block);
		assert.equal(block.safety, safety);
		assert.deepEqual(codeIssues(block).map(issue => issue.rule), safety ? [] : ['not_telegraphic']);
	}
});

test('review: directive-like prose stays checked when separated from the slash marker', () => {
	for (const [path, prefix, code] of [['x.go', 'line numbers', 'package x\n'], ['x.go', 'export rows', 'package x\n'], ['x.go', 'extern symbols', 'package x\n'], ['x.go', 'word:x', 'package x\n'], ['x.rs', '@param x', ''], ['x.rs', '~ marks', '']]) {
		const suffix = path.endsWith('.go') ? 'func x() {}' : 'fn x() {}';
		const blocks = findComments(path, `${code}// ${prefix} just explain the choice.\n${suffix}`);
		assert.equal(blocks.length, 1, prefix);
		assert.ok(blocks[0] && codeIssues(blocks[0]).some(issue => issue.rule === 'not_telegraphic'));
		assert.deepEqual(findComments(path, `${code}//${prefix} just explain the choice.\n${suffix}`), [], prefix);
	}
});

test('review: deleted comments never send unused Jev questions', async () => {
	const request = staged('x.rs', '// Explains choice.\nfn x() {}', 'fn x() {}');
	let calls = 0;
	const report = await runCommentStyle(request, jev('sk-test', async () => { calls++; throw new Error('must not call'); }));
	assert.equal(calls, 0);
	assert.equal(report.exitCode, 1);
	assert.match(report.findings.join('\n'), /comment_deleted/);
});

test('review: incomplete draft declarations check comments without tool failure', async () => {
	for (const [path, code] of [['x.rs', 'fn start() {'], ['x.ts', 'export function start() {'], ['x.go', 'func start() {']]) {
		const request = readCommentStyle({ files: [path], draft: `// start explains choice.\n${code}` });
		assert.deepEqual(request.coverage?.map(file => file.status), ['checked'], path);
		const report = await runCommentStyle(request, undefined);
		assert.equal(report.exitCode, 0, path);
		assert.match(report.notes?.join('\n') ?? '', /parse|syntax/i);
	}
});

test('review: auth and quota failures preserve HTTP status and service code only once', async () => {
	for (const status of [401, 402, 429]) {
		const draft = Array.from({ length: 20 }, (_, index) => `// Explains; the choice.\nfunction x${index}() {}`).join('\n');
		const request = readCommentStyle({ files: ['x.ts'], draft });
		let calls = 0;
		const report = await runCommentStyle(request, jev('sk-test', async () => { calls++; return Response.json({ error: { code: 'insufficient_quota', message: 'Do not print arbitrary response text' } }, { status }); }));
		assert.equal(report.exitCode, 2);
		assert.equal(report.failures?.length, 1, String(status));
		assert.match(report.failures?.[0] ?? '', new RegExp(`HTTP ${status}.*insufficient_quota`));
		assert.doesNotMatch(report.failures?.[0] ?? '', /Do not print/);
		assert.ok(calls <= 8, `no subsequent batch after HTTP ${status}`);
		assert.equal(report.findings.length, 20);
	}
});

test('review: safety prose stays advisory with configured error severity', async () => {
	const config = loadConfiguration({ noConfig: true });
	config.rules.set('semicolon', 'error');
	const request = readCommentStyle({ files: ['x.rs'], draft: '// SAFETY: the allocation is live; the read stays valid.\nfn x() {}', configuration: config });
	assert.deepEqual(request.comments[0]?.issues.map(issue => [issue.rule, issue.severity]), [['semicolon', 'warning']]);
	assert.equal((await runCommentStyle(request, undefined)).exitCode, 0);
});


test('review: general filler is advisory and telegram filler is an error', async () => {
	for (const word of ['just', 'simply', 'really']) {
		for (const [profile, severity, exit] of [['general', 'warning', 0], ['telegram', 'error', 1]] as const) {
			const request = readCommentStyle({ files: ['x.rs'], draft: `// Callers ${word} wait.\nfn x() {}`, configuration: loadConfiguration({ noConfig: true, profile }) });
			assert.deepEqual(request.comments[0]?.issues.map(issue => [issue.rule, issue.severity]), [['not_telegraphic', severity]]);
			assert.equal((await runCommentStyle(request, undefined)).exitCode, exit);
		}
	}
});


test('review: home configuration and credentials share absolute XDG_CONFIG_HOME', () => {
	const root = mkdtempSync(join(tmpdir(), 'telegrapher-xdg-'));
	const config = join(root, 'config', 'telegrapher', 'config.toml');
	mkdirSync(dirname(config), { recursive: true });
	writeFileSync(config, 'profile = "telegram"');
	const env = { XDG_CONFIG_HOME: join(root, 'config') };
	assert.equal(loadConfiguration({ cwd: root, home: join(root, 'home'), env }).source, config);
	assert.equal(dirname(credentialsPath(env)), dirname(config));
	assert.equal(loadConfiguration({ cwd: root, home: join(root, 'home'), env: { XDG_CONFIG_HOME: 'relative' } }).source, null);
});

test('review: ordinary slashes are stripped and metadata attributes do not claim prose exclusions', () => {
	const result = readCommentStyle({ files: ['x.rs'], draft: '//// Ordinary.\n///// Five.\n#[doc(hidden)]\n#[doc(alias = "x")]\n#![doc(html_root_url = "https://example.com")]\n#[cfg_attr(feature = "docs", doc = "Prose.")]\n#[allow(dead_code, reason = "doc = not documentation")]\nfn x() {}' });
	assert.deepEqual(result.comments[0]?.text, ['Ordinary.', 'Five.']);
	const coverage = result.coverage?.[0];
	assert.ok(coverage?.status === 'checked');
	assert.deepEqual(coverage.exclusions.map(exclusion => exclusion.reason), ['attribute-based documentation is not supported']);
});

test('review: an unpinned bare link keeps its own line budget beside pinned metadata', () => {
	const commit = 'a'.repeat(40);
	const [block] = findComments('x.rs', `// Reviewdog decodes paths.\n// A second useful detail.\n// A third useful detail.\n// https://github.com/reviewdog/reviewdog/blob/${commit}/diff/parse.go\n// https://example.com/details\nfn x() {}`);
	assert.ok(block);
	assert.ok(codeIssues(block).some(issue => issue.rule === 'link_line'));
});

test('review: syntax errors covering comment nodes fail explicitly', async () => {
	const request = readCommentStyle({ files: ['x.rs'], draft: 'fn x( // Explains choice.\n{' });
	assert.deepEqual(request.coverage?.map(file => file.status), ['failed']);
	assert.equal((await runCommentStyle(request, undefined)).exitCode, 2);
});
