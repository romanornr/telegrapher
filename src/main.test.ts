import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const main = fileURLToPath(new URL('main.ts', import.meta.url));
function run(args: string[], input?: string) {
	const home = mkdtempSync(join(tmpdir(), 'telegrapher-empty-home-'));
	const env: NodeJS.ProcessEnv = { ...process.env, HOME: home };
	delete env.JEV_API_KEY;
	delete env.OPENROUTER_API_KEY;
	delete env.XDG_CONFIG_HOME;
	return spawnSync(process.execPath, [main, ...args], { env, input, encoding: 'utf8' });
}

test('CLI distinguishes clean, warnings, errors and failures without a key', () => {
	const clean = run(['comment-style', '--local-only', '--no-config', '--stdin', '--file', 'x.rs'], '//! The crate can own its buffer.\nfn x() {}');
	assert.equal(clean.status, 0, clean.stderr + clean.stdout);
	assert.match(clean.stdout, /1 files checked/);
	const warning = run(['comment-style', '--local-only', '--stdin', '--file', 'x.rs'], '/// The caller just waits; then retries.\nfn x() {}');
	assert.equal(warning.status, 0, warning.stderr + warning.stdout);
	assert.match(warning.stdout, /semicolon \[warning\]/);
	const error = run(['comment-style', '--local-only', '--stdin', '--file', 'x.rs'], '// The caller just waits; then retries.\nfn x() {}');
	assert.equal(error.status, 1, error.stderr + error.stdout);
	assert.match(error.stdout, /semicolon \[error\]/);
	assert.equal(run(['comment-style', '--local-only', '--exit-zero', '--stdin', '--file', 'x.rs'], '// Waits; then retries.\nfn x() {}').status, 0);
	const failure = run(['comment-style', '--local-only', '--exit-zero', '--file', '/does/not/exist.rs']);
	assert.equal(failure.status, 2);
	assert.match(failure.stdout, /failed/);
	const unsupported = run(['comment-style', '--local-only', '--stdin', '--file', 'x.py'], '# Explanation.');
	assert.equal(unsupported.status, 2);
	assert.match(unsupported.stdout, /unsupported/);
});

test('CLI supports profiles, explicit config, JSON coverage, help and usage errors', () => {
	const path = join(mkdtempSync(join(tmpdir(), 'telegrapher-cli-')), 'config.toml');
	writeFileSync(path, 'profile = "telegram"\n[rules]\nnot_telegraphic = "warning"');
	const configured = run(['comment-style', '--local-only', '--config', path, '--json', '--stdin', '--file', 'x.rs'], '// The caller can own the buffer.\nfn x() {}');
	assert.equal(configured.status, 0, configured.stderr + configured.stdout);
	const record: unknown = JSON.parse(configured.stdout);
	assert.equal(typeof record, 'object');
	assert.match(configured.stdout, /"status": "checked"/);
	assert.match(configured.stdout, /"profile": "telegram"/);
	assert.match(configured.stdout, /"rule": "not_telegraphic",[\s\S]*?"severity": "warning"/);
	assert.equal(run(['--help']).status, 0);
	assert.equal(run(['--unknown']).status, 2);
	assert.equal(run(['comment-style', '--local-only', '--profile', 'unknown', '--stdin'], '// Explanation.').status, 2);
	assert.equal(run(['comment-style', '--local-only', '--diff', 'HEAD']).status, 2);
});


test('CLI prints findings before compact coverage and keeps general filler non-blocking', () => {
	const result = run(['comment-style', '--local-only', '--stdin', '--file', 'x.rs'], '// Callers just wait.\nfn x() {}');
	assert.equal(result.status, 0, result.stderr + result.stdout);
	assert.match(result.stdout, /not_telegraphic \[warning\]/);
	assert.ok(result.stdout.indexOf('not_telegraphic') < result.stdout.indexOf('comment-style:'));
	assert.doesNotMatch(result.stdout, /x\.rs: checked/);
	const telegram = run(['comment-style', '--local-only', '--profile', 'telegram', '--stdin', '--file', 'x.rs'], '// Callers just wait.\nfn x() {}');
	assert.equal(telegram.status, 1, telegram.stderr + telegram.stdout);
	assert.match(telegram.stdout, /not_telegraphic \[error\]/);
});
