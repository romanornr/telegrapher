import { readFileSync } from 'node:fs';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import type { NoulQuestion } from '@typesafe-ai/sdk';
import { bareLinks, changedLines, removedLines, codeIssues, codeKey, findComments, rewriteIssues, type CommentBlock, type Issue } from './comments.ts';
import { checkRange, git } from '../git.ts';
import { costOf, judgeOnly, type Ask, type Report, type State } from '../request.ts';

// Bump the version whenever a question changes, so saved runs stay comparable.
const pack = 'comment-style/2';

// Well above 0.5, so a near coin-flip answer does not count as a finding.
const flagProbability = 0.65;
// Jev scored invented words 91-95% and established terms such as kiss-o'-death 79-83%, steady across runs.
const jargonProbability = 0.9;
const concurrency = 8;
const sourceFiles = ['*.ts', '*.go', '*.mjs'];

// Generated parsers and bundled output follow their generators' formats.
const generated = /(?:^|\/)(?:dist|generated|internal\/syntax)\//;

function question(instructions: string): NoulQuestion & { instructions: string } {
	return { type: 'noul', instructions: `${instructions}${judgeOnly}` };
}

const questionNames = ['jargon', 'restates_code', 'status', 'unexplained_source', 'meaning_lost'] as const;

// labels are short texts for terminal output, while saved run keeps full questions.
// Source and confidence sit beside rule name, so readers never take "Jev" for flagged word.
const labels: Record<(typeof questionNames)[number], string> = {
	jargon: 'uses jargon where plain words would do. Jev does not say which word, and established technical terms are fine',
	restates_code: 'only repeats what the code does',
	status: 'describes status or progress, not a lasting fact',
	unexplained_source: 'cites a source without saying what idea it takes',
	meaning_lost: 'drops or changes a fact the committed comment stated',
};

// Each asks whether a rule is broken, so a high probability of yes is a flag.
export const questions: Record<(typeof questionNames)[number], NoulQuestion & { instructions: string }> = {
	jargon: question('Does `state.comment` use jargon: in-house shorthand, slang, or a vague or invented term where plain words would say the same? Established technical terms with one fixed meaning in their field, such as protocol names, standard numbers like RFC 8252, and standard terms of that field, do not count. Terms named in `state.code_after` or explained in `state.package_doc` do not count either.'),
	restates_code: question('Does `state.comment` only describe what `state.code_after` visibly does, adding no reason, constraint or consequence?'),
	status: question('Does `state.comment` describe project status or progress, such as planned work, recent changes or rollout state, instead of a fact that stays true?'),
	unexplained_source: question('Does `state.comment` cite an outside source, such as a link, paper or project, without stating which idea it takes from that source?'),
	meaning_lost: question('Does `state.comment` drop or change a fact that `state.previous_comment` states? Rewording, reordering, shortening and dropping filler words do not count, only lost or altered meaning.'),
};

// deleted marks committed comment removed while its code stays, with text holding what was removed.
export type CheckedComment = CommentBlock & { issues: Issue[]; packageDoc: string; previous: string[] | null; deleted?: true };
export type CommentStyleRequest = { pack: string; comments: CheckedComment[]; notes?: string[] };

// flat joins code lines without line breaks or trailing commas formatters add on rewrap: rewrapped code pairs too.
function flat(lines: string[]): string {
	return lines.join('').replace(/,(?=[)\]}])/g, '');
}

function startsWith(code: string, start: string): boolean {
	return start !== '' && code.startsWith(start);
}

// codeKeys lists code below each code line of file, letting code under comment be found again.
function codeKeys(content: string): { line: number; key: string }[] {
	const code = content.split('\n').flatMap((line, index) => codeKey([line]).map(text => ({ line: index + 1, text })));

	return code.map((entry, index) => ({ line: entry.line, key: flat(code.slice(index, index + 40).map(next => next.text)) }));
}

// unique says whether anchor names one place, since identical code may repeat past 40 lines.
type Committed = CommentBlock & { anchor: string; unique: boolean };

// Anchor is shortest start of code below comment found once in committed file, 2 lines or 40 characters at least.
// Short anchor survives edits further down, such as deleted function, and minimum length keeps generic code apart.
function committedComments(path: string, content: string): Committed[] {
	const keys = codeKeys(content).map(entry => entry.key);

	return findComments(path, content).map(block => {
		const length = block.codeKey.findIndex((_, index) => {
			const start = flat(block.codeKey.slice(0, index + 1));

			return (index >= 1 || start.length >= 40 || index === block.codeKey.length - 1) && keys.filter(key => startsWith(key, start)).length <= 1;
		});

		return { ...block, anchor: flat(length < 0 ? block.codeKey : block.codeKey.slice(0, length + 1)), unique: length >= 0 };
	});
}

