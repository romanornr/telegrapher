import assert from 'node:assert/strict';
import test from 'node:test';
import { noul } from '@typesafe-ai/sdk';
import { costOf, jev, model, providerOf } from './request.ts';

test('sends the pinned model, state and questions through OpenRouter', async () => {
	const sent: { url: string; body: unknown; authorized: boolean }[] = [];
	const ask = jev('sk-or-test-key', async (url, init) => {
		sent.push({ url, body: JSON.parse(String(init?.body)), authorized: new Headers(init?.headers).get('authorization') === 'Bearer sk-or-test-key' });

		return Response.json({ model: 'typesafe/jev-1.13', answers: { kept: { type: 'noul', noul: 0.9 } }, usage: { input_tokens: 10, output_tokens: 1, cost: 0.00042 } });
	});

	const result = await ask({ source: 'x' }, { kept: noul('Is it kept?') });

	assert.equal(sent.length, 1);
	assert.equal(sent[0]?.url, 'https://openrouter.ai/api/v1/systemone');
	assert.deepEqual(sent[0]?.body, { model, state: { source: 'x' }, questions: { kept: { type: 'noul', instructions: 'Is it kept?' } } });
	assert.equal(sent[0]?.authorized, true);
	assert.equal(result.answers.kept.noul, 0.9);
	assert.equal(costOf(result), 0.00042);
});

test('reports unknown cost, never zero, when the provider omits it', () => {
	assert.equal(costOf({ model: 'jev', answers: {}, usage: { input_tokens: 1, output_tokens: 1 } }), undefined);
});

test('sends a TypeSafe key straight to TypeSafe', async () => {
	const urls: string[] = [];
	const ask = jev('direct-key', async (url, init) => {
		urls.push(`${url} ${new Headers(init?.headers).get('authorization')}`);

		return Response.json({ model: 'jev-1.13', answers: { kept: { type: 'noul', noul: 0.1 } }, usage: { input_tokens: 1, output_tokens: 1 } });
	});

	await ask({ source: 'x' }, { kept: noul('Is it kept?') });
	assert.deepEqual(urls, ['https://api.typesafe.ai/v1/systemone Bearer direct-key']);
});

test('reads provider from key itself', () => {
	assert.equal(providerOf('sk-or-v1-abc'), 'openrouter');
	assert.equal(providerOf('ts-abc'), 'typesafe');
});
