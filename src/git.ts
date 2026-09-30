import { execFileSync } from 'node:child_process';

export function git(args: string[]): string {
	// Captures git's error output, so expected misses stay quiet. A thrown error still carries it.
	return execFileSync('git', args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] });
}

// A range starting with "-" would be read as a git option, such as --output, which writes files.
export function checkRange(range: string): string {
	if (range.startsWith('-')) throw new Error(`Diff range ${JSON.stringify(range)} must not start with "-".`);

	return range;
}
