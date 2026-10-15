import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, renameSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { readCommentStyle, runCommentStyle } from './check.ts';
import { changedLines, removedLines, unquoteCStyle } from './diff.ts';
import { codeIssues, rewriteIssues } from './comments.ts';
import { findComments } from './extract.ts';
import { jev } from '../request.ts';

function repository(body: (root: string, git: (args: string[]) => string) => void): void {
	const root = mkdtempSync(join(tmpdir(), 'telegrapher-coverage-'));
	const git = (args: string[]) => execFileSync('git', args, { cwd: root, encoding: 'utf8' });
	git(['init', '-q']);
	git(['-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '--allow-empty', '-qm', 'base']);
	const cwd = process.cwd();
	process.chdir(root);
	try { body(root, git); } finally { process.chdir(cwd); }
}

test('quoted Git patch paths decode UTF-8 octal bytes, tabs, quotes and newlines', () => {
	const path = 'é\t"\n.rs';
	const quoted = '"b/\\303\\251\\t\\"\\n.rs"';
	assert.equal(unquoteCStyle(quoted), `b/${path}`);
	const patch = `diff --git a/x b/x\n+++ ${quoted}\n@@ -3,2 +3,1 @@\n-old\n-second\n+new\n`;
	assert.deepEqual([...changedLines(patch).get(path) ?? []], [3]);
	assert.deepEqual([...removedLines(patch).get(path) ?? []], [3, 4]);
	assert.throws(() => unquoteCStyle('"b/\\999.rs"'), /Invalid C escape/);
});

test('diff coverage enumerates every path despite prefix settings, external diff and subdirectory cwd', () => {
	repository((root, git) => {
		git(['config', 'diff.mnemonicPrefix', 'true']);
		git(['config', 'diff.noprefix', 'true']);
		git(['config', 'diff.external', '/does/not/exist']);
		for (const path of ['é.rs', 'space name.ts', 'tab\tname.go', 'line\nname.js', 'quote"name.tsx']) {
			const text = path.endsWith('.rs') ? '// Explains a choice.\nfn x() {}' : path.endsWith('.go') ? 'package x\n// x explains a choice.\nfunc x() {}' : '// Explains a choice.\nfunction x() {}';
			writeFileSync(join(root, path), text);
		}
		mkdirSync(join(root, 'generated'));
		writeFileSync(join(root, 'generated/x.rs'), 'not source');
		writeFileSync(join(root, 'README.md'), 'Changed prose.');
		git(['add', '.']);
		mkdirSync(join(root, 'subdir'));
		process.chdir(join(root, 'subdir'));
		const request = readCommentStyle({ files: [] });
		assert.deepEqual(request.coverage?.filter(file => file.status === 'checked').map(file => file.path).sort(), ['é.rs', 'space name.ts', 'tab\tname.go', 'line\nname.js', 'quote"name.tsx'].sort());
		assert.deepEqual(request.coverage?.filter(file => file.status !== 'checked').map(file => [file.path, file.status]).sort(), [['README.md', 'unsupported'], ['generated/x.rs', 'excluded']]);
		assert.equal(request.comments.length, 5);
	});
});

test('renamed paths compare against the old path and deleted files have a coverage reason', () => {
	repository((root, git) => {
		writeFileSync(join(root, 'old.rs'), '// Explains a choice.\nfn x() {\n let a = 1;\n let b = 2;\n let c = 3;\n}\n');
		writeFileSync(join(root, 'deleted.rs'), '// A reason.\nfn y() {}');
		git(['add', '.']); git(['-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-qm', 'files']);
		renameSync(join(root, 'old.rs'), join(root, 'new.rs'));
		writeFileSync(join(root, 'new.rs'), '// Explains the choice.\nfn x() {\n let a = 1;\n let b = 2;\n let c = 3;\n}\n');
		unlinkSync(join(root, 'deleted.rs'));
		git(['add', '-A']);
		const request = readCommentStyle({ files: [] });
		assert.deepEqual(request.comments[0]?.previous, ['Explains a choice.']);
		assert.ok(request.coverage?.some(file => file.path === 'deleted.rs' && file.status === 'excluded' && file.reason === 'deleted file'));
	});
});

test('unsupported and missing files fail while recovered syntax keeps checked coverage', async () => {
	const root = mkdtempSync(join(tmpdir(), 'telegrapher-files-'));
	const good = join(root, 'good.rs'); const bad = join(root, 'bad.rs'); const missing = join(root, 'missing.ts');
	writeFileSync(good, '// Explains; the choice.\nfn x() {}');
	writeFileSync(bad, 'fn x( {');
	const request = readCommentStyle({ files: [good, bad, missing, join(root, 'other.py')] });
	assert.deepEqual(request.coverage?.map(file => file.status), ['checked', 'checked', 'failed', 'unsupported']);
	const report = await runCommentStyle(request, undefined);
	assert.equal(report.exitCode, 2);
	assert.match(report.findings.join('\n'), /semicolon/);
	assert.match(report.notes?.join('\n') ?? '', /parse warning/);
});

test('no candidate runs explicitly report that zero files were checked', async () => {
	let request: ReturnType<typeof readCommentStyle> | undefined;
	repository((_root, _git) => { request = readCommentStyle({ files: [] }); });
	assert.ok(request);
	const report = await runCommentStyle(request, undefined);
	assert.equal(report.exitCode, 0);
	assert.match(report.summary, /0 files checked/);
	assert.deepEqual(request.coverage, []);
});

test('pinned provenance is metadata and the exact shorthand migration preserves source identity', () => {
	const commit = 'c'.repeat(40);
	const source = `fn x() {}\n// Reviewdog unquoteCStyle decodes Git paths.\n// It handles escaped bytes.\n// A third detail remains useful.\n// https://github.com/reviewdog/reviewdog/blob/${commit}/diff/parse.go\nfn y() {}`;
	const [block] = findComments('x.rs', source);
	assert.ok(block);
	assert.deepEqual(codeIssues(block), []);
	const before = [`Reviewdog unquoteCStyle decodes Git paths, reviewdog/reviewdog@${commit}, diff/parse.go.`];
	const after = ['Reviewdog unquoteCStyle decodes Git paths.', `https://github.com/reviewdog/reviewdog/blob/${commit}/diff/parse.go`];
	assert.deepEqual(rewriteIssues(after, before), []);
	assert.deepEqual(rewriteIssues(after, ['Reviewdog unquoteCStyle decodes Git paths.']).map(issue => issue.rule), ['link_added']);
});

test('clause wrapping near 100 characters and soft size and shape findings do not fail', async () => {
	const clause = '// The caller retains the complete allocation until every outstanding operation has finished,\n// so the data remains available to readers.';
	const request = readCommentStyle({ files: ['x.rs'], draft: `${clause}\n// Short.\n// A final useful detail remains here.\nfn x() {}` });
	const report = await runCommentStyle(request, undefined);
	assert.equal(report.exitCode, 0);
	assert.match(report.findings.join('\n'), /too_long \[warning\]/);
	assert.doesNotMatch(report.findings.join('\n'), /wrapped_sentence/);
});

test('a failed Jev stage retains deterministic findings and returns 2 with no network', async () => {
	const request = readCommentStyle({ files: ['x.ts'], draft: '// Explains; the choice.\nfunction x() {}' });
	const report = await runCommentStyle(request, jev('sk-test', async () => { throw new Error('simulated failure'); }));
	assert.equal(report.exitCode, 2);
	assert.match(report.findings.join('\n'), /semicolon/);
	assert.match(report.failures?.join('\n') ?? '', /Jev request failed/);
});

test('Jev-only findings are warnings and documentation does not ask for deletion advice', async () => {
	const request = readCommentStyle({ files: ['x.rs'], draft: '/// Documents a useful API.\n///\n/// # Safety\n/// ```rust,no_run\n/// # hidden();\n/// ```\nfn x() {}' });
	let sent: unknown;
	const report = await runCommentStyle(request, jev('sk-test', async (_, init) => {
		const data: unknown = JSON.parse(String(init?.body)); sent = data;
		if (typeof data !== 'object' || data === null || !('questions' in data) || typeof data.questions !== 'object' || data.questions === null) throw new Error('Invalid request');
		return Response.json({ model: 'jev', answers: Object.fromEntries(Object.keys(data.questions).map(name => [name, { type: 'noul', noul: 0.95 }])), usage: { input_tokens: 1, output_tokens: 1 } });
	}));
	assert.equal(report.exitCode, 0);
	assert.match(report.findings.join('\n'), /Jev 95%/);
	assert.doesNotMatch(JSON.stringify(sent), /restates_code|hidden\(\)|# Safety/);
});


test('source lines resembling file headers never swallow later hunks', () => {
	const patch = 'diff --git a/x.ts b/x.ts\n+++ b/x.ts\n@@ -1 +1 @@\n--- old\n+++ source\n@@ -10 +10 @@\n-old\n+new\n';
	assert.deepEqual([...changedLines(patch).get('x.ts') ?? []], [1, 10]);
	assert.deepEqual([...removedLines(patch).get('x.ts') ?? []], [1, 10]);
	assert.throws(() => changedLines('+++ b/x.ts\n@@ -1 +1 @@\n'), /Incomplete Git diff hunk/);
});
