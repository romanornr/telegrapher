import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { createServer, type ServerResponse } from 'node:http';

// Browser sign-in with OpenRouter's PKCE flow (RFC 7636) returns ordinary sk-or- key, never refresh token.
// Login flow is adapted from pi's OpenRouter module: https://github.com/earendil-works/pi/blob/8ce69e9d2b171d173fe4b6b2b6256f1f4411e69d/packages/ai/src/auth/oauth/openrouter.ts
// Callback server is adapted from pi's shared one, merged into this module: https://github.com/earendil-works/pi/blob/8ce69e9d2b171d173fe4b6b2b6256f1f4411e69d/packages/ai/src/auth/oauth/callback-server.ts
// Sign-in steps and headless mode follow OpenRouter's guide for command-line apps: https://openrouter.ai/docs/guides/overview/auth/oauth

const authorizeURL = 'https://openrouter.ai/auth';
const exchangeURL = 'https://openrouter.ai/api/v1/auth/keys';
const loginTimeout = 5 * 60_000;
const exchangeTimeout = 30_000;

// keyLabel names created key in OpenRouter's dashboard, so user can find and revoke it there.
export const keyLabel = 'telegrapher';

// Ask reads one pasted line, and rejects when signal aborts.
export type Ask = (message: string, signal: AbortSignal) => Promise<string>;

// LoginMode picks how OpenRouter's authorisation code reaches telegrapher.
// callback: browser redirects to local server, and ask can also take pasted code.
// headless: OpenRouter shows code on its page, and user pastes it into ask.
export type LoginMode = { kind: 'callback'; ask?: Ask } | { kind: 'headless'; ask: Ask };

// pkce makes RFC 7636 S256 pair: random verifier, and its SHA-256 hash as challenge.
function pkce(): { verifier: string; challenge: string } {
	const verifier = randomBytes(32).toString('base64url');

	return { verifier, challenge: createHash('sha256').update(verifier).digest('base64url') };
}

// parseCode finds code in whatever user pastes, including redirect URL of page that failed over SSH.
export function parseCode(input: string): string | undefined {
	const value = input.trim();
	if (!value) return undefined;

	try {
		return new URL(value).searchParams.get('code') ?? undefined;
	} catch {
		// Not a URL, so query string or bare code.
	}

	return value.includes('code=') ? (new URLSearchParams(value).get('code') ?? undefined) : value;
}

type JsonObject = Record<string, unknown>;

function errorDetail(body: JsonObject): string | undefined {
	if (typeof body.error_description === 'string') return body.error_description;
	if (typeof body.message === 'string') return body.message;
	if (typeof body.error === 'string') return body.error;
	if (body.error && typeof body.error === 'object') {
		const message = (body.error as JsonObject).message;
		if (typeof message === 'string') return message;
	}

	return undefined;
}

// exchange swaps one-time sign-in code, plus secret only this process knows, for new key.
// Any failed HTTP status reports OpenRouter's own message, since live codes differ from docs.
export async function exchange(code: string, verifier: string, signal: AbortSignal, fetchKey = fetch): Promise<string> {
	const response = await fetchKey(exchangeURL, {
		method: 'POST',
		headers: { accept: 'application/json', 'content-type': 'application/json' },
		body: JSON.stringify({ code, code_verifier: verifier, code_challenge_method: 'S256' }),
		signal: AbortSignal.any([signal, AbortSignal.timeout(exchangeTimeout)]),
	});
	const body: JsonObject = await response.json().then(
		(parsed: unknown) => (parsed && typeof parsed === 'object' ? (parsed as JsonObject) : {}),
		() => ({}),
	);

	if (!response.ok) {
		const detail = errorDetail(body);
		throw new Error(`OpenRouter key exchange failed (HTTP ${response.status})${detail ? `: ${detail}` : ''}`);
	}
	if (typeof body.key !== 'string' || body.key === '') throw new Error('OpenRouter returned no key');

	return body.key;
}

type CallbackServer = {
	redirectURI: string;
	// wait resolves with key, or undefined after cancel, and rejects on provider error, timeout or abort.
	wait: () => Promise<string | undefined>;
	cancel: () => void;
	close: () => void;
};