// repoPath turns path given on command line into one git show accepts, or undefined outside any repository.
function repoPath(path: string): string | undefined {
	let top: string;
	try {
		top = git(['rev-parse', '--show-toplevel']).trim();
	} catch {
		return undefined;
	}
	const inside = relative(top, resolve(path));

	return inside.startsWith('..') || isAbsolute(inside) ? undefined : inside.split(sep).join('/');
}

// readBase returns file at revision, or undefined when revision or file does not exist there yet.
// Any other git failure is thrown: rewrite checks never switch off unnoticed.
function readBase(revision: string, path: string): string | undefined {
	try {
		git(['rev-parse', '--verify', '--quiet', `${revision}^{commit}`]);
	} catch {
		return undefined;
	}
	if (git(['ls-tree', '--full-tree', '--name-only', revision, '--', path]).trim() === '') return undefined;

	return git(['show', `${revision}:${path}`]);
}

// Whole files check every comment, and otherwise only comments touching changed lines, staged by default.
// Draft is checked as if it sat inside code of named file, so agents can test rewrite before editing.
export function readCommentStyle(options: { files: string[]; diff?: string; draft?: string }): CommentStyleRequest {
	const blocks: CommentBlock[] = [];

	// Git revision the files are read from: undefined for the working tree, '' for the staged index.
	let target: string | undefined;
	// Changed files and their new content, where deleted comments are looked for.
	const changed = new Map<string, string>();
	// Old lines each changed file removes, since only removed comment may be deleted one.
	let removed = new Map<string, Set<number>>();
	// New content of every file checked, where text fallback looks for old code.
	const sources = new Map<string, string>();
	// Folder named on command line, as given relative or absolute, counts as named in link checks.
	const inFolder = (block: CommentBlock): CommentBlock => ({ ...block, folder: basename(dirname(resolve(block.path))) });

	if (options.draft !== undefined) {
		const path = options.files[0] ?? 'draft.go';
		const code = path.endsWith('.go') ? 'var _ = 0' : 'void 0;';
		sources.set(path, `${code}\n${options.draft}`);
		blocks.push(...findComments(path, `${code}\n${options.draft}`).map(block => inFolder({ ...block, line: block.line - 1, endLine: block.endLine - 1 })));
	} else if (options.files.length > 0) {
		for (const path of options.files) {
			sources.set(path, readFileSync(path, 'utf8'));
			blocks.push(...findComments(path, sources.get(path) ?? '').map(inFolder));
		}
	} else {
		const range = options.diff === undefined ? undefined : checkRange(options.diff);
		target = range === undefined ? '' : range.split('..').at(-1);
		if (range !== undefined && (!range.includes('..') || range.includes('...') || !target)) throw new Error(`Diff range ${JSON.stringify(range)} must name both ends, such as main~3..main.`);

		const diff = git(['diff', '-U0', '--no-color', ...(range === undefined ? ['--cached'] : ['--end-of-options', range]), '--', ...sourceFiles]);

		removed = removedLines(diff);
		for (const [path, lines] of changedLines(diff)) {
			if (generated.test(path) || lines.size === 0) continue;

			const content = git(['show', `${target}:${path}`]);
			changed.set(path, content);
			sources.set(path, content);
			blocks.push(...findComments(path, content).filter(block => [...lines].some(line => line >= block.line && line <= block.endLine)));
		}
	}

	// Go explains shared terms once in the package doc, which a newcomer reads before any other comment.
	const docs = new Map<string, string>();
	const packageDoc = (path: string) => {
		const directory = dirname(path);
		if (!path.endsWith('.go')) return '';
		if (!docs.has(directory)) docs.set(directory, readPackageDoc(join(directory, 'doc.go'), target));

		return docs.get(directory) ?? '';
	};

	// Committed version of each file, where rewrites are compared: diff start, or HEAD for files, drafts and staged changes.
	const diffMode = options.draft === undefined && options.files.length === 0;
	const baseRevision = diffMode && options.diff !== undefined ? checkRange(options.diff).split('..')[0] ?? 'HEAD' : 'HEAD';
	const bases = new Map<string, Committed[] | undefined>();
	const baseOf = (path: string): Committed[] | undefined => {
		if (!bases.has(path)) {
			const inRepo = diffMode ? path : repoPath(path);
			const content = inRepo === undefined ? undefined : readBase(baseRevision, inRepo);
			bases.set(path, content === undefined ? undefined : committedComments(path, content));
		}

		return bases.get(path);
	};

	// Pairs comment with committed one above same code, nearest first, since rewrites leave code alone.
	// Draft may carry fewer code lines than anchor, and its line numbers say nothing about place.
	// Draft pairs only when one committed comment fits.
	const candidatesOf = (block: CommentBlock, committed: Committed[]): Committed[] => committed.filter(old => startsWith(flat(block.codeKey), old.anchor) || startsWith(old.anchor, flat(block.codeKey)));
	const keysIn = new Map<string, string[]>();
	const currentKeys = (path: string): string[] => keysIn.get(path) ?? keysIn.set(path, codeKeys(sources.get(path) ?? '').map(entry => entry.key)).get(path) ?? [];

	// Each committed comment pairs with one new comment at most: two rewrites never share one original.
	const pairOf = (block: CommentBlock, committed: Committed[], used: Set<Committed>): Committed | undefined => {
		// Unchanged comment above changed code pairs by its text.
		const byCode = candidatesOf(block, committed).filter(old => !used.has(old));
		const gone = (old: Committed) => !currentKeys(block.path).some(key => startsWith(key, old.anchor));
		// Text alone pairs only once old code is gone, never onto unrelated code elsewhere.
		const candidates = byCode.length > 0 ? byCode : committed.filter(old => !used.has(old) && gone(old) && old.text.join('\n') === block.text.join('\n'));
		if (options.draft !== undefined && candidates.length !== 1) return undefined;
		candidates.sort((a, b) => Math.abs(a.line - block.line) - Math.abs(b.line - block.line));
		const pair = candidates[0];
		if (pair !== undefined) used.add(pair);

		return pair;
	};
	const usedIn = new Map<string, Set<Committed>>();
	const usedOf = (path: string): Set<Committed> => usedIn.get(path) ?? usedIn.set(path, new Set()).get(path) ?? new Set();

	// Links this change adds anywhere, including docs, where links dropped from comment may have moved.
	let added = '';
	try {
		added = git(['diff', '-U0', '--no-color', ...(diffMode ? (options.diff === undefined ? ['--cached'] : ['--end-of-options', checkRange(options.diff)]) : ['HEAD'])]);
	} catch {
		// Outside repository or before first commit, nothing has moved.
	}
	// Only comment lines and docs count as destination, since link tacked onto code carries no fact.
	const links = new Set<string>();
	let inDocs = false;
	for (const line of added.split('\n')) {
		if (line.startsWith('+++ ')) inDocs = /\.(?:md|txt|rst|tmpl)$/.test(line);
		else if (line.startsWith('+') && (inDocs || /^\s*(?:\/\/|\/\*|\*)/.test(line.slice(1)))) for (const link of bareLinks(line)) links.add(link);
	}

	const notes: string[] = [];
	// New comments without committed pair, which deleted comment right above same code may have moved into.
	const unpaired = new Map<CommentBlock, number>();
	const comments: CheckedComment[] = blocks.map((block, index) => {
		const committed = baseOf(block.path);
		const pair = committed === undefined ? undefined : pairOf(block, committed, usedOf(block.path));
		if (pair === undefined) unpaired.set(block, index);
		const previous = pair?.text;
		if (options.draft !== undefined && committed !== undefined && previous === undefined) {
			notes.push(candidatesOf(block, committed).length > 1
				? `Several committed comments sit above code like this in ${block.path}, so rewrite checks were skipped. Pass more code lines below the comment.`
				: `No committed comment sits above this code in ${block.path}, so it is checked as new comment.`);
		}
		const rewritten = previous !== undefined && (previous.join('\n') !== block.text.join('\n') || block.size !== pair?.size);
		const issues = [...codeIssues(block), ...(rewritten ? rewriteIssues(block.text, previous, links, { now: block.size, before: pair?.size ?? previous.length }) : [])];

		return { ...block, issues, packageDoc: packageDoc(block.path), previous: rewritten ? previous : null };
	});

	// Deleted comment whose code stays loses its reason, while comment deleted with its code goes with it.
	for (const [path, content] of changed) {
		const committed = baseOf(path);
		if (committed === undefined) continue;
		const kept = new Set<Committed>();
		for (const block of findComments(path, content)) pairOf(block, committed, kept);
		const keys = codeKeys(content);

		// Repeated code leaves no single place to compare, and deletion there stays unreported rather than guessed.
		const cut = removed.get(path) ?? new Set();
		for (const old of committed) {
			if (kept.has(old) || !old.unique) continue;
			// Comment diff leaves in place was not deleted, whatever pairing guessed.
			if (!Array.from({ length: old.endLine - old.line + 1 }, (_, offset) => old.line + offset).every(line => cut.has(line))) continue;
			// Code found twice in new file names no single place either.
			const found = keys.filter(entry => startsWith(entry.key, old.anchor));
			const at = found.length === 1 ? found[0] : undefined;
			if (at === undefined) continue;

			// Comment moved up to few lines above its old code, as above enclosing if, is rewrite, not deletion.
			const near = [...unpaired.keys()].find(block => block.path === path && at.line - block.endLine >= 1 && at.line - block.endLine <= 4);
			const index = near === undefined ? undefined : unpaired.get(near);
			const moved = index === undefined ? undefined : comments[index];
			if (near !== undefined && moved !== undefined) {
				unpaired.delete(near);
				comments[index ?? 0] = { ...moved, issues: [...moved.issues, ...rewriteIssues(near.text, old.text, links, { now: near.size, before: old.size })], previous: old.text };
				continue;
			}

			comments.push({
				...old, line: at.line, endLine: at.line, packageDoc: packageDoc(path), previous: null, deleted: true,
				issues: [{ rule: 'comment_deleted', detail: 'Comment deleted while its code stays. Put it back and rewrite it.' }],
			});
		}
	}

	return { pack, comments, notes };
}

