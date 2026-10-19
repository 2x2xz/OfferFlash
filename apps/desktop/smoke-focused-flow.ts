import { createServer } from 'node:http';
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { app, type BrowserWindow } from 'electron';
import type { BrowserController } from '../../packages/browser/src/controller.js';
import type { AppEvent, AppState, FillPlan } from '../../packages/shared/src/contracts.js';
import { readResume } from '../../packages/profile/src/import.js';

/** Full desktop path against a fictional local page and deterministic model protocol. */
export async function smokeFocusedFlow(
  window: BrowserWindow, browser: BrowserController,
  methods: Record<string, (...args: any[]) => Promise<any>>,
  send: (event: AppEvent) => void, stateDirectory: string,
) {
  if (!process.argv.includes('--smoke-test')) throw new Error('快速申请验收仅允许隔离测试。');
  const evaluate = <T = any>(code: string): Promise<T> => window.webContents.executeJavaScript(code);
  const frames = () => evaluate('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
  const expect = (condition: unknown, message: string) => { if (!condition) throw new Error(message); };
  async function waitFor(code: string, message: string, timeoutMs = 20_000) {
    const until = Date.now() + timeoutMs;
    do {
      if (await evaluate<boolean>(code)) return;
      await new Promise(resolve => setTimeout(resolve, 40));
    } while (Date.now() < until);
    throw new Error(message);
  }
  async function click(selector: string) {
    app.focus({ steal: true });
    window.focus(); window.webContents.focus();
    const point = await evaluate<{ x: number; y: number }>(`(async () => {
      const element = document.querySelector(${JSON.stringify(selector)});
      if (!element || element.disabled) throw new Error('快速申请按钮不存在或不可用');
      element.scrollIntoView({block:'center'});
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      const r=element.getBoundingClientRect();
      if (!r.width || !r.height) throw new Error('快速申请按钮不可见');
      const point={x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2)};
      const hit=document.elementFromPoint(point.x,point.y);
      if (!hit || !(hit===element || element.contains(hit))) throw new Error('快速申请按钮被其他界面遮挡');
      return point;
    })()`);
    window.webContents.sendInputEvent({ type: 'mouseMove', ...point });
    window.webContents.sendInputEvent({ type: 'mouseDown', ...point, button: 'left', clickCount: 1 });
    window.webContents.sendInputEvent({ type: 'mouseUp', ...point, button: 'left', clickCount: 1 });
    await frames();
  }
  async function setInput(selector: string, value: string, select = false) {
    await evaluate(`(() => {
      const element=document.querySelector(${JSON.stringify(selector)});
      if (!element) throw new Error('模型配置输入框不存在');
      Object.getOwnPropertyDescriptor(${select ? 'HTMLSelectElement' : 'HTMLInputElement'}.prototype,'value').set.call(element,${JSON.stringify(value)});
      element.dispatchEvent(new Event(${JSON.stringify(select ? 'change' : 'input')},{bubbles:true}));
    })()`);
    await frames();
  }
  const original = await methods.getState!() as AppState;
  let expectedProfile = original.profile;
  const expectedApplications = structuredClone(original.applications);
  const html = await readFile(join(dirname(fileURLToPath(import.meta.url)), '../../apps/desktop/fixtures/focused-application.html'), 'utf8');
  const labels = new Map([
    ['您的称呼', 'fullName'], ['接收通知的邮件地址', 'email'], ['便于联系您的号码', 'phone'],
    ['就读高校', 'school'], ['研究方向（专业）', 'major'], ['获得的最高学位', 'degree'],
  ]);
  let requests = 0;
  let privateValuesAbsent = true;
  let noTools = true;
  let onlyExpectedFields = true;
  const server = createServer(async (request, response) => {
    if (request.method === 'GET' && request.url === '/apply') {
      response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }).end(html); return;
    }
    if (request.method !== 'POST' || request.url !== '/v1/chat/completions') {
      response.writeHead(404).end(); return;
    }
    try {
      const chunks: Buffer[] = [];
      for await (const chunk of request) chunks.push(Buffer.from(chunk));
      const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      if (request.headers.authorization !== 'Bearer local-focused-fixture-key') { response.writeHead(401).end(); return; }
      requests++;
      const serialized = JSON.stringify(body);
      privateValuesAbsent &&= [expectedProfile.fullName, expectedProfile.email, expectedProfile.phone,
        expectedProfile.school, 'keep-this@example.invalid', 'PRIVATE_PROJECT_DESCRIPTION', 'PRIVATE_PAPER_AUTHOR']
        .filter(value => !!value && value.length >= 3).every(value => !serialized.includes(value));
      noTools &&= !body.tools?.length;
      const message = body.messages.findLast((item: { role: string }) => item.role === 'user');
      const content = typeof message?.content === 'string' ? message.content : message?.content?.filter((item: any) => item.type === 'text').map((item: any) => item.text).join('');
      const input = JSON.parse(content);
      const fields = input.fields as Array<{ fieldId: string; label: string }>;
      onlyExpectedFields &&= fields.length === 6 && fields.every(field => labels.has(field.label));
      const text = JSON.stringify({ mappings: fields.filter(field => labels.has(field.label)).map(field => ({ fieldId: field.fieldId, profileKey: labels.get(field.label) })) });
      if (body.stream === false) {
        response.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({
          id: 'focused-local-test', object: 'chat.completion', created: 1, model: 'focused-protocol-test',
          choices: [{ index: 0, message: { role: 'assistant', content: text }, finish_reason: 'stop' }],
          usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
        })); return;
      }
      response.writeHead(200, { 'Content-Type': 'text/event-stream' });
      for (const [delta, finish] of [[{ role: 'assistant', content: text }, null], [{}, 'stop']]) response.write(`data: ${JSON.stringify({
        id: 'focused-local-test', object: 'chat.completion.chunk', created: 1, model: 'focused-protocol-test',
        choices: [{ index: 0, delta, finish_reason: finish }],
      })}\n\n`);
      response.end('data: [DONE]\n\n');
    } catch { response.writeHead(500).end('invalid fictional model request'); }
  });
  await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('快速申请测试端口未建立');
  const baseURL = `http://127.0.0.1:${address.port}`;
  const jobId = 'focused-flow-fictional-job';
  const originalPrepare = methods.prepareFill!;
  const originalImport = methods.importResume!;
  let observedPlan: FillPlan | undefined;
  let importCalls = 0;
  methods.prepareFill = async (...args) => { const plan = await originalPrepare(...args) as FillPlan; observedPlan = plan; return plan; };
  try {
    // The preceding pending-progress regression intentionally leaves its edit
    // dialog open for a screenshot. Close that real dialog before a new flow.
    if (await evaluate('Boolean(document.querySelector(".modal"))')) {
      await click('.modal button[aria-label="关闭"]');
      await waitFor('!document.querySelector(".modal")', '旧回归的编辑窗口没有关闭');
    }
    // Replace only the operating-system file chooser; parse the actual bundled
    // fictional file and exercise the real upload, review and confirmation UI.
    const imported = await readResume(join(dirname(fileURLToPath(import.meta.url)), '../../apps/desktop/fixtures/focused-resume.md'));
    const education = imported.career?.educations.find(item => item.school === '流程样本大学');
    expect(education && imported.career!.educations.length === 2 && imported.career!.projects.length === 1, '快速申请简历没有产生真实结构化候选');
    methods.importResume = async () => { importCalls++; return imported; };
    send({ type: 'navigate', page: 'apply' });
    await waitFor('Boolean(document.querySelector(\'[data-testid="apply-start"]\'))', '上传入口没有显示');
    await click('[data-testid="resume-upload"]');
    await waitFor('document.querySelector(\'[data-testid="resume-review"]\')?.innerText.includes("focused-resume.md")', '上传后没有进入紧凑资料核对');
    expect((await methods.getState!()).profile.version === expectedProfile.version, '导入未确认候选就改写了已确认资料');
    await evaluate(`(() => {
      const select=document.querySelector('[data-testid="resume-education"]');
      Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value').set.call(select,${JSON.stringify(education!.id)});
      select.dispatchEvent(new Event('change',{bubbles:true}));
    })()`);
    await frames();
    await click('[data-testid="resume-confirm"]');
    await waitFor('Boolean(document.querySelector(\'[data-testid="apply-start"]\'))', '确认简历后没有直接返回岗位推荐');
    expectedProfile = (await methods.getState!() as AppState).profile;
    expect(expectedProfile.career?.primaryEducationId === education!.id && expectedProfile.school === education!.school
      && expectedProfile.career.educations.find(item => item.id === education!.id)?.confirmation === 'confirmed', '选中的教育没有逐版本确认并成为默认');
    expect(imported.career!.projects.every(item => expectedProfile.career!.projects.find(saved => saved.id === item.id)?.confirmation === 'pending')
      && imported.career!.educations.filter(item => item.id !== education!.id).every(item => expectedProfile.career!.educations.find(saved => saved.id === item.id)?.confirmation === 'pending'), '未选择的经历被批量确认');
    expect(imported.career!.sources.every(item => expectedProfile.career!.sources.some(saved => saved.id === item.id && saved.fileHash === item.fileHash)), '上传材料的真实出处丢失');
    methods.importResume = originalImport;
    await methods.saveJob!({ id: jobId, company: '虚构流程测试企业', title: '大模型算法工程师（本地流程样本）',
      city: expectedProfile.cities[0] ?? '', type: 'campus', requirements: '2027届毕业生，计算机专业，Python、大模型研发。',
      description: '此条只用于隔离本机快速申请流程测试，不代表实际招聘。', url: `${baseURL}/apply`,
      sourceId: 'focused-flow-fixture', sourceName: '虚构本机流程样本', publishedAt: null, deadline: null, demo: false });
    send({ type: 'navigate', page: 'apply' });
    await waitFor('Boolean(document.querySelector(\'[data-testid="apply-start"]\'))', '快速申请首页没有显示');
    await click('.apply-model-strip button');
    await waitFor('document.querySelector(".modal select")?.value === "bailian"', '配置窗口没有默认百炼预设');
    expect(await evaluate(`document.querySelector('.modal input[placeholder="填写模型名称"]').value === 'qwen-flash' && document.querySelector('.modal input[type=url]').value === 'https://dashscope.aliyuncs.com/compatible-mode/v1' && document.querySelector('.model-config-summary').innerText.includes('dashscope.aliyuncs.com')`), '百炼模型和目标域名未明确预填');
    await setInput('.modal input[type=password]', 'local-switch-clearing-fixture');
    await setInput('.modal select', 'custom', true);
    expect(await evaluate('document.querySelector(".modal input[type=password]").value === ""'), '切换服务保留了上一服务的 Key');
    await setInput('.modal input[placeholder="填写模型名称"]', 'focused-protocol-test');
    await setInput('.modal input[type=url]', `${baseURL}/v1`);
    await setInput('.modal input[type=password]', 'local-focused-fixture-key');
    await click('.modal-footer .button-primary');
    await waitFor('!document.querySelector(".modal")', '模型配置未完成或未关闭');
    expect((await methods.modelStatus!()).mode === 'live' && requests === 0, '应用配置时误发模型请求或模式未更新');
    const jobSelector = `[data-testid="recommended-job-${jobId}"]`;
    await waitFor(`Boolean(document.querySelector(${JSON.stringify(jobSelector)}))`, '导入并确认的资料没有自动匹配库内岗位');
    const profileReusable = await evaluate('document.querySelector(\'[data-testid="apply-start"]\').innerText.includes("已保存")');
    expect(profileReusable, '已有简历被要求重新上传');
    await writeFile(join(stateDirectory, 'focused-recommendations.png'), (await window.webContents.capturePage()).toPNG());
    await click(`${jobSelector} .apply-job-bottom button`);
    await waitFor('Boolean(document.querySelector(\'[data-testid="quick-fill"]\'))', '岗位没有进入可一键填写的浏览器');
    await waitFor('!document.querySelector(\'[data-testid="quick-fill"]\').disabled', '页面加载完成后仍不能一键填写');
    expect(browser.getState().url === `${baseURL}/apply`, '去网申打开了错误岗位');
    const before = await browser.view.webContents.executeJavaScript('Array.from(document.querySelectorAll("input")).slice(0,5).every(item=>!item.value) && window.focusedSubmissions===0');
    expect(before, '用户点击填写之前已发生网页写入');
    await click('[data-testid="quick-fill"]');
    await waitFor('document.querySelectorAll(".preview-row.verified").length === 6', '一键填写未验证全部六项（含模型识别和真实学历下拉）', 35_000);
    const planId = await evaluate<string>('document.querySelector(".form-preview").getAttribute("data-plan-id")');
    const plan = observedPlan;
    expect(plan?.id === planId && plan.recognition?.mode === 'model' && plan.recognition.mappedCount === 6, '未真实走模型映射便宣称模型识别');
    const values = await browser.view.webContents.executeJavaScript(`({
      name: document.querySelector('#focus-name').value, email: document.querySelector('#focus-email').value,
      phone: document.querySelector('#focus-phone').value, school: document.querySelector('#focus-school').value,
      major: document.querySelector('#focus-major').value, degree: document.querySelector('#focus-degree').value,
      existing: document.querySelector('#focus-existing').value, emergency: document.querySelector('#focus-emergency').value,
      identity: document.querySelector('#focus-identity').value, consent: document.querySelector('#focus-consent').checked,
      submissions: window.focusedSubmissions, appBridge: typeof window.offer !== 'undefined' || typeof require !== 'undefined'
    })`);
    expect(values.name === expectedProfile.fullName && values.email === expectedProfile.email && values.phone === expectedProfile.phone
      && values.school === expectedProfile.school && values.major === expectedProfile.major && values.degree === 'master', '网页实际值不等于本地已确认资料');
    expect(values.existing === 'keep-this@example.invalid' && !values.emergency && !values.identity && !values.consent && values.submissions === 0, '覆盖已有值或操作了不允许的字段/提交');
    const after = await methods.getState!() as AppState;
    expect(JSON.stringify(after.profile) === JSON.stringify(expectedProfile), '快速填写改写了确认资料');
    expect(expectedApplications.every(item => JSON.stringify(after.applications.find(candidate => candidate.id === item.id)) === JSON.stringify(item)), '快速填写改写了已有申请状态');
    expect(!after.applications.some(item => item.jobId === jobId && item.status === 'applied'), '填写被当作投递成功');
    expect(requests === 1 && privateValuesAbsent && noTools && onlyExpectedFields && values.appBridge === false, '模型请求范围、数据隔离或调用次数不符');
    await writeFile(join(stateDirectory, 'focused-fill-result.png'), (await window.webContents.capturePage()).toPNG());
    await writeFile(join(stateDirectory, 'focused-webpage.png'), (await browser.view.webContents.capturePage()).toPNG());
    return { ok: true, fixtureOnly: true, fileChooserSubstitutedWithBundledFixture: true,
      realResumeParser: true, compactReviewConfirmedViaUI: true, onlySelectedEducationConfirmed: true,
      unselectedRecordsPending: true, sourceEvidencePreserved: true, profileReusable, recommendedFromConfirmedProfile: true,
      bailianPresetViaUI: true, providerSwitchClearsKey: true, modelConfiguredViaUI: true, configurationDidNotCallProvider: true,
      nativeOneClick: true, importCalls, modelRequests: requests, modelMappedFields: 6, verifiedNativeFields: 6,
      nativeSelectVerified: true, privateValuesAbsent, noTools, onlyExpectedFields,
      existingValuesPreserved: true, sensitiveAndConsentUntouched: true, submitted: false,
      profileUnchanged: true, priorApplicationsUnchanged: true, applicationStatusNotInferred: true,
      browserHasAppBridge: false, realModelQualityEvaluated: false, realEnterpriseVerified: false };
  } catch (error) {
    await writeFile(join(stateDirectory, 'focused-failure.json'), JSON.stringify({
      message: error instanceof Error ? error.message : String(error), importCalls, requests,
      ui: await evaluate('document.body.innerText'),
      plan: observedPlan, browser: browser.getState(),
    }, null, 2));
    await writeFile(join(stateDirectory, 'focused-failure.png'), (await window.webContents.capturePage()).toPNG());
    throw error;
  } finally {
    methods.prepareFill = originalPrepare;
    methods.importResume = originalImport;
    await methods.configureModel!({ mode: 'demo', provider: '', modelId: '', apiKey: '' });
    await new Promise<void>((resolve, reject) => { server.close(error => error ? reject(error) : resolve()); server.closeIdleConnections(); });
  }
}
