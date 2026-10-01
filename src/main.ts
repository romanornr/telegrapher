#!/usr/bin/env node
import { parseArgs } from 'node:util';
import { APIError, TypeSafeError } from '@typesafe-ai/sdk';
import password from '@inquirer/password';
import { questions as commentQuestions, readCommentStyle, runCommentStyle } from './comment-style/check.ts';
import { credentialsPath, findKey, saveKey } from './credentials.ts';
import { jev, model, providerOf, providers, type Ask, type Report } from './request.ts';

const usage = `Usage:
  telegrapher comment-style [--file <path>]... [--diff <from>..<to>] [--preview | --json]
  telegrapher auth

comment-style checks comments in whole files, a commit range, or by default the staged changes.
It prints only what needs a look. --preview prints the request without sending it.
--json prints every answer, including unflagged ones, for tuning. Keep that output out of committed files.
auth saves a TypeSafe or OpenRouter key for every project, readable only by you.
JEV_API_KEY, when set, wins over the saved key. Keys starting with sk-or- go through OpenRouter.
Without a key, code checks still run and nothing is sent.`;

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

// auth never prints key, so it cannot leak into terminal logs or agent transcripts.
// Without terminal, caller is script or coding agent, so auth refuses rather than take key from it.
async function auth(): Promise<number> {
	if (!process.stdin.isTTY) {
		console.error('telegrapher auth needs a person at a terminal, so the key never passes through an agent or script.');
		console.error('Agents: ask the user to run `npx github:romanornr/telegrapher auth` in their own terminal. Never ask for the key.');

		return 2;
	}

	const apiKey = (await password({ message: 'TypeSafe or OpenRouter key:' })).trim();

	if (apiKey === '') {
		console.error('No key given, nothing saved.');

		return 2;
	}

	const path = credentialsPath();
	await saveKey(apiKey, path);
	console.log(`Saved ${providers[providerOf(apiKey)].label} key (${apiKey.length} characters) to ${path}.`);

	return 0;
}

// Returns the exit code instead of calling process.exit, which can cut off output still flowing into a pipe.
async function main(): Promise<number> {
	if (positionals.length === 1 && positionals[0] === 'auth') {
		// Ctrl-C inside prompt ends auth quietly, with exit code 130 like other interrupted programs.
		return auth().catch((error: unknown) => {
			if (error instanceof Error && error.name === 'ExitPromptError') return 130;
			throw error;
		});
	}

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
	const apiKey = await findKey();

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
