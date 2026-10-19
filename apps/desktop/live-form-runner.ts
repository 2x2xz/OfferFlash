/** Explicit, isolated verification against an actual HTTPS recruiting page. */
import { app, BrowserWindow } from 'electron';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { randomBytes } from 'node:crypto';
import { ModelRuntime } from '@earendil-works/pi-coding-agent';
import { InMemoryCredentialStore } from '@earendil-works/pi-ai';
import { BrowserController } from '../../packages/browser/src/controller.js';
import { READ_FORM } from '../../packages/browser/src/read-scripts.js';
import { buildFillPlan } from '../../packages/forms/src/index.js';
import { recognizeModelForm } from '../../packages/forms/src/model-recognition.js';
import { recognizeFormWithModel } from '../../packages/agent/src/form-model.js';
import type { FieldObservation, FillPlan, FormObservation, Profile } from '../../packages/shared/src/contracts.js';

const arguments_ = process.argv.slice(1);
const argument = (name: string): string | undefined => arguments_.find(value => value.startsWith(`${name}=`))?.slice(name.length + 1);
const observeOnly = arguments_.includes('--observe-only');
const waitForKey = arguments_.includes('--wait-for-key');
const probeScroll = arguments_.includes('--probe-scroll');
const originalURL = argument('--url') ?? '';
const directory = await mkdtemp(join(tmpdir(), 'offeragent-live-form-'));
const reportPath = join(directory, 'report.json');
const modelId = process.env.OFFERAGENT_LIVE_FORM_MODEL?.trim() || 'qwen-flash';
const baseURL = process.env.OFFERAGENT_LIVE_FORM_BASE_URL?.trim() || 'https://dashscope.aliyuncs.com/compatible-mode/v1';
let apiKey = process.env.OFFERAGENT_LIVE_FORM_API_KEY?.trim() || '';
delete process.env.OFFERAGENT_LIVE_FORM_API_KEY;
const report: Record<string, unknown> = {
  schemaVersion: 1, startedAt: new Date().toISOString(), originalURL,
  mode: observeOnly ? 'observe-only' : 'live', status: 'starting',
  isolatedDataDirectory: directory, realCareerDataRead: false, applicationCredentialsRead: false, dedicatedTestCredentialOnly: true,
  productionPath: ['BrowserController.preparePlan', 'recognizeModelForm', 'recognizeFormWithModel', 'Pi ModelRuntime.completeSimple', 'BrowserController.fillApproved'],
  recognitionRan: false, fillRan: false, submitted: false, modelRequestCount: 0,
  model: { modelId, provider: 'offeragent-live-form-compatible', endpointOrigin: '', api: 'openai-completions' },
  requestProtection: { allowedMethods: ['GET', 'HEAD'], blockedCount: 0, blockedMethods: {}, blockedTestValueQueryCount: 0, blockedInsecureRequestCount: 0 },
  testValues: { fullName: 'OfferAgent Validation', email: 'offeragent-validation@example.invalid', phone: '2025550100' },
  selected: [], verified: [], unresolved: [], nonselectedUnchanged: null,
};
const profile: Profile = {
  version: 1, updatedAt: new Date().toISOString(), fullName: 'OfferAgent Validation', fullNameEn: 'OfferAgent Validation',
  email: 'offeragent-validation@example.invalid', phone: '2025550100', school: '', schoolEn: '',
  degree: '', major: '', majorEn: '', graduationMonth: '', skills: [], cities: [], targetRoles: [], resumeText: '',
};
const permittedKeys = new Set(['fullName', 'fullNameEn', 'email', 'phone']);
let window: BrowserWindow | undefined;
let browser: BrowserController | undefined;
let exiting = false;
let phase = 'configuration';
const blockedMethods: Record<string, number> = {};

async function saveReport(): Promise<void> {
  report.updatedAt = new Date().toISOString();
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
}

async function screenshot(name: string): Promise<void> {
  if (!browser || browser.view.webContents.isDestroyed()) return;
  const path = join(directory, name);
  await writeFile(path, (await browser.view.webContents.capturePage()).toPNG(), { mode: 0o600 });
  const screenshots = report.screenshots as Record<string, string> | undefined;
  report.screenshots = { ...screenshots, [name.replace('.png', '')]: path };
}

