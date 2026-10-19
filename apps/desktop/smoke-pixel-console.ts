import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import type { BrowserWindow } from 'electron';
import type { AppEvent, AppState, Application, BrowserBounds, BrowserState } from '../../packages/shared/src/contracts.js';
import { SmokeStepRunner } from './smoke-deadline.js';
import { MISSION_LEDGER_KEY } from '../../packages/ui/src/mission-progress.js';

type Methods = Record<string, (...args: any[]) => Promise<any>>;
export function contrastRatio(foreground: string, background: string): number | undefined {
  const fg = foreground.match(/[\d.]+/gu)?.map(Number), bg = background.match(/[\d.]+/gu)?.map(Number);
  if (!fg || !bg || fg.length < 3 || bg.length < 3) return undefined;
  const luminance = (channels: number[]) => channels.slice(0, 3).reduce((sum, channel, index) => {
    const srgb = channel / 255;
    return sum + (srgb <= 0.04045 ? srgb / 12.92 : ((srgb + 0.055) / 1.055) ** 2.4) * [0.2126, 0.7152, 0.0722][index]!;
  }, 0);
  const alpha = fg[3] ?? 1;
  const visibleText = fg.slice(0, 3).map((channel, index) => channel * alpha + bg[index]! * (1 - alpha));
  const text = luminance(visibleText), surface = luminance(bg);
  return (Math.max(text, surface) + 0.05) / (Math.min(text, surface) + 0.05);
}

