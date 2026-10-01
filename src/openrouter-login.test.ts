import assert from 'node:assert/strict';
import test from 'node:test';
import { exchange, parseCode, shouldOpenBrowser, startCallbackServer } from './openrouter-login.ts';

test('parseCode accepts redirect URL, query string or bare code', () => {
	assert.equal(parseCode('http://127.0.0.1:5000/callback/x?code=abc'), 'abc');
	assert.equal(parseCode('code=abc&other=1'), 'abc');
	assert.equal(parseCode(' abc '), 'abc');
	assert.equal(parseCode('  '), undefined);
});

test('callback server completes only on its own path', async () => {
	const callback = await startCallbackServer(async code => `key-for-${code}`, new AbortController().signal);
	try {
		const wrongPath = await fetch(new URL('/callback/other?code=abc', callback.redirectURI));
		assert.equal(wrongPath.status, 404);

		const page = await fetch(`${callback.redirectURI}?code=abc`);
		assert.equal(page.status, 200);
		assert.equal(await callback.wait(), 'key-for-abc');

		const again = await fetch(`${callback.redirectURI}?code=abc`);
		assert.equal(again.status, 409);
	} finally {
		callback.close();
	}
});

test('callback server rejects when OpenRouter redirects with an error', async () => {
	const callback = await startCallbackServer(async () => 'unused', new AbortController().signal);
	try {
		const page = await fetch(`${callback.redirectURI}?error=access_denied`);
		assert.equal(page.status, 400);
		await assert.rejects(callback.wait(), /access_denied/);
	} finally {
		callback.close();
	}
});

test('callback server stops waiting when cancelled or aborted', async () => {
	const cancelled = await startCallbackServer(async () => 'unused', new AbortController().signal);
	cancelled.cancel();
	assert.equal(await cancelled.wait(), undefined);
	cancelled.close();

	const controller = new AbortController();
	const aborted = await startCallbackServer(async () => 'unused', controller.signal);
	controller.abort();
	await assert.rejects(aborted.wait(), /Login cancelled/);
	aborted.close();
});

test('exchange returns key, and reports OpenRouter message on failure', async () => {
	const ok: typeof fetch = async () => Response.json({ key: 'sk-or-v1-test', user_id: null });
	assert.equal(await exchange('code', 'verifier', new AbortController().signal, ok), 'sk-or-v1-test');

	const invalid: typeof fetch = async () => Response.json({ error: { message: 'Invalid code', code: 400 } }, { status: 400 });
	await assert.rejects(exchange('code', 'verifier', new AbortController().signal, invalid), /HTTP 400\): Invalid code/);

	const empty: typeof fetch = async () => Response.json({});
	await assert.rejects(exchange('code', 'verifier', new AbortController().signal, empty), /no key/);
});

test('shouldOpenBrowser skips CI, SSH and Linux without a display', () => {
	assert.equal(shouldOpenBrowser({ DISPLAY: ':0' }, 'linux'), true);
	assert.equal(shouldOpenBrowser({}, 'linux'), false);
	assert.equal(shouldOpenBrowser({ CI: 'true', DISPLAY: ':0' }, 'linux'), false);
	assert.equal(shouldOpenBrowser({ BROWSER: 'www-browser' }, 'darwin'), false);
	assert.equal(shouldOpenBrowser({}, 'darwin'), true);
	assert.equal(shouldOpenBrowser({ SSH_CONNECTION: '1 2 3 4' }, 'darwin'), false);
});
