import assert from 'node:assert/strict';
import { chmod, mkdtemp, readFile, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { credentialsPath, findKey, saveKey } from './credentials.ts';

test('JEV_API_KEY wins over saved key', async () => {
	const path = join(await mkdtemp(join(tmpdir(), 'telegrapher-')), 'credentials');
	await saveKey('saved', path);

	assert.equal(await findKey({ JEV_API_KEY: ' from-env ' }, path), 'from-env');
	assert.equal(await findKey({}, path), 'saved');
	assert.equal(await findKey({}, join(path, '..', 'missing')), undefined);
});

test('saved key file stays private, also when overwriting older readable file', async () => {
	const path = join(await mkdtemp(join(tmpdir(), 'telegrapher-')), 'telegrapher', 'credentials');
	await saveKey('old', path);
	await chmod(path, 0o644);
	await saveKey('secret', path);

	assert.equal((await stat(path)).mode & 0o777, 0o600);
	assert.equal(await readFile(path, 'utf8'), 'secret\n');
});

test('follows XDG_CONFIG_HOME when set', () => {
	assert.equal(credentialsPath({ XDG_CONFIG_HOME: '/x/config' }), '/x/config/telegrapher/credentials');
});
