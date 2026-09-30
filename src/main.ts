import { parseArgs } from 'node:util';
import { APIError, TypeSafeError } from '@typesafe-ai/sdk';
import { questions as commentQuestions, readCommentStyle, runCommentStyle } from './comment-style/check.ts';
import { jev, model, type Ask, type Report } from './request.ts';

const usage = `Usage:
  telegrapher comment-style [--file <path>]... [--diff <from>..<to>] [--preview | --json]

comment-style checks comments in whole files, a commit range, or by default the staged changes.
It prints only what needs a look. --preview prints the request without sending it.
--json prints every answer, including unflagged ones, for tuning. Keep that output out of committed files.
Sending needs JEV_API_KEY in the environment or a .env file here.`;

const { positionals, values } = parseArgs({
	allowPositionals: true,
	options: {
		file: { type: 'string', multiple: true, default: [] },
		diff: { type: 'string' },
		preview: { type: 'boolean', default: false },
		json: { type: 'boolean', default: false },
	},
});

type Prepared = { preview: unknown; run: (ask: Ask | undefined) => Promise<Report> };

function prepare(): Prepared | undefined {
	const [check] = positionals;
	if (positionals.length !== 1) return undefined;

	if (check === 'comment-style') {
		const request = readCommentStyle({ files: values.file, diff: values.diff });

		return { preview: { model, questions: commentQuestions, ...request }, run: ask => runCommentStyle(request, ask) };
	}

	return undefined;
}

// Returns the exit code instead of calling process.exit, which can cut off output still flowing into a pipe.
async function main(): Promise<number> {
	const prepared = prepare();

	if (prepared === undefined) {
		console.error(usage);

		return 2;
	}

	if (values.preview) {
		console.log(JSON.stringify(prepared.preview, null, 2));

		return 0;
	}

	// Without a key, code checks still run and Jev is skipped.
	const apiKey = process.env.JEV_API_KEY?.trim();

	try {
		const report = await prepared.run(apiKey ? jev(apiKey) : undefined);

		if (values.json) {
			console.log(JSON.stringify(report.record, null, 2));
		} else {
			console.log(report.summary);

			for (const finding of report.findings) console.log(`\n${finding}`);
		}

		return 0;
	} catch (error) {
		// The service enforces its own state limit and names it in the body, such as max_tokens_exceeded.
		if (error instanceof APIError) console.error(`Jev request failed: ${error.name}, HTTP ${error.status}: ${JSON.stringify(error.body)}`);
		else if (error instanceof TypeSafeError) console.error(`Jev request failed: ${error.name}`);
		else throw error;

		return 1;
	}
}

process.exitCode = await main();