// Without ask, only code checks run, and nothing is sent.
export async function runCommentStyle(request: CommentStyleRequest, ask: Ask | undefined): Promise<Report> {
	const answered = [];
	// Undefined once any answer lacks cost, so total never undercounts.
	let cost: number | undefined = 0;

	for (let index = 0; index < request.comments.length; index += concurrency) {
		const batch = request.comments.slice(index, index + concurrency);
		answered.push(...await Promise.all(batch.map(async comment => {
			if (ask === undefined) return { ...comment, result: null, flags: [] };

			// Go requires doc comment on each exported name, and saying what name does is its job.
			const exported = comment.goName !== null && /^\p{Lu}/u.test(comment.goName);
			// Deleting comment is right only when it merely repeats code, never for exported Go name or cited source.
			if (comment.deleted && (exported || comment.text.some(line => /https?:\/\//.test(line)))) return { ...comment, result: null, flags: [] };
			// meaning_lost needs earlier version, so it is asked only about rewritten comments.
			const names = comment.deleted ? ['restates_code' as const] : questionNames.filter(name => !(name === 'restates_code' && exported) && (name !== 'meaning_lost' || comment.previous !== null));
			const state: State = { file: comment.path, comment: comment.text.join('\n'), code_after: comment.codeAfter, package_doc: comment.packageDoc };
			if (comment.previous !== null) state.previous_comment = comment.previous.join('\n');
			const result = await ask(state,
				Object.fromEntries(names.map(name => [name, questions[name]])));
			const answerCost = costOf(result);
			cost = cost === undefined || answerCost === undefined ? undefined : cost + answerCost;

			const flags = names.flatMap(name => {
				const probability = result.answers[name]?.noul ?? 0;

				return probability >= (name === 'jargon' ? jargonProbability : flagProbability) ? [{ name, probability }] : [];
			});
			if (comment.deleted) return { ...comment, issues: flags.length > 0 ? [] : comment.issues, result, flags: [] };

			return { ...comment, result, flags };
		})));
	}

	const findings = answered.filter(comment => comment.issues.length > 0 || comment.flags.length > 0).map(comment => [
		`${comment.path}:${comment.line}  ${preview(comment.text[0] ?? '')}`,
		...comment.issues.map(issue => `  ${issue.rule}: ${issue.detail}`),
		...comment.flags.map(flag => `  ${flag.name} (Jev ${Math.round(flag.probability * 100)}%): ${labels[flag.name]}`),
	].join('\n'));

	return {
		summary: `comment-style: ${findings.length} of ${request.comments.length} comments need a look `
			+ (ask === undefined ? '(code checks only, for Jev questions the user runs telegrapher auth in their own terminal)' : cost === undefined ? '(with Jev)' : `($${cost.toFixed(6)})`),
		findings,
		notes: request.notes,
		next: findings.length === 0 ? undefined : 'Check a rewrite before editing: telegrapher comment-style --stdin --file <file>. Rerun after editing until nothing is flagged.',
		record: { pack: request.pack, notes: request.notes ?? [], comments: answered },
	};
}

// preview shortens first line of comment at word, so each finding fits one terminal line.
// path:line already locates comment in file, and --json output keeps its full text.
export function preview(line: string, width = 72): string {
	if (line.length <= width) return line;
	const cut = line.lastIndexOf(' ', width - 1);

	return `${line.slice(0, cut > 0 ? cut : width - 1)}…`;
}

// The comment above the package clause of doc.go. Missing files give no context rather than an error.
function readPackageDoc(path: string, target: string | undefined): string {
	let content: string;

	try {
		content = target === undefined ? readFileSync(path, 'utf8') : git(['show', `${target}:${path}`]);
	} catch {
		return '';
	}

	return findComments(path, content).filter(block => block.overview).map(block => block.text.join('\n')).join('\n');
}
