// Finds comments in TypeScript and Go source, and checks style rules plain code can measure.
// Judgments code cannot make, such as jargon or restated code, go to Jev in check.ts.

export type CommentBlock = { path: string; line: number; endLine: number; kind: 'line' | 'block' | 'doc'; overview: boolean; goName: string | null; text: string[]; codeAfter: string; codeKey: string[] };
export type Issue = { rule: 'wrapped_sentence' | 'semicolon' | 'doc_path' | 'too_long' | 'not_telegraphic' | 'name_first' | 'uneven_lines' | 'link_line' | 'link_last' | 'link_colon' | 'link_space' | 'link_count' | 'too_wide' | 'link_added' | 'link_dropped' | 'grew' | 'summary_moved' | 'comment_deleted'; detail: string };

const maxInlineLines = 3;
const maxLineWidth = 120;
const minLineRatio = 0.85;
const urlOnly = /^https?:\/\/\S+$/;
const hasLink = /https?:\/\/\S+/;
const hasLinks = /https?:\/\/\S+/g;
const endsInLink = /https?:\/\/\S+$/;

// Name of a Go function, method, type, constant or variable declared on this line. Groups have no single name.
const goDeclaration = /^(?:func (?:\([^)]*\) )?|type |const |var )([\p{L}_][\p{L}\p{N}_]*)/u;
const listItem = /^(?:[-*] |\d+\. )/;

// Tool directives and licence notices follow their own required formats.
const exempt = /^(?:go:|nolint|oxlint|eslint|@ts-|#region|#endregion)|Licensed under|SPDX-License-Identifier/;

function stripMarkers(line: string, kind: CommentBlock['kind']): string {
	if (kind === 'line') return line.trim().replace(/^\/\/+\s?/, '').trimEnd();

	return line.trim().replace(/^\/\*\*?\s?/, '').replace(/\*\/$/, '').replace(/^\*(?!\/)\s?/, '').trimEnd();
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
		blocks.push({ path, line: start + 1, endLine: i, kind, overview: !seenCode, goName, text, codeAfter, codeKey: codeKey(lines.slice(i)) });
	}

	return blocks;
}

// codeKey is code below comment without blanks, comments or spacing: pairing survives reformatting and comment edits.
export function codeKey(lines: string[]): string[] {
	return lines.map(line => line.trim().replace(/\s+/g, ' ')).filter(line => line !== '' && !/^(?:\/\/|\/\*|\*\/|\* |\*$)/.test(line)).slice(0, 6);
}

// Fences come in pairs, and unclosed one hides nothing from checks.
function fenceLines(text: string[]): number[] {
	const fences = text.flatMap((line, index) => line.startsWith('```') ? [index] : []);

	return fences.length % 2 === 0 ? fences : fences.slice(0, -1);
}

// Prose lines skip blanks, bare links and fenced code, which follow no sentence rules.
function proseLines(text: string[]): string[] {
	const fences = fenceLines(text);
	const prose: string[] = [];
	let fenced = false;

	for (const [index, line] of text.entries()) {
		if (fences.includes(index)) fenced = !fenced;
		else if (!fenced && line !== '' && !urlOnly.test(line)) prose.push(line);
	}

	return prose;
}

// Telegraphic style strips articles and connective words wherever meaning survives, flagging each one.
// Word list cannot tell when one is needed, such as "the first link", and names them for people.
// "for" stays out, since "wait for reply" needs it.
const droppable = new Set(['a', 'an', 'the', 'just', 'really', 'basically', 'actually', 'simply', 'very', 'quite', 'still', 'can', 'own', 'so', 'even']);
const droppablePhrases = ['these are', 'at once', 'for example'];

