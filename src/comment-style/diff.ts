// Git path decoding adapts reviewdog's unquoteCStyle, rejecting malformed escapes in TypeScript.
// https://github.com/reviewdog/reviewdog/blob/94ab47a230fbbecac1b64e3c3d2e86a7f428c655/diff/parse.go
export function unquoteCStyle(path: string): string {
	if (!path.startsWith('"')) return path.replace(/\t$/, '');
	if (!path.endsWith('"')) throw new Error('Unterminated quoted Git path');
	const bytes: number[] = [];
	const encoder = new TextEncoder();
	const escapes: Record<string, number> = { a: 7, b: 8, t: 9, n: 10, v: 11, f: 12, r: 13, '"': 34, '\\': 92 };
	const body = path.slice(1, -1);
	for (let i = 0; i < body.length; i++) {
		const char = body[i] ?? '';
		if (char !== '\\') {
			const point = body.codePointAt(i);
			if (point === undefined) throw new Error('Invalid Git path');
			bytes.push(...encoder.encode(String.fromCodePoint(point)));
			if (point > 0xffff) i++;
			continue;
		}
		const escape = body[++i] ?? '';
		if (Object.hasOwn(escapes, escape)) bytes.push(escapes[escape]);
		else if (/^[0-3][0-7]{2}$/.test(body.slice(i, i + 3))) {
			bytes.push(Number.parseInt(body.slice(i, i + 3), 8));
			i += 2;
		} else throw new Error('Invalid C escape in Git path');
	}
	return new TextDecoder('utf-8', { fatal: true }).decode(new Uint8Array(bytes));
}

// Header trimming adapts reviewdog's parseFileHeader before decoding a quoted filename.
// https://github.com/reviewdog/reviewdog/blob/94ab47a230fbbecac1b64e3c3d2e86a7f428c655/diff/parse.go
export function parseFileHeader(line: string): string {
	const value = line.slice(4);
	const tab = value.lastIndexOf('\t');
	return unquoteCStyle(tab < 0 ? value : value.slice(0, tab));
}

function headerPath(line: string): string | undefined {
	if (!line.startsWith('+++ ')) return undefined;
	const path = parseFileHeader(line);
	return path.startsWith('b/') ? path.slice(2) : undefined;
}

export function parseDiff(diff: string): { changed: Map<string, Set<number>>; removed: Map<string, Set<number>> } {
	const changed = new Map<string, Set<number>>();
	const removed = new Map<string, Set<number>>();
	let path: string | undefined;
	let oldRemaining = 0;
	let newRemaining = 0;
	for (const line of diff.split('\n')) {
		if (oldRemaining > 0 || newRemaining > 0) {
			if (line.startsWith('+')) newRemaining--;
			else if (line.startsWith('-')) oldRemaining--;
			else if (line.startsWith(' ')) { oldRemaining--; newRemaining--; }
			else if (!line.startsWith('\\ No newline')) throw new Error('Incomplete Git diff hunk');
			continue;
		}
		if (line.startsWith('diff --git ')) path = undefined;
		if (line.startsWith('+++ ')) {
			path = headerPath(line);
			if (path !== undefined) { changed.set(path, new Set()); removed.set(path, new Set()); }
			continue;
		}
		const hunk = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/.exec(line);
		if (!hunk) continue;
		oldRemaining = hunk[2] === undefined ? 1 : Number(hunk[2]);
		newRemaining = hunk[4] === undefined ? 1 : Number(hunk[4]);
		if (path === undefined) continue;
		const oldStart = Number(hunk[1]);
		const newStart = Number(hunk[3]);
		const added = changed.get(path);
		const cut = removed.get(path);
		for (let offset = 0; offset < oldRemaining; offset++) cut?.add(oldStart + offset);
		for (let offset = 0; offset < newRemaining; offset++) added?.add(newStart + offset);
		if (newRemaining === 0) for (const line of [newStart, newStart + 1]) if (line > 0) added?.add(line);
	}
	if (oldRemaining > 0 || newRemaining > 0) throw new Error('Incomplete Git diff hunk');
	return { changed, removed };
}

export function changedLines(diff: string): Map<string, Set<number>> {
	return parseDiff(diff).changed;
}

export function removedLines(diff: string): Map<string, Set<number>> {
	return parseDiff(diff).removed;
}
