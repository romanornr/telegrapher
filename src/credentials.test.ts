import assert from 'node:assert/strict';
import { chmod, mkdtemp, readdir, readFile, stat } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { credentialsPath, findKey, saveKey } from './credentials.ts';

test('JEV_API_KEY wins, then saved key, then OPENROUTER_API_KEY', async () => {
	const path = join(await mkdtemp(join(tmpdir(), 'telegrapher-')), 'credentials');
	const missing = join(path, '..', 'missing');
	await saveKey('saved', path);

	assert.deepEqual(await findKey({ JEV_API_KEY: ' from-env ', OPENROUTER_API_KEY: 'shared' }, path), { key: 'from-env', source: 'JEV_API_KEY' });
	assert.deepEqual(await findKey({ OPENROUTER_API_KEY: 'shared' }, path), { key: 'saved', source: 'saved' });
	assert.deepEqual(await findKey({ OPENROUTER_API_KEY: ' shared ' }, missing), { key: 'shared', source: 'OPENROUTER_API_KEY' });
	assert.equal(await findKey({}, missing), undefined);
});

test('saved key file stays private, also when overwriting older readable file', async () => {
	const path = join(await mkdtemp(join(tmpdir(), 'telegrapher-')), 'telegrapher', 'credentials');
	await saveKey('old', path);
	await chmod(path, 0o644);
	await saveKey('secret', path);

	assert.equal((await stat(path)).mode & 0o777, 0o600);
	assert.equal(await readFile(path, 'utf8'), 'secret\n');
	assert.deepEqual(await readdir(join(path, '..')), ['credentials'], 'no temporary file should remain');
});

test('follows absolute XDG_CONFIG_HOME, and ignores a relative one', () => {
	assert.equal(credentialsPath({ XDG_CONFIG_HOME: '/x/config' }), '/x/config/telegrapher/credentials');
	assert.equal(credentialsPath({ XDG_CONFIG_HOME: 'config' }), join(homedir(), '.config', 'telegrapher', 'credentials'));
});
