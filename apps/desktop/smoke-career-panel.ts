import { createHash } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import type { BrowserWindow } from 'electron';
import type { AppEvent, AppState, BrowserState, FillPlan, FillResult, ModelStatus } from '../../packages/shared/src/contracts.js';
import type { CareerFillOptions, CareerFillOutcome, CareerFillPreview } from '../../packages/shared/src/career-form.js';
import { buildCareerPlan, careerGroupSignature, type CareerFillPlan, type CareerFormObservation } from '../../packages/forms/src/career-plan.js';
import { createCareerFormFixtureProfile } from './fixtures/career-form-profile.js';
import { SmokeStepRunner } from './smoke-deadline.js';

type Methods = Record<string, (...args: any[]) => Promise<any>>;
type LocateInput = { kind: 'ordinary' | 'career'; planId: string; fieldId?: string; sectionId?: string; groupId?: string; fieldKey?: string };
type LocateReply = { status: 'located'; message: string };
const locateKey = (value: LocateInput | undefined) => JSON.stringify(Object.entries(value ?? {}).filter(([, item]) => item !== undefined).sort(([left], [right]) => left.localeCompare(right)));
const hash = (value: string) => createHash('sha256').update(value).digest('hex');

/** Own React/named-IPC protocol fixture. No enterprise view, model or actual form executor is used. */
export async function smokeCareerFillPanel(window: BrowserWindow, methods: Methods,
  send: (event: AppEvent) => void, stateDirectory: string) {
  if (!process.argv.includes('--smoke-test') || process.argv.includes('--live-product-check') || process.argv.includes('--site-diagnostic')) throw new Error('履历面板协议检查仅允许隔离桌面 smoke。');
  for (const name of ['getState', 'browserState', 'modelStatus', 'prepareFill', 'fillApproved', 'prepareCareerFill', 'runCareerFill', 'cancelCareerFill', 'locateApplicationField', 'browserBounds', 'finishMeasurement']) {
    if (typeof methods[name] !== 'function') throw new Error(`履历面板协议检查缺少 ${name}`);
  }
  const originalGetState = methods.getState!; const originalBrowserState = methods.browserState!;
  const originalFinishMeasurement = methods.finishMeasurement!;
  const beforeState = await originalGetState() as AppState; const beforeBrowser = await originalBrowserState() as BrowserState;
  const beforeModel = await methods.modelStatus!() as ModelStatus;
  const noKeyModel: ModelStatus = { mode: 'demo', provider: 'ui-protocol-fixture', modelId: '', configured: false };
  if (beforeBrowser.visible) throw new Error('请先隐藏原生企业 view，再运行纯 UI 协议检查。');
  const steps = new SmokeStepRunner('career-fill-panel-ui-protocol-fixture');
  // Named IPC fixtures may run while the outer driver is polling completion.
  // This separate bounded reader only observes our own renderer's tabs/layout; it
  // never clicks, changes focus or performs an actual browser operation.
  const phaseReads = new SmokeStepRunner('career-phase-layout-read-only');
  const assertions: Array<{ name: string; passed: true }> = [];
  const expect = (condition: unknown, name: string) => { if (!condition) throw new Error(name); assertions.push({ name, passed: true }); };
  const profile = createCareerFormFixtureProfile();
  // The default master's record is deliberately not the source array's first
  // item. Automatic order must follow the confirmed default, not array luck.
  profile.career!.educations.reverse();
  const fakeState: AppState = { ...structuredClone(beforeState), profile };
  const fakeBrowser: BrowserState = { url: 'https://modelbest.jobs.feishu.cn/campus/resume/0/apply', title: '完全虚构的 UI 协议上下文，未加载企业网页',
    loading: false, canGoBack: false, canGoForward: false, visible: false };
  const primary = profile.career!.primaryEducationId!;
  const expectedIds = { educations: [primary, ...profile.career!.educations.filter(record => record.id !== primary).map(record => record.id)],
    internships: profile.career!.internships.map(record => record.id), projects: profile.career!.projects.map(record => record.id) };
  const initialFields = [
    { key: 'school' as const, suffix: 'school', type: 'text' },
    { key: 'degree' as const, suffix: 'degree', type: 'combobox', customSelectSupported: true },
    { key: 'major' as const, suffix: 'fieldOfStudy', type: 'text' },
    { key: 'startDate' as const, suffix: 'period:start', type: 'feishu-month', datePrecision: 'month' as const },
    { key: 'endDate' as const, suffix: 'period:end', type: 'feishu-month', datePrecision: 'month' as const },
  ].map(({ suffix, ...field }) => ({ ...field, id: `education[0].${suffix}`, signature: hash(`ui-protocol-field-${suffix}`), value: '', editable: true, required: true }));
  const data = { id: 'education[0]', collection: 'educations' as const, fields: initialFields };
  const observation: CareerFormObservation = { id: 'ui-protocol-observation', url: fakeBrowser.url, generation: 1, signature: hash('ui-protocol-page'),
    groups: [{ ...data, signature: careerGroupSignature(data) }], addControls: (['educations', 'internships', 'projects'] as const)
      .map(collection => ({ id: `${collection}:add`, collection, signature: hash(`ui-protocol-add-${collection}`), enabled: true })), protectedFields: [] };
  const prepareRequests: CareerFillOptions[] = []; const prepareResponses: CareerFillPreview[] = []; const runRequests: string[] = [];
  const ordinaryPrepareRequests: Array<{ planId: string; rulesOnly: true }> = [];
  const ordinaryFillRequests: Array<{ planId: string; fieldIds: string[] }> = [];
  const eventOrder: string[] = []; const ordinaryIssued = new Set<string>();
  type WorkspaceLayout = { togglePresent: boolean; activityVisible: boolean; nativeHolderCount: number;
    holderBounds: { x: number; y: number; width: number; height: number } | null };
  const phaseLayouts: Array<WorkspaceLayout & { operation: 'ordinary-prepare' | 'ordinary-fill' | 'career-prepare' }> = [];
  const boundsRequests: Array<{ visibleRequested: boolean }> = []; const blocked: string[] = [];
  let entryDiagnostics: Record<string, boolean> | undefined;
  const replaced = new Map<string, Methods[string]>(); const issued = new Map<string, CareerFillPreview>();
  let cancelCalls = 0; let holdPrepareAt: number | undefined; let fixtureActive = true; let nextContactUnresolved = false;
  let contactValue = ''; let holdNextContactFill = false;
  let heldContactFill: { resolve(value: FillResult): void; reject(error: Error): void; value: FillResult } | undefined;
  type HeldPrepare = { resolve(value: CareerFillPreview): void; reject(error: Error): void; value: CareerFillPreview };
  let heldPrepare: HeldPrepare | undefined; let outcome: CareerFillOutcome | undefined;
  let holdNextMeasurementFinish = false; let measurementFinishHoldCount = 0;
  let heldMeasurementFinish: { resolve(): void; reject(error: Error): void } | undefined;
  const locateRequests: LocateInput[] = []; const allowedLocateRequests: LocateInput[] = [];
  let nextCareerPending = false; let holdNextLocate = false;
  let heldLocate: { resolve(value: LocateReply): void; reject(error: Error): void } | undefined;
  const replace = (name: string, value: Methods[string]) => { if (!replaced.has(name)) replaced.set(name, methods[name]!); methods[name] = value; };
  const project = (plan: CareerFillPlan, options: CareerFillOptions): CareerFillPreview => ({ planId: plan.id, url: plan.url, profileVersion: plan.profileVersion,
    groups: plan.original.groups.map(group => ({ id: group.id, collection: group.collection, signature: group.signature,
      fields: group.fields.map(field => ({ id: field.id, key: field.key, type: field.type, value: field.value, editable: field.editable, required: field.required })) })),
    bindings: structuredClone(plan.bindings), selectedRecordIds: structuredClone(options.selectedRecordIds ?? {}), preserveGroupIds: [...(options.preserveGroupIds ?? [])],
    issues: structuredClone(plan.issues), steps: plan.steps.map(step => step.kind === 'fill-group'
      ? { kind: step.kind, collection: step.binding.collection, recordId: step.binding.recordId, groupId: step.binding.groupId, items: structuredClone(step.items) }
      : { kind: step.kind, collection: step.collection, recordId: step.recordId }) });
  const ui = <T = unknown>(operation: string, expression: string) => steps.run(operation, () => window.webContents.executeJavaScript(expression) as Promise<T>);
  const workspaceLayoutScript = `(() => {
    const toggle=document.querySelector('[data-testid="browser-panel-toggle"]');
    const activity=document.querySelector('[data-testid="workspace-tab-activity"]');
    const pane=document.querySelector('#space-activity');const holders=document.querySelectorAll('.browser-placeholder');
    const rect=holders.length===1?holders[0].getBoundingClientRect():null;
    return {togglePresent:Boolean(toggle),activityVisible:Boolean(activity?.getAttribute('aria-selected')==='true'&&pane?.checkVisibility()),
      nativeHolderCount:holders.length,holderBounds:rect?{x:Math.round(rect.x),y:Math.round(rect.y),width:Math.round(rect.width),height:Math.round(rect.height)}:null};
  })()`;
  const recordPhaseLayout = async (operation: 'ordinary-prepare' | 'ordinary-fill' | 'career-prepare') => {
    const snapshot = await phaseReads.run(operation, () => window.webContents.executeJavaScript(workspaceLayoutScript) as Promise<WorkspaceLayout>);
    phaseLayouts.push({ operation, ...snapshot });
  };
  const sameHolder = (entry: WorkspaceLayout, reference: WorkspaceLayout) => entry.togglePresent && entry.nativeHolderCount === 1
    && Boolean(entry.holderBounds && entry.holderBounds.width > 0 && entry.holderBounds.height > 0)
    && JSON.stringify(entry.holderBounds) === JSON.stringify(reference.holderBounds);
  const panel = (body: string) => `(() => {const panel=document.querySelector('[data-testid="career-fill-panel"]');if(!panel)throw new Error('履历面板未挂载');${body}})()`;
  const settle = () => ui('own-renderer-two-frame-settle', 'new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');
  const waitFor = async (name: string, expression: string) => {
    const until = performance.now() + 5_000;
    while (performance.now() < until) { if (await ui<boolean>(name, expression)) return; await delay(25); }
    throw new Error(name);
  };
  const click = (text: string) => ui('own-renderer-scripted-panel-button-click', panel(`const button=Array.from(panel.querySelectorAll('button')).find(node=>node.textContent.trim().startsWith(${JSON.stringify(text)}));if(!button||button.disabled||!button.checkVisibility())throw new Error('目标面板按钮不可用或不可见');button.click();`));
  const clickTestId = (id: string) => ui('own-renderer-scripted-test-id-button-click', `(() => {const button=document.querySelector('[data-testid=${JSON.stringify(id)}]');if(!button||button.disabled)throw new Error('工作台按钮不可用');button.click();})()`);
  const waitIdle = () => waitFor('automatic-fill-idle', "(() => {const button=document.querySelector('[data-testid=\"quick-fill\"]');return Boolean(button&&!button.disabled&&(!document.querySelector('[data-testid=\"stop-auto-fill\"]')||document.querySelector('[data-testid=\"stop-auto-fill\"]').disabled)&&!document.querySelector('.career-fill-progress'));})()");
  const setPanelCollapsed = async (collapsed: boolean) => {
    const tab = collapsed ? 'chat' : 'details';
    await waitFor('workspace-filling-tab-enabled', `(() => {const tab=document.querySelector('[data-testid="workspace-tab-${tab}"]');return Boolean(tab&&!tab.disabled);})()`);
    await ui('own-renderer-select-filling-workspace-tab', `(() => {const tab=document.querySelector('[data-testid="workspace-tab-${tab}"]');if(!tab||tab.disabled)throw new Error('填写工作区页签不可用');if(tab.getAttribute('aria-selected')!=='true')tab.click();})()`);
    await settle();
    await waitFor('workspace-filling-tab-visible', `(() => {const tab=document.querySelector('[data-testid="workspace-tab-${tab}"]');const pane=document.querySelector('#space-${tab}');return Boolean(tab?.getAttribute('aria-selected')==='true'&&pane?.checkVisibility());})()`);
  };
  const releaseHeld = () => { const held = heldPrepare; if (!held) throw new Error('没有待返回的协议预览。'); heldPrepare = undefined; held.resolve(structuredClone(held.value)); };
  const waitHeld = () => steps.run('held-protocol-prepare-arrived', async () => { while (!heldPrepare) await delay(20); });
  const releaseMeasurementFinish = () => {
    const held = heldMeasurementFinish; if (!held) throw new Error('没有待返回的测量结束回执。');
    heldMeasurementFinish = undefined; held.resolve();
  };
  const changeContext = async () => {
    fakeBrowser.url = `https://modelbest.jobs.feishu.cn/campus/resume/${observation.generation}/apply`;
    observation.url = fakeBrowser.url; observation.generation++; observation.signature = hash(`ui-protocol-page-${observation.generation}`);
    send({ type: 'browser', state: structuredClone(fakeBrowser) }); await settle();
  };
  const assertBoundRequest = (request: CareerFillOptions, label: string) => {
    expect(JSON.stringify(request.selectedRecordIds) === JSON.stringify(expectedIds), `${label}.allSixRecordsAndDefaultEducationOrder`);
    expect(Object.values(request.selectedRecordIds!).every(ids => new Set(ids).size === ids.length), `${label}.noDuplicateSelectedIds`);
    expect(request.profileVersion === 1 && request.bindings?.length === 1 && request.bindings[0]!.recordId === primary
      && request.bindings[0]!.collection === 'educations' && request.bindings[0]!.revision === 1 && request.bindings[0]!.profileVersion === 1
      && request.bindings[0]!.groupId === observation.groups[0]!.id && request.bindings[0]!.groupSignature === observation.groups[0]!.signature
      && request.preserveGroupIds?.length === 0, `${label}.masterBoundToObservedEmptyEducationGroup`);
  };
  try {
    steps.setStage('install-named-ipc-protocol-fixtures');
    replace('getState', async () => structuredClone(fakeState)); replace('browserState', async () => structuredClone(fakeBrowser));
    replace('modelStatus', async () => structuredClone(noKeyModel));
    replace('browserBounds', async (_bounds, visible) => { boundsRequests.push({ visibleRequested: visible === true }); });
    replace('finishMeasurement', async (...args) => {
      const actualResult = await originalFinishMeasurement(...args);
      if (!holdNextMeasurementFinish) return actualResult;
      holdNextMeasurementFinish = false; measurementFinishHoldCount++;
      // Only the owned IPC reply is held. Native execution is never involved,
      // and the real isolated host has already finalized its measurement.
      return new Promise((resolve, reject) => { heldMeasurementFinish = { resolve: () => resolve(actualResult), reject }; });
    });
    replace('prepareFill', async (options?: { useModel?: boolean; scope?: 'contacts' }) => {
      if (!fixtureActive || options !== undefined && (options.scope !== 'contacts' || Object.keys(options).some(key => key !== 'scope'))) { blocked.push('prepareFill-with-model-or-options'); throw new Error('通用字段 UI fixture 只允许无模型识别及明确的联系人范围。'); }
      await recordPhaseLayout('ordinary-prepare');
      const planId = `ui-protocol-ordinary-preview-${ordinaryPrepareRequests.length + 1}`;
      ordinaryPrepareRequests.push({ planId, rulesOnly: true }); ordinaryIssued.clear(); ordinaryIssued.add(planId); eventOrder.push('ordinary-prepare');
      const base = { status: 'ready' as const, reason: '虚构的本机协议字段，未连接真实网页。' };
      const result: FillPlan = { id: planId, url: fakeBrowser.url, title: '虚构通用字段预览', profileVersion: profile.version,
        observationId: 'ui-protocol-ordinary-observation', createdAt: new Date().toISOString(), items: [
          { ...base, status: contactValue ? 'skip' : 'ready', fieldId: 'ordinary-email', label: '邮箱', profileKey: 'email', value: profile.email, currentValue: contactValue },
          { ...base, fieldId: 'ordinary-degree', label: '学历', profileKey: 'degree', value: '硕士', currentValue: '' },
          { ...base, fieldId: 'ordinary-existing-phone', label: '电话', profileKey: 'phone', value: profile.phone, currentValue: '保留虚构已有电话' },
          { ...base, fieldId: 'ordinary-unmapped', label: '未知资料项', value: '禁止自动写入', currentValue: '' },
        ] };
      return result;
    });
    replace('fillApproved', async (planId: string, fieldIds: string[]) => {
      if (!fixtureActive || !ordinaryIssued.delete(planId) || JSON.stringify(fieldIds) !== JSON.stringify(['ordinary-email'])) {
        blocked.push('fillApproved-invalid-contact-selection'); throw new Error('联系字段只能填写本次规则计划中空白且明确对应的邮箱。');
      }
      await recordPhaseLayout('ordinary-fill');
      ordinaryFillRequests.push({ planId, fieldIds: [...fieldIds] }); eventOrder.push('ordinary-fill');
      const unresolved = nextContactUnresolved; nextContactUnresolved = false;
      const result: FillResult = { planId, verified: unresolved ? [] : [{ fieldId: 'ordinary-email', label: '邮箱' }],
        unresolved: unresolved ? [{ fieldId: 'ordinary-email', label: '邮箱', reason: '虚构联系字段未通过核对。' }] : [] };
      if (holdNextContactFill) {
        holdNextContactFill = false;
        return new Promise<FillResult>((resolve, reject) => { heldContactFill = { resolve: value => { if (!value.unresolved.length) contactValue = profile.email; resolve(value); }, reject, value: result }; });
      }
      if (!unresolved) contactValue = profile.email;
      return result;
    });
    replace('prepareCareerFill', async (options: CareerFillOptions) => {
      if (!fixtureActive || !options || options.profileVersion !== 1) throw new Error('UI fixture 参数或作用域无效。');
      await recordPhaseLayout('career-prepare');
      prepareRequests.push(structuredClone(options)); eventOrder.push('career-prepare');
      // Mirror the production controller: every new prepare revokes all old plans.
      issued.clear(); const plan = buildCareerPlan(profile, observation, options); const preview = project(plan, options);
      prepareResponses.push(structuredClone(preview)); issued.set(preview.planId, preview);
      if (prepareRequests.length !== holdPrepareAt) return structuredClone(preview);
      holdPrepareAt = undefined;
      return new Promise<CareerFillPreview>((resolve, reject) => { heldPrepare = { resolve, reject, value: preview }; });
    });
    replace('runCareerFill', async (planId: string) => {
      const preview = issued.get(planId);
      if (!fixtureActive || !preview?.steps.length || runRequests.includes(planId)) throw new Error('UI fixture 计划无效、旧计划或已使用。');
      runRequests.push(planId); issued.delete(planId); eventOrder.push('career-run');
      const bindings = (['educations', 'internships', 'projects'] as const).flatMap(collection => expectedIds[collection].map((recordId, index) => ({ collection, recordId,
        revision: 1, profileVersion: 1, groupId: `${collection === 'educations' ? 'education' : collection === 'internships' ? 'internship' : 'project'}[${index}]`, groupSignature: hash(`ui-faux-result-${recordId}`) })));
      outcome = { status: 'completed', addedCount: 5, verifiedCount: 32, pending: [], bindings };
      if (nextCareerPending) {
        nextCareerPending = false; outcome.status = 'partial';
        // Explicit field ID, unique saved outcome binding, absent binding and
        // conflicting outcome bindings are distinct owned IPC fixture cases.
        outcome.pending = [
          { collection: 'internships', recordId: expectedIds.internships[0]!, key: 'role', required: true, reason: '虚构协议：需在对应实习组补充职位。' },
          { collection: 'projects', recordId: expectedIds.projects[0]!, groupId: 'project[0]', fieldId: 'project[0].url', key: 'url', required: false, reason: '虚构协议：需在明确字段补充链接。' },
          { collection: 'projects', recordId: expectedIds.projects[1]!, key: 'role', required: true, reason: '虚构协议：没有可信组绑定，不按资料顺序猜位置。' },
          { collection: 'internships', recordId: expectedIds.internships[1]!, key: 'endDate', required: true, reason: '虚构协议：出现两个绑定，不能猜其中一组。' },
          { collection: 'educations', fieldId: 'education[0].degree', key: 'degree', required: true, reason: '虚构协议：字段标识在当前观察中唯一对应一组。' },
          { collection: 'projects', fieldId: 'unobserved-project.role', key: 'role', required: true, reason: '虚构协议：字段标识没有可信组，不单凭fieldId启用。' },
        ];
        outcome.bindings = bindings.filter(binding => binding.recordId !== expectedIds.projects[1]);
        const duplicate = bindings.find(binding => binding.recordId === expectedIds.internships[1])!;
        outcome.bindings.push({ ...duplicate, groupId: 'internship[conflicting]' });
      }
      return structuredClone(outcome);
    });
    replace('cancelCareerFill', async () => { cancelCalls++; issued.clear(); });
    replace('locateApplicationField', async (input: LocateInput) => {
      if (!fixtureActive || !allowedLocateRequests.some(allowed => locateKey(allowed) === locateKey(input))) {
        blocked.push('locateApplicationField-unexpected-id-or-extra-field'); throw new Error('定位协议只接受本轮明确允许的计划和字段标识。');
      }
      locateRequests.push(structuredClone(input));
      const reply: LocateReply = { status: 'located', message: '虚构定位协议回执；未滚动或写入真实企业网页。' };
      if (!holdNextLocate) return reply;
      holdNextLocate = false;
      return new Promise<LocateReply>((resolve, reject) => { heldLocate = { resolve, reject }; });
    });
    // Block every actual command. The named replacements above also never call
    // their originals: their contact and career results are expressly faux.
    for (const name of ['saveProfile', 'confirmCareerRecord', 'importResume', 'saveJob', 'deleteJob', 'trackJob', 'saveApplication', 'deleteApplication',
      'loadDemo', 'clearDemo', 'exportData', 'refreshSource', 'browserNavigate', 'browserBack', 'browserForward', 'browserReload', 'capturePage',
      'collectPageJobs', 'openTestForm', 'browserZoom', 'configureModel', 'runAgent', 'cancelAgent']) {
      if (typeof methods[name] === 'function') replace(name, async () => { blocked.push(name); throw new Error('纯履历面板协议 fixture 禁止真实业务命令。'); });
    }
    send({ type: 'state', state: structuredClone(fakeState) }); send({ type: 'browser', state: structuredClone(fakeBrowser) });
    send({ type: 'model', status: structuredClone(noKeyModel) }); send({ type: 'navigate', page: 'browser' });
    await waitFor('career-panel-mounted', "Boolean(document.querySelector('[data-testid=\"career-fill-panel\"]'))");
    await setPanelCollapsed(false);
    entryDiagnostics = await ui<Record<string, boolean>>('one-click-entry-layout', `(() => {
      const panel=document.querySelector('[data-testid="career-fill-panel"]');const tools=document.querySelector('[data-testid="generic-fill-tools"]');
      const manual=document.querySelector('[data-testid="career-manual-tools"]');const quick=document.querySelector('[data-testid="quick-fill"]');
      const aside=document.querySelector('#browser-fill-panel');const read=Array.from(panel?.querySelectorAll('button')||[]).find(button=>button.textContent.startsWith('1. 读取网页经历组'));
      const hasVisibilityApi=Boolean(quick&&typeof quick.checkVisibility==='function');
      return { careerPanelExists:Boolean(panel),singleAutomaticButton:document.querySelectorAll('[data-testid="quick-fill"]').length===1,
        quickVisible:Boolean(hasVisibilityApi&&quick.checkVisibility()),quickOutsideSidebar:Boolean(quick&&aside&&!aside.contains(quick)),
        quickOutsideManualAndGeneric:Boolean(quick&&manual&&tools&&!manual.contains(quick)&&!tools.contains(quick)),
        quickNameMatches:Boolean(quick&&quick.textContent.trim()==='自动填写'),quickEnabledWithoutKey:Boolean(quick&&!quick.disabled),
        manualInitiallyCollapsed:Boolean(manual&&manual.tagName==='DETAILS'&&!manual.open),
        genericInitiallyCollapsed:Boolean(tools&&tools.tagName==='DETAILS'&&!tools.open),
        ordinaryPreviewInitiallyCollapsed:Boolean(document.querySelector('[data-testid="ordinary-preview-details"]')?.open===false),
        manualReadWithinCollapsedDetails:Boolean(read&&manual&&manual.contains(read)&&!read.checkVisibility()),
        modelStatusWithinGeneric:Boolean(tools&&tools.contains(document.querySelector('.quick-model-status'))),
        ordinaryResultWithinGeneric:Boolean(tools&&(!document.querySelector('.quick-fill-result')||tools.contains(document.querySelector('.quick-fill-result')))),
        ordinaryPreviewWithinGeneric:Boolean(tools&&tools.contains(document.querySelector('.browser-manual-tools:not([data-testid="generic-fill-tools"])'))),
        visibilityApiAvailable:hasVisibilityApi };
    })()`);
    for (const [name, value] of Object.entries(entryDiagnostics)) expect(value === true, `oneClickEntry.${name}`);
    expect(ordinaryPrepareRequests.length === 0 && prepareRequests.length === 0 && runRequests.length === 0, 'noAutomaticOperationBeforeUserClick');
    await setPanelCollapsed(true);
    expect(await ui<boolean>('one-click-visible-with-details-tab-closed', "(() => {const quick=document.querySelector('[data-testid=\"quick-fill\"]');return Boolean(quick&&!quick.disabled&&quick.checkVisibility()&&document.querySelector('[data-testid=\"workspace-tab-chat\"]')?.getAttribute('aria-selected')==='true'&&document.querySelector('[data-testid=\"browser-panel-toggle\"]')?.getAttribute('aria-expanded')==='false');})()"), 'automaticButtonRemainsUsableWithDetailsTabClosed');
    await ui('own-renderer-synthetic-window-resize', "window.dispatchEvent(new Event('resize'))");
    await steps.run('renderer-bounds-fixture-observed', async () => { while (!boundsRequests.length) await delay(25); });

    steps.setStage('one-click-without-key-contacts-and-six-records');
    await setPanelCollapsed(false);
    expect(await ui<boolean>('automatic-starts-with-details-tab-visible', "document.querySelector('[data-testid=\"workspace-tab-details\"]')?.getAttribute('aria-selected')==='true'&&document.querySelector('#space-details')?.checkVisibility()"), 'automaticSuccessfulRunStartsWithVisibleDetailsTab');
    const initialLayout = await ui<WorkspaceLayout>('automatic-initial-native-holder-layout', workspaceLayoutScript);
    const autoStart = { prepares: prepareRequests.length, runs: runRequests.length, ordinary: ordinaryPrepareRequests.length, contacts: ordinaryFillRequests.length, order: eventOrder.length, layouts: phaseLayouts.length };
    holdNextMeasurementFinish = true;
    await clickTestId('quick-fill');
    await waitFor('one-click-faux-outcome-rendered', "Boolean(document.querySelector('[data-testid=\"career-fill-outcome\"]'))&&!document.querySelector('.career-fill-progress')");
    await steps.run('measurement-finalization-reply-held-after-success', async () => { while (!heldMeasurementFinish) await delay(20); });
    await settle();
    expect(await ui<boolean>('measurement-finalization-retains-full-ui-lock', `(() => {
      const ids=['quick-fill','workspace-tab-chat','workspace-tab-activity','workspace-tab-details','workspace-dock-toggle'];
      return ids.every(id=>document.querySelector('[data-testid="'+id+'"]')?.disabled===true)
        &&document.querySelector('[data-testid="workspace-dock-resizer"]')?.getAttribute('aria-disabled')==='true'
        &&[...document.querySelectorAll('nav[aria-label="主导航"] .nav-button')].every(button=>button.disabled===true);
    })()`), 'successfulFauxFillKeepsQuickEntryAndLayoutLockedUntilMeasurementReplyReturns');
    const heldCounts = { prepares: prepareRequests.length, runs: runRequests.length, ordinary: ordinaryPrepareRequests.length, contacts: ordinaryFillRequests.length };
    await ui('disabled-finalizing-button-cannot-start-another-operation', "document.querySelector('[data-testid=\"quick-fill\"]').click()"); await settle();
    expect(JSON.stringify(heldCounts) === JSON.stringify({ prepares: prepareRequests.length, runs: runRequests.length, ordinary: ordinaryPrepareRequests.length, contacts: ordinaryFillRequests.length }), 'clickWhileMeasurementFinalizingCannotStartOrQueueAnotherFill');
    releaseMeasurementFinish();
    await waitIdle();
    expect(measurementFinishHoldCount === 1 && !heldMeasurementFinish
      && await ui<boolean>('measurement-reply-restores-automatic-entry', "!document.querySelector('[data-testid=\"quick-fill\"]').disabled&&!document.querySelector('[data-testid=\"workspace-tab-chat\"]').disabled"), 'measurementReplyReleasesEntryAndLayoutForNextFreshClick');
    expect(await ui<boolean>('main-click-automatically-selected-activity-tab', "document.querySelector('[data-testid=\"workspace-tab-activity\"]')?.getAttribute('aria-selected')==='true'&&document.querySelector('#space-activity')?.checkVisibility()"), 'singleMainClickShowsActivityTabAndCompletes');
    expect(ordinaryPrepareRequests.length === autoStart.ordinary + 2 && ordinaryFillRequests.length === autoStart.contacts + 1, 'oneClickReobservesContactsAfterOneFauxFieldFill');
    expect(JSON.stringify(ordinaryFillRequests.at(-1)!.fieldIds) === JSON.stringify(['ordinary-email']), 'oneClickExcludesEducationExistingContactAndUnmappedReadyFields');
    expect(prepareRequests.length === autoStart.prepares + 2 && runRequests.length === autoStart.runs + 1, 'oneClickReadsThenPreparesThenRunsWithoutManualSteps');
    const initialRequest = prepareRequests[autoStart.prepares]!;
    expect(Object.values(initialRequest.selectedRecordIds ?? {}).every(ids => ids.length === 0) && initialRequest.bindings?.length === 0
      && initialRequest.preserveGroupIds?.length === 0, 'automaticInitialReadRequestsNoCareerWriteAuthorization');
    assertBoundRequest(prepareRequests[autoStart.prepares + 1]!, 'automaticPreparation');
    expect(runRequests.at(-1) === prepareResponses[autoStart.prepares + 1]!.planId
      && runRequests.at(-1) !== prepareResponses[autoStart.prepares]!.planId, 'oneClickRunsOnlyItsNewBoundPlanNeverTheReadPlan');
    expect(JSON.stringify(eventOrder.slice(autoStart.order)) === JSON.stringify(['ordinary-prepare', 'ordinary-fill', 'ordinary-prepare', 'career-prepare', 'career-prepare', 'career-run']), 'oneClickNamedIpcOrderIsSerialAndRulesOnly');
    const autoLayouts = phaseLayouts.slice(autoStart.layouts);
    expect(autoLayouts.filter(entry => entry.operation === 'ordinary-prepare').length === 2
      && autoLayouts.filter(entry => entry.operation === 'ordinary-fill').length === 1
      && autoLayouts.filter(entry => entry.operation !== 'career-prepare').every(entry => entry.activityVisible && sameHolder(entry, initialLayout)), 'contactPrepareAndFillKeepActivityVisibleAndSingleUnchangedNativeHolder');
    expect(autoLayouts.filter(entry => entry.operation === 'career-prepare').length === 2
      && autoLayouts.filter(entry => entry.operation === 'career-prepare').every(entry => entry.activityVisible && sameHolder(entry, initialLayout))
      && sameHolder(await ui<WorkspaceLayout>('automatic-final-native-holder-layout', workspaceLayoutScript), initialLayout), 'careerPrepareAndCompletionKeepActivityVisibleAndNativeHolderGeometryUnchanged');

    steps.setStage('one-click-also-completes-from-chat-tab');
    await setPanelCollapsed(true);
    const chatLayout = await ui<WorkspaceLayout>('chat-start-native-holder-layout', workspaceLayoutScript);
    const collapsedStart = { prepares: prepareRequests.length, runs: runRequests.length, contacts: ordinaryFillRequests.length, layouts: phaseLayouts.length };
    await clickTestId('quick-fill');
    await steps.run('collapsed-sidebar-faux-run-returned', async () => { while (runRequests.length === collapsedStart.runs) await delay(25); });
    await settle(); await waitIdle();
    expect(prepareRequests.length === collapsedStart.prepares + 2 && runRequests.length === collapsedStart.runs + 1
      && ordinaryFillRequests.length === collapsedStart.contacts, 'alreadyCollapsedSidebarStillCompletesFreshCareerRunWithoutRefillingContacts');
    const collapsedLayouts = phaseLayouts.slice(collapsedStart.layouts);
    expect(collapsedLayouts[0]?.operation === 'ordinary-prepare' && collapsedLayouts.some(entry => entry.operation === 'career-prepare')
      && collapsedLayouts.every(entry => entry.activityVisible && sameHolder(entry, chatLayout)), 'chatStartShowsActivityForContactsAndCareerWithoutChangingNativeHolder');
    expect(await ui<boolean>('chat-start-run-ends-in-activity', "document.querySelector('[data-testid=\"workspace-tab-activity\"]')?.getAttribute('aria-selected')==='true'&&document.querySelector('#space-activity')?.checkVisibility()"), 'chatStartSuccessfulRunEndsWithActivityVisible');
    await setPanelCollapsed(false);
    expect(await ui<boolean>('one-click-faux-counts-visible', "(() => {const result=document.querySelector('[data-testid=\"career-fill-outcome\"]');return Boolean(result?.checkVisibility()&&result.textContent.includes('新增 5 组')&&result.textContent.includes('重读核实 32 项'));})()"), 'automaticFauxFiveAddsAnd32ValuesDisplayed');
    expect(await ui<boolean>('one-click-did-not-open-manual-details', "!document.querySelector('[data-testid=\"career-manual-tools\"]').open"), 'oneClickDoesNotRequireOrOpenManualAdjustmentSteps');

    steps.setStage('cancel-during-contact-waits-for-current-faux-result-and-stops');
    const contactCancel = { ordinary: ordinaryPrepareRequests.length, contacts: ordinaryFillRequests.length, prepares: prepareRequests.length, runs: runRequests.length, cancels: cancelCalls };
    contactValue = ''; holdNextContactFill = true; await clickTestId('quick-fill');
    await steps.run('held-contact-protocol-result-arrived', async () => { while (!heldContactFill) await delay(20); });
    await waitFor('contact-top-level-stop-available', "(() => {const stop=document.querySelector('[data-testid=\"stop-auto-fill\"]');return Boolean(stop&&!stop.disabled);})()");
    await clickTestId('stop-auto-fill'); await settle();
    expect(cancelCalls > contactCancel.cancels && Boolean(heldContactFill), 'contactStopCannotPretendPendingFieldHasAlreadyFinished');
    const heldContact = heldContactFill!; heldContactFill = undefined; heldContact.resolve(structuredClone(heldContact.value));
    await settle(); await waitIdle();
    expect(ordinaryPrepareRequests.length === contactCancel.ordinary + 1 && ordinaryFillRequests.length === contactCancel.contacts + 1
      && prepareRequests.length === contactCancel.prepares && runRequests.length === contactCancel.runs, 'contactStopWaitsForCurrentResultThenPreventsNextContactAndCareer');

    steps.setStage('unresolved-contact-stops-before-career-read');
    const contactStop = { prepares: prepareRequests.length, runs: runRequests.length, contacts: ordinaryFillRequests.length };
    contactValue = ''; nextContactUnresolved = true; await clickTestId('quick-fill'); await settle(); await waitIdle();
    expect(ordinaryFillRequests.length === contactStop.contacts + 1 && prepareRequests.length === contactStop.prepares && runRequests.length === contactStop.runs, 'uncertainContactResultPreventsAllCareerOperations');

    steps.setStage('cancel-one-click-held-read-and-discard-late-dto');
    const stopped = { prepares: prepareRequests.length, runs: runRequests.length, cancels: cancelCalls };
    holdPrepareAt = prepareRequests.length + 1; await clickTestId('quick-fill'); await waitHeld();
    await waitFor('one-click-top-level-stop-available', "(() => {const stop=document.querySelector('[data-testid=\"stop-auto-fill\"]');return Boolean(stop&&!stop.disabled);})()");
    expect(await ui<boolean>('busy-summary-toggles-blocked', `(() => {
      return ['generic-fill-tools','career-manual-tools'].every(id=>{const tools=document.querySelector('[data-testid="'+id+'"]');const summary=tools?.querySelector('summary');if(!summary)return false;
        const before=tools.open;const click=new MouseEvent('click',{bubbles:true,cancelable:true});summary.dispatchEvent(click);
        const enter=new KeyboardEvent('keydown',{key:'Enter',bubbles:true,cancelable:true});summary.dispatchEvent(enter);
        const space=new KeyboardEvent('keydown',{key:' ',bubbles:true,cancelable:true});summary.dispatchEvent(space);
        return click.defaultPrevented&&enter.defaultPrevented&&space.defaultPrevented&&tools.open===before;});
    })()`), 'activeOneClickLocksBothManualSummariesForMouseAndKeyboard');
    await clickTestId('stop-auto-fill'); await settle();
    expect(cancelCalls > stopped.cancels && Boolean(heldPrepare), 'stopRequestsCancelWhileLateReadIsStillPending');
    releaseHeld(); await settle(); await waitIdle();
    expect(prepareRequests.length === stopped.prepares + 1 && runRequests.length === stopped.runs, 'cancelledLateReadCannotPrepareOrRunCareerFill');

    steps.setStage('context-change-during-second-prepare-cannot-run');
    const changed = { prepares: prepareRequests.length, runs: runRequests.length, cancels: cancelCalls };
    holdPrepareAt = prepareRequests.length + 2; await clickTestId('quick-fill'); await waitHeld();
    expect(prepareRequests.length === changed.prepares + 2, 'contextTestHoldsTheNewBoundPrepareNotOnlyTheInitialRead');
    const stalePlanId = heldPrepare!.value.planId;
    await changeContext(); expect(cancelCalls > changed.cancels, 'contextChangeCancelsPendingAutomaticRun');
    releaseHeld(); await settle(); await waitIdle();
    expect(runRequests.length === changed.runs && !runRequests.includes(stalePlanId), 'contextChangeRejectsLatePreparedPlanBeforeRun');
    expect(await ui<boolean>('changed-context-clears-automatic-result', "!document.querySelector('[data-testid=\"career-fill-outcome\"]')"), 'contextChangeDoesNotDisplayOldAutomaticSuccess');

    steps.setStage('manual-adjustment-remains-explicit-and-usable');
    await setPanelCollapsed(false);
    await waitFor('manual-sidebar-explicitly-expanded-and-visible', "(() => {const aside=document.querySelector('#browser-fill-panel');return Boolean(aside?.checkVisibility()&&document.querySelector('[data-testid=\"browser-panel-toggle\"]')?.getAttribute('aria-expanded')==='true');})()");
    await ui('own-renderer-open-career-manual-details', "(() => {const details=document.querySelector('[data-testid=\"career-manual-tools\"]');if(!details?.open)details?.querySelector('summary').click();})()");
    await settle();
    expect(await ui<boolean>('manual-details-open-and-read-visible', panel("const details=panel.querySelector('[data-testid=\"career-manual-tools\"]');const read=Array.from(panel.querySelectorAll('button')).find(button=>button.textContent.startsWith('1. 读取网页经历组'));return Boolean(details?.open&&read?.checkVisibility()&&!read.disabled);")), 'manualWorkflowOpensOnlyAfterExplicitSummaryClick');
    const manualStart = { prepares: prepareRequests.length, runs: runRequests.length, ordinary: ordinaryPrepareRequests.length };
    await click('1. 读取网页经历组');
    await waitFor('manual-records-rendered', panel("return panel.querySelectorAll('.career-fill-record input[type=checkbox]').length===6&&!panel.querySelector('.career-fill-progress');"));
    expect(prepareRequests.length === manualStart.prepares + 1, 'manualReadCallsPrepareExactlyOnce');
    expect(await ui<boolean>('manual-read-is-empty-selection', panel("return panel.querySelectorAll('.career-fill-group').length===1&&panel.querySelectorAll('.career-fill-record input:checked').length===0;")), 'manualReadNeverImplicitlySelectsRecords');
    for (const collection of ['educations', 'internships', 'projects'] as const) for (const recordId of expectedIds[collection]) {
      const record = collection === 'educations' ? profile.career!.educations.find(item => item.id === recordId)!
        : collection === 'internships' ? profile.career!.internships.find(item => item.id === recordId)! : profile.career!.projects.find(item => item.id === recordId)!;
      const label = 'school' in record ? record.school : 'organization' in record ? record.organization : record.name;
      await ui('own-renderer-scripted-record-checkbox-click', panel(`const record=Array.from(panel.querySelectorAll('.career-fill-record')).find(node=>node.textContent.includes(${JSON.stringify(label)}));const checkbox=record?.querySelector('input[type=checkbox]');if(!checkbox||checkbox.checked)throw new Error('待选虚构记录不唯一或已选');checkbox.click();`)); await settle();
    }
    expect(await ui<boolean>('all-records-selected', panel("return panel.querySelectorAll('.career-fill-record input:checked').length===6;")), 'allSixManualRecordsCanStillBeSelected');
    await ui('own-renderer-select-value-and-change-event', panel(`const select=panel.querySelector('.career-fill-group select');const value=${JSON.stringify(`record:${primary}`)};if(!select||!Array.from(select.options).some(option=>option.value===value))throw new Error('硕士绑定选项不存在');Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value').set.call(select,value);select.dispatchEvent(new Event('change',{bubbles:true}));`));
    await settle(); await click('生成本次预览');
    await waitFor('manual-preview-rendered', "Boolean(document.querySelector('[data-testid=\"career-fill-preview\"]'))&&!document.querySelector('.career-fill-progress')");
    expect(prepareRequests.length === manualStart.prepares + 2, 'manualExplicitPreviewUsesNewPrepare');
    assertBoundRequest(prepareRequests[manualStart.prepares + 1]!, 'manualPreparation');
    const actionablePreview = prepareResponses[manualStart.prepares + 1]!;
    expect(!('original' in actionablePreview) && !('options' in actionablePreview), 'previewDtoOmitsPrivateHostSnapshot');
    expect(await ui<boolean>('manual-preview-step-counts', panel("return panel.querySelectorAll('.career-fill-step').length===3&&panel.querySelector('[data-testid=\"career-fill-preview\"]').textContent.includes('本次选中 6 条经历');")), 'manualPreviewExplainsAllRecordsAndIncrementalAdds');
    await click('确认，自动新增并填写');
    await waitFor('manual-faux-result-rendered', "Boolean(document.querySelector('[data-testid=\"career-fill-outcome\"]'))&&!document.querySelector('.career-fill-progress')");
    expect(runRequests.length === manualStart.runs + 1 && runRequests.at(-1) === actionablePreview.planId, 'manualConfirmationUsesOnlyItsIssuedPlan');
    expect(ordinaryPrepareRequests.length === manualStart.ordinary, 'manualCareerWorkflowDoesNotInvokeOrdinaryFormOrModel');
    expect(await ui<boolean>('manual-plan-used-state', panel("const result=panel.querySelector('[data-testid=\"career-fill-outcome\"]');const used=Array.from(panel.querySelectorAll('button')).find(button=>button.textContent.includes('本次计划已使用'));return Boolean(result?.textContent.includes('新增 5 组')&&result.textContent.includes('重读核实 32 项')&&used?.disabled);")), 'manualFauxCountsAndConsumedPlanStateDisplayed');
    await ui('disabled-own-renderer-button-cannot-replay', panel("Array.from(panel.querySelectorAll('button')).find(button=>button.textContent.includes('本次计划已使用')).click();")); await settle();
    expect(runRequests.length === manualStart.runs + 1, 'disabledManualPlanCannotReplay');
    const beforeChange = cancelCalls; await changeContext();
    await waitFor('changed-context-clears-manual-state', panel("return !panel.querySelector('[data-testid=\"career-fill-preview\"]')&&!panel.querySelector('[data-testid=\"career-fill-outcome\"]')&&!panel.querySelector('.career-fill-selection');"));
    expect(cancelCalls > beforeChange, 'contextChangeRevokesManualPreviewAndResult');

    steps.setStage('compact-career-pending-locates-only-proven-field-or-unique-binding');
    nextCareerPending = true;
    const pendingRunsBefore = runRequests.length;
    await clickTestId('quick-fill');
    await waitFor('career-pending-faux-outcome-arrived', `Boolean(document.querySelector('[data-testid="career-needs-user"]'))&&!document.querySelector('.career-fill-progress')`);
    await waitIdle(); await setPanelCollapsed(false);
    const pendingPlanId = runRequests.at(-1)!;
    expect(runRequests.length === pendingRunsBefore + 1 && outcome?.pending.length === 6, 'compactCareerPendingUsesOwnLatestFauxOutcome');
    expect(await ui<boolean>('compact-career-pending-visible-with-advanced-closed', `(() => {
      const needs=document.querySelector('[data-testid="career-needs-user"]');
      return Boolean(needs?.checkVisibility()&&[...needs.querySelectorAll('li')].filter(item=>item.checkVisibility()).length===5
        &&needs.querySelector('[data-testid="career-optional"]')?.open===false
        &&needs.querySelector('h4')?.textContent.includes('5 项')
        &&document.querySelector('[data-testid="career-manual-tools"]')?.open===false
        &&document.querySelector('[data-testid="generic-fill-tools"]')?.open===false
        &&[...needs.querySelectorAll('.application-attention-reason')].every(details=>!details.open));
    })()`), 'careerPendingGroupsFivePrincipalFieldsAndKeepsOptionalAndAdvancedClosed');
    expect(await ui<boolean>('career-pending-trust-boundary-buttons', `(() => {
      const buttons=[...document.querySelectorAll('[data-testid="career-field-locate"]')].filter(button=>button.checkVisibility());
      return buttons.length===5&&!buttons[0].disabled&&buttons[1].disabled&&buttons[2].disabled&&!buttons[3].disabled&&buttons[4].disabled
        &&[...document.querySelectorAll('.career-attention-location-hint')].filter(item=>item.checkVisibility()).length===3;
    })()`), 'careerPendingMissingOrDuplicateBindingCannotGuessAGroupToLocate');
    const expectedCareerBinding: LocateInput = { kind: 'career', planId: pendingPlanId, groupId: 'internship[0]', fieldKey: 'role' };
    const expectedCareerField: LocateInput = { kind: 'career', planId: pendingPlanId, groupId: 'project[0]', fieldId: 'project[0].url', fieldKey: 'url' };
    allowedLocateRequests.push(expectedCareerBinding, expectedCareerField);
    const beforeCareerLocate = { cancels: cancelCalls, runs: runRequests.length, prepares: prepareRequests.length, ordinary: ordinaryPrepareRequests.length, fills: ordinaryFillRequests.length, locates: locateRequests.length };
    holdNextLocate = true;
    await ui('own-career-unique-binding-locate-click', `document.querySelector('[data-testid="career-field-locate"][data-record-id="${expectedIds.internships[0]}"]').click()`);
    await steps.run('held-career-locate-fixture-arrived', async () => { while (!heldLocate) await delay(20); });
    await settle();
    expect(locateKey(locateRequests.at(-1)) === locateKey(expectedCareerBinding), 'careerLocatePassesLatestPlanAndUniqueOutcomeBindingWithoutLabelOrOrderGuess');
    expect(await ui<boolean>('locating-career-locks-controls-without-stop', `(() => {
      const ids=['quick-fill','stop-auto-fill','browser-focus-toggle','browser-zoom'];
      return ids.every(id=>document.querySelector('[data-testid="'+id+'"]')?.disabled===true)
        &&document.querySelector('[data-testid="quick-fill"]')?.textContent.includes('正在定位')
        &&[...document.querySelectorAll('[data-testid="career-field-locate"]')].every(button=>button.disabled);
    })()`), 'careerLocateLocksFillZoomFocusAndStopWithAccurateBusyLabel');
    await ui('disabled-locate-controls-cannot-call-cancel-or-another-operation', `(() => {
      document.querySelector('[data-testid="stop-auto-fill"]').click();
      document.querySelector('[data-testid="quick-fill"]').click();
      document.querySelector('[data-testid="browser-focus-toggle"]').click();
      document.querySelector('[data-testid="career-field-locate"][data-record-id="${expectedIds.projects[1]}"]').click();
    })()`); await settle();
    expect(cancelCalls === beforeCareerLocate.cancels && runRequests.length === beforeCareerLocate.runs && prepareRequests.length === beforeCareerLocate.prepares
      && ordinaryPrepareRequests.length === beforeCareerLocate.ordinary && ordinaryFillRequests.length === beforeCareerLocate.fills
      && locateRequests.length === beforeCareerLocate.locates + 1, 'careerLocateCannotMisrouteToCancelOrFillAndDisabledUnboundRowDoesNothing');
    const heldCareerLocate = heldLocate!; heldLocate = undefined;
    heldCareerLocate.resolve({ status: 'located', message: '虚构定位协议回执；未滚动或写入真实企业网页。' });
    await waitIdle();
    expect(await ui<boolean>('career-locate-faux-reply-visible', `document.querySelector('[data-testid="career-locate-status"]')?.textContent.includes('虚构定位协议回执')`), 'careerLocateDisplaysReadOnlyNamedIpcResult');
    await ui('own-career-open-optional-link', `document.querySelector('[data-testid="career-optional"]>summary').click()`); await settle();
    expect(await ui<boolean>('optional-career-link-explicit-label', `document.querySelector('[data-testid="career-optional"]')?.textContent.includes('可选补充 · 1 项')&&document.querySelector('[data-testid="career-optional"]')?.open===true`), 'optionalLinkSeparateFromFivePrincipalFields');
    await ui('own-career-exact-field-locate-click', `document.querySelector('[data-testid="career-field-locate"][data-field-id="project[0].url"]').click()`);
    await steps.run('career-exact-field-named-request-arrived', async () => { while (locateRequests.length < beforeCareerLocate.locates + 2) await delay(20); });
    await waitFor('career-exact-field-locate-request-observed', `document.querySelector('[data-testid="career-locate-status"]')?.textContent.includes('虚构定位协议回执')&&!document.querySelector('.career-fill-progress')`);
    expect(locateKey(locateRequests.at(-1)) === locateKey(expectedCareerField) && cancelCalls === beforeCareerLocate.cancels, 'careerLocateKeepsExplicitFieldIdAndGroupIdWithoutCancellingConsumedPlan');
    expect(await ui<boolean>('career-field-id-requires-unique-observed-group', `(() => {const degree=document.querySelector('[data-testid="career-field-locate"][data-field-id="education[0].degree"]');const unknown=document.querySelector('[data-testid="career-field-locate"][data-field-id="unobserved-project.role"]');return degree&&!degree.disabled&&unknown?.disabled===true;})()`), 'careerFieldIdAloneRequiresUniqueCurrentObservedGroupAndUnknownGroupIsDisabled');
    const expectedObservedGroup: LocateInput = { kind: 'career', planId: pendingPlanId, groupId: 'education[0]', fieldId: 'education[0].degree', fieldKey: 'degree' };
    allowedLocateRequests.push(expectedObservedGroup);
    await ui('own-career-observed-unique-field-group-locate-click', `document.querySelector('[data-testid="career-field-locate"][data-field-id="education[0].degree"]').click()`);
    await steps.run('career-observed-field-group-request-arrived', async () => { while (locateRequests.length < beforeCareerLocate.locates + 3) await delay(20); });
    await waitFor('career-observed-field-group-location-returned', `document.querySelector('[data-testid="career-locate-status"]')?.textContent.includes('虚构定位协议回执')&&!document.querySelector('.career-fill-progress')`);
    expect(locateKey(locateRequests.at(-1)) === locateKey(expectedObservedGroup), 'careerLocateIncludesUniqueObservedGroupInsteadOfSendingUnscopedFieldId');

    steps.setStage('non-target-visible-automatic-button-and-rule-only-preview');
    fakeBrowser.url = 'https://example.invalid/offeragent-ui-protocol-form'; send({ type: 'browser', state: structuredClone(fakeBrowser) });
    await waitFor('non-target-removes-career-panel', "!document.querySelector('[data-testid=\"career-fill-panel\"]')"); await settle();
    expect(await ui<boolean>('non-target-top-level-automatic-button', "(() => {const quick=document.querySelector('[data-testid=\"quick-fill\"]');return Boolean(document.querySelectorAll('[data-testid=\"quick-fill\"]').length===1&&quick&&!quick.disabled&&quick.checkVisibility()&&quick.textContent.trim()==='自动填写');})()"), 'nonTargetKeepsVisibleSingleAutomaticEntryWithoutKey');
    await setPanelCollapsed(false);
    const compactOrdinaryPlan: FillPlan = { id: 'ui-protocol-ordinary-compact-preview', url: fakeBrowser.url, title: '虚构紧凑预览，不连接网页', profileVersion: profile.version,
      observationId: 'ui-protocol-ordinary-compact-observation', createdAt: new Date().toISOString(), items: [
        { status: 'review', fieldId: 'compact-repeat-label-A', label: '相同的虚构问题', value: '', currentValue: '', reason: '虚构待处理甲，不按标签猜字段。' },
        { status: 'review', fieldId: 'compact-repeat-label-B', label: '相同的虚构问题', value: '', currentValue: '', reason: '虚构待处理乙，不按标签猜字段。' },
      ] };
    send({ type: 'form-preview', plan: structuredClone(compactOrdinaryPlan) });
    await waitFor('ordinary-event-compact-pending-visible', `Boolean(document.querySelector('[data-testid="ordinary-needs-user"]')?.checkVisibility())`);
    expect(await ui<boolean>('ordinary-event-preview-remains-compact', `(() => {
      const details=document.querySelector('[data-testid="ordinary-preview-details"]');const needs=document.querySelector('[data-testid="ordinary-needs-user"]');
      return Boolean(details&&!details.open&&needs?.checkVisibility()&&needs.querySelectorAll('[data-testid="ordinary-field-locate"]').length===2
        &&[...needs.querySelectorAll('.application-attention-reason')].every(reason=>!reason.open)
        &&!document.querySelector('.form-preview')?.checkVisibility());
    })()`), 'newAgentOrdinaryPreviewDoesNotAutomaticallyExpandAllFieldsOrReasons');
    const expectedOrdinary: LocateInput = { kind: 'ordinary', planId: compactOrdinaryPlan.id, fieldId: 'compact-repeat-label-B' };
    allowedLocateRequests.push(expectedOrdinary);
    const beforeOrdinaryLocate = { cancels: cancelCalls, runs: runRequests.length, prepares: prepareRequests.length, ordinary: ordinaryPrepareRequests.length, fills: ordinaryFillRequests.length };
    holdNextLocate = true;
    await ui('own-ordinary-second-same-label-field-locate-click', `document.querySelectorAll('[data-testid="ordinary-field-locate"]')[1].click()`);
    await steps.run('held-ordinary-locate-fixture-arrived', async () => { while (!heldLocate) await delay(20); }); await settle();
    expect(locateKey(locateRequests.at(-1)) === locateKey(expectedOrdinary), 'ordinaryLocateUsesExactSecondFieldIdEvenWhenLabelsAreIdentical');
    expect(await ui<boolean>('ordinary-locate-retains-compact-list-and-locks-controls', `(() => {
      return document.querySelector('[data-testid="ordinary-needs-user"]')?.checkVisibility()
        &&document.querySelector('[data-testid="ordinary-preview-details"]')?.open===false
        &&['quick-fill','stop-auto-fill','browser-focus-toggle','browser-zoom'].every(id=>document.querySelector('[data-testid="'+id+'"]')?.disabled===true)
        &&[...document.querySelectorAll('[data-testid="ordinary-field-locate"]')].every(button=>button.disabled);
    })()`), 'ordinaryLocateKeepsPendingListVisibleAndLocksAllNewControls');
    const heldOrdinaryLocate = heldLocate!; heldLocate = undefined;
    heldOrdinaryLocate.resolve({ status: 'located', message: '虚构普通字段定位回执；没有操作真实网页。' });
    await waitIdle();
    expect(await ui<boolean>('ordinary-locate-read-only-reply-visible', `document.querySelector('[data-testid="ordinary-locate-status"]')?.textContent.includes('虚构普通字段定位回执')`)
      && cancelCalls === beforeOrdinaryLocate.cancels && runRequests.length === beforeOrdinaryLocate.runs && prepareRequests.length === beforeOrdinaryLocate.prepares
      && ordinaryPrepareRequests.length === beforeOrdinaryLocate.ordinary && ordinaryFillRequests.length === beforeOrdinaryLocate.fills, 'ordinaryLocateDisplaysNamedReplyWithoutAnyPrepareFillOrCareerCancellation');
    send({ type: 'form-preview', plan: { ...structuredClone(compactOrdinaryPlan), id: 'ui-protocol-ordinary-replaced-preview' } }); await settle();
    expect(await ui<boolean>('new-plan-clears-old-locate-reply-and-stays-collapsed', `document.querySelector('[data-testid="ordinary-preview-details"]')?.open===false&&!document.querySelector('[data-testid="ordinary-locate-status"]')`), 'replacementPlanClearsOldLocateFeedbackWithoutReopeningFullPreview');
    const ordinaryBefore = ordinaryPrepareRequests.length; const runsBeforeOrdinary = runRequests.length; const contactsBeforeOrdinary = ordinaryFillRequests.length;
    await setPanelCollapsed(false);
    await ui('non-target-own-renderer-rule-only-preview-click', `(() => {
      const generic=document.querySelector('[data-testid="generic-fill-tools"]');if(generic&&!generic.open)generic.querySelector('summary').click();
      const tools=document.querySelector('[data-testid="ordinary-preview-details"]');
      if(!tools)throw new Error('非目标页通用预览入口缺失');if(!tools.open)tools.querySelector('summary').click();
      const button=tools.querySelector('.browser-panel-actions button');if(!button||button.disabled)throw new Error('非目标页通用识别按钮不可用');button.click();
    })()`);
    await waitFor('non-target-rule-only-preview-rendered', `Boolean(document.querySelector('[data-plan-id="ui-protocol-ordinary-preview-${ordinaryBefore + 1}"]'))`);
    expect(ordinaryPrepareRequests.length === ordinaryBefore + 1 && runRequests.length === runsBeforeOrdinary && ordinaryFillRequests.length === contactsBeforeOrdinary, 'nonTargetManualRulesPreviewNeverCallsModelOrCareerExecutor');
    expect(blocked.length === 0, 'noUnexpectedActualBusinessProviderOrModelCommand');
    expect(boundsRequests.length > 0, 'rendererBoundsRequestsInterceptedWithoutShowingNativeView');
    expect((await originalBrowserState() as BrowserState).visible === false, 'actualNativeViewRemainedHidden');
    expect(JSON.stringify(await originalGetState()) === JSON.stringify(beforeState), 'isolatedStoreUnchanged');
    const report = { ok: true, uiProtocolFixtureOnly: true, realEnterpriseVerified: false, nativeEnterpriseInputs: 0,
      realModelCalled: false, modelCalls: 0, realFormExecutionCalled: false, realStoreBusinessMutationCalled: false,
      interactionMethod: 'Own renderer scripted HTMLElement.click, cancelable summary mouse/keyboard events, synthetic window resize, own select value setter/change; every form command returns a named protocol fixture.',
      fauxOutcome: { addedCount: 5, verifiedCount: 32, explicitlyNotNativeEvidence: true },
      fauxContactFieldsPerAutomaticClick: 1, assertionCount: assertions.length, assertions, entryDiagnostics,
      prepareRequestCount: prepareRequests.length, prepareRequests, runRequestCount: runRequests.length, correctPlanIdUsed: true,
      ordinaryPrepareCalls: ordinaryPrepareRequests.length, ordinaryPrepareRequests, ordinaryFillRequests, eventOrder, phaseLayouts,
      cancelCalls, locateRequests, compactPreviewAndReadOnlyLocateProtocolVerified: true, boundsRequestCount: boundsRequests.length, blockedUnexpectedCommands: blocked, storeUnchanged: true,
      actualNativeViewRemainedHidden: true, noKeyAutomaticEntryAvailable: true, detailsClosedAutomaticEntryAvailable: true,
      fixedTwoColumnGeometryAcrossContactAndCareerPhases: true,
      measurementFinishHoldCount, finalizationRetainsInputAndLayoutLock: true,
      lateReadCannotContinue: true, contextChangeBeforeRunCannotContinue: true, uncertainContactStopsCareer: true, contactCancellationStopsAfterPendingResult: true,
      manualFlowPreserved: true, nonTargetRulePreviewPreserved: true, harness: steps.snapshot(), phaseReadHarness: phaseReads.snapshot() };
    await writeFile(join(stateDirectory, 'career-panel-ui-protocol-report.json'), JSON.stringify(report, null, 2), { mode: 0o600 }); return report;
  } catch (error) {
    await writeFile(join(stateDirectory, 'career-panel-ui-protocol-failure.json'), JSON.stringify({ ok: false, uiProtocolFixtureOnly: true,
      realEnterpriseVerified: false, nativeEnterpriseInputs: 0, realModelCalled: false, modelCalls: 0,
      message: error instanceof Error ? error.message : '履历面板协议 fixture 未完成。', assertions, entryDiagnostics,
      prepareRequestCount: prepareRequests.length, runRequestCount: runRequests.length, ordinaryPrepareCalls: ordinaryPrepareRequests.length,
      ordinaryFillRequests, eventOrder, phaseLayouts, cancelCalls, locateRequests, locateReplyStillHeld: Boolean(heldLocate), measurementFinishHoldCount, measurementReplyStillHeld: Boolean(heldMeasurementFinish), blockedUnexpectedCommands: blocked, harness: steps.snapshot(), phaseReadHarness: phaseReads.snapshot() }, null, 2), { mode: 0o600 }); throw error;
  } finally {
    fixtureActive = false;
    if (heldPrepare) { heldPrepare.reject(new Error('履历面板协议 fixture 已结束。')); heldPrepare = undefined; }
    if (heldContactFill) { heldContactFill.reject(new Error('联系字段协议 fixture 已结束。')); heldContactFill = undefined; }
    if (heldMeasurementFinish) { heldMeasurementFinish.reject(new Error('测量结束回执 fixture 已结束。')); heldMeasurementFinish = undefined; }
    if (heldLocate) { heldLocate.reject(new Error('只读定位协议 fixture 已结束。')); heldLocate = undefined; }
    send({ type: 'navigate', page: 'apply' }); try { await settle(); } catch { /* A poisoned fixture does not resume GUI work. */ }
    for (const [name, method] of replaced) methods[name] = method;
    send({ type: 'state', state: beforeState }); send({ type: 'browser', state: beforeBrowser }); send({ type: 'model', status: beforeModel });
  }
}