export function codeIssues(block: CommentBlock): Issue[] {
	const prose = proseLines(block.text);
	const issues: Issue[] = [];

	const wrapped = prose.filter((line, index) => {
		const next = prose[index + 1];

		return next !== undefined && !/[.!?:]["')`]*$/.test(line) && !endsInLink.test(line) && /^[a-z]/.test(next) && !listItem.test(next);
	});
	if (wrapped.length > 0) issues.push({ rule: 'wrapped_sentence', detail: `${wrapped.length} sentence(s) continue on the next line. Keep each sentence on one line.` });

	// Two sentences may share line when that evens out shape, but semicolon hides where first one ends.
	if (prose.some(line => /;/.test(line.replace(/`[^`]*`|"[^"]*"/g, '').replace(hasLinks, '')))) {
		issues.push({ rule: 'semicolon', detail: 'Semicolon joins two sentences. End the first with a period.' });
	}

	// Go doc comments start with the exact name they document, as go doc and revive expect.
	if (block.goName !== null && prose[0] !== undefined && prose[0].split(' ')[0] !== block.goName) {
		issues.push({ rule: 'name_first', detail: `Start with ${block.goName}, the name this comment documents.` });
	}

	// A path never ends in a period, so a sentence's final period stays out of it.
	const docPath = prose.join('\n').match(/(?<![\w/])(?:docs|\.scratch)\/[\w./-]*[\w/-]|\bADR[ -]?\d{2,4}\b/);
	if (docPath) issues.push({ rule: 'doc_path', detail: `Points to ${docPath[0]}. State the reason in the comment instead.` });

	// Links end comment, because link in middle stretches its line far past the others.
	const lines = block.text.map(line => line.trim()).filter(line => line !== '');
	const firstLink = lines.findIndex(line => hasLink.test(line));
	if (firstLink >= 0 && lines.slice(firstLink).some(line => !hasLink.test(line) || !endsInLink.test(line))) {
		issues.push({ rule: 'link_last', detail: 'Text follows a link. End the line with its link, and keep linked lines last. Never move the summary line.' });
	}

	// Colon marks what follows as source of sentence before it.
	if (lines.some(line => !urlOnly.test(line) && hasLink.test(line) && !line.slice(0, line.search(hasLink)).trimEnd().endsWith(':'))) {
		issues.push({ rule: 'link_colon', detail: 'Link follows text without a colon. Put a colon and a space before the link.' });
	}

	// Two links on one line read as sources for one sentence, even when each backs different one.
	if (lines.some(line => (line.match(hasLinks) ?? []).length > 1)) {
		issues.push({ rule: 'link_count', detail: 'Two links share one line. End each sentence a link supports with its own link, on the last lines.' });
	}

	// Colon glued to link reads as part of the address, and some viewers then fail to open it.
	if (lines.some(line => /:https?:\/\//.test(line))) issues.push({ rule: 'link_space', detail: 'Colon touches the link. Put a space between them.' });

	// Link gets separate line only under one or two lines of text, three lines at most, never trailing longer comment.
	// Link with no text above it gives no reason to follow it.
	if (lines.some(line => urlOnly.test(line))) {
		if (prose.length === 0) issues.push({ rule: 'link_line', detail: 'Link stands alone without text. Say what the source supports, then end that line with a colon and the link.' });
		else if (prose.length > 2 || lines.length > 3) issues.push({ rule: 'link_line', detail: 'Link has its own line, but the comment then runs past three lines. End the last line of text with a colon, then the link.' });
	}

	if (!block.overview && block.kind !== 'doc' && prose.length > maxInlineLines) issues.push({ rule: 'too_long', detail: `${prose.length} lines of text inside code, above ${maxInlineLines}. Links do not count.` });

	// Width cap stops text from being folded into one long line to stay within line limit.
	const widest = Math.max(0, ...prose.map(line => line.replace(hasLinks, '').trimEnd().length));
	if (widest > maxLineWidth) issues.push({ rule: 'too_wide', detail: `Line has ${widest} characters of text, above ${maxLineWidth}. Links do not count. Cut words, not meaning.` });

	// Code spans, quoted strings and links are data, not prose.
	let plain = prose.join(' ').replace(/`[^`]*`|"[^"]*"/g, ' ').replace(hasLinks, ' ').toLowerCase().replace(/\s+/g, ' ');
	const counts = new Map<string, number>();

	for (const phrase of droppablePhrases) {
		const pattern = new RegExp(`\\b${phrase}\\b`, 'g');
		const found = plain.match(pattern)?.length ?? 0;
		if (found > 0) counts.set(phrase, found);
		plain = plain.replace(pattern, ' ');
	}

	for (const word of plain.match(/[a-z]+(?:'[a-z]+)?/g) ?? []) if (droppable.has(word)) counts.set(word, (counts.get(word) ?? 0) + 1);

	if (counts.size > 0) {
		issues.push({ rule: 'not_telegraphic', detail: `Drop where meaning survives: ${[...counts].map(([word, count]) => `${word} ×${count}`).join(', ')}.` });
	}

	const visible = block.text.map(line => line.trim()).filter(line => line !== '');
	if (visible.length >= 2 && !block.text.some(line => listItem.test(line)) && fenceLines(block.text).length === 0) {
		if (visible.some(line => hasLink.test(line))) {
			// Link line is widest, so lines above it must widen toward it, measured as seen, link included.
			const widths = visible.map(line => line.length);
			if (widths.some((width, index) => index > 0 && width < (widths[index - 1] ?? 0))) {
				issues.push({ rule: 'uneven_lines', detail: `Line lengths ${widths.join(', ')} dip before the link. Each line should be at least as long as the one above, so the link line ends widest.` });
			}
		} else {
			// Lines may stay level, only grow or only shrink.
			// Line sticking out past its neighbours, up then down or down then up, reads as ragged.
			const lengths = prose.map(line => line.length);
			const steps = lengths.slice(1).map((length, index) => length - (lengths[index] ?? 0)).filter(step => step !== 0);
			const even = Math.min(...lengths) >= minLineRatio * Math.max(...lengths);
			if (!even && steps.some(step => step > 0) && steps.some(step => step < 0)) {
				issues.push({ rule: 'uneven_lines', detail: `Line lengths ${lengths.join(', ')} zigzag. Rebalance the sentences so lengths only grow, only shrink, or stay within ${Math.round((1 - minLineRatio) * 100)}%.` });
			}
		}
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

		// Pure deletion sits between new lines start and start + 1, and comment it cut into touches one of them.
		if (count === 0) for (const line of [start, start + 1]) if (line > 0) current.add(line);

		for (let offset = 0; offset < count; offset++) current.add(start + offset);
	}

	return changed;
}

// linksIn counts links without angle brackets or trailing punctuation, and final period never makes link look new.
// Counts, not set, making repeated link on another line count as added.
function linksIn(text: string[]): Map<string, number> {
	const counts = new Map<string, number>();
	for (const link of text.join(' ').match(hasLinks) ?? []) {
		const bare = link.replace(/[.,;:)>]+$/, '');
		counts.set(bare, (counts.get(bare) ?? 0) + 1);
	}

	return counts;
}

// Summary line compared without links, closing colon or spacing: moving its link alone keeps it in place.
function summaryOf(line: string): string {
	return line.replace(hasLinks, '').replace(/[\s:<]+$/, '').replace(/\s+/g, ' ').trim().toLowerCase();
}

// rewriteIssues compares comment with its committed version, checking rewrite keeps links, summary and size.
export function rewriteIssues(text: string[], previous: string[]): Issue[] {
	const issues: Issue[] = [];
	const now = linksIn(text);
	const before = linksIn(previous);

	if ([...now].some(([link, count]) => count > (before.get(link) ?? 0))) issues.push({ rule: 'link_added', detail: 'Rewrite adds a link the previous comment did not have. Keep only its links.' });
	if ([...before].some(([link, count]) => count > (now.get(link) ?? 0))) issues.push({ rule: 'link_dropped', detail: 'Rewrite drops a link the previous comment had. Keep every link, at the end of the sentence it supports.' });

	// Blank lines count too. Only exception: giving each link that shared line separate line.
	const split = previous.reduce((extra, line) => extra + Math.max(0, (line.match(hasLinks) ?? []).length - 1), 0);
	if (text.length > previous.length + split) {
		issues.push({ rule: 'grew', detail: `Rewrite has ${text.length} lines, previous comment had ${previous.length}. Never add lines${split > 0 ? `, except ${split} to give each link its own line` : ''}.` });
	}

	const summary = summaryOf(previous[0] ?? '');
	const moved = summary === '' ? -1 : text.findIndex(line => summaryOf(line) === summary);
	if (moved > 0) issues.push({ rule: 'summary_moved', detail: `First line of the previous comment is now line ${moved + 1}. Keep it first, and move links or other lines instead.` });

	return issues;
}
