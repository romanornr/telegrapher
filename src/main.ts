#!/usr/bin/env node
import { parseArgs } from 'node:util';
import { APIError, TypeSafeError } from '@typesafe-ai/sdk';
import { createInterface } from 'node:readline/promises';
import password from '@inquirer/password';
import open from 'open';
import { questions as commentQuestions, readCommentStyle, runCommentStyle } from './comment-style/check.ts';
import { credentialsPath, findKey, saveKey, type KeySource } from './credentials.ts';
import { keyLabel, loginWithOpenRouter, shouldOpenBrowser, type Ask as AskLine, type LoginMode } from './openrouter-login.ts';
import { jev, model, providerOf, providers, type Ask, type Report } from './request.ts';

const usage = `Usage:
  telegrapher comment-style [--file <path>]... [--diff <from>..<to>] [--preview | --json]
  telegrapher auth [--browser | --no-browser | --stdin]

comment-style checks comments in whole files, a commit range, or by default the staged changes.
It prints only what needs a look. --preview prints the request without sending it.
--json prints every answer, including unflagged ones, for tuning. Keep that output out of committed files.
auth saves a TypeSafe or OpenRouter key for every project, readable only by you.
It asks for a key, or with an empty answer signs in with OpenRouter in your browser.
--browser signs in with OpenRouter straight away, and also works when a coding agent runs it.
--no-browser signs in with a code OpenRouter shows, for SSH sessions and containers.
--stdin reads a key piped from a password manager, for example: pass show openrouter | telegrapher auth --stdin
Keys are looked up in JEV_API_KEY, then the saved file, then OPENROUTER_API_KEY.
Keys starting with sk-or- go through OpenRouter. Without a key, code checks still run and nothing is sent.`;

const { positionals, values } = parseArgs({
	allowPositionals: true,
	options: {
		file: { type: 'string', multiple: true, default: [] },
		diff: { type: 'string' },
		preview: { type: 'boolean', default: false },
		json: { type: 'boolean', default: false },
		browser: { type: 'boolean' },
		stdin: { type: 'boolean', default: false },
	},
	allowNegative: true,
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

const sourceNames: Record<KeySource, string> = {
	JEV_API_KEY: 'JEV_API_KEY',
	saved: 'saved key',
	OPENROUTER_API_KEY: 'OPENROUTER_API_KEY',
};

// askLine reads one pasted line, and turns Ctrl-C into an abort so auth can exit with 130.
function askLine(interrupt: AbortController): AskLine {
	return async (message, signal) => {
		const lines = createInterface({ input: process.stdin, output: process.stdout });
		lines.on('SIGINT', () => interrupt.abort());
		try {
			return await lines.question(message, { signal });
		} finally {
			lines.close();
		}
	};
}

// readStdin reads key piped in, the way gh auth login --with-token and docker login --password-stdin do.
async function readStdin(): Promise<string> {
	let text = '';
	for await (const chunk of process.stdin) text += chunk;

	return text.trim();
}

async function save(apiKey: string): Promise<number> {
	if (apiKey === '') {
		console.error('No key given, nothing saved.');

		return 2;
	}

	const path = credentialsPath();
	await saveKey(apiKey, path);
	console.log(`Saved ${providers[providerOf(apiKey)].label} key (${apiKey.length} characters) to ${path}.`);
	if (process.env.JEV_API_KEY?.trim()) console.log('JEV_API_KEY is set in this shell and wins over the saved key.');

	return 0;
}

// signIn runs OpenRouter browser login, and announces it, because a coding agent may have started it.
async function signIn(mode: LoginMode, openBrowser: boolean, interrupt: AbortController): Promise<number> {
	const show = async (url: string) => {
		console.log(`Opening OpenRouter to create a key named ${keyLabel}. Approve only if you started this.`);
		console.log(url);
		// The printed URL stays usable when no browser opens.
		if (openBrowser) await open(url).catch(() => undefined);
	};

	try {
		return await save(await loginWithOpenRouter(mode, show, interrupt.signal));
	} catch (error) {
		if (interrupt.signal.aborted) return 130;
		console.error(error instanceof Error ? error.message : String(error));

		return 1;
	}
}

// auth never prints key, so it cannot leak into terminal logs or agent transcripts.
// Plain auth needs terminal and --stdin needs pipe, so no key is typed where agent sees it.
// --browser works without terminal, since key goes from OpenRouter straight to file.
async function auth(): Promise<number> {
	const terminal = Boolean(process.stdin.isTTY);
	const interrupt = new AbortController();

	if (values.stdin) {
		if (values.browser !== undefined) {
			console.error('--stdin reads a key, so it cannot be combined with --browser or --no-browser.');

			return 2;
		}
		if (terminal) {
			console.error('auth --stdin reads a key piped in, for example: pass show openrouter | telegrapher auth --stdin');
			console.error('To type a key instead, run telegrapher auth.');

			return 2;
		}

		return save(await readStdin());
	}

	if (values.browser === true) return signIn({ kind: 'callback', ask: terminal ? askLine(interrupt) : undefined }, shouldOpenBrowser(), interrupt);

	if (!terminal) {
		console.error('telegrapher auth needs a person at a terminal, so the key never passes through an agent or script.');
		console.error('Agents: ask the user to run `npx github:romanornr/telegrapher auth` in their own terminal. Never ask for the key.');
		console.error('With the user\'s permission, `telegrapher auth --browser` signs in through their browser instead.');

		return 2;
	}

	if (values.browser === false) return signIn({ kind: 'headless', ask: askLine(interrupt) }, false, interrupt);

	const apiKey = (await password({ message: 'TypeSafe or OpenRouter key (or press Enter to sign in with OpenRouter):' })).trim();
	if (apiKey !== '') return save(apiKey);

	const openBrowser = shouldOpenBrowser();
	const mode: LoginMode = openBrowser ? { kind: 'callback', ask: askLine(interrupt) } : { kind: 'headless', ask: askLine(interrupt) };

	return signIn(mode, openBrowser, interrupt);
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
	const found = await findKey();
	// Naming source, never key, explains which key runs when several are set.
	if (found) console.error(`Jev key: ${sourceNames[found.source]}`);

	try {
		const report = await prepared.run(found ? jev(found.key) : undefined);

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
