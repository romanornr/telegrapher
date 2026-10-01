import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { NoulQuestion } from '@typesafe-ai/sdk';
import { changedLines, codeIssues, findComments, rewriteIssues, type CommentBlock, type Issue } from './comments.ts';
import { checkRange, git } from '../git.ts';
import { costOf, judgeOnly, type Ask, type Report, type State } from '../request.ts';

// Bump the version whenever a question changes, so saved runs stay comparable.
const pack = 'comment-style/2';

// Well above 0.5, so a near coin-flip answer does not count as a finding.
const flagProbability = 0.65;
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

export type CheckedComment = CommentBlock & { issues: Issue[]; packageDoc: string; previous: string[] | null };
export type CommentStyleRequest = { pack: string; comments: CheckedComment[] };

// Whole files check every comment, and otherwise only comments touching changed lines, staged by default.
// Draft is checked as if it sat inside code of named file, so agents can test rewrite before editing.
export function readCommentStyle(options: { files: string[]; diff?: string; draft?: string }): CommentStyleRequest {
	const blocks: CommentBlock[] = [];

	// Git revision the files are read from: undefined for the working tree, '' for the staged index.
	let target: string | undefined;

	if (options.draft !== undefined) {
		const path = options.files[0] ?? 'draft.go';
		const code = path.endsWith('.go') ? 'var _ = 0' : 'void 0;';
		blocks.push(...findComments(path, `${code}\n${options.draft}`).map(block => ({ ...block, line: block.line - 1, endLine: block.endLine - 1 })));
	} else if (options.files.length > 0) {
		for (const path of options.files) blocks.push(...findComments(path, readFileSync(path, 'utf8')));
	} else {
		const range = options.diff === undefined ? undefined : checkRange(options.diff);
		target = range === undefined ? '' : range.split('..').at(-1);
		if (range !== undefined && (!range.includes('..') || range.includes('...') || !target)) throw new Error(`Diff range ${JSON.stringify(range)} must name both ends, such as main~3..main.`);

		const diff = git(['diff', '-U0', '--no-color', ...(range === undefined ? ['--cached'] : ['--end-of-options', range]), '--', ...sourceFiles]);

		for (const [path, lines] of changedLines(diff)) {
			if (generated.test(path) || lines.size === 0) continue;

			const content = git(['show', `${target}:${path}`]);
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
	const baseRevision = options.draft === undefined && options.files.length === 0 && options.diff !== undefined ? checkRange(options.diff).split('..')[0] : 'HEAD';
	const bases = new Map<string, CommentBlock[]>();
	const previousOf = (block: CommentBlock): string[] | null => {
		if (!bases.has(block.path)) {
			let content = '';
			try {
				content = git(['show', `${baseRevision}:${block.path}`]);
			} catch {
				// New or untracked file, so no comment has an earlier version.
			}
			bases.set(block.path, content === '' ? [] : findComments(block.path, content));
		}

		// Pairs comment with committed one above same code line, nearest first, since rewrites leave code alone.
		const candidates = (bases.get(block.path) ?? []).filter(old => old.codeLine === block.codeLine);
		candidates.sort((a, b) => Math.abs(a.line - block.line) - Math.abs(b.line - block.line));

		return candidates[0]?.text ?? null;
	};

	return {
		pack,
		comments: blocks.map(block => {
			const previous = previousOf(block);
			const changed = previous !== null && previous.join('\n') !== block.text.join('\n');
			const issues = [...codeIssues(block), ...(changed ? rewriteIssues(block.text, previous) : [])];

			return { ...block, issues, packageDoc: packageDoc(block.path), previous: changed ? previous : null };
		}),
	};
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
			// meaning_lost needs earlier version, so it is asked only about rewritten comments.
			const names = questionNames.filter(name => !(name === 'restates_code' && comment.goName !== null && /^\p{Lu}/u.test(comment.goName)) && (name !== 'meaning_lost' || comment.previous !== null));
			const state: State = { file: comment.path, comment: comment.text.join('\n'), code_after: comment.codeAfter, package_doc: comment.packageDoc };
			if (comment.previous !== null) state.previous_comment = comment.previous.join('\n');
			const result = await ask(state,
				Object.fromEntries(names.map(name => [name, questions[name]])));
			const answerCost = costOf(result);
			cost = cost === undefined || answerCost === undefined ? undefined : cost + answerCost;

			const flags = names.flatMap(name => {
				const probability = result.answers[name]?.noul ?? 0;

				return probability >= flagProbability ? [{ name, probability }] : [];
			});

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
		next: findings.length === 0 ? undefined : 'Check a rewrite before editing: telegrapher comment-style --stdin --file <file>. Rerun after editing until nothing is flagged.',
		record: { pack: request.pack, comments: answered },
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
