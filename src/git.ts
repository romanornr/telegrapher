import { execFileSync } from 'node:child_process';

export function git(args: string[], cwd?: string): string {
	// Captures git's error output, so expected misses stay quiet. A thrown error still carries it.
	return execFileSync('git', args, { cwd, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] });
}

// A range starting with "-" would be read as a git option, such as --output, which writes files.
export function checkRange(range: string): string {
	if (range.startsWith('-')) throw new Error(`Diff range ${JSON.stringify(range)} must not start with "-".`);

	return range;
}

// Diff flags adapt golangci revgrep's gitDiff, using fixed prefixes and the repository root instead of relative paths.
// https://github.com/golangci/revgrep/blob/9c0507b9e81a006bb7f5c4a311c9e4e317ece771/patch.go
export function gitDiff(args: string[], root: string): string {
	return git(['diff', '--no-color', '--no-ext-diff', '--no-textconv', '--inter-hunk-context=0', '--ignore-submodules=none', '--src-prefix=a/', '--dst-prefix=b/', '--no-relative', ...args], root);
}

export type ChangedFile = { status: string; path: string; previousPath: string };
export function diffFiles(args: string[], root: string): ChangedFile[] {
	const tokens = gitDiff(['--name-status', '-z', '--find-renames', ...args, '--'], root).split('\0');
	const files: ChangedFile[] = [];
	for (let i = 0; i < tokens.length - 1;) {
		const status = tokens[i++];
		const first = tokens[i++];
		const path = status.startsWith('R') || status.startsWith('C') ? tokens[i++] : first;
		if (!status || first === undefined || path === undefined) throw new Error('Incomplete Git file enumeration');
		files.push({ status, path, previousPath: first });
	}
	return files;
}
