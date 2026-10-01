import { chmod, mkdir, readFile, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

type Env = Record<string, string | undefined>;

// credentialsPath uses ~/.config like other command-line tools, so key never lives inside project.
export function credentialsPath(env: Env = process.env): string {
	const configHome = env.XDG_CONFIG_HOME?.trim() || join(homedir(), '.config');

	return join(configHome, 'telegrapher', 'credentials');
}

// findKey checks JEV_API_KEY first, then saved file, for either provider.
// Without any key, code checks still run, and nothing is sent to Jev at all.
export async function findKey(env: Env = process.env, path = credentialsPath(env)): Promise<string | undefined> {
	const fromEnv = env.JEV_API_KEY?.trim();
	if (fromEnv) return fromEnv;

	try {
		return (await readFile(path, 'utf8')).trim() || undefined;
	} catch {
		return undefined;
	}
}

// saveKey keeps file private to its owner, also when overwriting older file.
export async function saveKey(apiKey: string, path = credentialsPath()): Promise<void> {
	await mkdir(dirname(path), { recursive: true, mode: 0o700 });
	await writeFile(path, `${apiKey}\n`, { mode: 0o600 });
	await chmod(path, 0o600);
}
