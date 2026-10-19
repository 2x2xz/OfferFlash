import { createServer } from 'node:http';

/** A local protocol fixture, never a claim of validation against a real model. */
export async function createSmokeModelServer(toolName: 'query_jobs' | 'get_profile_summary' | 'prepare_form_preview' | 'get_task_guide' | 'get_application_agenda' | 'compare_jobs' = 'query_jobs', toolArgs: unknown = {}) {
  let requests = 0;
  let toolResultSeen = false;
  let policySeen = false;
  let toolDefinitionsSeen = false;
  let privateFieldValuesAbsent = true;
  let previewPlanId: string | undefined;
  const server = createServer(async (request, response) => {
    try {
      const chunks: Buffer[] = [];
      for await (const chunk of request) chunks.push(Buffer.from(chunk));
      const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      if (request.headers.authorization !== 'Bearer local-protocol-fixture-key') {
        response.writeHead(401).end(); return;
      }
      requests++;
      const serialized = JSON.stringify(body);
      policySeen ||= serialized.includes('offeragent-career-v2') && serialized.includes('岗位发现流程') && serialized.includes('网申预览与用户接管');
      const names = body.tools?.map((item: any) => item.function?.name) ?? [];
      toolDefinitionsSeen ||= names.includes('get_job_details') && names.includes('query_jobs') && names.length === 11 && names.includes('get_task_guide') && names.includes('get_application_agenda') && names.includes('compare_jobs');
      privateFieldValuesAbsent &&= !['applicant@example.invalid', '13800000000', '测试同学', 'PRIVATE_PROJECT_DESCRIPTION', 'PRIVATE_INTERNSHIP_DESCRIPTION', 'PRIVATE_PAPER_AUTHOR'].some(value => serialized.includes(value));
      const tool = body.messages?.findLast((message: { role: string }) => message.role === 'tool');
      if (typeof tool?.content === 'string') {
        if (toolName === 'query_jobs') toolResultSeen ||= tool.content.includes('demo-hangzhou-llm');
        else if (toolName === 'prepare_form_preview') {
          const preview = JSON.parse(tool.content);
          previewPlanId = preview.planId;
          toolResultSeen ||= typeof preview.planId === 'string' && preview.previewOnly === true;
        } else {
          const result = JSON.parse(tool.content);
          toolResultSeen ||= toolName === 'get_profile_summary' ? typeof result.version === 'number' && result.careerSummary?.projects?.length === 1 && result.careerSummary?.publications?.[0]?.status === 'submitted'
            : toolName === 'get_task_guide' ? result.kind === 'application-instructions' && !!result.contentHash
            : toolName === 'get_application_agenda' ? result.timeZone === 'Asia/Shanghai' && Array.isArray(result.items)
            : result.coverage === 'selected-local-jobs' && result.jobs?.length === 2;
        }
      }
      response.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' });
      const chunk = (delta: unknown, finishReason: string | null) => {
        response.write(`data: ${JSON.stringify({ id: 'offeragent-local-test', object: 'chat.completion.chunk', created: 1, model: 'offeragent-protocol-test', choices: [{ index: 0, delta, finish_reason: finishReason }] })}\n\n`);
      };
      if (!tool) {
        chunk({ role: 'assistant', tool_calls: [{ index: 0, id: 'local-domain-tool', type: 'function', function: { name: toolName, arguments: JSON.stringify(toolArgs) } }] }, null);
        chunk({}, 'tool_calls');
      } else {
        chunk({ role: 'assistant', content: '本地兼容接口测试已收到实际岗位工具结果。' }, null);
        chunk({}, 'stop');
      }
      response.end('data: [DONE]\n\n');
    } catch {
      response.writeHead(500).end('invalid protocol fixture request');
    }
  });
  await new Promise<void>((done, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', done); });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('本地模型测试端口未建立');
  return {
    baseURL: `http://127.0.0.1:${address.port}/v1`,
    getStats: () => ({ requests, toolResultSeen, policySeen, toolDefinitionsSeen, privateFieldValuesAbsent, previewPlanId }),
    close: () => new Promise<void>((done, reject) => { server.close(error => error ? reject(error) : done()); server.closeIdleConnections(); }),
  };
}
