import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import type { BrowserWindow } from 'electron';
import type { AppEvent, AppState, BrowserBounds, BrowserState } from '../../packages/shared/src/contracts.js';
import type { ApplicationQueueItem, ApplicationQueueState } from '../../packages/shared/src/application-queue.js';
import { BACKGROUND_QUEUE_CAPABILITY } from '../../packages/shared/src/application-queue.js';
import { SmokeStepRunner } from './smoke-deadline.js';

type Methods = Record<string, (...args: any[]) => Promise<any>>;
type ActivityItem = ApplicationQueueItem & { activity?: 'reading' | 'filling' | 'retrying' };
/** Own hidden renderer only. Queue receipts are explicitly synthetic; no webpage is loaded or written. */
export async function smokeSpeedster(window: BrowserWindow, methods: Methods, send: (event: AppEvent) => void, stateDirectory: string) {
  if (!process.argv.includes('--smoke-test') || !process.argv.includes('--smoke-speedster-only') || window.isVisible()
    || process.argv.some(arg => arg.startsWith('--smoke-') && !['--smoke-test', '--smoke-speedster-only'].includes(arg))
    || process.argv.includes('--live-product-check') || process.argv.includes('--site-diagnostic')) throw new Error('速度小助手检查仅允许隐藏的专用隔离 smoke。');
  const runner = new SmokeStepRunner('speedster-hidden-owned-renderer');
  const checks: Array<{ name: string; passed: true }> = [], blockedCommands: string[] = [], screenshots: string[] = [];
  const replaced = new Map<string, Methods[string]>();
  const originalState = methods.getState!, originalBounds = methods.browserBounds!, originalBrowserState = methods.browserState!;
  const windowBounds = window.getBounds(); let ownDebugger = false;
  const browser: BrowserState = { url: 'https://careers.example.invalid/application/speedster-fixture', title: '原创速度助手样本（未加载网页）', loading: false,
    canGoBack: false, canGoForward: false, visible: false, zoomPercent: 100 };
  let queue: ApplicationQueueState = { id: null, status: 'idle', profileVersion: null, items: [], completedCount: 0, totalCount: 0, activeItemId: null,
    sessionOnly: true, capability: BACKGROUND_QUEUE_CAPABILITY };
  const expect = (value: unknown, name: string) => { if (!value) throw new Error(name); checks.push({ name, passed: true }); };
  const replace = (name: string, value: Methods[string]) => { if (!replaced.has(name)) replaced.set(name, methods[name]!); methods[name] = value; };
  const ui = <T = unknown>(name: string, expression: string) => runner.run(name, () => window.webContents.executeJavaScript(expression) as Promise<T>);
  const settle = () => ui('settle-owned-renderer', 'new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');
  const waitFor = async (name: string, expression: string) => { const until = performance.now() + 7000; while (performance.now() < until) { if (await ui<boolean>(name, expression)) return; await delay(25); } throw new Error(name); };
  const click = async (selector: string) => { await ui('click-visible-owned-control', `(() => {const node=document.querySelector(${JSON.stringify(selector)});if(!(node instanceof HTMLElement)||node.hasAttribute('disabled')||!node.checkVisibility())throw new Error('速度助手控件不可用：'+${JSON.stringify(selector)});node.click();})()`); await settle(); };
  const screenshot = async (name: string) => { const data = await runner.run('hidden-owned-renderer-screenshot', () => window.webContents.capturePage()); const path = join(stateDirectory, name); await writeFile(path, data.toPNG(), { mode: 0o600 }); screenshots.push(path); };
  const screenshotCompanion = async (name: string) => {
    // Capture the real renderer rectangle directly; this is not an image edit or
    // a reconstruction. The visible label identifies the strip as an example.
    const rect = await ui<{ x: number; y: number; width: number; height: number }>('read-owned-companion-source-rectangle', `(() => {const node=document.querySelector('[data-testid="agent-companion"]');if(!(node instanceof HTMLElement)||!node.checkVisibility())throw new Error('小助手示例不可见');const r=node.getBoundingClientRect();return {x:Math.floor(r.x),y:Math.floor(r.y),width:Math.ceil(r.width),height:Math.ceil(r.height)};})()`);
    const data = await runner.run('capture-owned-preview-source-rectangle', () => window.webContents.capturePage(rect));
    const path = join(stateDirectory, name); await writeFile(path, data.toPNG(), { mode: 0o600 }); screenshots.push(path);
  };
  const publish = async (item: Partial<ActivityItem>, status: ApplicationQueueState['status'] = 'running', id = 'fictional-speedster-run') => {
    const actual: ActivityItem = { id: 'fictional-speedster-item', jobId: 'fictional-job-id', company: '原创虚构企业', title: '原创速度助手样本',
      status: 'filling', verifiedCount: 0, pendingCount: 0, message: '仅隔离界面协议回执，不表示真实填表。', canReview: false, ...item };
    queue = { ...queue, id, status, totalCount: 1, activeItemId: status === 'running' ? actual.id : null, items: [actual], completedCount: status === 'finished' ? 1 : 0 };
    send({ type: 'application-queue', state: queue }); await settle();
  };
  const motionIs = (motion: string) => `document.querySelector('[data-testid="speedster-track"]')?.getAttribute('data-motion')===${JSON.stringify(motion)}`;
  const animatedIs = (animated: boolean) => `document.querySelector('[data-testid="speedster-track"]')?.getAttribute('data-animated')===${JSON.stringify(String(animated))}`;
  try {
    runner.setStage('empty-isolated-store-with-all-execution-disabled');
    const before = await originalState() as AppState;
    expect(before.profile.version === 0 && before.jobs.length === 0 && before.applications.length === 0, 'startsFromEmptySyntheticBusinessStore');
    await originalBounds({ x: 0, y: 0, width: 900, height: 600 } satisfies BrowserBounds, false);
    replace('browserBounds', async () => undefined); replace('browserState', async () => browser); replace('queueState', async () => queue);
    window.webContents.session.webRequest.onBeforeRequest({ urls: ['http://*/*', 'https://*/*'] }, (_details, callback) => callback({ cancel: true }));
    for (const name of ['browserNavigate', 'browserBack', 'browserForward', 'browserReload', 'browserZoom', 'prepareFill', 'fillApproved', 'prepareCareerFill', 'runCareerFill',
      'configureModel', 'runAgent', 'cancelAgent', 'discoverJobs', 'refreshSource', 'collectPageJobs', 'capturePage', 'importResume', 'importApplyDock', 'importResumeVersion',
      'exportData', 'exportTelemetry', 'saveJob', 'saveProfile', 'saveApplication', 'enqueueApplications', 'startApplicationQueue', 'cancelApplicationQueue', 'reviewQueuedApplication', 'closeQueuedApplication']) {
      if (methods[name]) replace(name, async () => { blockedCommands.push(name); throw new Error('速度助手协议检查禁止网络、模型、网页操作和业务写入。'); });
    }
    if (!window.webContents.debugger.isAttached()) { window.webContents.debugger.attach('1.3'); ownDebugger = true; }
    await runner.run('emulate-owned-renderer-standard-motion', () => window.webContents.debugger.sendCommand('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'no-preference' }] }));
    window.setContentSize(1480, 960);
    await waitFor('first-run-dialog-is-ready', 'document.querySelector(\'[data-testid="onboarding-skip"]\')?.checkVisibility()===true');
    await click('[data-testid="onboarding-skip"]');
    await waitFor('first-run-dialog-is-closed', '!document.querySelector(\'[data-testid="onboarding-dialog"]\')');
    send({ type: 'browser', state: browser }); send({ type: 'navigate', page: 'browser' });
    await waitFor('speedster-track-visible', 'document.querySelector(\'[data-testid="speedster-track"]\')?.checkVisibility()===true');
    expect(await ui<boolean>('idle-sprite-is-static', `${motionIs('idle')}&&${animatedIs(false)}`), 'idleDoesNotPretendToRunOrFill');
    expect(await ui<boolean>('track-stays-above-native-holder', `(() => {const track=document.querySelector('[data-testid="speedster-track"]'),holder=document.querySelector('.browser-placeholder');return track&&holder&&track.getBoundingClientRect().bottom<=holder.getBoundingClientRect().top+1;})()`), 'pixelRunnerUsesLayoutAboveNativeWebpageRatherThanCoveringIt');
    await ui('remember-stable-holder-and-focus', `(() => {const r=document.querySelector('.browser-placeholder').getBoundingClientRect();window.__speedsterHolderBefore=[r.x,r.y,r.width,r.height];window.__speedsterFocusBefore=document.activeElement;})()`);

    runner.setStage('explicit-example-never-dispatches-an-application');
    await click('[data-testid="speedster-preview"]');
    await waitFor('example-label-visible', 'document.querySelector(\'[data-testid="speedster-track"]\')?.getAttribute("data-demo")==="true"');
    expect(await ui<boolean>('example-honest-label', 'document.querySelector(\'[data-testid="speedster-track"]\')?.textContent.includes("效果预览")===true&&document.querySelector(\'[data-testid="speedster-track"]\')?.textContent.includes("不填写网页")===true'), 'previewIsExplicitlyMarkedAsExampleRatherThanRealWork');
    expect(blockedCommands.length === 0, 'previewDoesNotCallAWriteExecutionNetworkOrModelMethod');
    await delay(220);
    await screenshotCompanion('speedster-preview-strip.png');
    await click('[data-testid="speedster-preview-stop"]');
    await waitFor('example-stopped', 'document.querySelector(\'[data-testid="speedster-track"]\')?.getAttribute("data-demo")==="false"');

    runner.setStage('host-shaped-reading-fill-retry-and-pending-receipts');
    await publish({ status: 'loading', activity: 'reading' });
    await waitFor('reading-pose', `${motionIs('reading')}&&${animatedIs(true)}`);
    expect(await ui<boolean>('reading-example-disabled', 'document.querySelector(\'[data-testid="speedster-preview"]\')?.disabled===true'), 'liveWorkDisablesTheExampleControl');
    await publish({ activity: 'filling', verifiedCount: 0 });
    await waitFor('filling-pose', `${motionIs('running')}&&${animatedIs(true)}`);
    await ui('sample-actual-running-position', `(() => {const runner=document.querySelector('[data-testid="speedster-runner"]'),runway=document.querySelector('.speedster-runway');if(!(runner instanceof HTMLElement)||!(runway instanceof HTMLElement))throw new Error('速度跑道缺失');const r=runner.getBoundingClientRect(),track=runway.getBoundingClientRect();window.__speedsterMotionBefore={x:r.x,left:track.left,right:track.right};})()`);
    await delay(100);
    expect(await ui<boolean>('actual-runner-movement-inside-owned-track', `(() => {const runner=document.querySelector('[data-testid="speedster-runner"]');if(!(runner instanceof HTMLElement))return false;const r=runner.getBoundingClientRect(),before=window.__speedsterMotionBefore;return ${motionIs('running')}&&Math.abs(r.x-before.x)>1&&[before.x,r.x].every(x=>x>=before.left-60&&x<=before.right+60)&&getComputedStyle(runner).animationName!=='none';})()`), 'actualRunnerPositionChangesDuringFillingAndStaysNearItsOwnRunway');
    await ui('remember-focus-after-explicit-preview-buttons', 'window.__speedsterFocusBefore=document.activeElement');
    await publish({ activity: 'filling', verifiedCount: 3 });
    await waitFor('verified-receipt-sprint', motionIs('sprint'));
    expect(await ui<boolean>('honest-verified-count', 'document.querySelector(\'[data-testid="companion-progress"]\')?.textContent.includes("已核实 3 项")===true&&!document.querySelector(\'[data-testid="companion-progress"] progress\')'), 'verifiedReceiptHasRealCountWithoutAnInventedFieldPercentage');
    await publish({ activity: 'retrying', verifiedCount: 3, message: '普通文字没有重试关键词，结构化activity仍应折返。' });
    await waitFor('structured-retry-turn', motionIs('retry'));
    expect(await ui<boolean>('host-updates-preserve-focus', 'document.activeElement===window.__speedsterFocusBefore'), 'receiptAnimationsNeverChangeTheFocusedElement');
    await publish({ status: 'waiting-user', verifiedCount: 3, pendingCount: 2, canReview: true }, 'finished');
    await waitFor('pending-stops-running', `${motionIs('waiting')}&&${animatedIs(false)}`);
    expect(await ui<boolean>('pending-guidance-readable', 'document.querySelector(\'[data-testid="companion-progress"]\')?.textContent.includes("待你处理 2 项")===true'), 'needsInformationStopsTheRunnerAndKeepsTheActualPendingCount');
    await publish({ status: 'waiting-user', attention: 'login', verifiedCount: 3, pendingCount: 1, canReview: true }, 'finished');
    await waitFor('login-stops-running', `${motionIs('waiting')}&&${animatedIs(false)}&&document.querySelector('[data-testid="agent-companion"]')?.getAttribute('data-status')==='waiting-login'`);
    expect(await ui<boolean>('login-has-attention-pose', 'document.querySelector(\'[data-testid="speedster-runner"] [data-speedster-state="attention"]\')!==null'), 'loginAttentionStopsTheRunnerRatherThanClaimingContinuedFilling');

    runner.setStage('accessibility-and-user-motion-preference');
    await publish({ activity: 'filling', verifiedCount: 3 });
    await runner.run('emulate-owned-renderer-reduced-motion', () => window.webContents.debugger.sendCommand('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] }));
    await waitFor('system-reduced-motion-stops-track', animatedIs(false));
    expect(await ui<boolean>('computed-reduced-motion-static', 'getComputedStyle(document.querySelector(\'[data-testid="speedster-runner"]\')).animationName==="none"'), 'systemReducedMotionStopsActualRunnerAnimation');
    await runner.run('restore-owned-renderer-standard-motion', () => window.webContents.debugger.sendCommand('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'no-preference' }] }));
    await waitFor('normal-motion-resumes-real-work-only', animatedIs(true));
    await click('[data-testid="speedster-enabled"]');
    await waitFor('explicit-preference-stops-track', animatedIs(false));
    expect(await ui<boolean>('disable-keeps-count-and-state', 'document.querySelector(\'[data-testid="speedster-enabled"]\')?.checked===false&&document.querySelector(\'[data-testid="companion-progress"]\')?.textContent.includes("已核实 3 项")===true'), 'disablingMotionDoesNotHideOrChangeRealProgress');
    await click('[data-testid="speedster-enabled"]');
    await publish({ status: 'ready-for-review', verifiedCount: 3, canReview: true }, 'finished');
    await waitFor('completed-is-static', `${motionIs('completed')}&&${animatedIs(false)}`);
    expect(await ui<boolean>('holder-not-moved-by-state-or-preview', `(() => {const r=document.querySelector('.browser-placeholder').getBoundingClientRect();return [r.x,r.y,r.width,r.height].every((value,index)=>Math.abs(value-window.__speedsterHolderBefore[index])<0.5);})()`), 'runningRetryPendingPreviewAndPreferencesKeepNativeHolderBoundsStable');
    expect(JSON.stringify(await originalState()) === JSON.stringify(before), 'allDisplayEffectsLeaveProfileJobsApplicationsAndBusinessStateUnchanged');
    expect(!window.isVisible() && (await originalBrowserState() as BrowserState).visible === false, 'ordinaryWindowAndNativeWebpageStayHidden');
    expect(blockedCommands.length === 0, 'noExecutionWriteNetworkModelOrNativeInputMethodWasAttempted');
    await screenshot('speedster-owned-fixture.png');
    const report = { ok: true, assertionCount: checks.length, checks, screenshots, blockedCommands, queueReceiptsAreSynthetic: true,
      actualQueueExecution: false, normalPrivateStoreRead: false, nativeInputs: 0, enterpriseInputs: 0, realModelCalls: 0, actualNativeWebViewHidden: true,
      screenshotsContainOwnedRendererOnly: true, harness: runner.snapshot() };
    await writeFile(join(stateDirectory, 'smoke-speedster-report.json'), JSON.stringify(report, null, 2), { mode: 0o600 }); return report;
  } catch (error) {
    try { await screenshot('speedster-owned-fixture-failure.png'); } catch { /* Keep the first failure. */ }
    await writeFile(join(stateDirectory, 'smoke-speedster-failure.json'), JSON.stringify({ ok: false, checks, assertionCount: checks.length, screenshots, blockedCommands,
      queueReceiptsAreSynthetic: true, nativeInputs: 0, enterpriseInputs: 0, realModelCalls: 0, message: error instanceof Error ? error.message : '速度助手隔离检查失败', harness: runner.snapshot() }, null, 2), { mode: 0o600 }); throw error;
  } finally {
    for (const [name, method] of replaced) methods[name] = method;
    window.webContents.session.webRequest.onBeforeRequest(null);
    if (!window.webContents.isDestroyed() && window.webContents.debugger.isAttached()) {
      try { await window.webContents.debugger.sendCommand('Emulation.setEmulatedMedia', { features: [] }); } catch { /* Own renderer may have closed. */ }
      if (ownDebugger) window.webContents.debugger.detach();
    }
    if (!window.isDestroyed()) window.setBounds(windowBounds);
  }
}
