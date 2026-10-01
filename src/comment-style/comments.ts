// Finds comments in TypeScript and Go source, and checks style rules plain code can measure.
// Judgments code cannot make, such as jargon or restated code, go to Jev in check.ts.

export type CommentBlock = { path: string; line: number; endLine: number; kind: 'line' | 'block' | 'doc'; overview: boolean; goName: string | null; text: string[]; size: number; codeAfter: string; codeKey: string[] };
export type Issue = { rule: 'wrapped_sentence' | 'crowded_line' | 'semicolon' | 'doc_path' | 'too_long' | 'not_telegraphic' | 'name_first' | 'uneven_lines' | 'link_line' | 'link_last' | 'link_colon' | 'link_space' | 'link_count' | 'link_mismatch' | 'too_wide' | 'link_added' | 'link_dropped' | 'grew' | 'summary_moved' | 'comment_deleted'; detail: string };

const maxInlineLines = 3;
const maxLineWidth = 120;
const minLineRatio = 0.85;
const urlOnly = /^<?https?:\/\/\S+$/;
const linkStart = /<?https?:\/\//;
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
		blocks.push({ path, line: start + 1, endLine: i, kind, overview: !seenCode, goName, text, size: i - start, codeAfter, codeKey: codeKey(lines.slice(i)) });
	}

	return blocks;
}

