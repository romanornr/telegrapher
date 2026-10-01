import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { NoulQuestion } from '@typesafe-ai/sdk';
import { changedLines, codeIssues, findComments, type CommentBlock, type Issue } from './comments.ts';
import { checkRange, git } from '../git.ts';
import { costOf, judgeOnly, type Ask, type Report } from '../request.ts';

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

const questionNames = ['jargon', 'restates_code', 'status', 'unexplained_source'] as const;

// labels are short texts for terminal output, while saved run keeps full questions.
// Source and confidence sit beside rule name, so readers never take "Jev" for flagged word.
const labels: Record<(typeof questionNames)[number], string> = {
	jargon: 'uses a term a newcomer would need to look up. Jev does not say which, so explain each technical term once in plain words',
	restates_code: 'only repeats what the code does',
	status: 'describes status or progress, not a lasting fact',
	unexplained_source: 'cites a source without saying what idea it takes',
};

// Each asks whether a rule is broken, so a high probability of yes is a flag.
export const questions: Record<(typeof questionNames)[number], NoulQuestion & { instructions: string }> = {
	jargon: question('Does `state.comment` use a technical term or abbreviation that a developer new to this codebase would need to look up, without explaining it? Terms named in `state.code_after` or explained in `state.package_doc` do not count.'),
	restates_code: question('Does `state.comment` only describe what `state.code_after` visibly does, adding no reason, constraint or consequence?'),
	status: question('Does `state.comment` describe project status or progress, such as planned work, recent changes or rollout state, instead of a fact that stays true?'),
	unexplained_source: question('Does `state.comment` cite an outside source, such as a link, paper or project, without stating which idea it takes from that source?'),
};

export type CheckedComment = CommentBlock & { issues: Issue[]; packageDoc: string };
export type CommentStyleRequest = { pack: string; comments: CheckedComment[] };

// Whole files check every comment. Otherwise only comments touching changed lines, staged by default.
export function readCommentStyle(options: { files: string[]; diff?: string }): CommentStyleRequest {
	const blocks: CommentBlock[] = [];

	// Git revision the files are read from: undefined for the working tree, '' for the staged index.
	let target: string | undefined;

	if (options.files.length > 0) {
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

	return { pack, comments: blocks.map(block => ({ ...block, issues: codeIssues(block), packageDoc: packageDoc(block.path) })) };
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

			// Go requires a doc comment on each exported name, and saying what the name does is its job.
			const names = comment.goName !== null && /^\p{Lu}/u.test(comment.goName) ? questionNames.filter(name => name !== 'restates_code') : questionNames;
			const result = await ask({ file: comment.path, comment: comment.text.join('\n'), code_after: comment.codeAfter, package_doc: comment.packageDoc },
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