/** Hidden own-renderer and actual SQLite/IPC checks; never sends native input or submits an enterprise application. */
export async function smokePixelConsole(window: BrowserWindow, methods: Methods,
  send: (event: AppEvent) => void, stateDirectory: string) {
  if (!process.argv.includes('--smoke-test') || !process.argv.includes('--smoke-pixel-only')
    || process.argv.some(value => value.startsWith('--smoke-') && !['--smoke-test', '--smoke-pixel-only'].includes(value))
    || process.argv.includes('--live-product-check') || process.argv.includes('--site-diagnostic') || window.isVisible()) {
    throw new Error('像素界面验收只允许隐藏的专用隔离 smoke。');
  }
  for (const name of ['getState', 'browserState', 'browserBounds', 'saveApplication', 'loadDemo']) {
    if (typeof methods[name] !== 'function') throw new Error(`像素界面验收缺少 ${name}`);
  }
  const runner = new SmokeStepRunner('pixel-console-hidden-owned-renderer');
  const checks: Array<{ name: string; passed: true }> = [], screenshots: string[] = [], blockedCommands: string[] = [];
  const layouts: unknown[] = [];
  const particleEvidence: unknown[] = [];
  const saveReceipts: Array<{ id: string; status: string; historyLength: number }> = [];
  const blockedHTTP: Array<{ method: string; origin: string }> = [];
  let ownsDebugger = false; let observerScript: string | undefined;
  const beforeBounds = window.getBounds();
  const originalBounds = methods.browserBounds!, originalState = methods.getState!, originalBrowser = methods.browserState!;
  const replaced = new Map<string, Methods[string]>();
  const replace = (name: string, value: Methods[string]) => { if (!replaced.has(name)) replaced.set(name, methods[name]!); methods[name] = value; };
  const expect = (condition: unknown, name: string) => { if (!condition) throw new Error(name); checks.push({ name, passed: true }); };
  const ui = <T = unknown>(name: string, expression: string) => runner.run(name, () => window.webContents.executeJavaScript(expression) as Promise<T>);
  const settle = () => ui('owned-renderer-settle', 'new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');
  const waitFor = async (name: string, expression: string, timeoutMs = 7_000) => {
    const until = performance.now() + timeoutMs;
    while (performance.now() < until) { if (await ui<boolean>(name, expression)) return; await delay(25); }
    throw new Error(name);
  };
  const waitHost = async (name: string, predicate: () => Promise<boolean>) => {
    const until = performance.now() + 7_000;
    while (performance.now() < until) { if (await runner.run(name, predicate)) return; await delay(25); }
    throw new Error(name);
  };
  const invoke = <T = unknown>(name: string, args: unknown[] = []) => ui<T>('actual-isolated-pixel-ipc', `window.offer[${JSON.stringify(name)}](...${JSON.stringify(args)})`);
  const click = async (selector: string) => {
    await ui('owned-renderer-control-click', `(() => {
      const item=document.querySelector(${JSON.stringify(selector)});
      if(!(item instanceof HTMLElement)||item.hasAttribute('disabled')||!item.checkVisibility())throw new Error('像素界面控件不可用：'+${JSON.stringify(selector)});
      item.scrollIntoView({block:'nearest'});item.click();
    })()`); await settle();
  };
  const screenshot = async (name: string) => {
    await ui('close-owned-toast-before-capture', 'document.querySelector(".toast button")?.click()');
    const image = await runner.run('hidden-owned-renderer-capture', () => window.webContents.capturePage(), 8_000);
    const path = join(stateDirectory, name); await writeFile(path, image.toPNG(), { mode: 0o600 }); screenshots.push(path);
  };
  const nav = async (page: 'dashboard' | 'jobs' | 'applications' | 'profile' | 'workspace') => {
    await click(`[data-testid="${page === 'workspace' ? 'apply-nav' : `nav-${page}`}"]`);
    const selector = page === 'dashboard' ? '[data-testid="mission-home"]' : page === 'jobs' ? '.filters' : page === 'applications' ? '.pill-switch' : page === 'profile' ? '[data-testid="application-profile-guide"]' : '[data-testid="application-space"]';
    await waitFor(`${page}-visible`, `document.querySelector(${JSON.stringify(selector)})?.checkVisibility()===true`);
  };
  const control = async (label: string, value: string) => {
    await ui('owned-application-dialog-input', `(() => {
      const modal=document.querySelector('[role="dialog"]');
      const field=[...(modal?.querySelectorAll('.field')??[])].find(node=>node.querySelector('.field-label')?.textContent.replace(/\\s*\\*/g,'').trim()===${JSON.stringify(label)});
      const input=field?.querySelector('input,select,textarea');
      if(!input||input.disabled)throw new Error('申请字段缺失：'+${JSON.stringify(label)});
      const proto=input instanceof HTMLSelectElement?HTMLSelectElement.prototype:input instanceof HTMLTextAreaElement?HTMLTextAreaElement.prototype:HTMLInputElement.prototype;
      Object.getOwnPropertyDescriptor(proto,'value').set.call(input,${JSON.stringify(value)});
      input.dispatchEvent(new Event(input instanceof HTMLSelectElement?'change':'input',{bubbles:true}));
    })()`); await settle();
  };
  const modal = async () => waitFor('application-dialog-open', 'document.querySelector(\'[role="dialog"] .field select\')!==null');
  const saveDialog = async () => {
    await click('[role="dialog"] .modal-footer .button-primary');
    await waitFor('application-dialog-saved-and-closed', '!document.querySelector("[role=dialog]")');
  };
  const openRecord = async (id: string) => {
    await nav('applications');
    await waitFor('application-card-present', `document.querySelector('[data-application-id=${JSON.stringify(id)}]')?.checkVisibility()===true`);
    await click(`[data-application-id=${JSON.stringify(id)}]`); await modal();
  };
  const fixtureCompany = '像素验收虚构企业';
  const createRecord = async (title: string, status = 'saved') => {
    await nav('applications');
    await ui('new-application-button', `(() => {const button=[...document.querySelectorAll('.section-heading-actions button')].find(button=>button.textContent.trim()==='新增申请');if(!(button instanceof HTMLButtonElement)||button.disabled)throw new Error('新增申请入口缺失');button.click();})()`);
    await modal(); await control('公司', fixtureCompany); await control('岗位', title);
    await control('申请网址（可选）', `https://example.org/pixel-console/${encodeURIComponent(title)}`);
    await control('当前状态', status); await saveDialog();
    let record: Application | undefined;
    await waitHost('actual-application-record-created', async () => { record = ((await originalState()) as AppState).applications.find(item => item.company === fixtureCompany && item.title === title); return !!record && record.status === status; });
    return record!;
  };
  const countAchievements = () => ui<number>('achievement-observer-count', 'window.__pixelConsoleProbe?.achievements.length??0');
  const observation = `(() => {
    if(window.__pixelConsoleProbe)return;
    const probe={achievements:[],confettiIds:[]};window.__pixelConsoleProbe=probe;
    const observe=()=>{const node=document.querySelector('[data-testid="mission-achievement"]');const id=node?.getAttribute('data-achievement-id');
      if(id&&!probe.achievements.some(item=>item.id===id))probe.achievements.push({id,motion:node.getAttribute('data-motion'),text:node.textContent});
      if(id&&document.querySelector('[data-testid="mission-confetti"]')&&!probe.confettiIds.includes(id))probe.confettiIds.push(id);};
    const observer=new MutationObserver(observe);observer.observe(document,{subtree:true,childList:true,attributes:true,attributeFilter:['data-achievement-id']});observe();
  })()`;
  try {
    runner.setStage('guard-isolated-hidden-shell');
    const initial = await originalState() as AppState;
    expect(initial.profile.version === 0 && initial.jobs.length === 0 && initial.applications.length === 0, 'pixelModeStartsInFreshEmptyBusinessStore');
    window.webContents.session.webRequest.onBeforeRequest({ urls: ['http://*/*', 'https://*/*'] }, (details, callback) => {
      blockedHTTP.push({ method: details.method, origin: new URL(details.url).origin }); callback({ cancel: true });
    });
    await originalBounds({ x: 0, y: 0, width: 800, height: 600 }, false);
    replace('browserBounds', async (_bounds: BrowserBounds, _visible: boolean) => undefined);
    for (const name of ['browserNavigate', 'browserBack', 'browserForward', 'browserReload', 'openTestForm', 'prepareFill', 'fillApproved',
      'prepareCareerFill', 'runCareerFill', 'configureModel', 'runAgent', 'cancelAgent', 'discoverJobs', 'refreshSource', 'collectPageJobs',
      'capturePage', 'importResume', 'importApplyDock', 'importApplicationFacts', 'applyApplicationFactsImport', 'exportApplicationFactsTemplate',
      'exportData', 'exportTelemetry', 'importResumeVersion', 'exportResumeVersion', 'beginMeasurement', 'finishMeasurement', 'reviewMeasurement']) {
      if (methods[name]) replace(name, async () => { blockedCommands.push(name); throw new Error('像素界面检查禁止网页输入、联网、付费模型和文件选择。'); });
    }
    if (methods.cancelCareerFill) replace('cancelCareerFill', async () => undefined);
    const save = methods.saveApplication!;
    replace('saveApplication', async input => {
      const next = await save(input) as AppState;
      const record = input.id ? next.applications.find(item => item.id === input.id) : next.applications.find(item => item.company === input.company.trim() && item.title === input.title.trim() && item.url === input.url);
      if (record) saveReceipts.push({ id: record.id, status: record.status, historyLength: record.history.length });
      return next;
    });
    if (!window.webContents.debugger.isAttached()) { window.webContents.debugger.attach('1.3'); ownsDebugger = true; }
    await runner.run('emulate-normal-motion-without-changing-os-preferences', () => window.webContents.debugger.sendCommand('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'no-preference' }] }));
    await runner.run('focus-emulation-only-for-hidden-owned-renderer', () => window.webContents.debugger.sendCommand('Emulation.setFocusEmulationEnabled', { enabled: true }));
    observerScript = (await runner.run('install-reload-safe-owned-dom-observer', () => window.webContents.debugger.sendCommand('Page.addScriptToEvaluateOnNewDocument', { source: observation })) as { identifier: string }).identifier;
    await ui('observe-achievement-dom-not-internal-state', observation);
    await waitFor('default-pixel-home-is-visible', 'document.querySelector(\'[data-testid="mission-home"]\')?.checkVisibility()===true');
    expect(await ui<boolean>('default-home-navigation', 'document.querySelector(\'[data-testid="nav-dashboard"]\')?.getAttribute("aria-current")==="page"'), 'defaultRouteIsMissionDashboard');
    window.setContentSize(1480, 960); await settle();
    await screenshot('pixel-home-1480.png');
    window.setContentSize(1100, 760); await settle();
    await screenshot('pixel-home-1100.png');
    expect(await countAchievements() === 0 && await ui<boolean>('no-startup-confetti', '!document.querySelector(\'[data-testid="mission-confetti"]\')'), 'startupStateDoesNotCelebrate');

    runner.setStage('independent-celebration-preview-without-business-receipt');
    const beforePreviewState = JSON.stringify(await originalState());
    const beforePreviewLedger = await ui<string | null>('read-preview-baseline-ledger', `localStorage.getItem(${JSON.stringify(MISSION_LEDGER_KEY)})`);
    const beforePreviewCount = await ui<string>('read-preview-baseline-weekly-count', 'document.querySelector(\'[data-testid="mission-completed-count"]\').textContent');
    await click('[data-testid="mission-preview"]');
    await waitFor('preview-sample-is-visible', 'document.querySelector(\'[data-testid="mission-preview-layer"]\')?.getAttribute("data-motion")==="confetti"&&document.querySelectorAll(\'[data-testid="mission-preview-confetti"] .mission-pixel\').length===24');
    expect(await ui<boolean>('preview-explicitly-labelled-as-sample', `(() => {
      const note=document.querySelector('[data-testid="mission-preview-note"]');return note?.textContent.includes('效果预览')
        &&note.textContent.includes('示例')&&note.textContent.includes('不新增申请')
        &&!document.querySelector('[data-testid="mission-achievement"]')&&!document.querySelector('[data-testid="mission-confetti"]');
    })()`), 'previewShowsSeparatelyLabelledSampleRatherThanAnActualSavedAchievement');
    expect(JSON.stringify(await originalState()) === beforePreviewState && await countAchievements() === 0
      && await ui<string | null>('preview-ledger-after-open', `localStorage.getItem(${JSON.stringify(MISSION_LEDGER_KEY)})`) === beforePreviewLedger
      && await ui<string>('preview-weekly-count-after-open', 'document.querySelector(\'[data-testid="mission-completed-count"]\').textContent') === beforePreviewCount,
    'previewDoesNotChangeBusinessStateWeeklyCountOrRewardDeduplicationLedger');
    await click('[data-testid="mission-preview-close"]');
    await waitFor('preview-close-button-removes-layer', '!document.querySelector(\'[data-testid="mission-preview-layer"]\')');
    expect(await ui<boolean>('preview-can-be-closed-independently', '!document.querySelector(\'[data-testid="mission-preview-layer"]\')&&Boolean(document.querySelector(\'[data-testid="mission-preview"]\'))'), 'previewCloseButtonStopsOnlyTheVisualSample');
    await runner.run('emulate-reduced-motion-for-preview-only', () => window.webContents.debugger.sendCommand('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] }));
    await waitFor('preview-reduced-motion-observed', 'matchMedia("(prefers-reduced-motion: reduce)").matches'); await settle();
    await click('[data-testid="mission-preview"]');
    await waitFor('preview-reduced-motion-static-layer', 'document.querySelector(\'[data-testid="mission-preview-layer"]\')?.getAttribute("data-motion")==="static"');
    expect(await ui<boolean>('preview-reduced-motion-has-no-particles', '!document.querySelector(\'[data-testid="mission-preview-confetti"]\')&&!document.querySelector(\'[data-testid="mission-confetti"]\')'), 'previewRespectsReducedMotionWithStaticFeedbackWithoutParticles');
    await runner.run('owned-renderer-escape-closes-preview', () => window.webContents.debugger.sendCommand('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 }));
    await runner.run('owned-renderer-escape-release-after-preview', () => window.webContents.debugger.sendCommand('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 }));
    await waitFor('preview-escape-removed-layer', '!document.querySelector(\'[data-testid="mission-preview-layer"]\')');
    expect(JSON.stringify(await originalState()) === beforePreviewState && await countAchievements() === 0
      && await ui<string | null>('preview-ledger-after-close', `localStorage.getItem(${JSON.stringify(MISSION_LEDGER_KEY)})`) === beforePreviewLedger,
    'escapeClosesPreviewWithoutCreatingApplicationOrRewardReceipts');
    await runner.run('restore-normal-motion-before-original-achievement-checks', () => window.webContents.debugger.sendCommand('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'no-preference' }] }));
    await waitFor('normal-motion-restored-after-preview', '!matchMedia("(prefers-reduced-motion: reduce)").matches'); await settle();

    runner.setStage('explicit-application-dialog-commit-and-single-celebration');
    window.setContentSize(1480, 960); await settle();
    const first = await createRecord('虚构岗位 A：手动确认');
    expect(await countAchievements() === 0, 'savingPendingApplicationDoesNotCelebrate');
    await openRecord(first.id); await control('当前状态', 'applied'); await saveDialog();
    await waitFor('explicit-manual-save-shows-achievement', 'window.__pixelConsoleProbe.achievements.length===1&&Boolean(document.querySelector(\'[data-testid="mission-achievement"]\'))');
    await waitFor('normal-motion-has-pixel-confetti', 'document.querySelector(\'[data-testid="mission-confetti"]\')!==null');
    const actualFirst = (await originalState() as AppState).applications.find(item => item.id === first.id)!;
    expect(actualFirst.status === 'applied' && actualFirst.history.length === 2 && actualFirst.history[0]!.status === 'saved'
      && actualFirst.history[1]!.status === 'applied', 'realApplicationDialogPersistsSavedToAppliedHistoryThroughHostIpc');
    expect(await ui<boolean>('celebration-transparent-to-input', 'getComputedStyle(document.querySelector(".mission-celebration")).pointerEvents==="none"'), 'confettiNeverBlocksApplicationInput');
    expect(await ui<boolean>('celebration-reception-boundary', 'document.querySelector(\'[data-testid="mission-achievement"]\').textContent.includes("企业接收")&&document.querySelector(\'[data-testid="mission-achievement"]\').textContent.includes("官网为准")'), 'celebrationDoesNotClaimEnterpriseReceipt');
    await waitFor('confetti-reaches-actually-visible-animation-frame', '[...document.querySelectorAll(\'[data-testid="mission-confetti"] .mission-pixel\')].some(node=>{const style=getComputedStyle(node);return Number(style.opacity)>0.2&&style.animationName!=="none"})', 1_400);
    particleEvidence.push(await ui('read-current-visible-particle-frame', `(() => {
      const styles=[...document.querySelectorAll('[data-testid="mission-confetti"] .mission-pixel')].map(node=>getComputedStyle(node));
      return {activeParticleCount:styles.filter(style=>Number(style.opacity)>0.2&&style.animationName!=='none').length,animationNames:[...new Set(styles.map(style=>style.animationName))],motion:document.querySelector('[data-testid="mission-achievement"]')?.getAttribute('data-motion')};
    })()`));
    await screenshot('pixel-manual-recorded-confetti.png');
    await openRecord(first.id); await control('备注与下一步', '虚构备注更新，不是另一次投递。'); await saveDialog();
    expect(await countAchievements() === 1, 'editingNotesOnAppliedRecordDoesNotCelebrateAgain');
    const repeated = await originalState() as AppState;
    send({ type: 'state', state: structuredClone(repeated) }); send({ type: 'state', state: structuredClone(repeated) }); await settle();
    expect(await countAchievements() === 1, 'duplicateStateBroadcastsDoNotReplayAchievement');

    runner.setStage('actual-ipc-import-and-demo-never-authorize-celebration');
    await invoke('saveApplication', [{ company: '虚构外部历史记录', title: '单条导入的已投递记录', url: 'https://example.org/pixel-console/imported', status: 'applied', deadline: null, notes: '隔离命名IPC导入，非ApplicationDialog手动确认。' }]);
    await settle();
    expect(await countAchievements() === 1, 'singleFreshImportedAppliedRecordDoesNotCelebrateFromStateAlone');
    await invoke('loadDemo');
    const demoRecord = ((await originalState()) as AppState).applications.find(item => item.demo)!;
    expect(!!demoRecord, 'actualDemoLoaderCreatesMarkedRecords');
    await openRecord(demoRecord.id); await control('当前状态', 'applied'); await saveDialog();
    expect(await countAchievements() === 1, 'explicitDemoStatusSaveNeverAwardsRealAchievement');

    runner.setStage('effect-settings-weekly-goal-and-reduced-motion');
    await nav('dashboard');
    await ui('change-owned-weekly-goal', `(() => {const input=document.querySelector('[data-testid="mission-weekly-goal"]');if(!(input instanceof HTMLInputElement))throw new Error('每周目标输入缺失');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,'3');input.dispatchEvent(new Event('input',{bubbles:true}));})()`); await settle();
    await click('.mission-preferences button');
    expect(await ui<boolean>('goal-applied-to-header-and-card', '[...document.querySelectorAll(\'[data-testid="mission-weekly-progress"]\')].length===2&&[...document.querySelectorAll(\'[data-testid="mission-weekly-progress"]\')].every(bar=>bar.getAttribute("aria-valuemax")==="3")'), 'explicitWeeklyGoalUpdatesBothAccessibleProgressBars');
    expect(await ui<boolean>('normal-effects-enabled', 'document.querySelector(\'[data-testid="mission-effects-toggle"]\').checked===true'), 'effectsBeginEnabledInFreshIsolatedPreferences');
    await click('[data-testid="mission-effects-toggle"]');
    await waitFor('disabled-effects-hide-feedback', '!document.querySelector(\'[data-testid="mission-achievement"]\')&&!document.querySelector(\'[data-testid="mission-confetti"]\')');
    const beforeDisabled = await ui<number>('weekly-count-before-disabled-award', 'Number(document.querySelector(\'[data-testid="mission-completed-count"]\').textContent)');
    await createRecord('虚构岗位 B：关闭效果', 'applied');
    expect(await countAchievements() === 1, 'disablingEffectsSuppressesCelebrationWithoutSuppressingSave');
    expect(await ui<number>('weekly-count-after-disabled-save', 'Number(document.querySelector(\'[data-testid="mission-completed-count"]\').textContent)') === beforeDisabled + 1, 'disabledEffectsStillUpdateRealRecordedCount');
    await nav('dashboard'); await click('[data-testid="mission-effects-toggle"]');
    expect(await countAchievements() === 1, 'reenablingEffectsDoesNotReplayPreviouslyRecordedAchievement');
    await runner.run('emulate-reduced-motion-on-owned-renderer', () => window.webContents.debugger.sendCommand('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] }));
    await waitFor('reduced-motion-media-observed', 'matchMedia("(prefers-reduced-motion: reduce)").matches'); await settle();
    await createRecord('虚构岗位 C：减少动态', 'applied');
    await waitFor('reduced-motion-static-achievement', 'window.__pixelConsoleProbe.achievements.length===2&&document.querySelector(\'[data-testid="mission-achievement"]\')?.getAttribute("data-motion")==="static"');
    expect(await ui<boolean>('no-reduced-motion-particles', '!document.querySelector(\'[data-testid="mission-confetti"]\')'), 'reducedMotionUsesStaticStatusWithoutConfettiLayer');
    expect(await ui<number>('only-first-normal-award-had-particles', 'window.__pixelConsoleProbe.confettiIds.length') === 1, 'onlyNormalMotionAwardMountedPixelParticles');
    await screenshot('pixel-reduced-motion-static-status.png');

    runner.setStage('real-renderer-keyboard-handler-and-modal-focus-return');
    await nav('applications');
    const cardSelector = `[data-application-id=${JSON.stringify(first.id)}]`;
    await ui('owned-application-card-keyboard-activation', `(() => {const card=document.querySelector(${JSON.stringify(cardSelector)});if(!(card instanceof HTMLElement)||!card.checkVisibility())throw new Error('申请键盘目标缺失');card.scrollIntoView({block:'center'});card.focus();const event=new KeyboardEvent('keydown',{key:' ',bubbles:true,cancelable:true});card.dispatchEvent(event);window.__pixelCardKeyPrevented=event.defaultPrevented;})()`);
    await modal(); expect(await ui<boolean>('keyboard-handler-prevents-space-default', 'window.__pixelCardKeyPrevented===true'), 'ownedCardSpaceHandlerPreventsDefault');
    await ui('owned-modal-escape-handler', 'document.activeElement.dispatchEvent(new KeyboardEvent("keydown",{key:"Escape",bubbles:true,cancelable:true}))');
    await waitFor('owned-modal-focus-restored', `!document.querySelector('[role="dialog"]')&&document.activeElement?.getAttribute('data-application-id')===${JSON.stringify(first.id)}`);
    expect(true, 'ownedDomKeyboardHandlerOpensModalAndEscapeRestoresFocus');

    runner.setStage('five-page-theme-and-contained-two-size-layouts');
    for (const [width, height] of [[1480, 960], [1100, 760]]) {
      window.setContentSize(width!, height!); await settle();
      for (const page of ['dashboard', 'jobs', 'applications', 'profile', 'workspace'] as const) {
        await nav(page);
        await ui('observe-owned-renderer-tab-modality', 'window.__pixelTrustedTab=undefined;document.addEventListener("keydown",event=>{window.__pixelTrustedTab={key:event.key,trusted:event.isTrusted}},{once:true})');
        await runner.run('cdp-tab-in-owned-renderer-only', () => window.webContents.debugger.sendCommand('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 }));
        await runner.run('cdp-tab-release-in-owned-renderer-only', () => window.webContents.debugger.sendCommand('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 }));
        await settle();
        expect(await ui<boolean>('trusted-owned-tab-was-delivered', 'window.__pixelTrustedTab?.key==="Tab"&&window.__pixelTrustedTab?.trusted===true'), `${page}-${width}-ownedRendererReceivesCdpTrustedTabWithoutOsInput`);
        const snapshot = await ui<{ page: string; width: number; height: number; token: string; background: string; color: string; globalOverflow: boolean; mainOverflow: boolean; pageOverflow: boolean; workspaceOverflow: boolean; focusVisible: boolean; focusable: boolean }>('actual-computed-pixel-theme-and-layout', `(() => {
          const root=document.querySelector('.workbench'),main=document.querySelector('.workspace'),nav=document.querySelector('[data-testid="${page === 'workspace' ? 'apply-nav' : `nav-${page}`}"');
          nav.focus();const style=getComputedStyle(root),navStyle=getComputedStyle(nav),mainStyle=getComputedStyle(main);
          let surface=main,background=mainStyle.backgroundColor;while(surface&&getComputedStyle(surface).backgroundColor==='rgba(0, 0, 0, 0)')surface=surface.parentElement;
          if(surface)background=getComputedStyle(surface).backgroundColor;
          const scroll=[...main.querySelectorAll(':scope > .page-scroll')].find(node=>node.checkVisibility());
          const space=main.querySelector('[data-testid="application-space"]');const r=main.getBoundingClientRect();
          return {page:${JSON.stringify(page)},width:innerWidth,height:innerHeight,token:style.getPropertyValue('--pixel-theme').trim(),background,color:mainStyle.color,
            globalOverflow:document.documentElement.scrollWidth>innerWidth+2,mainOverflow:r.right>innerWidth+2||r.left<0,
            pageOverflow:!!scroll&&scroll.scrollWidth>scroll.clientWidth+2,workspaceOverflow:!!space&&space.scrollWidth>space.clientWidth+2,
            focusVisible:navStyle.outlineStyle!=='none'&&parseFloat(navStyle.outlineWidth)>=2,focusable:document.activeElement===nav&&nav.tabIndex>=0&&nav.checkVisibility()};
        })()`);
        const contrast = contrastRatio(snapshot.color, snapshot.background);
        layouts.push({ ...snapshot, workspaceTextContrast: contrast ?? null });
        expect(snapshot.token === '1', `${page}-${width}-usesComputedPixelTheme`);
        const rgb = snapshot.background.match(/[\d.]+/gu)?.map(Number) ?? [];
        expect(rgb.length >= 3 && rgb.slice(0, 3).every(channel => channel < 90), `${page}-${width}-hasActualDarkWorkspaceSurface`);
        expect(contrast !== undefined && contrast >= 4.5, `${page}-${width}-workspaceTextMeetsNormalTextContrast`);
        expect(!snapshot.globalOverflow && !snapshot.mainOverflow && !snapshot.pageOverflow && !snapshot.workspaceOverflow, `${page}-${width}-containsMainLayoutAllowingInnerKanbanScroll`);
        expect(snapshot.focusable && snapshot.focusVisible, `${page}-${width}-navigationCanReceiveVisibleKeyboardFocus`);
        await screenshot(`pixel-${page}-${width}.png`);
      }
    }
    runner.setStage('reload-is-baseline-not-a-new-completion');
    await runner.run('reload-owned-application-with-existing-records', async () => { window.webContents.reload(); });
    await waitFor('reloaded-dashboard-visible', 'document.querySelector(\'[data-testid="mission-home"]\')?.checkVisibility()===true'); await settle();
    expect(await countAchievements() === 0 && await ui<boolean>('reload-has-no-replayed-effect', '!document.querySelector(\'[data-testid="mission-achievement"]\')&&!document.querySelector(\'[data-testid="mission-confetti"]\')'), 'reloadExistingHistoryOnlyBuildsBaselineAndNeverReplaysConfetti');
    expect(saveReceipts.some(item => item.id === first.id && item.status === 'applied' && item.historyLength === 2), 'harnessObservedActualCommittedManualSaveReceipt');
    expect(!window.isVisible() && !(await originalBrowser() as BrowserState).visible, 'pixelWindowAndNativeViewRemainHidden');
    expect(blockedCommands.length === 0 && blockedHTTP.length === 0, 'pixelChecksDoNotAttemptProhibitedOperationsOrHttp');
    const report = { ok: true, coverage: 'pixel-ui-real-ipc-and-owned-renderer', assertionCount: checks.length, checks, screenshots, layouts, particleEvidence, blockedCommands, blockedHTTP, saveReceipts,
      nativeInputs: 0, nativeKeyboardVerified: false, enterpriseInputs: 0, realModelCalls: 0, clipboardOperations: 0,
      rendererOnly: true, ownedRendererCdpKeyboardOnly: true, actualIsolatedSQLiteAndApplicationDialog: true, reducedMotionEmulatedOnlyInOwnedRenderer: true, harness: runner.snapshot() };
    await writeFile(join(stateDirectory, 'smoke-pixel-console-report.json'), JSON.stringify(report, null, 2), { mode: 0o600 });
    return report;
  } catch (error) {
    const report = { ok: false, coverage: 'pixel-ui-real-ipc-and-owned-renderer', error: error instanceof Error ? error.message : String(error), assertionCount: checks.length,
      checks, screenshots, layouts, particleEvidence, blockedCommands, blockedHTTP, saveReceipts, nativeInputs: 0, realModelCalls: 0, rendererOnly: true, harness: runner.snapshot() };
    await writeFile(join(stateDirectory, 'smoke-pixel-console-report.json'), JSON.stringify(report, null, 2), { mode: 0o600 }); return report;
  } finally {
    for (const [name, original] of replaced) methods[name] = original;
    window.webContents.session.webRequest.onBeforeRequest(null);
    if (window.webContents.debugger.isAttached()) {
      if (observerScript) await window.webContents.debugger.sendCommand('Page.removeScriptToEvaluateOnNewDocument', { identifier: observerScript }).catch(() => {});
      await window.webContents.debugger.sendCommand('Emulation.setEmulatedMedia', { features: [] }).catch(() => {});
      await window.webContents.debugger.sendCommand('Emulation.setFocusEmulationEnabled', { enabled: false }).catch(() => {});
      if (ownsDebugger) window.webContents.debugger.detach();
    }
    if (!window.isDestroyed()) { window.setBounds(beforeBounds); await originalBounds({ x: 0, y: 0, width: 0, height: 0 }, false); }
  }
}