/** This local-only page has no bridge, network access, form submission or Node. */
async function requestKey(): Promise<string> {
  if (!window) return '';
  const nonce = randomBytes(18).toString('base64');
  const keyWindow = new BrowserWindow({
    parent: window, modal: true, width: 570, height: 330, show: false,
    title: 'OfferAgent · 真实模型验证',
    webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, partition: `live-form-key-${nonce}` },
  });
  keyWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  keyWindow.webContents.on('will-navigate', event => event.preventDefault());
  const html = `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'nonce-${nonce}'; style-src 'unsafe-inline'; form-action 'none'; connect-src 'none'; frame-src 'none'; img-src 'none'"><style>body{font:16px system-ui;padding:24px;color:#18232e}input{display:block;width:95%;padding:10px;margin:16px 0}button{padding:10px 18px;margin-right:10px}small{display:block;line-height:1.6;color:#52606d}</style><h3>输入专用于本次验证的阿里云百炼 API Key</h3><small>仅保存在本次进程内存。最多 3 次请求，每次最多 1000 输出 tokens。企业网页无法访问此输入框。不会提交申请。</small><input id="key" type="password" autocomplete="off" placeholder="API Key" autofocus><button id="run" type="button">开始真实模型验证</button><button id="cancel" type="button">取消</button><script nonce="${nonce}">document.getElementById('run').addEventListener('click',()=>{if(document.getElementById('key').value.trim())document.body.dataset.ready='yes'});document.getElementById('cancel').addEventListener('click',()=>document.body.dataset.cancel='yes');</script></html>`;
  await keyWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
  keyWindow.show(); app.focus({ steal: true }); keyWindow.focus();
  report.status = 'awaiting-explicit-test-key';
  await saveReport();
  const deadline = Date.now() + 10 * 60_000;
  try {
    while (!keyWindow.isDestroyed() && Date.now() < deadline) {
      const state = await keyWindow.webContents.executeJavaScript(`({ready:document.body.dataset.ready==='yes',cancel:document.body.dataset.cancel==='yes'})`) as { ready: boolean; cancel: boolean };
      if (state.cancel) return '';
      if (state.ready) {
        const value: unknown = await keyWindow.webContents.executeJavaScript(`(()=>{const e=document.getElementById('key');const value=e.value;e.value='';return value})()`);
        return typeof value === 'string' ? value.trim() : '';
      }
      await delay(300);
    }
    return '';
  } finally { if (!keyWindow.isDestroyed()) keyWindow.destroy(); }
}

async function readFields(): Promise<FieldObservation[]> {
  if (!browser) return [];
  const raw = await browser.view.webContents.executeJavaScript(READ_FORM) as { fields: Array<Omit<FieldObservation, 'id' | 'signature'>> };
  return raw.fields.map(field => ({ ...field, id: `field-${field.index}`, signature: '' }));
}

async function observe(): Promise<FormObservation> {
  if (!browser) throw new Error('BROWSER_UNAVAILABLE');
  let observation: FormObservation | undefined;
  await browser.preparePlan(async (value, localProfile) => { observation = value; return buildFillPlan(value, localProfile); });
  if (!observation) throw new Error('OBSERVATION_UNAVAILABLE');
  return observation;
}

async function finish(code: number): Promise<void> {
  if (exiting) return;
  exiting = true;
  apiKey = '';
  report.finishedAt = new Date().toISOString();
  await saveReport();
  process.stdout.write(`OfferAgent live-form report: ${reportPath}\n`);
  browser?.dispose();
  window?.destroy();
  app.exit(code);
}