function sendPage(response: ServerResponse, status: number, text: string): void {
	response.writeHead(status, { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' });
	response.end(`${text}\n`);
}

// startCallbackServer waits for OpenRouter's redirect on this computer only, at free port.
// OpenRouter adds no check value to its redirect, so secret random path blocks stray requests.
// It swaps code for key before answering browser, so its page can show failures too.
// Listening locally at free port follows desktop sign-in standard RFC 8252 section 7.3: https://www.rfc-editor.org/rfc/rfc8252#section-7.3
export async function startCallbackServer(complete: (code: string) => Promise<string>, signal: AbortSignal): Promise<CallbackServer> {
	if (signal.aborted) throw new Error('Login cancelled');
	const path = `/callback/${randomUUID()}`;
	const { promise, resolve, reject } = Promise.withResolvers<string | undefined>();
	// A cancelled or closed wait may never be observed.
	promise.catch(() => undefined);

	let claimed = false;
	let settled = false;
	const finish = (result: { key: string | undefined } | { error: Error }): void => {
		if (settled) return;
		settled = true;
		clearTimeout(timer);
		signal.removeEventListener('abort', onAbort);
		if ('error' in result) reject(result.error);
		else resolve(result.key);
	};
	const onAbort = () => finish({ error: new Error('Login cancelled') });

	const server = createServer((request, response) => {
		void (async () => {
			const url = new URL(request.url ?? '/', 'http://127.0.0.1');
			if (request.method !== 'GET' || url.pathname !== path) return sendPage(response, 404, 'Not found.');
			if (claimed || settled) return sendPage(response, 409, 'This sign-in has already been handled.');

			const error = url.searchParams.get('error');
			if (error) {
				const description = url.searchParams.get('error_description') ?? error;
				sendPage(response, 400, `OpenRouter sign-in failed: ${description}`);

				return finish({ error: new Error(`OpenRouter sign-in failed: ${description}`) });
			}

			const code = url.searchParams.get('code');
			if (!code) return sendPage(response, 400, 'Missing authorization code.');

			claimed = true;
			try {
				const key = await complete(code);
				sendPage(response, 200, 'Signed in to OpenRouter. telegrapher saved the key. You can close this page.');
				finish({ key });
			} catch (error) {
				const failure = error instanceof Error ? error : new Error(String(error));
				sendPage(response, 502, `OpenRouter sign-in failed: ${failure.message}`);
				finish({ error: failure });
			}
		})();
	});

	await new Promise<void>((resolveListen, rejectListen) => {
		server.once('error', rejectListen);
		server.listen(0, '127.0.0.1', () => {
			server.off('error', rejectListen);
			resolveListen();
		});
	});
	const address = server.address();
	if (!address || typeof address === 'string') {
		server.close();
		throw new Error('Callback server did not bind to a TCP port');
	}

	server.on('error', error => finish({ error }));
	signal.addEventListener('abort', onAbort, { once: true });
	const timer = setTimeout(() => finish({ error: new Error('OpenRouter sign-in timed out after 5 minutes') }), loginTimeout);

	return {
		redirectURI: `http://127.0.0.1:${address.port}${path}`,
		wait: () => promise,
		cancel: () => {
			if (!claimed) finish({ key: undefined });
		},
		close: () => {
			finish({ error: new Error('Callback server closed') });
			server.close();
		},
	};
}

// loginWithOpenRouter returns new key, and show prints OpenRouter's approval page and may open it.
// When user can also paste, first to arrive wins: pasted code or redirect from their browser.
export async function loginWithOpenRouter(mode: LoginMode, show: (url: string) => Promise<void>, signal: AbortSignal): Promise<string> {
	const { verifier, challenge } = pkce();
	const url = new URL(authorizeURL);
	url.search = new URLSearchParams({ code_challenge: challenge, code_challenge_method: 'S256', key_label: keyLabel }).toString();

	if (mode.kind === 'headless') {
		await show(url.toString());
		const code = parseCode(await mode.ask('Paste the code OpenRouter shows: ', signal));
		if (!code) throw new Error('No code given, nothing saved');

		return exchange(code, verifier, signal);
	}

	const callback = await startCallbackServer(code => exchange(code, verifier, signal), signal);
	try {
		url.searchParams.set('callback_url', callback.redirectURI);
		await show(url.toString());
		if (!mode.ask) {
			const key = await callback.wait();
			if (key === undefined) throw new Error('Login cancelled');

			return key;
		}

		// Manual input cancels callback wait, and a callback ends manual prompt, so whichever comes first wins.
		const manualAbort = new AbortController();
		const manual = mode.ask('Or paste the code or redirect URL here: ', AbortSignal.any([signal, manualAbort.signal])).then(
			input => {
				callback.cancel();

				return input;
			},
			(error: unknown) => {
				callback.cancel();
				throw error;
			},
		);
		manual.catch(() => undefined);
		try {
			const key = await callback.wait();
			if (key !== undefined) return key;
			const code = parseCode(await manual);
			if (!code) throw new Error('No code given, nothing saved');

			return await exchange(code, verifier, signal);
		} finally {
			manualAbort.abort();
		}
	} finally {
		callback.close();
	}
}

// shouldOpenBrowser guesses whether browser can open here, so SSH and CI get code to paste.
// Copied from gemini-cli, which adapted it from Google Cloud SDK, with environment passed in: https://github.com/google-gemini/gemini-cli/blob/c6bccb7ecbf6d8368d995455dd725ed34466faad/packages/core/src/utils/browser.ts#L14-L56
export function shouldOpenBrowser(env: Record<string, string | undefined> = process.env, platform = process.platform): boolean {
	if (env.BROWSER === 'www-browser') return false;
	if (env.CI || env.DEBIAN_FRONTEND === 'noninteractive') return false;

	const ssh = Boolean(env.SSH_CONNECTION);
	if (platform === 'linux') return ['DISPLAY', 'WAYLAND_DISPLAY', 'MIR_SOCKET'].some(name => Boolean(env[name]));

	return !ssh;
}
