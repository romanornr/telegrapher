import { chmod, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, isAbsolute, join } from 'node:path';

type Env = Record<string, string | undefined>;

// KeySource names where key came from, so output can say which one is used without printing it.
export type KeySource = 'JEV_API_KEY' | 'saved' | 'OPENROUTER_API_KEY';
export type FoundKey = { key: string; source: KeySource };

// credentialsPath uses ~/.config like other command-line tools, so key never lives inside project.
// XDG_CONFIG_HOME, usual way to move ~/.config, must be absolute, so relative values are ignored.
export function credentialsPath(env: Env = process.env): string {
	const configHome = env.XDG_CONFIG_HOME?.trim();

	return join(configHome && isAbsolute(configHome) ? configHome : join(homedir(), '.config'), 'telegrapher', 'credentials');
}

// findKey tries JEV_API_KEY, then saved file, then OPENROUTER_API_KEY, which other tools share.
// Shared key comes last, so it never replaces key saved for telegrapher on purpose.
// Without any key, code checks still run locally, and nothing is sent to Jev at all.
export async function findKey(env: Env = process.env, path = credentialsPath(env)): Promise<FoundKey | undefined> {
	const fromEnv = env.JEV_API_KEY?.trim();
	if (fromEnv) return { key: fromEnv, source: 'JEV_API_KEY' };

	const saved = await readFile(path, 'utf8').then(
		text => text.trim(),
		() => '',
	);
	if (saved) return { key: saved, source: 'saved' };

	const shared = env.OPENROUTER_API_KEY?.trim();
	if (shared) return { key: shared, source: 'OPENROUTER_API_KEY' };

	return undefined;
}

// saveKey keeps file private to its owner, also when overwriting older file.
// It writes temporary file, then renames it, so crash never leaves half-written key.
export async function saveKey(apiKey: string, path = credentialsPath()): Promise<void> {
	await mkdir(dirname(path), { recursive: true, mode: 0o700 });
	const temporary = `${path}.${process.pid}.tmp`;

	try {
		await writeFile(temporary, `${apiKey}\n`, { mode: 0o600 });
		await chmod(temporary, 0o600);
		await rename(temporary, path);
	} catch (error) {
		await rm(temporary, { force: true });
		throw error;
	}
}
