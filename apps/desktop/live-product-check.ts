import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { execFile } from 'node:child_process';
import { evaluateLiveNetworkRequest, liveQueryTokenHash } from './live-network-policy.js';
import { SmokeDeadlineError, SmokeStepRunner } from './smoke-deadline.js';
import { app, type BrowserWindow } from 'electron';
import type { BrowserController } from '../../packages/browser/src/controller.js';
import { READ_FORM } from '../../packages/browser/src/read-scripts.js';
import type { AppEvent, AppState, FillPlan, FillResult } from '../../packages/shared/src/contracts.js';
import { contactCategory, LIVE_CONTACT_VALUES, LiveProductCheckError, requireLiveCheck,
  resolveLiveProductTarget, validateLiveContactSelection, type LiveReadFields } from './live-product-targets.js';

/** A deliberately explicit, isolated acceptance run through the shipped UI and worker.
 * No private candidate data, browser fixtures, model mocks or DOM setters are used. */
export async function runLiveProductCheck(
  window: BrowserWindow, browser: BrowserController,
  methods: Record<string, (...args: any[]) => Promise<any>>,
  send: (event: AppEvent) => void, directory: string,
  configuration: { url: string; apiKey: string; modelId: string; baseURL: string },
): Promise<{ ok: boolean; report: string }> {
  const observeOnly = process.argv.includes('--live-observe-only');
  const caseId = process.argv.find(value => value.startsWith('--live-case='))?.slice('--live-case='.length);
  const reportPath = join(directory, 'report.json');
  const report: Record<string, any> = {
    date: new Date().toISOString(), status: 'starting', ok: false,
    mode: observeOnly ? 'observe-only' : 'live-fill', realEnterprisePage: true,
    realProviderApi: false, productionUI: true, productionWorker: false, sharedModelHelper: false, testValuesOnly: true,
    privateResumeOrDatabaseUsed: false, apiKeyPersisted: false,
    apiKeySentToRenderer: false, modelRequestCount: 0, prepareCallCount: 0, submitted: false,
    attachmentsUploaded: false, roleRecommendationClaim: false,
    pureModelMappingAccuracyClaim: false, enterpriseApplicationAcceptanceClaim: false,
    networkProtection: { allowedMethods: ['GET', 'HEAD'], blockedCount: 0,
      blockedMethods: {}, blockedTestValueQueryCount: 0, blockedInsecureRequestCount: 0,
      reviewedReadPostCount: 0, reviewedReadRules: [], blockedReasons: {} },
  };
  const expect: typeof requireLiveCheck = (condition, code) => {
    if (!condition) report.guardFailureCode = code;
    requireLiveCheck(condition, code);
  };
  const safeException = (error: unknown) => {
    const knownNames = new Set(['Error', 'TypeError', 'RangeError', 'ReferenceError', 'SyntaxError', 'DOMException', 'LiveProductCheckError']);
    const name = error instanceof Error && knownNames.has(error.name) ? error.name : 'UnknownError';
    // Extract only local source positions, never the stack's first line (message)
    // or remote URLs, call arguments, provider payloads and credentials.
    const frames = error instanceof Error && typeof error.stack === 'string'
      ? error.stack.split('\n').slice(1).flatMap(line => {
        const match = line.match(/(?:file:\/\/)?(\/Users\/study\/Documents\/OfferAgent\/[^()\s]+):(\d+):(\d+)/);
        return match ? [{ path: match[1], line: Number(match[2]), column: Number(match[3]) }] : [];
      }).slice(0, 5) : [];
    return { name, localFrames: frames };
  };
  async function screenshot(name: string, capture: () => Promise<{ toPNG(): Buffer }>): Promise<void> {
    try {
      const captured = await Promise.race([
        capture(),
        delay(3000).then(() => { throw new LiveProductCheckError('SCREENSHOT_UNAVAILABLE'); }),
      ]);
      await writeFile(join(directory, `${name}.png`), captured.toPNG());
      (report.screenshots ??= {})[name] = { status: 'saved' };
    } catch (error) {
      // Screenshots are supporting evidence. A transient compositor failure must
      // not interrupt the independent reads or production safety checks.
      (report.screenshots ??= {})[name] = { status: 'unavailable', failureCode: 'SCREENSHOT_UNAVAILABLE', ...safeException(error) };
    }
  }
  const uiSteps = new SmokeStepRunner('live-product-ui');
  const evaluate = <T = any>(code: string): Promise<T> => uiSteps.run('renderer-script', () => window.webContents.executeJavaScript(code));
  async function waitFor(code: string, timeoutMs = 25_000): Promise<void> {
    const until = Date.now() + timeoutMs;
    do { if (await evaluate<boolean>(code)) return; await delay(60); } while (Date.now() < until);
    expect(false, 'UI_WAIT_INCOMPLETE');
  }
  async function click(selector: string): Promise<void> {
    app.focus({ steal: true }); window.focus(); window.webContents.focus();
    const point = await evaluate<{ x: number; y: number; code?: never } | { code: string }>(`(async () => {
      const e=document.querySelector(${JSON.stringify(selector)});
      if(!e||e.disabled) return {code:'UI_BUTTON_UNAVAILABLE'};
      e.scrollIntoView({block:'center'});
      await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));
      const b=e.getBoundingClientRect(), x=Math.round(b.x+b.width/2), y=Math.round(b.y+b.height/2);
      const hit=document.elementFromPoint(x,y);
      if(!b.width||!b.height||!(hit===e||e.contains(hit))) return {code:'UI_BUTTON_OBSCURED'};
      return {x,y};
    })()`);
    expect('x' in point && 'y' in point, point.code === 'UI_BUTTON_UNAVAILABLE' ? 'UI_BUTTON_UNAVAILABLE' : 'UI_BUTTON_OBSCURED');
    window.webContents.sendInputEvent({ type: 'mouseMove', ...point });
    window.webContents.sendInputEvent({ type: 'mouseDown', ...point, button: 'left', clickCount: 1 });
    window.webContents.sendInputEvent({ type: 'mouseUp', ...point, button: 'left', clickCount: 1 });
    await delay(120);
  }
  const contents = browser.view.webContents;
  const startedAt = Date.now();
  const focusTimeline: Array<Record<string, unknown>> = [];
  const trace = (event: string, detail: Record<string, unknown> = {}) => {
    if (focusTimeline.length >= 1000) return;
    focusTimeline.push({ atMs: Date.now() - startedAt, event,
      windowFocused: window.isFocused(), viewFocused: contents.isFocused(),
      windowVisible: window.isVisible(), minimized: window.isMinimized(),
      appHidden: app.isHidden(), ...detail });
  };
  // Read only the frontmost application identity after an observed window blur.
  // No window text, screen pixels, Accessibility or Apple Events are requested.
  const frontmost = (reason: string) => {
    if (process.platform !== 'darwin') return;
    execFile('/usr/bin/osascript', ['-l', 'JavaScript', '-e',
      'ObjC.import("AppKit");var a=$.NSWorkspace.sharedWorkspace.frontmostApplication;JSON.stringify({pid:Number(a.processIdentifier),bundleId:ObjC.unwrap(a.bundleIdentifier)})'],
    { timeout: 1500 }, (error, stdout) => {
      try {
        if (error) { trace('frontmost-unavailable', { reason }); return; }
        const value = JSON.parse(stdout);
        const bundle = typeof value.bundleId === 'string' ? value.bundleId : '';
        trace('frontmost', { reason, ownProcess: value.pid === process.pid,
          application: ['com.apple.Safari', 'com.openai.codex', 'com.apple.systemuiserver', 'com.github.Electron'].includes(bundle) ? bundle : 'other-application' });
      } catch { trace('frontmost-unavailable', { reason }); }
    });
  };
  const windowFocus = () => trace('window-focus');
  const windowBlur = () => { trace('window-blur'); frontmost('window-blur'); };
  const viewFocus = () => trace('view-focus');
  const viewBlur = () => trace('view-blur');
  const loadStart = () => trace('page-load-start', { mainFrameLoading: contents.isLoadingMainFrame() });
  const loadStop = () => trace('page-load-stop', { mainFrameLoading: contents.isLoadingMainFrame() });
  window.on('focus', windowFocus); window.on('blur', windowBlur);
  contents.on('focus', viewFocus); contents.on('blur', viewBlur);
  contents.on('did-start-loading', loadStart); contents.on('did-stop-loading', loadStop);
  trace('harness-start');
  const read = async (): Promise<LiveReadFields> => {
    const observation = await contents.executeJavaScript(READ_FORM) as LiveReadFields;
    // Diagnostic ownership metadata only: no setters, focus, events, page body or private state.
    const metadata = await contents.executeJavaScript(`Array.from(document.querySelectorAll('input,textarea,select')).slice(0,300).map(e=>({
      id:String(e.id||'').slice(0,240),name:String(e.name||'').slice(0,240),autocomplete:String(e.autocomplete||'').slice(0,120),
      formIndex:e.form?Array.from(document.forms).indexOf(e.form):-1,formId:String(e.form?.id||'').slice(0,240),
      formName:String(e.form?.getAttribute('name')||'').slice(0,240),formAction:(()=>{try{const u=new URL(e.form?.getAttribute('action')||location.href,location.href);return u.origin+u.pathname}catch{return ''}})(),
      nativeValid:!e.validity||e.validity.valid,validationMessage:String(e.validationMessage||'').slice(0,240),ariaInvalid:String(e.getAttribute('aria-invalid')||''),
      errorText:Array.from(e.parentElement?.querySelectorAll('.error-message,.field-error,[role=alert]')||[]).map(n=>n.innerText||'').join(' ').replace(/\\s+/g,' ').slice(0,240)
    }))`);
    return { ...observation, fields: observation.fields.map(field => ({ ...field, metadata: metadata[field.index] })) };
  };
  const protectedControls = () => contents.executeJavaScript(`Array.from(document.querySelectorAll('input[type=checkbox],input[type=radio],input[type=file]')).map((e,index)=>({index,type:e.type,checked:e.checked,fileCount:e.files?.length??0}))`);
  const originalPrepare = methods.prepareFill!;
  const originalFill = methods.fillApproved!;
  let plan: FillPlan | undefined;
  let fillResult: FillResult | undefined;
  let selected: string[] = [];
  let phase = 'configuration';
  let fillCalls = 0;
  const nativeWheels: Array<{ deltaY: number; precise: boolean; x: number; y: number; at: string; windowFocused: boolean; viewFocused: boolean }> = [];
  const pageEnvironment = async () => ({ windowFocused: window.isFocused(), viewFocused: contents.isFocused(),
    page: await contents.executeJavaScript(`({visible:document.visibilityState,focused:document.hasFocus(),scrollY,scrollX})`) });
  let profileBefore: AppState['profile'] | undefined;
  let applicationsBefore: AppState['applications'] | undefined;
  let before: LiveReadFields | undefined;
  let protectedBefore: unknown;
  async function diagnostics(): Promise<void> {
    if (plan) {
      report.recognition = plan.recognition;
      report.plan = { id: plan.id, url: plan.url, profileVersion: plan.profileVersion, observationId: plan.observationId,
        items: plan.items.map(item => ({ ...item })) };
      report.planStatusCounts = Object.fromEntries(['ready', 'review', 'skip'].map(status => [status, plan!.items.filter(item => item.status === status).length]));
      report.selected = plan.items.filter(item => selected.includes(item.fieldId)).map(item => ({ fieldId: item.fieldId, label: item.label, profileKey: item.profileKey }));
    }
    report.fillCallCount = fillCalls;
    report.selectedCount = selected.length;
    if (fillResult) { report.verified = fillResult.verified; report.unresolved = fillResult.unresolved; }
    if (!before) return;
    const after = await read();
    report.after = after; report.finalURL = after.url;
    report.nativeViewportStable = before.viewport?.width === after.viewport?.width && before.viewport?.height === after.viewport?.height;
    report.independentValueChecks = selected.map(id => {
      const field = after.fields.find(field => `field-${field.index}` === id);
      const item = plan?.items.find(item => item.fieldId === id);
      return { fieldId: id, exactMatch: Boolean(field && item && field.value === item.value),
        missingOrBlank: !field || field.value === '', wrongNonemptyValue: Boolean(field?.value && item && field.value !== item.value) };
    });
    report.wrongNonemptyValueCount = report.independentValueChecks.filter((item: { wrongNonemptyValue: boolean }) => item.wrongNonemptyValue).length;
    report.nonselectedUnchanged = before.fields.filter(field => !selected.includes(`field-${field.index}`))
      .every(field => after.fields.find(candidate => candidate.index === field.index && candidate.identity === field.identity)?.value === field.value);
    report.consentAndAttachmentsUnchanged = JSON.stringify(await protectedControls()) === JSON.stringify(protectedBefore);
    report.enterprisePageHasAppBridge = await contents.executeJavaScript("typeof window.offer !== 'undefined' || typeof require !== 'undefined' || typeof process !== 'undefined'");
    const afterState = await methods.getState!() as AppState;
    report.profileUnchanged = JSON.stringify(afterState.profile) === JSON.stringify(profileBefore);
    report.applicationsUnchanged = JSON.stringify(afterState.applications) === JSON.stringify(applicationsBefore);
  }
  try {
    expect(process.argv.includes('--live-product-check') && !process.argv.includes('--smoke-test'), 'ISOLATION_FLAG_REQUIRED');
    const target = resolveLiveProductTarget(configuration.url, caseId);
    expect(observeOnly || configuration.apiKey.length > 8 && !process.env.OFFERAGENT_LIVE_FORM_API_KEY, 'DEDICATED_MEMORY_KEY_REQUIRED');
    report.applicationURL = configuration.url;
    report.caseId = target.id; report.company = target.company;
    report.scope = 'supported-contact-fields-only';
    report.expectedContactCategories = target.expectedContactCategories;
    report.expectedManualContactLabels = target.expectedManualContactLabels ?? [];
    report.expectedSemanticContactCount = target.expectedContactCategories.length + (target.expectedManualContactLabels?.length ?? 0);
    report.model = { modelId: configuration.modelId, endpointOrigin: new URL(configuration.baseURL).origin };
    contents.session.webRequest.onBeforeRequest((details, callback) => {
      const decision = evaluateLiveNetworkRequest(details, target.id);
      const protection = report.networkProtection;
      if (decision.reason === 'reviewed-ashby-query') {
        protection.reviewedReadPostCount++;
        if (!protection.reviewedReadRules.includes(decision.ruleId)) protection.reviewedReadRules.push(decision.ruleId);
      }
      if (!decision.allowed) {
        protection.blockedCount++;
        protection.blockedMethods[details.method] = (protection.blockedMethods[details.method] ?? 0) + 1;
        protection.blockedReasons[decision.reason] = (protection.blockedReasons[decision.reason] ?? 0) + 1;
        if (decision.reason === 'test-value-query') protection.blockedTestValueQueryCount++;
        if (decision.reason === 'insecure-url') protection.blockedInsecureRequestCount++;
        if (target.id === 'oakslab-ashby' && details.method === 'POST' && (protection.blockedPublicReadShapes?.length ?? 0) < 20) {
          // Public, isolated read diagnostics only. Never retain request bodies,
          // query text, arbitrary variables, candidate values or cookies.
          try {
            const chunks = details.uploadData ?? [];
            const bytes = Buffer.concat(chunks.flatMap(entry => entry.bytes ? [entry.bytes] : []));
            const body = bytes.length <= 32768 ? JSON.parse(bytes.toString('utf8')) : {};
            const shape = { operation: typeof body.operationName === 'string' && /^[_A-Za-z][_0-9A-Za-z]{0,80}$/.test(body.operationName) ? body.operationName : 'unknown',
              keys: Object.keys(body).slice(0,10), variableKeys: Object.keys(body.variables ?? {}).slice(0,10),
              queryHash: typeof body.query === 'string' ? liveQueryTokenHash(body.query) : null,
              uploadKeys: chunks.map(entry => Object.keys(entry)) };
            (protection.blockedPublicReadShapes ??= []).push(shape);
          } catch { /* A malformed write remains blocked. */ }
        }
      }
      callback({ cancel: !decision.allowed });
    });
    contents.session.on('will-download', event => event.preventDefault());
    phase = 'empty-state-check';
    const original = await methods.getState!() as AppState;
    expect(original.profile.version === 0 && original.applications.length === 0 && original.jobs.length === 0, 'EMPTY_ISOLATED_DATABASE_REQUIRED');
    phase = 'profile-seeding';
    const state = await methods.saveProfile!({
      ...LIVE_CONTACT_VALUES,
      school: '', schoolEn: '', major: '', majorEn: '', degree: '', graduationMonth: '',
      targetRoles: [], cities: [], skills: [], resumeText: '',
    }, original.profile.version) as AppState;
    profileBefore = state.profile; applicationsBefore = state.applications;
    phase = 'job-seeding';
    const jobId = `live-product-${target.id}-validation`;
    await methods.saveJob!({ id: jobId, company: `${target.company} · 真实页面功能验证（非投递推荐）`,
      title: `${target.title} · 网页填写技术验收`, city: '', type: 'unknown',
      description: '真实企业申请页功能验证入口，不是适合候选人的岗位推荐；不提交申请。',
      requirements: '', url: configuration.url, sourceId: 'live-product-validation',
      sourceName: '明确选择的真实页面功能验证', publishedAt: null, deadline: null, demo: false });
    if (!observeOnly) {
      phase = 'model-configuration';
      await methods.configureModel!({ mode: 'live', provider: 'custom', modelId: configuration.modelId,
        apiKey: configuration.apiKey, baseURL: configuration.baseURL });
      configuration.apiKey = '';
      const modelStatus = await methods.modelStatus!();
      expect(modelStatus.mode === 'live' && modelStatus.configured && modelStatus.modelId === 'qwen-flash', 'PRODUCTION_MODEL_NOT_CONFIGURED');
      report.modelConfiguredViaProductionMethod = true;
    } else configuration.apiKey = '';
    methods.prepareFill = async (...args) => {
      expect(!observeOnly && args[0]?.useModel === true && report.prepareCallCount < 1, 'ONE_MODEL_REQUEST_BUDGET');
      report.prepareCallCount++; report.modelRequestCount = null;
      const started = Date.now();
      plan = await originalPrepare(...args) as FillPlan;
      report.recognitionLatencyMs = Date.now() - started;
      report.recognition = plan.recognition;
      report.productionWorker = true; report.sharedModelHelper = true;
      report.realProviderApi = plan.recognition?.httpStatus === 200 && !!plan.recognition.usage?.totalTokens;
      if (plan.recognition?.httpStatus || plan.recognition?.usage) report.modelRequestCount = 1;
      expect(plan.recognition?.mode === 'model', 'REAL_MODEL_REQUIRED_NO_FALLBACK');
      return plan;
    };
    methods.fillApproved = async (planId, fieldIds) => {
      expect(!observeOnly && ++fillCalls === 1 && plan?.id === planId, 'ONE_APPROVED_FILL_BUDGET');
      // Keep the attempted IDs even if the independent test guard refuses them.
      report.attemptedSelected = Array.isArray(fieldIds) ? fieldIds : [];
      try { validateLiveContactSelection(plan, fieldIds, before, target); }
      catch (error) { if (error instanceof LiveProductCheckError) report.guardFailureCode = error.code; throw error; }
      selected = [...fieldIds];
      const originalInput = contents.sendInputEvent;
      const originalInsert = contents.insertText;
      contents.sendInputEvent = function (event) {
        trace(`input-${event.type}`, 'x' in event ? { x: event.x, y: event.y } : {});
        if (event.type === 'mouseWheel') { const wheel = event as import('electron').MouseWheelInputEvent; nativeWheels.push({ deltaY: wheel.deltaY ?? 0, precise: wheel.hasPreciseScrollingDeltas === true,
          x: wheel.x, y: wheel.y, at: new Date().toISOString(), windowFocused: window.isFocused(), viewFocused: contents.isFocused() }); }
        return originalInput.call(this, event);
      };
      contents.insertText = function (value) { trace('insert-text'); return originalInsert.call(this, value); };
      try { report.beforeNativeFillEnvironment = await pageEnvironment(); fillResult = await originalFill(planId, fieldIds) as FillResult; }
      finally { contents.sendInputEvent = originalInput; contents.insertText = originalInsert; report.nativeScrollDuringApprovedFill = [...nativeWheels]; report.afterNativeFillEnvironment = await pageEnvironment(); }
      return fillResult;
    };
    phase = 'production-ui-navigation';
    send({ type: 'navigate', page: 'apply' });
    const selector = `[data-testid="recommended-job-${jobId}"] .apply-job-bottom button`;
    await waitFor(`Boolean(document.querySelector(${JSON.stringify(selector)}))`);
    await click(selector);
    await waitFor('Boolean(document.querySelector(\'[data-testid="quick-fill"]\')) && !document.querySelector(\'[data-testid="quick-fill"]\').disabled', 60_000);
    expect(contents.getURL() === configuration.url, 'TARGET_URL_CHANGED');
    await delay(1400);
    // A cookie rejection is the only allowed enterprise-page button click.
    const denyPoint = await contents.executeJavaScript(`(() => {
      const e=Array.from(document.querySelectorAll('button,a')).find(e=>/^(deny|reject(?: all)?|only necessary)$/i.test(e.textContent.trim()));
      if(!e) return null; const r=e.getBoundingClientRect(), x=Math.round(r.x+r.width/2), y=Math.round(r.y+r.height/2), hit=document.elementFromPoint(x,y);
      return r.width&&r.height&&(hit===e||e.contains(hit))?{x,y,label:e.textContent.trim()}:null;
    })()`);
    if (denyPoint) {
      app.focus({ steal: true }); window.focus(); contents.focus();
      contents.sendInputEvent({ type: 'mouseDown', ...denyPoint, button: 'left', clickCount: 1 });
      contents.sendInputEvent({ type: 'mouseUp', ...denyPoint, button: 'left', clickCount: 1 });
      await delay(300); report.cookieNoticeAction = denyPoint.label;
    }
    phase = 'enterprise-page-observation';
    before = await read();
    protectedBefore = await protectedControls();
    report.before = before;
    report.title = before.title; report.fieldCount = before.fields.length;
    report.expectedContactCoverage = target.expectedContactCategories.map(category => ({ category,
      observedFieldIds: before!.fields.filter(field => contactCategory(field.label) === category).map(field => `field-${field.index}`) }));
    phase = 'before-evidence-capture';
    // Keep all compositor work out of the live-input interval. Capture requests
    // cannot be cancelled; a late completion can perturb macOS focus/painting.
    if (observeOnly) await screenshot('before-ui', () => window.webContents.capturePage());
    else (report.screenshots ??= {})['before-ui'] = { status: 'not-requested-before-live-input' };
    // A pending native-view compositor capture cannot be cancelled and may
    // outlive its timeout. Keep it outside live input; the original values and
    // ownership are already preserved by the mandatory independent read above.
    if (observeOnly) await screenshot('before-webpage', () => contents.capturePage());
    else (report.screenshots ??= {})['before-webpage'] = { status: 'not-requested-before-live-input' };
    expect(before.url === configuration.url && before.fields.length > 0, 'REAL_FORM_NOT_AVAILABLE');
    if (observeOnly) {
      await diagnostics(); report.status = 'real-page-observed-no-model-or-fill'; report.ok = true;
      return { ok: true, report: reportPath };
    }
    phase = 'production-ui-one-click';
    await waitFor('Boolean(document.querySelector(\'[data-testid="quick-fill"]\')) && !document.querySelector(\'[data-testid="quick-fill"]\').disabled', 60_000);
    await click('[data-testid="quick-fill"]');
    await waitFor('Boolean(document.querySelector(\'[data-testid="quick-fill-result"]\')) || (Boolean(document.querySelector(\'.inline-error[role=alert]\')) && !document.querySelector(\'[data-testid="quick-fill"]\')?.disabled)', 50_000);
    report.uiStatus = await evaluate(`({ error:document.querySelector('.inline-error[role=alert]')?.innerText?.slice(0,600)||'', status:document.querySelector('[data-testid="quick-fill-status"]')?.innerText?.slice(0,600)||'' })`);
    phase = 'independent-reread-immediate';
    if (report.guardFailureCode) throw new LiveProductCheckError(report.guardFailureCode);
    expect(plan?.recognition?.mode === 'model', 'REAL_MODEL_UI_FLOW_INCOMPLETE');
    const currentPlan = plan!;
    await diagnostics(); report.afterImmediate = report.after;
    await delay(1000);
    phase = 'independent-reread-settled';
    await diagnostics(); report.settledRereadDelayMs = 1000;
    report.settledValuesStable = selected.every(id => report.afterImmediate.fields.find((field: { index: number }) => `field-${field.index}` === id)?.value
      === report.after.fields.find((field: { index: number }) => `field-${field.index}` === id)?.value);
    const verifiedCount = fillResult?.verified.length ?? 0;
    report.manualContactDisposition = (target.expectedManualContactLabels ?? []).map(label => ({ label,
      items: currentPlan.items.filter(item => item.label.replace(/[*✱∗＊✳※:：]/g, '').trim().toLowerCase() === label.toLowerCase())
        .map(item => ({ fieldId: item.fieldId, status: item.status, reason: item.reason, selected: selected.includes(item.fieldId) })) }));
    report.expectedContactCoverage = report.expectedContactCoverage.map((entry: { category: string; observedFieldIds: string[] }) => ({ ...entry,
      selectedFieldIds: currentPlan.items.filter(item => selected.includes(item.fieldId) && contactCategory(item.label) === entry.category).map(item => item.fieldId),
      independentlyExactFieldIds: entry.observedFieldIds.filter(id => report.independentValueChecks.some((check: { fieldId: string; exactMatch: boolean }) => check.fieldId === id && check.exactMatch)) }));
    report.ui = await evaluate(`(() => ({
      samePlan:document.querySelector('.form-preview')?.getAttribute('data-plan-id')===${JSON.stringify(currentPlan.id)},
      filledAndVerified:document.querySelector('[data-testid="quick-fill-result"]')?.innerText.includes(${JSON.stringify(`已填写并核实 ${verifiedCount} 项`)})===true,
      needsUserVisible:Boolean(document.querySelector('.quick-needs-user li')),
      noNode:typeof require==='undefined' && typeof process==='undefined',
      keyFieldsEmpty:Array.from(document.querySelectorAll('input[type=password]')).every(e=>!e.value)
      , browserNoticeInSidebar:Boolean(document.querySelector('.browser-panel .browser-permission-note')),
      browserNoticeOutsideNativeArea:!document.querySelector('.browser-content .browser-error,.browser-content .browser-permission-note')
    }))()`);
    phase = 'result-verification';
    expect(report.modelRequestCount === 1 && report.recognition.httpStatus === 200 && report.recognition.usage?.totalTokens > 0, 'LIVE_API_RESPONSE_EVIDENCE_REQUIRED');
    expect(report.nativeViewportStable && report.wrongNonemptyValueCount === 0 && report.nonselectedUnchanged && report.consentAndAttachmentsUnchanged
      && report.finalURL === configuration.url, 'VALUE_OR_PROTECTED_STATE_CHANGED');
    expect(fillResult && verifiedCount === selected.length && fillResult.unresolved.length === 0
      && report.independentValueChecks.every((item: { exactMatch: boolean }) => item.exactMatch) && report.settledValuesStable, 'SAFE_FILL_INCOMPLETE');
    expect(report.expectedContactCoverage.every((entry: { independentlyExactFieldIds: string[] }) => entry.independentlyExactFieldIds.length === 1), 'SUPPORTED_CONTACT_COVERAGE_INCOMPLETE');
    expect(report.ui.samePlan && report.ui.filledAndVerified && report.ui.needsUserVisible && report.ui.noNode
      && report.ui.keyFieldsEmpty && !report.enterprisePageHasAppBridge && report.profileUnchanged && report.applicationsUnchanged, 'PRODUCT_STATE_OR_ISOLATION_FAILED');
    phase = 'after-evidence-capture';
    await screenshot('after-ui', () => window.webContents.capturePage());
    await screenshot('after-webpage', () => contents.capturePage());
    report.status = 'production-ui-live-contact-fill-verified'; report.ok = true;
  } catch (error) {
    // Never persist raw exception text, request payloads, credentials or full UI
    // state. The stage and safe counters suffice to diagnose an incomplete run.
    report.failurePhase = phase;
    report.failureCode = error instanceof LiveProductCheckError ? error.code : error instanceof SmokeDeadlineError ? 'UI_STEP_TIMEOUT' : report.guardFailureCode ?? 'UNEXPECTED_RUNTIME_ERROR';
    if (error instanceof SmokeDeadlineError) report.uiWait = uiSteps.snapshot();
    report.exception = safeException(error);
    try { await diagnostics(); } catch { report.diagnosticRereadUnavailable = true; }
    report.status = report.wrongNonemptyValueCount > 0 || report.nonselectedUnchanged === false || report.consentAndAttachmentsUnchanged === false
      ? 'incorrect-or-unexpected-page-change' : 'safe-incomplete';
    await screenshot('failure-ui', () => window.webContents.capturePage());
    await screenshot('failure-webpage', () => contents.capturePage());
  } finally {
    window.removeListener('focus', windowFocus); window.removeListener('blur', windowBlur);
    contents.removeListener('focus', viewFocus); contents.removeListener('blur', viewBlur);
    contents.removeListener('did-start-loading', loadStart); contents.removeListener('did-stop-loading', loadStop);
    report.focusTimeline = focusTimeline;
    configuration.apiKey = '';
    methods.prepareFill = originalPrepare; methods.fillApproved = originalFill;
    report.apiKeyEnvironmentRemoved = !process.env.OFFERAGENT_LIVE_FORM_API_KEY;
    await writeFile(reportPath, JSON.stringify(report, null, 2), { mode: 0o600 });
  }
  return { ok: report.ok === true, report: reportPath };
}
