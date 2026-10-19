import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import type { BrowserWindow } from 'electron';
import type { AppEvent, AppState, BrowserBounds, BrowserState, JobInput } from '../../packages/shared/src/contracts.js';
import type { ApplicationQueueStartInput, ApplicationQueueState } from '../../packages/shared/src/application-queue.js';
import { BACKGROUND_QUEUE_CAPABILITY } from '../../packages/shared/src/application-queue.js';
import { SmokeStepRunner } from './smoke-deadline.js';
import { ONBOARDING_STORAGE_KEY, readOnboardingReceipt } from '../../packages/ui/src/onboarding.js';

type Methods = Record<string, (...args: any[]) => Promise<any>>;
/** Own hidden renderer, real isolated job save, and explicitly mocked queue IPC. No native/background webpage inputs. */
export async function smokeCompanionQueue(window: BrowserWindow, methods: Methods, send: (event: AppEvent) => void, stateDirectory: string) {
  if (!process.argv.includes('--smoke-test') || !process.argv.includes('--smoke-assistant-only') || window.isVisible()
    || process.argv.some(arg => arg.startsWith('--smoke-') && !['--smoke-test', '--smoke-assistant-only'].includes(arg))
    || process.argv.includes('--live-product-check') || process.argv.includes('--site-diagnostic')) throw new Error('小助手检查仅允许隐藏的专用隔离 smoke。');
  const runner = new SmokeStepRunner('companion-queue-hidden-owned-renderer');
  const checks: Array<{ name: string; passed: true }> = [], blockedCommands: string[] = [], screenshots: string[] = [];
  const calls = { enqueue: [] as ApplicationQueueStartInput[], start: 0, cancel: 0, review: [] as string[], close: [] as string[] };
  const replaced = new Map<string, Methods[string]>();
  const originalBounds = methods.browserBounds!, originalBrowserState = methods.browserState!, originalState = methods.getState!;
  const beforeBounds = window.getBounds(); let ownDebugger = false;
  const fixtureURL = 'https://careers.example.invalid/application/fixture-current';
  const fixtureBrowser: BrowserState = { url: fixtureURL, title: '虚构小助手协议页面（未加载网页）', loading: false, canGoBack: false, canGoForward: false, visible: false, zoomPercent: 100 };
  let fixtureQueue: ApplicationQueueState = { id: null, status: 'idle', profileVersion: null, items: [], completedCount: 0, totalCount: 0, activeItemId: null, sessionOnly: true, capability: BACKGROUND_QUEUE_CAPABILITY };
  const expect = (value: unknown, name: string) => { if (!value) throw new Error(name); checks.push({ name, passed: true }); };
  const replace = (name: string, value: Methods[string]) => { if (!replaced.has(name)) replaced.set(name, methods[name]!); methods[name] = value; };
  const ui = <T = unknown>(name: string, expression: string) => runner.run(name, () => window.webContents.executeJavaScript(expression) as Promise<T>);
  const settle = () => ui('settle-owned-renderer', 'new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');
  const waitFor = async (name: string, expression: string) => { const until = performance.now() + 7000; while (performance.now() < until) { if (await ui<boolean>(name, expression)) return; await delay(25); } throw new Error(name); };
  const invoke = <T = unknown>(name: string, args: unknown[] = []) => ui<T>('actual-isolated-owned-ipc', `window.offer[${JSON.stringify(name)}](...${JSON.stringify(args)})`);
  const click = async (selector: string) => { await ui('click-visible-owned-control', `(() => {const node=document.querySelector(${JSON.stringify(selector)});if(!(node instanceof HTMLElement)||node.hasAttribute('disabled')||!node.checkVisibility())throw new Error('小助手控件不可用：'+${JSON.stringify(selector)});node.click();})()`); await settle(); };
  const screenshot = async (name: string) => { const data = await runner.run('hidden-owned-renderer-screenshot', () => window.webContents.capturePage()); const path = join(stateDirectory, name); await writeFile(path, data.toPNG(), { mode: 0o600 }); screenshots.push(path); };
  const publishQueue = async (next: ApplicationQueueState) => { fixtureQueue = structuredClone(next); send({ type: 'application-queue', state: fixtureQueue }); await settle(); };
  try {
    runner.setStage('guard-empty-isolated-store-and-disable-all-external-execution');
    const original = await originalState() as AppState;
    expect(original.jobs.length === 0 && original.applications.length === 0 && original.profile.version === 0, 'startsFromFreshEmptyIsolatedBusinessStore');
    await originalBounds({ x: 0, y: 0, width: 900, height: 600 } satisfies BrowserBounds, false);
    replace('browserBounds', async () => undefined); replace('browserState', async () => fixtureBrowser);
    window.webContents.session.webRequest.onBeforeRequest({ urls: ['http://*/*', 'https://*/*'] }, (_details, callback) => callback({ cancel: true }));
    for (const name of ['browserNavigate', 'browserBack', 'browserForward', 'browserReload', 'browserZoom', 'prepareFill', 'fillApproved', 'prepareCareerFill', 'runCareerFill',
      'configureModel', 'runAgent', 'cancelAgent', 'discoverJobs', 'refreshSource', 'collectPageJobs', 'capturePage', 'importResume', 'importApplyDock', 'importResumeVersion', 'exportData', 'exportTelemetry']) {
      if (methods[name]) replace(name, async () => { blockedCommands.push(name); throw new Error('小助手协议样本禁止网络、付费模型、网页输入或无关文件操作。'); });
    }
    replace('queueState', async () => fixtureQueue);
    replace('enqueueApplications', async (input: ApplicationQueueStartInput) => {
      calls.enqueue.push(structuredClone(input));
      const state = await originalState() as AppState;
      fixtureQueue = { ...fixtureQueue, id: 'fictional-queue', status: 'idle', profileVersion: input.profileVersion, completedCount: 0, totalCount: input.jobIds.length, activeItemId: null,
        items: input.jobIds.map((id, index) => { const job = state.jobs.find(job => job.id === id); if (!job) throw new Error('虚构岗位不存在'); return { id: `fictional-item-${index}`, jobId: id, company: job.company, title: job.title, status: 'queued', verifiedCount: 0, pendingCount: 0, message: '命名IPC虚构队列，没有实际网页', canReview: false }; }) };
      send({ type: 'application-queue', state: fixtureQueue }); return fixtureQueue;
    });
    replace('startApplicationQueue', async () => {
      calls.start++; fixtureQueue = { ...fixtureQueue, status: 'running', activeItemId: fixtureQueue.items[0]?.id ?? null,
        items: fixtureQueue.items.map((item, index) => ({ ...item, status: index === 0 ? 'loading' : 'queued' })) };
      send({ type: 'application-queue', state: fixtureQueue }); return fixtureQueue;
    });
    replace('cancelApplicationQueue', async () => { calls.cancel++; fixtureQueue = { ...fixtureQueue, status: 'cancelled', activeItemId: null }; send({ type: 'application-queue', state: fixtureQueue }); return fixtureQueue; });
    replace('reviewQueuedApplication', async (id: string) => { calls.review.push(id); });
    replace('closeQueuedApplication', async (id: string) => { calls.close.push(id); fixtureQueue = { ...fixtureQueue, items: fixtureQueue.items.filter(item => item.id !== id) }; send({ type: 'application-queue', state: fixtureQueue }); return fixtureQueue; });
    if (!window.webContents.debugger.isAttached()) { window.webContents.debugger.attach('1.3'); ownDebugger = true; }
    await runner.run('emulate-owned-renderer-motion-only', () => window.webContents.debugger.sendCommand('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'no-preference' }] }));
    window.setContentSize(1480, 960);
    // The first-run dialog is opened by App's effect after getState resolves.
    // An early optional click can run before that effect and leave a later modal
    // correctly blocking every companion action. Wait for the real control.
    const receipt = readOnboardingReceipt(await ui<string | null>('read-owned-onboarding-display-receipt', `localStorage.getItem(${JSON.stringify(ONBOARDING_STORAGE_KEY)})`));
    if (!receipt) {
      await waitFor('first-run-onboarding-control-ready', 'document.querySelector(\'[data-testid="onboarding-skip"]\')?.checkVisibility()===true');
      await click('[data-testid="onboarding-skip"]');
      await waitFor('first-run-onboarding-closed', '!document.querySelector(\'[data-testid="onboarding-dialog"]\')');
    }
    const fixtureJob = (title: string, url: string): JobInput => ({ company: '虚构小助手企业', title, city: '北京', type: 'campus', description: '原创协议样本，不代表真实岗位。', requirements: '虚构人工智能方向', url, sourceId: 'manual', sourceName: '隔离原创样本', publishedAt: null, deadline: null, demo: false });
    await invoke('saveJob', [fixtureJob('虚构算法岗位一', 'https://careers.example.invalid/job/one')]);
    await invoke('saveJob', [fixtureJob('虚构算法岗位二', 'https://careers.example.invalid/job/two')]);
    await invoke('saveJob', [fixtureJob('不同官网的虚构岗位', 'https://another.example.invalid/job/three')]);
    const state = await originalState() as AppState;
    const chosenJob = state.jobs.find(item => item.title === '虚构算法岗位二')!;
    send({ type: 'browser', state: fixtureBrowser }); send({ type: 'navigate', page: 'browser' });
    await waitFor('companion-visible-above-owned-holder', 'document.querySelector(\'[data-testid="agent-companion"]\')?.checkVisibility()===true');
    await waitFor('companion-action-unblocked-after-onboarding', 'document.querySelector(\'[data-testid="companion-action"]\')?.checkVisibility()===true&&document.querySelector(\'[data-testid="companion-action"]\')?.disabled===false');
    expect(await ui<boolean>('companion-not-an-overlay-on-native-holder', `(() => {const companion=document.querySelector('[data-testid="agent-companion"]'),holder=document.querySelector('.browser-placeholder');return companion&&holder&&holder.checkVisibility()&&companion.getBoundingClientRect().bottom<=holder.getBoundingClientRect().top+1;})()`), 'companionOccupiesLayoutAboveNativeBrowserRatherThanCoveringWebpage');

    runner.setStage('explicit-current-page-selection-and-autosave-consent');
    await click('[data-testid="companion-action"]');
    await waitFor('queue-request-opens-picker', 'document.querySelector(\'[data-testid="queue-panel"]\')?.open===true&&document.querySelector(\'[data-testid="queue-picker"]\')?.checkVisibility()===true');
    expect(await ui<boolean>('queue-no-implicit-consent-or-selection', 'document.querySelector(\'[data-testid="queue-use-current-page"]\')?.checked===false&&document.querySelector(\'[data-testid="queue-autosave-ack"]\')?.checked===false&&document.querySelector(\'[data-testid="queue-start"]\')?.disabled===true&&document.querySelectorAll(".queue-job-list input:checked").length===0'), 'openingQueueNeitherChoosesJobsNorAcceptsAutosaveNorStartsWork');
    expect(calls.enqueue.length === 0 && calls.start === 0, 'openingQueuePerformsNoBackgroundTask');
    await click('[data-testid="queue-use-current-page"]');
    expect(await ui<boolean>('queue-current-page-exact-origin-choices', 'document.querySelectorAll(\'[data-testid="queue-current-page-jobs"] input[type="radio"]\').length===2&&document.querySelectorAll(\'[data-testid="queue-current-page-jobs"] input:checked\').length===0&&!document.querySelector(\'[data-testid="queue-current-page-jobs"]\')?.textContent.includes("不同官网")'), 'sameOriginRestrictsChoicesButDoesNotGuessWhichJobTheUserMeans');
    expect(await ui<boolean>('queue-shows-exact-destination-hostname', '([...document.querySelectorAll(\'[data-testid="queue-current-page-jobs"] [data-testid="queue-job-host"]\')]).every(node=>node.textContent==="careers.example.invalid")'), 'currentPageChoicesShowActualDestinationHostWithoutPrivateApplicationPath');
    await ui('explicit-owned-current-page-job-radio', `(() => {const row=[...document.querySelectorAll('[data-testid="queue-current-page-jobs"] label')].find(node=>node.textContent.includes('虚构算法岗位二'));const radio=row?.querySelector('input');if(!(radio instanceof HTMLInputElement)||radio.disabled||!radio.checkVisibility())throw new Error('虚构岗位选择不可见');radio.click();})()`); await settle();
    expect(await ui<boolean>('queue-still-requires-autosave-consent', 'document.querySelector(\'[data-testid="queue-start"]\')?.disabled===true'), 'explicitJobSelectionStillDoesNotAcceptAutosaveConsent');
    await click('[data-testid="queue-autosave-ack"]'); await click('[data-testid="queue-start"]');
    await waitFor('queue-start-observed', 'document.querySelector(\'[data-testid="agent-companion"]\')?.getAttribute("data-status")==="reading"');
    expect(calls.enqueue.length === 1 && calls.start === 1 && calls.enqueue[0]?.jobIds.length === 1 && calls.enqueue[0]?.jobIds[0] === chosenJob.id
      && calls.enqueue[0]?.currentPageForJobId === chosenJob.id && calls.enqueue[0]?.acknowledgeAutosave === true
      && calls.enqueue[0]?.profileVersion === state.profile.version && !('url' in calls.enqueue[0]!), 'queueIpcContainsOnlyExplicitJobAndProfileBindingNotRendererUrlOrInputValues');

    runner.setStage('real-state-presentation-without-invented-progress-or-focus');
    await ui('remember-owned-focused-node', 'window.__assistantFocusedBefore=document.activeElement');
    await publishQueue({ ...fixtureQueue, items: fixtureQueue.items.map(item => ({ ...item, status: 'filling', verifiedCount: 3, pendingCount: 2, message: '虚构回执：已核实三项，仍需人工处理' })) });
    await waitFor('companion-shows-fixture-verified-count', 'document.querySelector(\'[data-testid="agent-companion"]\')?.getAttribute("data-status")==="filling"&&document.querySelector(\'[data-testid="companion-progress"]\')?.textContent.includes("已核实 3 项")===true');
    expect(await ui<boolean>('unknown-total-not-a-percentage', 'document.querySelector(\'[data-testid="companion-progress"]\')?.getAttribute("data-determinate")==="false"&&!document.querySelector(\'[data-testid="companion-progress"] progress\')'), 'unknownFieldDenominatorUsesActivityIndicatorWithoutFakePercentage');
    expect(await ui<boolean>('companion-did-not-steal-focus', 'document.activeElement===window.__assistantFocusedBefore'), 'queueUpdatesNeverMoveKeyboardFocus');
    await click('[data-testid="companion-mute"]');
    expect(await ui<boolean>('muted-companion-keeps-state-with-live-off', 'document.querySelector(\'[data-testid="companion-live"]\')?.getAttribute("aria-live")==="off"&&document.querySelector(\'[data-testid="companion-progress"]\')?.textContent.includes("已核实 3 项")===true'), 'mutingRemindersDoesNotHideActualProgress');
    const companionHeight = await ui<number>('read-owned-companion-layout-height', 'document.querySelector(\'[data-testid="agent-companion"]\').getBoundingClientRect().height');
    await click('[data-testid="companion-collapse"]');
    expect(await ui<boolean>('collapsed-companion-keeps-layout-stable', `document.querySelector('[data-testid="agent-companion"]').classList.contains('is-collapsed')&&document.querySelector('[data-testid="agent-companion"]').getBoundingClientRect().height===${companionHeight}`), 'collapsingCompanionCannotShiftTheNativeBrowserDuringBackgroundWork');
    await runner.run('emulate-accessible-reduced-motion-on-owned-renderer', () => window.webContents.debugger.sendCommand('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] }));
    await waitFor('reduced-motion-sprite-static', 'getComputedStyle(document.querySelector(".agent-companion-sprite .speedster-hero")).animationName==="none"&&getComputedStyle(document.querySelector(".companion-activity-track i")).animationName==="none"');
    expect(await ui<boolean>('reduced-motion-remains-readable', 'document.querySelector(\'[data-testid="companion-progress"]\')?.textContent.includes("已核实 3 项")===true'), 'reducedMotionStopsAnimationsWithoutSuppressingRecordedCounts');

    runner.setStage('explicit-review-and-two-step-close-never-claim-submission');
    await publishQueue({ ...fixtureQueue, status: 'finished', activeItemId: null, completedCount: 1,
      items: fixtureQueue.items.map(item => ({ ...item, status: 'waiting-user', verifiedCount: 3, pendingCount: 2, canReview: true, message: '普通字段部分完成，请核对日期和自定义控件。' })) });
    await waitFor('queue-draft-review-visible', 'document.querySelector(\'[data-testid="queue-review"]\')?.checkVisibility()===true');
    expect(await ui<boolean>('partial-draft-honest-message', 'document.querySelector(\'[data-testid="queue-panel"]\')?.textContent.includes("普通字段部分完成")===true&&document.querySelector(\'[data-testid="queue-panel"]\')?.textContent.includes("不表示已投递")===true'), 'queuePartialDraftIsNotPresentedAsApplicationSubmission');
    await click('[data-testid="queue-review"]'); expect(calls.review.length === 1 && calls.review[0] === fixtureQueue.items[0]?.id, 'reviewUsesExactDraftIdWithoutReloadingMainBrowserUrl');
    await click('[data-testid="queue-close"]');
    expect(calls.close.length === 0 && await ui<boolean>('close-draft-warns-before-mutation', 'document.querySelector(".queue-close-confirm")?.textContent.includes("尚未保存")===true'), 'closeDraftRequiresSeparateExplicitConfirmation');
    await click('[data-testid="queue-close-confirm"]');
    expect(calls.close.length === 1, 'onlyExplicitConfirmationClosesOneRequestedDraft');
    expect((await originalState() as AppState).applications.length === 0, 'assistantAndQueuePresentationNeverCreateOrAdvanceApplications');
    expect(!window.isVisible() && (await originalBrowserState() as BrowserState).visible === false, 'normalWindowAndNativeWebViewRemainHiddenThroughout');
    expect(blockedCommands.length === 0, 'noModelNetworkNativeInputOrUnrelatedCommandAttempted');
    await screenshot('assistant-queue-owned-fixture.png');
    const report = { ok: true, assertionCount: checks.length, checks, screenshots, calls, blockedCommands, namedQueueIpcFixture: true,
      actualIsolatedJobSave: true, actualQueueExecution: false, normalPrivateStoreRead: false, nativeInputs: 0, enterpriseInputs: 0, realModelCalls: 0,
      actualNativeWebViewHidden: true, screenshotsContainOwnedRendererOnly: true, harness: runner.snapshot() };
    await writeFile(join(stateDirectory, 'smoke-companion-queue-report.json'), JSON.stringify(report, null, 2), { mode: 0o600 }); return report;
  } catch (error) {
    try { await screenshot('assistant-queue-failure.png'); } catch { /* Keep first failure. */ }
    await writeFile(join(stateDirectory, 'smoke-companion-queue-failure.json'), JSON.stringify({ ok: false, checks, assertionCount: checks.length, screenshots, calls, blockedCommands,
      namedQueueIpcFixture: true, nativeInputs: 0, realModelCalls: 0, message: error instanceof Error ? error.message : '小助手隔离检查失败', harness: runner.snapshot() }, null, 2), { mode: 0o600 }); throw error;
  } finally {
    for (const [name, method] of replaced) methods[name] = method;
    window.webContents.session.webRequest.onBeforeRequest(null);
    if (!window.webContents.isDestroyed() && window.webContents.debugger.isAttached()) {
      try { await window.webContents.debugger.sendCommand('Emulation.setEmulatedMedia', { features: [] }); } catch { /* Renderer may have closed. */ }
      if (ownDebugger) window.webContents.debugger.detach();
    }
    if (!window.isDestroyed()) window.setBounds(beforeBounds);
  }
}
