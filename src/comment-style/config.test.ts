import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { loadConfiguration } from './config.ts';
import { readCommentStyle, runCommentStyle } from './check.ts';

test('project config is first-found and does not merge home rule settings', async () => {
	const root = mkdtempSync(join(tmpdir(), 'telegrapher-config-'));
	const home = join(root, 'home');
	const project = join(root, 'project');
	const cwd = join(project, 'src');
	mkdirSync(join(home, '.config/telegrapher'), { recursive: true });
	mkdirSync(cwd, { recursive: true });
	writeFileSync(join(home, '.config/telegrapher/config.toml'), 'profile = "telegram"\n[rules]\nsemicolon = "off"\n');
	const homeConfig = loadConfiguration({ cwd, home });
	assert.equal(homeConfig.profile, 'telegram');
	assert.equal(homeConfig.rules.get('semicolon'), 'off');
	writeFileSync(join(project, '.telegrapher.toml'), 'profile = "general"\n[rules]\nuneven_lines = "off"\n');
	const config = loadConfiguration({ cwd, home });
	assert.equal(config.source, join(project, '.telegrapher.toml'));
	assert.equal(config.profile, 'general');
	assert.equal(config.rules.has('semicolon'), false);
	const report = await runCommentStyle(readCommentStyle({ files: ['x.ts'], draft: '// The caller just waits; then returns.', configuration: config }), undefined);
	assert.equal(report.exitCode, 1);
	assert.match(report.findings.join('\n'), /semicolon \[error\]/);
	assert.equal(loadConfiguration({ cwd, home, noConfig: true }).source, null);
	assert.equal(loadConfiguration({ cwd, home, noConfig: true }).profile, 'telegram');
	assert.equal(loadConfiguration({ cwd, home, profile: 'telegram' }).profile, 'telegram');
});

test('configuration rejects invalid TOML, unknown keys, unknown rules and levels', () => {
	const root = mkdtempSync(join(tmpdir(), 'telegrapher-config-'));
	const path = join(root, 'config.toml');
	for (const text of ['profile = ', 'profile = "unknown"', 'other = 1', '[rules]\nunknown = "off"', '[rules]\nsemicolon = "maybe"', 'rules = [1]']) {
		writeFileSync(path, text);
		assert.throws(() => loadConfiguration({ config: path }), Error, text);
	}
	writeFileSync(path, '[rules]\nsemicolon = "warning"');
	assert.equal(loadConfiguration({ config: path }).rules.get('semicolon'), 'warning');
	assert.equal(loadConfiguration({ config: path }).profile, 'telegram');
});

test('built-in configuration uses telegram and general is an explicit opt-out', async () => {
	const root = mkdtempSync(join(tmpdir(), 'telegrapher-default-'));
	const builtin = loadConfiguration({ cwd: root, home: root, env: {} });
	assert.equal(builtin.profile, 'telegram');
	assert.equal(builtin.source, null);
	const draft = '// The caller just waits.\nfn x() {}';
	const request = readCommentStyle({ files: ['x.rs'], draft });
	assert.equal(request.configuration?.profile, 'telegram');
	assert.equal((await runCommentStyle(request, undefined)).exitCode, 1);
	const general = loadConfiguration({ noConfig: true, profile: 'general' });
	const optedOut = readCommentStyle({ files: ['x.rs'], draft, configuration: general });
	assert.equal((await runCommentStyle(optedOut, undefined)).exitCode, 0);
	assert.equal(optedOut.comments[0]?.issues[0]?.detail, 'Drop where meaning survives: just ×1.');
});
