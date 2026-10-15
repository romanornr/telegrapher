import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const main = fileURLToPath(new URL('main.ts', import.meta.url));
function run(args: string[], input?: string, options: { cwd?: string; configHome?: string } = {}) {
	const home = mkdtempSync(join(tmpdir(), 'telegrapher-empty-home-'));
	const env: NodeJS.ProcessEnv = { ...process.env, HOME: home };
	delete env.JEV_API_KEY;
	delete env.OPENROUTER_API_KEY;
	delete env.XDG_CONFIG_HOME;
	if (options.configHome) env.XDG_CONFIG_HOME = options.configHome;
	return spawnSync(process.execPath, [main, ...args], { cwd: options.cwd, env, input, encoding: 'utf8' });
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
	const help = run(['--help']);
	assert.equal(help.status, 0);
	assert.match(help.stdout, /telegram \(default\) or general \(opt-out\)/);
	assert.equal(run(['--unknown']).status, 2);
	assert.equal(run(['comment-style', '--local-only', '--profile', 'unknown', '--stdin'], '// Explanation.').status, 2);
	assert.equal(run(['comment-style', '--local-only', '--diff', 'HEAD']).status, 2);
});


test('CLI defaults to telegram and keeps explicit general filler non-blocking', () => {
	const result = run(['comment-style', '--local-only', '--stdin', '--file', 'x.rs'], '// Callers just wait.\nfn x() {}');
	assert.equal(result.status, 1, result.stderr + result.stdout);
	assert.match(result.stdout, /not_telegraphic \[error\]/);
	assert.ok(result.stdout.indexOf('not_telegraphic') < result.stdout.indexOf('comment-style:'));
	assert.doesNotMatch(result.stdout, /x\.rs: checked/);
	const general = run(['comment-style', '--local-only', '--profile', 'general', '--stdin', '--file', 'x.rs'], '// Callers just wait.\nfn x() {}');
	assert.equal(general.status, 0, general.stderr + general.stdout);
	assert.match(general.stdout, /not_telegraphic \[warning\]/);
	const draft = '// The caller can own the buffer.\nfn x() {}';
	assert.equal(run(['comment-style', '--local-only', '--no-config', '--stdin', '--file', 'x.rs'], draft).status, 1);
	assert.equal(run(['comment-style', '--local-only', '--profile', 'general', '--stdin', '--file', 'x.rs'], draft).status, 0);
});

test('CLI project and home config opt out to general while flags override or ignore them', () => {
	const root = mkdtempSync(join(tmpdir(), 'telegrapher-profile-'));
	const project = join(root, 'project');
	const configHome = join(root, 'config');
	mkdirSync(project);
	mkdirSync(join(configHome, 'telegrapher'), { recursive: true });
	writeFileSync(join(configHome, 'telegrapher/config.toml'), 'profile = "general"');
	const args = ['comment-style', '--local-only', '--stdin', '--file', 'x.rs', '--json'];
	const draft = '// The caller just waits.\nfn x() {}';
	const options = { cwd: project, configHome };
	const home = run(args, draft, options);
	assert.equal(home.status, 0, home.stderr + home.stdout);
	assert.match(home.stdout, /"profile": "general"/);
	assert.match(home.stdout, /"severity": "warning"/);
	writeFileSync(join(project, '.telegrapher.toml'), 'profile = "general"');
	const configured = run(args, draft, options);
	assert.equal(configured.status, 0, configured.stderr + configured.stdout);
	assert.match(configured.stdout, /\.telegrapher\.toml/);
	assert.equal(run([...args, '--profile', 'telegram'], draft, options).status, 1);
	const builtin = run([...args, '--no-config'], draft, options);
	assert.equal(builtin.status, 1, builtin.stderr + builtin.stdout);
	assert.match(builtin.stdout, /"profile": "telegram"/);
	assert.equal(run([...args, '--no-config', '--profile', 'general'], draft, options).status, 0);
	for (const flags of [['--config', join(project, '.telegrapher.toml'), '--no-config'], ['--no-config', '--config', join(project, '.telegrapher.toml')]]) {
		assert.equal(run([...args, ...flags], draft, options).status, 2);
	}
	writeFileSync(join(project, '.telegrapher.toml'), '[rules]\nuneven_lines = "off"');
	const rulesOnly = run(args, draft, options);
	assert.equal(rulesOnly.status, 1, rulesOnly.stderr + rulesOnly.stdout);
	assert.match(rulesOnly.stdout, /"profile": "telegram"/);
});
