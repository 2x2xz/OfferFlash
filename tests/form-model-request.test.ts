import assert from 'node:assert/strict';
import test from 'node:test';
import { InMemoryCredentialStore, type Api, type AssistantMessage, type Model } from '@earendil-works/pi-ai';
import { ModelRuntime } from '@earendil-works/pi-coding-agent';
import { FormModelRequestError, recognizeFormWithModel } from '../packages/agent/src/form-model.js';
import { FORM_MAPPING_PROMPT, type ModelFormInput } from '../packages/forms/src/model-recognition.js';

const input: ModelFormInput = { fields: [{ fieldId: 'field-0', label: '接收通知的邮件地址', type: 'text', section: '申请人信息', required: true, options: [] }] };
const text = '{"mappings":[{"fieldId":"field-0","profileKey":"email"}]}';
const model: Model<Api> = { id: 'fictional-form-model', name: 'Fictional form model', api: 'openai-completions', provider: 'offeragent-form-request-fixture',
  baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1', reasoning: false, input: ['text'], contextWindow: 32_768, maxTokens: 4_096,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } };
function response(changes: Partial<AssistantMessage> = {}): AssistantMessage {
  return { role: 'assistant', content: [{ type: 'text', text }], api: 'openai-completions', provider: model.provider, model: model.id,
    stopReason: 'stop', usage: { input: 17, output: 8, cacheRead: 0, cacheWrite: 0, totalTokens: 25, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } }, timestamp: 1, ...changes };
}
test('shared form helper uses the real Pi HTTP adapter over an in-memory fixture transport', async () => {
  const bodies: Record<string, unknown>[] = [];
  const authorizations: Array<string | undefined> = [];
  const fixtureFetch: typeof fetch = async (resource, options) => {
    const request = new Request(resource, options);
    assert.equal(new URL(request.url).hostname, 'dashscope.aliyuncs.com');
    bodies.push(JSON.parse(await request.text())); authorizations.push(request.headers.get('authorization') ?? undefined);
    const chunks = [
      { id: 'fictional', object: 'chat.completion.chunk', created: 1, model: model.id, choices: [{ index: 0, delta: { role: 'assistant', content: text }, finish_reason: null }] },
      { id: 'fictional', object: 'chat.completion.chunk', created: 1, model: model.id, choices: [{ index: 0, delta: {}, finish_reason: 'stop' }], usage: { prompt_tokens: 17, completion_tokens: 8, total_tokens: 25 } },
    ];
    return new Response(`${chunks.map(chunk => `data: ${JSON.stringify(chunk)}\n\n`).join('')}data: [DONE]\n\n`,
      { status: 200, headers: { 'content-type': 'text/event-stream', 'x-fixture-secret-header': 'NEVER_RETURN_HEADER' } });
  };
  const runtime = await ModelRuntime.create({ credentials: new InMemoryCredentialStore(), modelsPath: null, allowModelNetwork: false, refreshOnCreate: false });
  runtime.registerProvider(model.provider, { baseUrl: model.baseUrl, api: 'openai-completions', apiKey: 'FAKE_LOCAL_ONLY_KEY',
    models: [{ id: model.id, name: model.name, reasoning: false, input: ['text'], contextWindow: model.contextWindow, maxTokens: model.maxTokens, cost: model.cost }] });
  const localModel = runtime.getModel(model.provider, model.id)!;
  const transport: Pick<ModelRuntime, 'completeSimple'> = { completeSimple: (selectedModel, context, options) => runtime.completeSimple(selectedModel, context, { ...options, fetch: fixtureFetch }) };
  const answer = await recognizeFormWithModel(transport, localModel, input);
  assert.equal(bodies.length, 1);
  assert.equal(authorizations[0], 'Bearer FAKE_LOCAL_ONLY_KEY');
  assert.equal(answer.text, text); assert.equal(answer.modelId, model.id); assert.equal(answer.httpStatus, 200);
  assert.deepEqual(answer.usage, { input: 17, output: 8, cacheRead: 0, cacheWrite: 0, totalTokens: 25 });
  assert.deepEqual(bodies[0]?.messages, [{ role: 'system', content: FORM_MAPPING_PROMPT }, { role: 'user', content: JSON.stringify(input) }]);
  assert.ok(!bodies[0]?.tools || (Array.isArray(bodies[0].tools) && bodies[0].tools.length === 0));
  assert.equal(bodies[0]?.max_tokens ?? bodies[0]?.max_completion_tokens, 3_000);
  assert.equal(bodies[0]?.enable_thinking, false);
  for (const marker of ['FAKE_LOCAL_ONLY_KEY', 'NEVER_RETURN_HEADER', 'authorization', 'cost', 'PRIVATE_RESUME', 'currentValue', 'resumeText']) {
    assert.equal(JSON.stringify(answer).includes(marker), false);
    if (marker !== 'cost') assert.equal(JSON.stringify(bodies[0]).includes(marker), false);
  }
});

