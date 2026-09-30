import assert from 'node:assert/strict';
import test from 'node:test';
import { noul } from '@typesafe-ai/sdk';
import { baseURL, costOf, jev, model } from './request.ts';

test('sends the pinned model, state and questions through OpenRouter', async () => {
	const sent: { url: string; body: unknown; authorized: boolean }[] = [];
	const ask = jev('test-key', async (url, init) => {
		sent.push({ url, body: JSON.parse(String(init?.body)), authorized: new Headers(init?.headers).get('authorization') === 'Bearer test-key' });

		return Response.json({ model: 'typesafe/jev-1.13', answers: { kept: { type: 'noul', noul: 0.9 } }, usage: { input_tokens: 10, output_tokens: 1, cost: 0.00042 } });
	});

	const result = await ask({ source: 'x' }, { kept: noul('Is it kept?') });

	assert.equal(sent.length, 1);
	assert.equal(sent[0]?.url, `${baseURL}/v1/systemone`);
	assert.deepEqual(sent[0]?.body, { model, state: { source: 'x' }, questions: { kept: { type: 'noul', instructions: 'Is it kept?' } } });
	assert.equal(sent[0]?.authorized, true);
	assert.equal(result.answers.kept.noul, 0.9);
	assert.equal(costOf(result), 0.00042);
});

test('reports zero cost when the provider omits it', () => {
	assert.equal(costOf({ model: 'jev', answers: {}, usage: { input_tokens: 1, output_tokens: 1 } }), 0);
});