// codeKey is code below comment without blanks, comments or any spacing: pairing survives reformatting and comment edits.
// Up to 40 lines, letting repeated test setups differ somewhere.
export function codeKey(lines: string[], length = 40): string[] {
	const key: string[] = [];
	for (const line of lines) {
		const trimmed = line.trim();
		if (trimmed === '' || /^(?:\/\/|\/\*|\*\/|\* |\*$)/.test(trimmed)) continue;
		key.push(trimmed.replace(/\s+/g, ''));
		if (key.length === length) break;
	}

	return key;
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
	if (prose.some(line => /;/.test(line.replace(/`[^`]*`|"[^"]*"|'[^'\s]'/g, '').replace(hasLinks, '')))) {
		issues.push({ rule: 'semicolon', detail: 'Semicolon joins two sentences. End the first with a period.' });
	}

	// Two short sentences may share line for better shape, never three.
	// Sentence ends after letter or digit, keeping "0.1 seconds" and "cel.bind" one sentence.
	if (prose.some(line => (line.replace(/`[^`]*`|"[^"]*"/g, '').replace(hasLinks, '').match(/[\p{L}\p{N}][.!?]["')]* +\p{Lu}/gu) ?? []).length >= 2)) {
		issues.push({ rule: 'crowded_line', detail: 'Three or more sentences share one line. Keep at most two short ones together.' });
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
	if (lines.some(line => !urlOnly.test(line) && hasLink.test(line) && !line.slice(0, line.search(linkStart)).trimEnd().endsWith(':'))) {
		issues.push({ rule: 'link_colon', detail: 'Link follows text without a colon. Put a colon and a space before the link.' });
	}

	// Link backs sentence naming its source, as RFC 5905 names rfc-editor.org/rfc/rfc5905, and shared name ties them.
	// Bare link line backs text above it.
	const mismatched = lines.filter((line, index) => {
		const link = line.match(hasLink)?.[0];
		if (link === undefined) return false;
		const sentence = urlOnly.test(line) ? lines.slice(0, index).filter(above => !urlOnly.test(above)).join(' ') : line.slice(0, line.search(hasLink));
		if (names(sentence).length === 0) return false;
		// Package folder counts as named, as okx.com docs are plain inside exchanges/okx.
		const named = joined(names(`${sentence} ${block.path.split('/').at(-2) ?? ''}`));
		const source = joined(names(link.replace(/#L\d+(?:-L\d+)?$/, '')));

		return !source.some(part => named.some(name => sameName(part, name)));
	});
	if (mismatched.length > 0) {
		issues.push({ rule: 'link_mismatch', detail: `Sentence never names source of ${bareLinks(mismatched[0] ?? '')[0]}. End the sentence that names it with this link, or name it here.` });
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
		else if (prose.length > 2 || (block.kind === 'line' ? block.size : block.text.length) > 3) issues.push({ rule: 'link_line', detail: 'Link has its own line, but the comment then runs past three lines. End the last line of text with a colon, then the link.' });
	}

	if (!block.overview && block.kind !== 'doc' && prose.length > maxInlineLines) issues.push({ rule: 'too_long', detail: `${prose.length} lines of text inside code, above ${maxInlineLines}. Links do not count. Keep summary and what readers need here, and move each other fact, with its link, next to the code it explains or into docs.` });

	// Width cap stops text from being folded into one long line to stay within line limit.
	const widest = Math.max(0, ...prose.map(line => line.replace(hasLinks, '').trimEnd().length));
	if (widest > maxLineWidth) issues.push({ rule: 'too_wide', detail: `Line has ${widest} characters of text, above ${maxLineWidth}. Links do not count. Split it into two sentences on separate lines, or cut words, not meaning.` });

	// Code spans, quoted strings and links are data, not prose.
	// Hyphenated compound such as once-an-hour is one word, and its parts are no filler.
	let plain = prose.join(' ').replace(/`[^`]*`|"[^"]*"/g, ' ').replace(hasLinks, ' ').replace(/[\p{L}\p{N}']+(?:-[\p{L}\p{N}']+)+/gu, ' ').toLowerCase().replace(/\s+/g, ' ');
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

// URL parts every link shares, which name no source.
const plainParts = new Set(['http', 'https', 'www', 'com', 'org', 'net', 'io', 'dev', 'html', 'htm', 'md', 'pdf', 'blob', 'tree', 'main', 'master', 'src', 'docs', 'doc', 'en', 'cgi', 'github', 'gitlab', 'raw', 'githubusercontent']);

// names splits text into lowercase name parts, letters and digits apart: "RFC 5905" and rfc5905 share rfc and 5905.
// Commit hashes and one-letter parts name nothing.
function names(text: string): string[] {
	return (text.toLowerCase().match(/[a-z]+|\d+/g) ?? []).filter(part => part.length > 1 && !plainParts.has(part) && !/^[0-9a-f]{7,40}$/.test(part));
}

// joined adds each pair of neighbouring parts: "NTP Pool" names ntppool.org, and gate.io names gateio.
function joined(parts: string[]): string[] {
	return [...parts, ...parts.slice(1).map((part, index) => `${parts[index] ?? ''}${part}`)];
}

// Longer names match inside each other: currencyconverter names currencyconverterapi.com.
function sameName(a: string, b: string): boolean {
	return a === b || (Math.min(a.length, b.length) >= 4 && (a.includes(b) || b.includes(a)));
}

// bareLinks drops angle brackets and trailing punctuation, and final period never makes link look new.
export function bareLinks(text: string): string[] {
	return (text.match(hasLinks) ?? []).map(link => link.replace(/[.,;:)>]+$/, ''));
}

// linksIn counts links, not set, making repeated link on another line count as added.
function linksIn(text: string[]): Map<string, number> {
	const counts = new Map<string, number>();
	for (const link of bareLinks(text.join(' '))) counts.set(link, (counts.get(link) ?? 0) + 1);

	return counts;
}

// Summary words without links or punctuation, finding moved summary after rewording or new link.
function summaryWords(line: string): Set<string> {
	return new Set(line.replace(hasLinks, ' ').toLowerCase().match(/[\p{L}\p{N}]+(?:['-][\p{L}\p{N}]+)*/gu) ?? []);
}

// overlap is share of summary words line keeps.
function overlap(summary: Set<string>, line: string): number {
	const words = summaryWords(line);

	return summary.size === 0 ? 0 : [...summary].filter(word => words.has(word)).length / summary.size;
}

// rewriteIssues compares comment with its committed version, checking rewrite keeps links, summary and size.
// Link added elsewhere in same change moved with its fact, next to other code or into docs: not dropped.
// Sizes count blank comment lines at edges too, which text leaves out.
export function rewriteIssues(text: string[], previous: string[], moved: ReadonlySet<string> = new Set(), sizes = { now: text.length, before: previous.length }): Issue[] {
	const issues: Issue[] = [];
	const now = linksIn(text);
	const before = linksIn(previous);

	if ([...now].some(([link, count]) => count > (before.get(link) ?? 0))) issues.push({ rule: 'link_added', detail: 'Rewrite adds a link the previous comment did not have. Keep only its links.' });
	if ([...before].some(([link, count]) => count > (now.get(link) ?? 0) && !moved.has(link))) {
		issues.push({ rule: 'link_dropped', detail: 'Rewrite drops a link the previous comment had. Keep it at the end of the sentence it supports, or move it with its fact next to the code it explains or into docs, in the same change.' });
	}

	// Blank lines count too. Only exception: giving each link that shared line separate line.
	// Exception holds only once links no longer share lines.
	const shared = (lines: string[]) => lines.reduce((extra, line) => extra + Math.max(0, (line.match(hasLinks) ?? []).length - 1), 0);
	const split = shared(text) === 0 ? shared(previous) : 0;
	if (sizes.now > sizes.before + split) {
		issues.push({ rule: 'grew', detail: `Rewrite has ${sizes.now} lines, previous comment had ${sizes.before}. Never add lines${split > 0 ? `, except ${split} to give each link its own line` : ''}.` });
	}

	// Summary moved when later line keeps more of its words than first line, and at least half.
	const summary = summaryWords(previous.find(line => line.trim() !== '') ?? '');
	const scores = text.map(line => overlap(summary, line));
	const best = scores.indexOf(Math.max(...scores));
	const position = best > 0 && (scores[best] ?? 0) >= 0.5 && (scores[best] ?? 0) > (scores[0] ?? 0) ? best : -1;
	if (position > 0) issues.push({ rule: 'summary_moved', detail: `First line of the previous comment is now line ${position + 1}. Keep it first, and move links or other lines instead.` });

	return issues;
}