test('official DashScope requests disable thinking while unrelated or deceptive hosts are unchanged', async () => {
  for (const hostname of ['dashscope.aliyuncs.com', 'dashscope-intl.aliyuncs.com', 'dashscope-us.aliyuncs.com', 'dashscope.aliyuncs.com.attacker.invalid', 'example.invalid']) {
    const payload = { messages: [], enable_thinking: true };
    let sent: unknown;
    const runtime: Pick<ModelRuntime, 'completeSimple'> = { completeSimple: async (_model, context, options) => {
      assert.deepEqual(context.tools, []); assert.equal(context.messages.length, 1);
      assert.equal(options?.maxRetries, 0); assert.equal(options?.cacheRetention, 'none'); assert.equal(options?.timeoutMs, 20_000);
      sent = await options?.onPayload?.(payload, _model);
      return response();
    } };
    await recognizeFormWithModel(runtime, { ...model, baseUrl: `https://${hostname}/compatible-mode/v1` }, input, { maxTokens: 1_000 });
    assert.deepEqual(sent, { ...payload, enable_thinking: !['dashscope.aliyuncs.com', 'dashscope-intl.aliyuncs.com', 'dashscope-us.aliyuncs.com'].includes(hostname) });
    assert.equal(payload.enable_thinking, true);
  }
});

test('invalid or oversized requests never invoke the model', async () => {
  let calls = 0;
  const runtime: Pick<ModelRuntime, 'completeSimple'> = { completeSimple: async () => { calls++; return response(); } };
  for (const value of [{ ...input, resumeText: 'PRIVATE_RESUME' }, { fields: [{ ...input.fields[0], value: 'PRIVATE_VALUE' }] }, { fields: [] },
    { fields: [{ ...input.fields[0], label: 'x'.repeat(241) }] },
    { fields: Array.from({ length: 101 }, (_value, index) => ({ ...input.fields[0], fieldId: `field-${index}` })) }]) {
    await assert.rejects(recognizeFormWithModel(runtime, model, value as ModelFormInput), (error: unknown) => error instanceof FormModelRequestError && error.code === 'invalid-input');
  }
  assert.equal(calls, 0);
});

test('timeout and cancellation settle even when a provider ignores its AbortSignal', async () => {
  let seenSignal: AbortSignal | undefined;
  let calls = 0;
  const runtime: Pick<ModelRuntime, 'completeSimple'> = { completeSimple: async (_model, _context, options) => {
    calls++; seenSignal = options?.signal; return new Promise<AssistantMessage>(() => {});
  } };
  await assert.rejects(recognizeFormWithModel(runtime, model, input, { timeoutMs: 10 }), (error: unknown) => error instanceof FormModelRequestError && error.code === 'timeout');
  assert.equal(seenSignal?.aborted, true);
  const controller = new AbortController();
  const cancelled = recognizeFormWithModel(runtime, model, input, { signal: controller.signal });
  controller.abort();
  await assert.rejects(cancelled, (error: unknown) => error instanceof FormModelRequestError && error.code === 'cancelled');
  assert.equal(seenSignal?.aborted, true);
  await assert.rejects(recognizeFormWithModel(runtime, model, input, { signal: controller.signal }), /已停止/);
  assert.equal(calls, 2);
});

test('provider failures retain only a safe HTTP status and discard raw errors, headers and credentials', async () => {
  for (const status of [401, 429]) {
    const runtime: Pick<ModelRuntime, 'completeSimple'> = { completeSimple: async (_model, _context, options) => {
      await options?.onResponse?.({ status, headers: { authorization: 'SECRET_KEY' } }, _model);
      throw new Error('SECRET_KEY https://provider.invalid?secret=SECRET_KEY PRIVATE_RESPONSE_BODY');
    } };
    await assert.rejects(recognizeFormWithModel(runtime, model, input), (error: unknown) => {
      assert.ok(error instanceof FormModelRequestError); assert.equal(error.httpStatus, status);
      assert.equal(error.code, 'provider'); assert.equal('cause' in error, false);
      assert.equal(`${error.message}${JSON.stringify(error)}`.includes('SECRET_KEY'), false);
      assert.equal(`${error.message}${JSON.stringify(error)}`.includes('PRIVATE_RESPONSE_BODY'), false);
      return true;
    });
  }
});

test('incomplete, overlong or tool responses never become a field mapping result', async () => {
  for (const value of [response({ stopReason: 'length' }), response({ content: [{ type: 'text', text: 'x'.repeat(24_001) }] }),
    response({ content: [{ type: 'toolCall', id: 'forbidden', name: 'unexpected', arguments: {} }] }),
    response({ stopReason: 'error', errorMessage: 'PRIVATE_PROVIDER_ERROR' })]) {
    const runtime: Pick<ModelRuntime, 'completeSimple'> = { completeSimple: async () => value };
    await assert.rejects(recognizeFormWithModel(runtime, model, input), (error: unknown) => error instanceof FormModelRequestError && !error.message.includes('PRIVATE_PROVIDER_ERROR'));
  }
});
