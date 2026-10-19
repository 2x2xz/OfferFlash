import { resolve } from 'node:path';
import { createDemoModel, makeJobSearchResponses } from '../packages/runtime/src/demo-model.js';
import { createDemoJobsTool } from '../packages/runtime/src/tools/demo-jobs.js';
import { createOfferAgentRuntime } from '../packages/runtime/src/runtime.js';

const model = await createDemoModel();
model.faux.setResponses(makeJobSearchResponses());
const runtime = await createOfferAgentRuntime({
  stateDir: resolve('runtime-home/demo'),
  modelRuntime: model.modelRuntime, model: model.model, tools: [createDemoJobsTool()],
});

runtime.subscribe(event => {
  if (event.type !== 'text_delta') console.log(JSON.stringify(event));
});

try {
  const result = await runtime.run('演示：找杭州的大模型岗位。只使用虚构岗位，验证工具闭环。');
  console.log(JSON.stringify({
    mode: 'offline-fixture', status: result.status, finalText: result.finalText,
    sessionId: result.sessionId, sessionFile: result.sessionFile,
    providerRequests: model.faux.state.callCount, activeTools: runtime.getActiveToolNames(),
  }, null, 2));
  if (result.status !== 'completed') process.exitCode = 1;
} finally {
  await runtime.close();
}