try {
  const target = new URL(originalURL);
  const endpoint = new URL(baseURL);
  if (target.protocol !== 'https:' || target.username || target.password) throw new Error('HTTPS_TARGET_REQUIRED');
  if (endpoint.protocol !== 'https:' || endpoint.username || endpoint.password || endpoint.search || endpoint.hash) throw new Error('HTTPS_MODEL_ENDPOINT_REQUIRED');
  report.model = { modelId, provider: 'offeragent-live-form-compatible', endpointOrigin: endpoint.origin, api: 'openai-completions' };
  app.setName('OfferAgent Live Form Validation');
  app.setPath('userData', directory);
  const sessionDirectory = join(directory, 'browser-session');
  await mkdir(sessionDirectory, { mode: 0o700 });
  app.setPath('sessionData', sessionDirectory);
  report.status = 'starting-browser'; await saveReport();
  await app.whenReady();
  window = new BrowserWindow({
    width: 1420, height: 1040, show: false, title: 'OfferAgent · 真实网申功能验证（不提交）',
    webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, partition: `live-form-host-${randomBytes(12).toString('hex')}` },
  });
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  await window.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent('<!doctype html><meta charset="utf-8"><title>OfferAgent real-page validation</title><body style="font:14px system-ui">真实企业页面功能验证：仅测试姓名、邮箱、电话；禁止提交与自动保存。</body>'));
  browser = new BrowserController({ window, onState: () => {}, getProfile: async () => structuredClone(profile) });
  const contents = browser.view.webContents;
  contents.session.webRequest.onBeforeRequest((details, callback) => {
    let testValueInQuery = false;
    let insecureRequest = false;
    try {
      const requestURL = new URL(details.url);
      insecureRequest = ['http:', 'ws:'].includes(requestURL.protocol);
      const query = requestURL.search.toLowerCase();
      const decoded = decodeURIComponent(query).replace(/\+/g, ' ');
      testValueInQuery = [profile.fullName, profile.email, profile.phone].some(value => decoded.includes(value.toLowerCase()));
    } catch { /* Malformed URLs are handled by Chromium. */ }
    if (!['GET', 'HEAD'].includes(details.method.toUpperCase()) || testValueInQuery || insecureRequest) {
      blockedMethods[details.method] = (blockedMethods[details.method] ?? 0) + 1;
      const protection = report.requestProtection as Record<string, unknown>;
      protection.blockedCount = (protection.blockedCount as number) + 1;
      protection.blockedMethods = { ...blockedMethods };
      if (testValueInQuery) protection.blockedTestValueQueryCount = (protection.blockedTestValueQueryCount as number) + 1;
      if (insecureRequest) protection.blockedInsecureRequestCount = (protection.blockedInsecureRequestCount as number) + 1;
      callback({ cancel: true });
    } else callback({ cancel: false });
  });
  const resize = () => {
    if (!window || !browser || window.isDestroyed()) return;
    const bounds = window.getContentBounds();
    browser.resize({ x: 0, y: 36, width: bounds.width, height: bounds.height - 36 });
  };
  resize(); window.on('resize', resize);
  browser.setVisible(true); window.show(); window.focus();
  phase = 'navigation';
  report.status = 'loading-real-page'; await saveReport();
  await Promise.race([browser.navigate(target.href), delay(60_000).then(() => { throw new Error('REAL_PAGE_LOAD_TIMEOUT'); })]);
  await delay(1600);
  const cookieDeny = await contents.executeJavaScript(`(() => {
    const element=Array.from(document.querySelectorAll('button,a')).find(item=>
      /^(?:deny|reject(?: all)?|拒绝(?:全部)?)$/i.test(item.textContent.trim()));
    if (!element) return null;
    const r=element.getBoundingClientRect(); const x=r.x+r.width/2,y=r.y+r.height/2;
    const hit=document.elementFromPoint(x,y);
    return r.width>0&&r.height>0&&(hit===element||element.contains(hit))?{x:Math.round(x),y:Math.round(y)}:null;
  })()`);
  if (cookieDeny) {
    app.focus({steal:true}); window.focus(); contents.focus();
    contents.sendInputEvent({type:'mouseDown',...cookieDeny,button:'left',clickCount:1});
    contents.sendInputEvent({type:'mouseUp',...cookieDeny,button:'left',clickCount:1});
    await delay(250); report.cookieNoticeAction='deny';
  }
  phase = 'observation';
  let initial = await observe();
  if (probeScroll && observeOnly) {
    const probes: Array<Record<string,unknown>>=[];
    for (const deltaY of [-80,80]) {
      const before=initial.fields.find(field=>/full.?name/i.test(field.label));
      app.focus({steal:true}); window.focus(); contents.focus();
      contents.sendInputEvent({type:'mouseWheel',x:500,y:250,deltaX:0,deltaY,hasPreciseScrollingDeltas:true,canScroll:true});
      await delay(350); initial=await observe();
      const after=initial.fields.find(field=>field.id===before?.id);
      probes.push({deltaY,precise:true,fieldId:before?.id,beforeY:before?.bounds.y,afterY:after?.bounds.y});
    }
    report.nativeScrollProbe=probes;
  }
  report.finalURL = initial.url; report.title = initial.title;
  report.fieldCount = initial.fields.length;
  report.fields = initial.fields.map(field => ({ fieldId: field.id, label: field.label, type: field.type, required: field.required, editable: field.editable, visibleInViewport: field.bounds.y >= 0 && field.bounds.y + field.bounds.height <= window!.getContentBounds().height - 36 }));
  report.observationComplete = true;
  await screenshot('before.png');
  const usableContactField = initial.fields.some(field => field.editable && field.value === ''
    && ['text', 'email', 'tel'].includes(field.type)
    && /^(?:full\s*name|name|姓名|完整姓名|英文姓名|e.?mail(?:\s*address)?|phone(?:\s*number)?|mobile(?:\s*number)?|telephone(?:\s*number)?|邮箱|电子邮箱|电子邮件|手机(?:号码)?|电话号码)\s*[*✱∗＊]?\s*$/i.test(field.label));
  if (!usableContactField) {
    report.status = 'real-page-unavailable';
    report.error = 'No editable empty name, email or phone field was observed on this real page. A key was not requested and the model was not called.';
    await finish(6);
  }
  report.status = observeOnly ? 'observation-complete' : 'observation-complete-api-key-required';
  await saveReport();
  if (observeOnly) await finish(0);
  else {
    if (!apiKey && waitForKey) apiKey = await requestKey();
    if (!apiKey) { report.status = 'api-key-required'; await finish(2); }
    else {
      phase = 'model-configuration';
      const runtime = await ModelRuntime.create({ credentials: new InMemoryCredentialStore(), modelsPath: null, allowModelNetwork: false, refreshOnCreate: false });
      runtime.registerProvider('offeragent-live-form-compatible', {
        baseUrl: endpoint.href, api: 'openai-completions', apiKey,
        models: [{ id: modelId, name: modelId, reasoning: false, input: ['text'], contextWindow: 32_768, maxTokens: 1_000, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } }],
      });
      const model = runtime.getModel('offeragent-live-form-compatible', modelId);
      if (!model) throw new Error('MODEL_NOT_CONFIGURED');
      phase = 'recognition';
      let beforeFill: FormObservation | undefined;
      const plan: FillPlan = await browser.preparePlan(async (observation, localProfile) => {
        beforeFill = observation;
        return recognizeModelForm(observation, localProfile, async input => {
          if ((report.modelRequestCount as number) >= 3) throw new Error('REQUEST_BUDGET_EXHAUSTED');
          report.modelRequestCount = (report.modelRequestCount as number) + 1;
          report.recognitionRan = true;
          const started = Date.now();
          try {
            const response = await recognizeFormWithModel(runtime, model, input, { maxTokens: 1_000 });
            report.modelResponse = { provider: model.provider, modelId: response.modelId, stopReason: 'stop', latencyMs: Date.now() - started,
              ...(response.usage ? { usage: response.usage } : {}), ...(response.httpStatus !== undefined ? { httpStatus: response.httpStatus } : {}), monetaryCostReported: false };
            return { text: response.text, modelId: response.modelId };
          } catch {
            report.modelFailure = 'Provider request failed, timed out, or did not complete a plain field mapping; raw provider errors are not persisted.';
            throw new Error('MODEL_REQUEST_FAILED');
          }
        });
      });
      report.recognition = plan.recognition;
      if (plan.recognition?.mode !== 'model') {
        report.status = 'model-recognition-incomplete';
        await finish(3);
      } else {
        const explicitContactLabel = (key: string, label: string): boolean => {
          if (/company|organi[sz]ation|employer|contact person|emergency|reference|referee|公司|企业|联系人|推荐人|紧急/i.test(label)) return false;
          if (key === 'email') return /e.?mail|邮箱|电子邮件/i.test(label);
          if (key === 'phone') return /phone|mobile|telephone|手机|电话/i.test(label);
          return /^(?:full\s*name|name|姓名|完整姓名|英文姓名)\s*[*✱∗＊]?\s*$/i.test(label);
        };
        const selected = plan.items.filter(item => item.status === 'ready' && item.profileKey && permittedKeys.has(item.profileKey)
          && item.currentValue === '' && explicitContactLabel(item.profileKey, item.label));
        report.selected = selected.map(item => ({ fieldId: item.fieldId, label: item.label, profileKey: item.profileKey }));
        if (!selected.length) { report.status = 'no-approved-contact-fields'; await finish(4); }
        else {
          phase = 'native-fill';
          window.focus(); contents.focus(); await delay(350);
          report.fillRan = true;
          const result = await browser.fillApproved(plan.id, selected.map(item => item.fieldId));
          report.verified = result.verified; report.unresolved = result.unresolved;
          phase = 'independent-reread';
          const after = await readFields();
          const selectedIds = new Set(selected.map(item => item.fieldId));
          report.nonselectedUnchanged = beforeFill!.fields.filter(field => !selectedIds.has(field.id)).every(field => after.find(candidate => candidate.id === field.id)?.value === field.value);
          report.independentValueChecks = selected.map(item => ({ fieldId: item.fieldId, exactMatch: after.find(field => field.id === item.fieldId)?.value === item.value }));
          report.finalURL = contents.getURL(); report.title = contents.getTitle();
          await screenshot('after.png');
          report.status = result.verified.length === selected.length && result.unresolved.length === 0 && report.nonselectedUnchanged === true ? 'live-contact-fill-verified' : 'live-contact-fill-partial';
          await finish(report.status === 'live-contact-fill-verified' ? 0 : 5);
        }
      }
    }
  }
} catch {
  // Do not persist raw SDK, network or Electron errors: they can include payloads.
  report.status = 'failed'; report.failurePhase = phase;
  report.error = 'This stage did not complete. See the recorded observation, model summary, selected/verified fields and request protections; no raw provider payload was saved.';
  if (browser) { try { await screenshot('failure.png'); } catch { /* The page may have closed. */ } }
  await finish(1);
}
