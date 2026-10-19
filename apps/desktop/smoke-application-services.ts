import { createHash, randomUUID } from 'node:crypto';
import { readFile, stat, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { dialog, type BrowserWindow } from 'electron';
import type { DomainStore } from '../../packages/domain/src/store.js';
import type { AppEvent, AppState, ApplicationFieldLocationResult, BrowserBounds, BrowserState, FillPlan, ProfileInput } from '../../packages/shared/src/contracts.js';
import type { ApplicationAssetsState } from '../../packages/shared/src/application-assets.js';
import type { ApplicationWorkflowState, ApplicationWorkflowTarget } from '../../packages/shared/src/application-workflow.js';
import type { CareerFillOutcome, CareerFillPreview } from '../../packages/shared/src/career-form.js';
import type { DiscoveryReport } from '../../packages/shared/src/discovery.js';
import { pickCareerInput } from '../../packages/profile/src/career-input.js';
import { createCareerFormFixtureProfile } from './fixtures/career-form-profile.js';
import { SmokeStepRunner } from './smoke-deadline.js';

type Methods = Record<string, (...args: any[]) => Promise<any>>;
const fictionalURL = 'https://example.invalid/offeragent-protocol/application-one';
/** Hidden protocol UI, real isolated SQLite/IPC/file services. No enterprise/native form inputs or networking. */
export async function smokeApplicationServices(window: BrowserWindow, methods: Methods, send: (event: AppEvent) => void,
  stateDirectory: string, store: DomainStore) {
  if (!process.argv.includes('--smoke-test') || !process.argv.includes('--smoke-workflow-only')
    || process.argv.includes('--live-product-check') || process.argv.includes('--site-diagnostic') || window.isVisible()) throw new Error('申请服务检查仅允许隐藏的专用隔离smoke。');
  const runner = new SmokeStepRunner('application-services-hidden-protocol');
  const assertions: Array<{ name: string; passed: true }> = [], screenshots: string[] = [], blockedCommands: string[] = [];
  const replaced = new Map<string, Methods[string]>(); const originalOpen = dialog.showOpenDialog, originalSave = dialog.showSaveDialog;
  const originalBounds = methods.browserBounds!, originalBrowserState = methods.browserState!;
  const selectorCalls: string[] = [], freshPlans: Array<{ id: string; profileVersion: number; useModel: boolean }> = [];
  let fixtureBrowser: BrowserState | undefined;
  const locationRequests: Array<{ workflowId: string; issueId: string }> = [];
  let heldLocation: ((value: ApplicationFieldLocationResult) => void) | undefined;
  const selectedWorkflowIds: string[] = [];
  let refreshRequests = 0; let heldAttention: ((value: ApplicationWorkflowState) => void) | undefined;
  const expect = (condition: unknown, name: string) => { if (!condition) throw new Error(name); assertions.push({ name, passed: true }); };
  const ui = <T = unknown>(name: string, expression: string) => runner.run(name, () => window.webContents.executeJavaScript(expression) as Promise<T>);
  const waitFor = async (name: string, predicate: string) => { const end = performance.now() + 7000; while (performance.now() < end) { if (await ui<boolean>(name, predicate)) return; await delay(25); } throw new Error(name); };
  const waitHost = async (name: string, predicate: () => Promise<boolean>) => { const end = performance.now() + 7000; while (performance.now() < end) { if (await predicate()) return; await delay(25); } throw new Error(name); };
  const invoke = <T = unknown>(name: string, args: unknown[] = []) => ui<T>('actual-owned-ipc', `window.offer[${JSON.stringify(name)}](...${JSON.stringify(args)})`);
  const click = (selector: string) => ui('owned-renderer-click', `(() => {const button=document.querySelector(${JSON.stringify(selector)});if(!(button instanceof HTMLButtonElement)||button.disabled||!button.checkVisibility())throw new Error('隔离界面按钮不可用');button.click();})()`);
  const openDetails = async (selector: string) => { await ui('owned-renderer-expand-details', `(() => {const item=document.querySelector(${JSON.stringify(selector)});if(!(item instanceof HTMLDetailsElement)||!item.checkVisibility())throw new Error('隔离详情入口不可见');if(!item.open)item.querySelector(':scope > summary').click();})()`); await waitFor('owned-details-open', `document.querySelector(${JSON.stringify(selector)})?.open===true`); };
  const setInput = (selector: string, value: string) => ui('owned-renderer-input', `(() => {const input=document.querySelector(${JSON.stringify(selector)});if(!(input instanceof HTMLInputElement)||!input.checkVisibility())throw new Error('隔离资料输入不可见');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,${JSON.stringify(value)});input.dispatchEvent(new Event('input',{bubbles:true}));input.dispatchEvent(new Event('change',{bubbles:true}));})()`);
  const screenshot = async (name: string) => { const image = await runner.run('owned-hidden-renderer-screenshot', () => window.webContents.capturePage()); const path = join(stateDirectory, name); await writeFile(path, image.toPNG(), { mode: 0o600 }); screenshots.push(path); };
  const replace = (name: string, value: Methods[string]) => { if (!replaced.has(name)) replaced.set(name, methods[name]!); methods[name] = value; };
  const publishWorkflow = async () => send({ type: 'application-workflow', state: await store.workflow.workflowState() });
  const setFictionalBrowser = (url: string) => { fixtureBrowser = { url, title: '虚构UI协议页面（未打开网页）', loading: false, canGoBack: false, canGoForward: false, visible: false }; send({ type: 'browser', state: fixtureBrowser }); };
  let applicationId = '', answerId = '', resumeId = '', resumeFileId = '';
  try {
    runner.setStage('install-isolated-native-network-and-paid-provider-guards');
    expect((await methods.getState!() as AppState).applications.length === 0, 'startsFromEmptyIsolatedApplicationStore');
    await originalBounds({ x: 0, y: 0, width: 900, height: 600 } satisfies BrowserBounds, false);
    // The browser state used below is explicitly an owned renderer protocol fixture.
    // Never ask the real browser to load its example.invalid URL or show a native view.
    replace('browserBounds', async () => undefined);
    replace('browserState', async () => fixtureBrowser ?? originalBrowserState());
    for (const name of ['browserNavigate', 'browserBack', 'browserForward', 'browserReload', 'openTestForm', 'fillApproved', 'runCareerFill', 'prepareCareerFill',
      'configureModel', 'runAgent', 'cancelAgent', 'discoverJobs', 'refreshSource', 'collectPageJobs', 'capturePage', 'importResume', 'importApplyDock', 'exportData', 'exportTelemetry', 'prepareFill']) {
      if (methods[name]) replace(name, async () => { blockedCommands.push(name); throw new Error('本轮协议检查禁止联网、模型、网页输入和无关文件操作。'); });
    }
    const fixture = createCareerFormFixtureProfile();
    fixture.career!.internships[0]!.role = ''; fixture.career!.internships[0]!.endDate = ''; fixture.career!.projects[0]!.url = '';
    const { version: _version, updatedAt: _updatedAt, career, ...basic } = fixture;
    const profileInput: ProfileInput = { ...basic, career: { ...pickCareerInput(career), primaryEducationId: null } };
    let current = await invoke<AppState>('saveProfile', [profileInput, (await store.getState()).profile.version]);
    const internshipId = current.profile.career!.internships[0]!.id, projectId = current.profile.career!.projects[0]!.id;
    current = await invoke<AppState>('confirmCareerRecord', ['internships', internshipId, current.profile.version, current.profile.career!.internships[0]!.revision]);
    current = await invoke<AppState>('saveApplication', [{ company: '虚构协议企业', title: '大模型算法校招（虚构）', url: fictionalURL, status: 'applied', deadline: null, notes: '隔离UI协议测试，不代表真实申请。' }]);
    applicationId = current.applications[0]!.id; const applicationBefore = JSON.stringify(current.applications);
    expect(current.profile.career!.internships[0]!.confirmation === 'confirmed' && current.profile.career!.internships[0]!.role === '', 'fictionalMissingFactRecordConfirmedThroughActualProfileApi');

    runner.setStage('profile-answer-library-real-ipc-and-broadcast');
    send({ type: 'navigate', page: 'profile' });
    await waitFor('visible-profile-assets', 'document.querySelector(\'[data-testid="application-assets"]\')?.checkVisibility()===true');
    expect(await ui<boolean>('profile-default-assets-collapsed', 'document.querySelector(\'[data-testid="answer-library"]\')?.open===false&&document.querySelector(\'[data-testid="resume-versions"]\')?.open===false'), 'answerAndResumeSectionsInitiallyCollapsed');
    let assets = await invoke<ApplicationAssetsState>('saveAnswer', [{ questionPattern: '为什么选择这个岗位？', answer: '虚构回答：我完成过原创合成项目。', scope: { kind: 'application', applicationId }, demo: false, risk: 'ordinary' }, null]);
    const draftAnswer = assets.answers[0]!; answerId = draftAnswer.id;
    expect(draftAnswer.confirmedRevision === null, 'savedAnswerIsDraftUntilExplicitConfirmation');
    assets = await invoke<ApplicationAssetsState>('confirmAnswer', [answerId, draftAnswer.revision, assets.profileVersion]);
    expect(assets.answers[0]!.confirmedRevision === assets.answers[0]!.revision, 'actualConfirmApiBindsAnswerRevisionAndProfileVersion');
    await openDetails('[data-testid="answer-library"]');
    await waitFor('answer-event-rendered', 'document.querySelector(\'[data-testid="answer-row"]\')?.textContent.includes("虚构回答：我完成过原创合成项目。")===true');
    expect(await ui<boolean>('answer-row-confirmation', 'document.querySelector(\'[data-testid="answer-row"]\')?.textContent.includes("已确认")===true'), 'answerBroadcastReachesVisibleProfileLibrary');

    runner.setStage('controlled-host-resume-import-and-export');
    const fixturePath = join(dirname(fileURLToPath(import.meta.url)), '../../apps/desktop/fixtures/resume.pdf');
    const originalBytes = await readFile(fixturePath), originalHash = createHash('sha256').update(originalBytes).digest('hex');
    const resumeExportPath = join(stateDirectory, 'fictional-resume-export.pdf'), calendarExportPath = join(stateDirectory, 'fictional-calendar-export.ics');
    dialog.showOpenDialog = (async () => { selectorCalls.push('open-resume-selector-only'); return { canceled: false, filePaths: [fixturePath] }; }) as typeof dialog.showOpenDialog;
    dialog.showSaveDialog = (async (...args: unknown[]) => { const options = args[1] as { defaultPath?: string } | undefined; const calendar = options?.defaultPath?.endsWith('.ics'); selectorCalls.push(calendar ? 'save-calendar-selector-only' : 'save-resume-selector-only'); return { canceled: false, filePath: calendar ? calendarExportPath : resumeExportPath }; }) as typeof dialog.showSaveDialog;
    await openDetails('[data-testid="resume-versions"]');
    await setInput('[data-testid="resume-version-label"]', '虚构算法版'); await setInput('[data-testid="resume-version-directions"]', '算法、大模型');
    await click('[data-testid="resume-version-import"]');
    await waitHost('resume-copy-persisted', async () => (await store.assets.getState()).resumeVersions.length === 1);
    assets = await store.assets.getState(); const version = assets.resumeVersions[0]!; resumeId = version.id; resumeFileId = version.fileId;
    const copiedPath = join(stateDirectory, 'resume-versions', resumeFileId), copiedBytes = await readFile(copiedPath);
    expect(version.sha256 === originalHash && createHash('sha256').update(copiedBytes).digest('hex') === originalHash, 'controlledImportCopiesExactFixtureBytesAndHostHash');
    expect(!('path' in version) && !('sourcePath' in version) && version.sizeBytes === originalBytes.length, 'rendererMetadataContainsNoArbitrarySourcePath');
    expect(process.platform === 'win32' || (await stat(copiedPath)).mode % 512 === 384, 'copiedResumeFileHasPrivateMode600');
    const exported = await invoke<{ cancelled: boolean; path?: string }>('exportResumeVersion', [resumeId]);
    expect(!exported.cancelled && exported.path === resumeExportPath && createHash('sha256').update(await readFile(resumeExportPath)).digest('hex') === originalHash, 'controlledResumeExportWritesVerifiedBytesToChosenPath');
    expect(createHash('sha256').update(await readFile(fixturePath)).digest('hex') === originalHash, 'originalFictionalResumeRemainsUnchanged');
    await invoke('selectApplicationResume', [applicationId, resumeId, null]);
    expect((await store.assets.getState()).resumeSelections[0]!.resumeVersionId === resumeId, 'resumeVersionExplicitlySelectedWithoutUpload');

    runner.setStage('calendar-ui-real-crud-and-ics-export');
    send({ type: 'navigate', page: 'applications' });
    await waitFor('calendar-tab-visible', 'document.querySelector(\'button[aria-label="日历视图"]\')?.checkVisibility()===true');
    await click('button[aria-label="日历视图"]'); await waitFor('calendar-visible', 'document.querySelector(\'[data-testid="application-calendar"]\')?.checkVisibility()===true');
    expect(await ui<boolean>('calendar-month-grid', 'document.querySelectorAll(".calendar-month .calendar-day").length===42'), 'calendarRendersSixWeekMonthGrid');
    await click('[data-testid="calendar-add"]'); await waitFor('calendar-editor-visible', 'document.querySelector(\'[data-testid="calendar-editor"]\')?.checkVisibility()===true');
    await ui('set-owned-calendar-title', `(() => {const field=[...document.querySelectorAll('[data-testid="calendar-editor"] .field')].find(item=>item.querySelector('.field-label')?.textContent==='事项名称');const input=field?.querySelector('input');if(!(input instanceof HTMLInputElement))throw new Error('事项名称输入不存在');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,'虚构一面');input.dispatchEvent(new Event('input',{bubbles:true}));})()`);
    await setInput('[data-testid="calendar-start"]', '2026-10-20T14:00'); await setInput('[data-testid="calendar-end"]', '2026-10-20T15:00');
    await click('[data-testid="calendar-save"]'); await waitHost('calendar-ui-event-persisted', async () => (await store.assets.getState()).calendarEvents.length === 1);
    const first = (await store.assets.getState()).calendarEvents[0]!;
    expect(first.title === '虚构一面' && first.startsAt === '2026-10-20T06:00:00.000Z' && first.timeZone === 'Asia/Shanghai', 'calendarUiConvertsExplicitShanghaiTimeIntoActualUtcRecord');
    assets = await invoke<ApplicationAssetsState>('saveCalendarEvent', [{ applicationId, kind: 'assessment', title: '虚构笔试', startsAt: '2026-10-21T06:00:00Z', endsAt: '2026-10-21T07:00:00Z', timeZone: 'Asia/Shanghai', location: '虚构线上会议', notes: '协议样本', status: 'scheduled' }, null]);
    const second = assets.calendarEvents.find(item => item.id !== first.id)!;
    expect(assets.calendarEvents.length === 2 && assets.calendarEvents.every(item => item.applicationId === applicationId), 'multipleCalendarEventsRemainBoundToOneExactApplication');
    await invoke('saveCalendarEvent', [{ ...second, title: '虚构笔试（已修改）' }, second.revision]);
    await waitFor('calendar-two-event-broadcast', 'document.querySelectorAll(\'[data-testid="calendar-event"]\').length===2');
    await ui('cancel-owned-calendar-event', `(() => {const row=document.querySelector('[data-event-id=${JSON.stringify(first.id)}]');const button=[...(row?.querySelectorAll('button')??[])].find(item=>item.textContent==='取消安排');if(!(button instanceof HTMLButtonElement)||button.disabled)throw new Error('取消安排入口不存在');button.click();})()`);
    await waitHost('calendar-cancel-persisted', async () => (await store.assets.getState()).calendarEvents.find(item => item.id === first.id)?.status === 'cancelled');
    expect((await store.assets.getState()).calendarEvents.find(item => item.id === first.id)!.revision === 2, 'calendarCancellationUsesRevisionedRealApi');
    await invoke('deleteCalendarEvent', [applicationId, second.id, second.revision + 1]);
    expect((await store.assets.getState()).calendarEvents.length === 1, 'calendarDeletionRemovesOnlyTheRequestedEvent');
    await invoke('exportApplicationCalendar', [applicationId]); const ics = await readFile(calendarExportPath, 'utf8');
    expect(ics.includes(`UID:${first.id}@offeragent.local`) && ics.includes('DTSTART:20261020T060000Z') && ics.includes('STATUS:CANCELLED') && !ics.includes(second.id), 'hostCalendarExportContainsExactRemainingEventUtcAndCancellation');
    expect(JSON.stringify((await store.getState()).applications) === applicationBefore, 'calendarAndResumeOperationsNeverChangeApplicationStatusOrHistory');

    runner.setStage('fixture-workflow-evidence-and-left-side-gap-editor');
    current = await store.getState(); const target: ApplicationWorkflowTarget = { url: fictionalURL, applicationId, profileVersion: current.profile.version };
    const ordinaryPlan: FillPlan = { id: 'fictional-ordinary-plan-evidence', url: fictionalURL, title: '虚构协议计划', profileVersion: target.profileVersion, observationId: 'fictional-observation', createdAt: new Date().toISOString(), items: [{ fieldId: 'fictional-email', label: '邮箱', value: current.profile.email, currentValue: '', status: 'ready', reason: '虚构主机证据', profileKey: 'email' }] };
    await store.workflow.recordOrdinaryPlan(target, ordinaryPlan); await store.workflow.recordOrdinaryResult(target, ordinaryPlan, { planId: ordinaryPlan.id, verified: [{ fieldId: 'fictional-email', label: '邮箱' }], unresolved: [] });
    const preview: CareerFillPreview = { planId: 'fictional-career-plan-evidence', url: fictionalURL, profileVersion: target.profileVersion, groups: [], bindings: [], selectedRecordIds: { internships: [internshipId], projects: [projectId] }, preserveGroupIds: [], issues: [], steps: [{ kind: 'fill-group', collection: 'internships', recordId: internshipId, groupId: 'fictional-internship-group', items: [] }, { kind: 'fill-group', collection: 'projects', recordId: projectId, groupId: 'fictional-project-group', items: [] }] };
    const outcome: CareerFillOutcome = { status: 'partial', addedCount: 0, verifiedCount: 0, bindings: [], pending: [ { collection: 'internships', recordId: internshipId, fieldId: 'fictional-role', key: 'role', required: true, reason: '虚构缺失事实' }, { collection: 'internships', recordId: internshipId, fieldId: 'fictional-end', key: 'endDate', required: true, reason: '虚构缺失事实' }, { collection: 'projects', recordId: projectId, fieldId: 'fictional-url', key: 'url', required: false, reason: '虚构缺失事实' } ] };
    const originalSelectWorkflow = methods.selectApplicationWorkflow!;
    replace('selectApplicationWorkflow', async (id: string) => { selectedWorkflowIds.push(id); return originalSelectWorkflow(id); });
    replace('refreshApplicationAttention', async (...args: unknown[]) => {
      if (args.length) throw new Error('只读提示刷新不得携带填写参数。');
      refreshRequests++; return new Promise<ApplicationWorkflowState>(resolve => { heldAttention = resolve; });
    });
    replace('locateWorkflowIssue', async (input: { workflowId: string; issueId: string }) => {
      if (!input || Object.keys(input).sort().join(',') !== 'issueId,workflowId') throw new Error('虚构定位仅接收精确工作流和问题身份。');
      locationRequests.push(structuredClone(input));
      return new Promise<ApplicationFieldLocationResult>(resolve => { heldLocation = resolve; });
    });
    await store.workflow.recordCareerPreview(target, preview); const workflow = await store.workflow.recordCareerOutcome(target, preview, outcome); await publishWorkflow();
    expect(workflow.coverage === 'observed-targets-only' && workflow.issues.filter(item => item.status === 'open').length === 3, 'fixtureEvidenceProducesThreeBoundMissingFactsNotWholeFormCompletion');
    setFictionalBrowser(fictionalURL); send({ type: 'navigate', page: 'browser' });
    await waitFor('tasks-visible-in-chat', 'document.querySelector(\'[data-testid="application-tasks"]\')?.checkVisibility()===true');
    await openDetails('[data-testid="application-tasks"]'); await waitFor('task-three-gaps', 'document.querySelectorAll(\'[data-testid="application-task-item"]\').length===3');
    expect(await ui<boolean>('task-progress-honest', 'document.querySelector(".application-task-sections")?.textContent.includes("已重读核实")===true&&document.querySelector(".application-task-sections")?.textContent.includes("尚未查看")===true&&document.querySelector(\'[data-testid="application-tasks"]\')?.textContent.includes("填写不等于投递")===true'), 'leftTasksDistinguishObservedVerifiedFromUninspectedSections');
    setFictionalBrowser('https://example.invalid/offeragent-protocol/other-page');
    await waitFor('other-page-does-not-reuse-workflow', 'document.querySelectorAll(\'[data-testid="application-task-item"]\').length===0');
    expect(await ui<boolean>('other-page-no-current-progress', '!document.querySelector(".application-task-sections")'), 'workflowTasksOnlyAppearForExactCurrentUrl');
    setFictionalBrowser(fictionalURL); await waitFor('return-three-gaps', 'document.querySelectorAll(\'[data-testid="application-task-item"]\').length===3');
    const roleIssue = workflow.issues.find(item => item.collection === 'internships' && item.profileField === 'role')!;
    const roleSelector = `[data-testid="application-task-item"][data-issue-id="${roleIssue.id}"]`;
    expect(await ui<boolean>('missing-fact-plain-guidance', `document.querySelector(${JSON.stringify(roleSelector)})?.textContent.includes('补充并记住')===true&&document.querySelector(${JSON.stringify(`${roleSelector} .application-task-edit-details`)})?.open===false`), 'missingFactOffersExplicitRememberActionWithoutExpandedEditor');
    expect(await ui<boolean>('specific-career-title-visible', `document.querySelector(${JSON.stringify(`${roleSelector} .application-task-title`)})?.textContent.includes('实习职位')===true`), 'persistentIssueDisplaysHumanFieldNameInsteadOfGenericReview');
    expect(await ui<boolean>('required-count-excludes-optional-link', `document.querySelector('[data-testid="application-tasks"]>summary')?.textContent.includes('2 项')&&document.querySelector('[data-testid="application-task-optional"]')?.open===false`), 'optionalProjectLinkExcludedFromPrincipalAttentionCount');
    await click(`${roleSelector} [data-testid="application-task-locate"]`);
    await waitHost('held-workflow-location', async () => Boolean(heldLocation));
    expect(locationRequests.length === 1 && locationRequests[0]!.workflowId === workflow.id && locationRequests[0]!.issueId === roleIssue.id, 'persistentLocateUsesExactStoredWorkflowAndIssueId');
    expect(await ui<boolean>('workflow-locate-locks-layout-and-fill', `['quick-fill','browser-focus-toggle','browser-zoom'].every(id=>document.querySelector('[data-testid="'+id+'"]')?.disabled===true)&&[...document.querySelectorAll('[data-testid="application-task-locate"]')].every(button=>button.disabled)`), 'persistentLocateLocksConcurrentFillAndViewportControls');
    heldLocation!({ status: 'located', message: '虚构工作流定位回执，未滚动或修改企业网页。' }); heldLocation = undefined;
    await waitFor('workflow-locate-reply-visible', `document.querySelector('[data-testid="application-tasks"]')?.textContent.includes('虚构工作流定位回执')&&document.querySelector('[data-testid="quick-fill"]')?.disabled===false`);
    expect((await store.workflow.workflowState()).workflows[0]!.issues.find(item=>item.id===roleIssue.id)?.status==='open', 'readOnlyLocationNeverResolvesIssueOrAuthorizesWriting');
    await waitFor('top-principal-count-before-read-only-refresh', `document.querySelector('[data-testid="companion-progress"]')?.textContent.includes('待你处理 2 项')===true`);
    const beforeRefresh = JSON.stringify(await store.workflow.workflowState());
    await click('[data-testid="application-task-refresh"]');
    await waitHost('held-attention-read-only-refresh', async () => Boolean(heldAttention));
    expect(await ui<boolean>('read-only-refresh-locks-form-and-layout', `document.querySelector('[data-testid="application-task-refresh"]')?.disabled===true&&document.querySelector('[data-testid="application-task-refresh"]')?.textContent.includes('正在读取提示')&&['quick-fill','browser-focus-toggle','browser-zoom'].every(id=>document.querySelector('[data-testid="'+id+'"]')?.disabled===true)`), 'attentionRefreshLocksConcurrentOperationsWithReadOnlyCopy');
    const historicalProtocol = structuredClone(await store.workflow.workflowState());
    historicalProtocol.workflows.forEach(item => item.issues.forEach(issue => { if (issue.status === 'open') issue.attentionState = 'not-reobserved'; }));
    // Production publishes the reconciled snapshot before returning the same
    // named response. Exercise both task-list and top-companion consumers.
    send({ type: 'application-workflow', state: historicalProtocol });
    heldAttention!(historicalProtocol); heldAttention = undefined;
    await waitFor('attention-refresh-reply', `document.querySelector('[data-testid="application-tasks"]')?.textContent.includes('没有填写任何字段')&&document.querySelector('[data-testid="application-task-refresh"]')?.disabled===false`);
    expect(selectedWorkflowIds.length === 1 && selectedWorkflowIds[0] === workflow.id, 'readOnlyRefreshExplicitlySelectsTheDisplayedWorkflowBeforeReading');
    expect(refreshRequests === 1 && freshPlans.length === 0 && JSON.stringify(await store.workflow.workflowState()) === beforeRefresh, 'namedReadOnlyRefreshFixtureNeverCallsFillOrCreatesAWritePlan');
    expect(await ui<boolean>('fresh-workflow-clears-old-top-attention-count', `document.querySelector('[data-testid="application-task-historical"]')?.textContent.includes('3 项')===true&&!document.querySelector('[data-testid="companion-progress"]')?.textContent.includes('待你处理')`), 'freshWorkflowBroadcastClearsOldTopAttentionCountWithoutFilling');
    expect(await ui<boolean>('unobserved-history-collapsed-and-not-counted', `document.querySelector('[data-testid="application-task-historical"]')?.open===false&&document.querySelector('[data-testid="application-task-historical"]')?.textContent.includes('3 项')&&!document.querySelector('[data-testid="application-tasks"]>summary')?.textContent.includes('需要你帮一下')&&document.querySelectorAll('[data-testid="application-task-historical"] .application-task-edit-details').length===0`), 'notReobservedHistoryIsCollapsedAndDoesNotPretendSourceFactsAreMissing');
    await publishWorkflow();
    await waitFor('actual-fictional-workflow-restored-after-history-protocol', `!document.querySelector('[data-testid="application-task-historical"]')&&document.querySelector(${JSON.stringify(`${roleSelector} .application-task-edit-details`)})?.checkVisibility()===true`);
    expect(await ui<boolean>('refresh-and-resume-distinct-labels', `document.querySelector('[data-testid="application-task-refresh"]')?.textContent==='重新读取提示'&&document.querySelector('[data-testid="application-task-resume"]')?.textContent==='重新读取并续填'`), 'readOnlyRefreshAndWriteContinuationHaveDistinctVisibleActions');
    await openDetails(`${roleSelector} .application-task-edit-details`);
    await setInput(`${roleSelector} input`, '虚构补充算法实习角色');
    expect(await ui<boolean>('unsaved-fact-blocks-read-only-refresh', `document.querySelector('[data-testid="application-task-refresh"]')?.disabled===true&&document.querySelector('.application-task-refresh-area')?.textContent.includes('先保存或还原')`), 'readOnlyRefreshCannotHideAnUnsavedFactDraft');
    await ui('disabled-refresh-cannot-hide-fact', `document.querySelector('[data-testid="application-task-refresh"]').click()`);
    expect(refreshRequests === 1 && selectedWorkflowIds.length === 1, 'disabledFactDraftRefreshCreatesNoSelectionOrReadRequest');
    await ui('save-owned-missing-role', `(() => {const row=document.querySelector(${JSON.stringify(roleSelector)});const button=[...(row?.querySelectorAll('button')??[])].find(item=>item.textContent==='保存为资料草稿');if(!(button instanceof HTMLButtonElement)||button.disabled)throw new Error('缺失事实保存入口不可用');button.click();})()`);
    await waitHost('role-fact-real-profile-save', async () => (await store.getState()).profile.career!.internships[0]!.role === '虚构补充算法实习角色');
    current = await store.getState(); expect(current.profile.career!.internships[0]!.confirmation === 'pending', 'savingMissingFactCreatesPendingCareerRevision');
    await waitFor('pending-confirmation-disables-resume', 'document.querySelector(\'[data-testid="application-task-resume"]\')?.disabled===true');
    expect((await store.workflow.workflowState()).workflows[0]!.issues.find(item => item.id === roleIssue.id)?.readbackVerified === false, 'savingSourceFactDoesNotClaimWebpageWasFilled');
    await ui('confirm-owned-role-revision', `(() => {const row=document.querySelector(${JSON.stringify(roleSelector)});const button=[...(row?.querySelectorAll('button')??[])].find(item=>item.textContent==='我已核对，确认本条修订');if(!(button instanceof HTMLButtonElement)||button.disabled)throw new Error('缺失事实确认入口不可用');button.click();})()`);
    await waitHost('role-fact-real-confirmation', async () => { const record = (await store.getState()).profile.career!.internships[0]!; return record.confirmation === 'confirmed' && record.confirmedRevision === record.revision; });
    expect((await store.workflow.workflowState()).workflows[0]!.issues.find(item => item.id === roleIssue.id)?.status === 'open', 'confirmingCareerFactStillRequiresFreshWebpageEvidence');
    expect(await ui<boolean>('saved-fact-not-mislabelled-missing', `document.querySelector(${JSON.stringify(roleSelector)})?.textContent.includes('资料已有')===true`), 'savedFactRemainsUnverifiedWithoutBeingCalledMissingInformation');
    await screenshot('workflow-tasks-fixture.png');

    runner.setStage('new-ordinary-question-explicit-draft-and-confirmation');
    const answerQuestion = '请简要介绍一个你独立完成的项目';
    const latestTarget = { ...target, profileVersion: (await store.getState()).profile.version };
    const identicalValue = '虚构回答：独立完成了原创合成项目';
    const twinCreated = await invoke<ApplicationAssetsState>('saveAnswer', [{ questionPattern: answerQuestion, answer: identicalValue, scope: { kind: 'application', applicationId }, demo: false, risk: 'ordinary' }, null]);
    const twinDraft = twinCreated.answers.find(item => item.questionPattern === answerQuestion)!;
    await invoke('confirmAnswer', [twinDraft.id, twinDraft.revision, latestTarget.profileVersion]);
    const answersBeforeRemember = (await store.assets.getState()).answers, knownAnswerIds = new Set(answersBeforeRemember.map(item => item.id));
    const uiConfirmRequests: string[] = [], originalConfirmAnswer = methods.confirmAnswer!;
    replace('confirmAnswer', async (...args: unknown[]) => { uiConfirmRequests.push(String(args[0])); return originalConfirmAnswer(...args); });
    const questionPlan: FillPlan = { ...ordinaryPlan, id: 'fictional-new-format-question-plan', profileVersion: latestTarget.profileVersion,
      items: [{ fieldId: 'fictional-new-format-question', label: answerQuestion, value: '', currentValue: '', status: 'review', reason: '此题没有可确定的资料映射' }] };
    const questionWorkflow = await store.workflow.recordOrdinaryPlan(latestTarget, questionPlan); await publishWorkflow();
    const questionIssue = questionWorkflow.issues.find(item => item.label === answerQuestion)!;
    const questionSelector = `[data-testid="application-task-item"][data-issue-id="${questionIssue.id}"]`;
    await waitFor('ordinary-answer-prompt-visible', `document.querySelector(${JSON.stringify(`${questionSelector} .application-task-answer`)})?.checkVisibility()===true`);
    await openDetails(`${questionSelector} .application-task-answer`);
    expect(await ui<boolean>('answer-reuse-is-not-preselected', `document.querySelector(${JSON.stringify(`${questionSelector} .application-task-reuse input`)})?.checked===false`), 'newQuestionDefaultsToCurrentApplicationRatherThanGlobalReuse');
    await ui('owned-answer-value-input', `(() => {const input=document.querySelector(${JSON.stringify(`${questionSelector} [data-testid="application-answer-value"]`)});if(!(input instanceof HTMLTextAreaElement)||!input.checkVisibility())throw new Error('常用回答编辑入口不可见');Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(input,'虚构回答：独立完成了原创合成项目');input.dispatchEvent(new Event('input',{bubbles:true}));})()`);
    expect(await ui<boolean>('unsaved-answer-blocks-read-only-refresh', `document.querySelector('[data-testid="application-task-refresh"]')?.disabled===true`), 'readOnlyRefreshCannotHideAnUnsavedAuthoredAnswer');
    await click(`${questionSelector} [data-testid="application-answer-save"]`);
    await waitHost('new-answer-draft-saved-through-existing-api', async () => (await store.assets.getState()).answers.some(item => !knownAnswerIds.has(item.id) && item.questionPattern === answerQuestion && item.answer === identicalValue));
    const rememberedDraft = (await store.assets.getState()).answers.find(item => !knownAnswerIds.has(item.id) && item.questionPattern === answerQuestion && item.answer === identicalValue)!;
    expect(rememberedDraft.confirmedRevision === null && rememberedDraft.scope.kind === 'application' && rememberedDraft.scope.applicationId === applicationId, 'newQuestionAnswerIsScopedDraftUntilExplicitUserConfirmation');
    await waitFor('new-answer-confirm-button-visible', `document.querySelector(${JSON.stringify(`${questionSelector} [data-testid="application-answer-confirm"]`)})?.checkVisibility()===true`);
    await click(`${questionSelector} [data-testid="application-answer-confirm"]`);
    await waitHost('new-answer-explicit-confirmation-persisted', async () => { const answer = (await store.assets.getState()).answers.find(item => item.id === rememberedDraft.id); return answer?.confirmedRevision === answer?.revision && answer?.confirmedProfileVersion === latestTarget.profileVersion; });
    expect(uiConfirmRequests.length === 1 && uiConfirmRequests[0] === rememberedDraft.id && rememberedDraft.id !== twinDraft.id, 'explicitConfirmationTargetsOnlyNewHostCreatedAnswerNotIdenticalExistingTwin');
    const afterRemember = (await store.assets.getState()).answers;
    expect(answersBeforeRemember.every(old => JSON.stringify(afterRemember.find(item => item.id === old.id)) === JSON.stringify(old)), 'rememberingAndConfirmingNewAnswerLeavesEveryPreviouslySavedAnswerUnchanged');
    expect((await store.workflow.workflowState()).workflows[0]!.issues.find(item => item.id === questionIssue.id)?.readbackVerified === false, 'rememberedAnswerNeverMarksUnfilledWebpageAsVerified');
    await setInput(`${questionSelector} [data-testid="application-answer-question"]`, '期望薪资和工作许可');
    expect(await ui<boolean>('high-impact-question-cannot-be-saved-as-ordinary', `document.querySelector(${JSON.stringify(`${questionSelector} [data-testid="application-answer-save"]`)})?.disabled===true`), 'answerEditorRefusesHighImpactQuestionAsOrdinaryReusableAnswer');

    runner.setStage('continue-uses-fresh-named-ipc-fixture-never-native-input');
    replace('beginMeasurement', async () => ({ id: 'fictional-continue-measurement' })); replace('finishMeasurement', async () => ({ id: 'fictional-continue-measurement' }));
    replace('prepareFill', async (options?: { useModel?: boolean }) => { const version = (await store.getState()).profile.version; const id = `fresh-protocol-plan-${randomUUID()}`; freshPlans.push({ id, profileVersion: version, useModel: options?.useModel === true }); return { id, url: fictionalURL, title: '全新命名协议计划，不是原生观察', profileVersion: version, observationId: `protocol-observe-${randomUUID()}`, createdAt: new Date().toISOString(), items: [], recognition: { mode: 'rules', mappedCount: 0, message: '命名IPC协议fixture，无模型与网页输入' } } satisfies FillPlan; });
    send({ type: 'model', status: { mode: 'live', provider: 'fictional-protocol', modelId: 'fictional-no-request-model', configured: true } });
    await ui('settle-owned-ui-model-state-only', 'new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');
    await waitFor('continue-button-enabled-after-confirm', 'document.querySelector(\'[data-testid="application-task-resume"]\')?.disabled===false');
    await click('[data-testid="application-task-resume"]'); await waitHost('fresh-prepare-invoked-from-continue', async () => freshPlans.length === 1);
    expect(freshPlans[0]!.id !== ordinaryPlan.id && freshPlans[0]!.id !== preview.planId && freshPlans[0]!.profileVersion === (await store.getState()).profile.version && freshPlans[0]!.useModel, 'continueRequestsNewObservationProtocolInsteadOfReplayingOldPlan');
    await waitFor('continue-finished-with-no-native-fields', 'document.querySelector(\'[data-testid="quick-fill"]\')?.disabled===false&&document.querySelector(\'[data-testid="page-auto-fill-status"]\')?.textContent.includes("没有可直接填写")===true');

    runner.setStage('saved-discovery-scope-only-without-network');
    const registered = await invoke<{ id: string; provider: string }>('addDiscoverySource', [{ company: '虚构候选入口', url: 'https://careers.example.com/fictional/careers' }]);
    expect(registered.provider === 'candidate', 'unknownSourceIsCandidateInsteadOfInventedJob');
    const source = (await store.discovery.getState()).sources.find(item => item.enabled && item.provider !== 'candidate')!;
    const timestamp = new Date().toISOString();
    const scopeReport: DiscoveryReport = { id: randomUUID(), startedAt: timestamp, finishedAt: timestamp, status: 'partial', plan: { profileVersion: (await store.getState()).profile.version, keywords: ['虚构协议关键词'], cities: [], educationSummary: '虚构资料', notes: ['协议fixture，并未执行采集'] }, options: { region: 'all', sourceIds: [source.id], maxSources: 1, maxPages: 1, pageSize: 2, detailLimit: 1, includeExperienced: false }, sources: [{ sourceId: source.id, name: source.name, url: source.url, provider: source.provider, status: 'partial', reason: '虚构范围报告：达到1页预算', pagesRequested: 1, pagesSucceeded: 1, entriesRead: 2, detailChecked: 1, detailComplete: 1, matchedCount: 1, excludedCount: 1, officialTotal: null, requestURLs: [], warnings: ['此为协议样本，不代表真实官网读取'], jobIds: ['fictional-job'], unviewed: ['剩余页面未查看'] }], unviewedSources: [], uniqueJobs: 1, completeDetails: 1, duplicateCount: 0, scopeNote: '虚构范围报告，只覆盖本次设定范围，不能称全网覆盖。' };
    await store.discovery.recordRun(scopeReport); send({ type: 'navigate', page: 'apply' });
    await waitFor('discovery-entry-visible', 'document.querySelector(\'[data-testid="job-discovery"]\')?.checkVisibility()===true');
    await openDetails('[data-testid="job-discovery"]'); await waitFor('saved-discovery-report-read', 'document.querySelector(\'[data-testid="discovery-report"]\')?.textContent.includes("虚构协议关键词")===true');
    expect(await ui<boolean>('source-selection-no-collection', 'document.querySelectorAll(".discovery-source-options input[type=checkbox]").length>0&&document.querySelector(\'[data-testid="discovery-start"]\')?.disabled===false'), 'recommendationPageHasSourceSelectionAndDiscoveryEntry');
    expect(await ui<boolean>('candidate-source-not-selectable', '([...document.querySelectorAll(".discovery-source-row")].find(row=>row.textContent.includes("虚构候选入口")))?.querySelector("input")?.disabled===true'), 'unsupportedCandidateSourceCannotStartAutomaticCollection');
    expect(await ui<boolean>('scope-and-unread-coverage-displayed', 'document.querySelector(\'[data-testid="discovery-report"]\')?.textContent.includes("剩余页面未查看")===true&&document.querySelector(\'[data-testid="discovery-report"]\')?.textContent.includes("不能称全网覆盖")===true'), 'savedDiscoveryReportRetainsBudgetAndUnviewedScopeWithoutRunningNetwork');
    await screenshot('application-services-discovery-fixture.png');

    runner.setStage('verify-isolation-and-output');
    expect(JSON.stringify((await store.getState()).applications) === applicationBefore, 'allNewServiceTestsPreserveApplicationStatusAndHistory');
    expect(!window.isVisible() && (await originalBrowserState() as BrowserState).visible === false, 'testWindowAndActualNativeWebViewRemainHidden');
    expect(blockedCommands.length === 0, 'noNativeInputProviderNetworkOrUnrelatedFileCommandAttempted');
    expect(selectorCalls.length === 3 && freshPlans.length === 1, 'onlyThreeFixtureNativeSelectorsAndOneNamedFreshPreparationUsed');
    const report = { ok: true, assertionCount: assertions.length, assertions, screenshots, blockedCommands, nativeSelectorsReplacedOnly: selectorCalls,
      realIsolatedSQLite: true, actualNewIpcAndBusinessMethods: true, copiedAndExportedFileHashVerified: true, originalFixtureUnchanged: true,
      workflowEvidenceInjectedByNamedFictionalFixture: true, workflowCountsNotNativeCorrectness: true, continuationFreshPrepareIsNamedProtocolFixture: true,
      discoveryReportInjectedFictionalScopeOnly: true, realDiscoveryRun: false, nativeInputs: 0, enterpriseInputs: 0, realModelCalls: 0,
      actualNativeWebViewHidden: true, screenshotsContainOwnedRendererOnlyNoEnterprisePixels: true,
      applicationId, answerId, resumeId, freshPlans, locationRequests, refreshRequests, selectedWorkflowIds, harness: runner.snapshot() };
    await writeFile(join(stateDirectory, 'smoke-application-services-report.json'), JSON.stringify(report, null, 2), { mode: 0o600 }); return report;
  } catch (error) {
    try { await screenshot('application-services-failure.png'); } catch { /* Preserve the first failure. */ }
    await writeFile(join(stateDirectory, 'smoke-application-services-failure.json'), JSON.stringify({ ok: false, assertionCount: assertions.length, assertions, screenshots, blockedCommands,
      nativeInputs: 0, realModelCalls: 0, workflowEvidenceInjectedByNamedFictionalFixture: true, message: error instanceof Error ? error.message : '隔离申请服务检查失败', harness: runner.snapshot() }, null, 2), { mode: 0o600 }); throw error;
  } finally {
    dialog.showOpenDialog = originalOpen; dialog.showSaveDialog = originalSave;
    for (const [name, method] of replaced) methods[name] = method;
  }
}
