// Finds comments in TypeScript and Go source, and checks style rules plain code can measure.
// Judgments code cannot make, such as jargon or restated code, go to Jev in check.ts.

export type CommentBlock = { path: string; line: number; endLine: number; kind: 'line' | 'block' | 'doc'; overview: boolean; goName: string | null; text: string[]; codeAfter: string };
export type Issue = { rule: 'wrapped_sentence' | 'two_sentences' | 'semicolon' | 'doc_path' | 'too_long' | 'not_telegraphic' | 'name_first' | 'uneven_lines'; detail: string };

const maxInlineLines = 4;
const minLineRatio = 0.85;
const urlOnly = /^https?:\/\/\S+$/;

// Name of a Go function, method, type, constant or variable declared on this line. Groups have no single name.
const goDeclaration = /^(?:func (?:\([^)]*\) )?|type |const |var )([\p{L}_][\p{L}\p{N}_]*)/u;
const listItem = /^(?:[-*] |\d+\. )/;

// Tool directives and licence notices follow their own required formats.
const exempt = /^(?:go:|nolint|oxlint|eslint|@ts-|#region|#endregion)|Licensed under|SPDX-License-Identifier/;

function stripMarkers(line: string, kind: CommentBlock['kind']): string {
	if (kind === 'line') return line.trim().replace(/^\/\/+\s?/, '').trimEnd();

	return line.trim().replace(/^\/\*\*?/, '').replace(/\*\/$/, '').replace(/^\*(?!\/)\s?/, '').trimEnd();
}

// A comment before any code, other than Go's package clause, is the file's overview.
export function findComments(path: string, content: string): CommentBlock[] {
	const lines = content.split('\n');
	const blocks: CommentBlock[] = [];
	let seenCode = false;
	let i = 0;

	while (i < lines.length) {
		const trimmed = lines[i]?.trim() ?? '';
		const start = i;
		let kind: CommentBlock['kind'];

		if (trimmed.startsWith('//')) {
			kind = 'line';

			while (i < lines.length && (lines[i]?.trim() ?? '').startsWith('//')) i++;
		} else if (trimmed.startsWith('/*')) {
			kind = trimmed.startsWith('/**') ? 'doc' : 'block';

			while (i < lines.length && !(lines[i] ?? '').includes('*/')) i++;

			i++;
		} else {
			if (trimmed !== '' && !trimmed.startsWith('#!') && !trimmed.startsWith('package ')) seenCode = true;
			i++;
			continue;
		}

		const text = lines.slice(start, i).map(line => stripMarkers(line, kind));

		while (text[0] === '') text.shift();

		while (text.at(-1) === '') text.pop();

		if (text.length === 0 || exempt.test(text.join('\n'))) continue;

		const codeAfter = lines.slice(i).filter(line => line.trim() !== '').slice(0, 12).join('\n');
		const goName = path.endsWith('.go') ? goDeclaration.exec(lines[i] ?? '')?.[1] ?? null : null;
		blocks.push({ path, line: start + 1, endLine: i, kind, overview: !seenCode, goName, text, codeAfter });
	}

	return blocks;
}

// Prose lines skip blanks, bare links and fenced code, which follow no sentence rules.
function proseLines(text: string[]): string[] {
	const prose: string[] = [];
	let fenced = false;

	for (const line of text) {
		if (line.startsWith('```')) fenced = !fenced;
		else if (!fenced && line !== '' && !urlOnly.test(line)) prose.push(line);
	}

	return prose;
}

// Telegraphic style drops these where meaning survives. Two or more in one comment is a flag.
// A word list cannot tell when one is needed, such as "the first link", so it names them and people decide.
const droppable = new Set(['a', 'an', 'the', 'just', 'really', 'basically', 'actually', 'simply', 'very', 'quite', 'still']);
const minDroppable = 2;

export function codeIssues(block: CommentBlock): Issue[] {
	const prose = proseLines(block.text);
	const issues: Issue[] = [];

	const wrapped = prose.filter((line, index) => {
		const next = prose[index + 1];

		return next !== undefined && !/[.!?:]["')`]*$/.test(line) && /^[a-z]/.test(next) && !listItem.test(next);
	});
	if (wrapped.length > 0) issues.push({ rule: 'wrapped_sentence', detail: `${wrapped.length} sentence(s) continue on the next line. Keep each sentence on one line.` });

	if (prose.some(line => /;\s/.test(line.replace(/`[^`]*`/g, '')))) issues.push({ rule: 'semicolon', detail: 'Semicolon joins two sentences. Split them.' });

	// A period ends a sentence only after a letter, so "0.1 seconds" and "cel.bind" stay one sentence.
	if (prose.some(line => /\p{L}[.!?]["')]* +\p{Lu}/u.test(line.replace(/`[^`]*`|"[^"]*"/g, '')))) {
		issues.push({ rule: 'two_sentences', detail: 'Two sentences share one line. Give each its own line.' });
	}

	// Go doc comments start with the exact name they document, as go doc and revive expect.
	if (block.goName !== null && prose[0] !== undefined && prose[0].split(' ')[0] !== block.goName) {
		issues.push({ rule: 'name_first', detail: `Start with ${block.goName}, the name this comment documents.` });
	}

	// A path never ends in a period, so a sentence's final period stays out of it.
	const docPath = prose.join('\n').match(/(?<![\w/])(?:docs|\.scratch)\/[\w./-]*[\w/-]|\bADR[ -]?\d{2,4}\b/);
	if (docPath) issues.push({ rule: 'doc_path', detail: `Points to ${docPath[0]}. State the reason in the comment instead.` });

	if (!block.overview && block.kind !== 'doc' && prose.length > maxInlineLines) issues.push({ rule: 'too_long', detail: `${prose.length} lines of text inside code, above ${maxInlineLines}. Links do not count.` });

	// Code spans and quoted strings are data, not prose.
	const words = prose.join(' ').replace(/`[^`]*`|"[^"]*"/g, ' ').toLowerCase().match(/[a-z]+(?:'[a-z]+)?/g) ?? [];
	const counts = new Map<string, number>();

	for (const word of words) if (droppable.has(word)) counts.set(word, (counts.get(word) ?? 0) + 1);

	if ([...counts.values()].reduce((sum, count) => sum + count, 0) >= minDroppable) {
		issues.push({ rule: 'not_telegraphic', detail: `Drop where meaning survives: ${[...counts].map(([word, count]) => `${word} ×${count}`).join(', ')}.` });
	}

	if (prose.length >= 2 && !block.text.some(line => listItem.test(line) || line.startsWith('```'))) {
		const lengths = prose.map(line => line.length);
		if (Math.min(...lengths) < minLineRatio * Math.max(...lengths)) issues.push({ rule: 'uneven_lines', detail: `Line lengths ${lengths.join(', ')} differ by more than ${Math.round((1 - minLineRatio) * 100)}%. Rebalance the sentences.` });
	}

	return issues;
}

// Maps each file in a zero-context diff to the line numbers its new version adds or changes.
export function changedLines(diff: string): Map<string, Set<number>> {
	const changed = new Map<string, Set<number>>();
	let current: Set<number> | undefined;

	for (const line of diff.split('\n')) {
		const file = /^\+\+\+ b\/(.+)$/.exec(line);

		if (file?.[1] !== undefined) {
			current = new Set();
			changed.set(file[1], current);
			continue;
		}

		if (line.startsWith('+++ ')) current = undefined;

		const hunk = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/.exec(line);
		if (hunk === null || current === undefined) continue;

		const start = Number(hunk[1]);
		const count = hunk[2] === undefined ? 1 : Number(hunk[2]);

		for (let offset = 0; offset < count; offset++) current.add(start + offset);
	}

	return changed;
}
