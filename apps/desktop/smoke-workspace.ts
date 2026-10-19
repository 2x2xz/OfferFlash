import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import type { BrowserWindow } from 'electron';
import type { AppEvent, AppState, BrowserBounds, BrowserState, FillPlan, ModelStatus } from '../../packages/shared/src/contracts.js';
import type { DiscoveryReport, DiscoveryState } from '../../packages/shared/src/discovery.js';
import { createCareerFormFixtureProfile } from './fixtures/career-form-profile.js';
import { SmokeStepRunner } from './smoke-deadline.js';
import { contrastRatio } from './smoke-pixel-console.js';

type Methods = Record<string, (...args: any[]) => Promise<any>>;

/** Hidden own-renderer layout and named-IPC fixtures. Never fills or submits a native page. */
export async function smokeWorkspace(window: BrowserWindow, methods: Methods,
  send: (event: AppEvent) => void, stateDirectory: string) {
  if (!process.argv.includes('--smoke-test') || !process.argv.includes('--smoke-workspace-only')
    || process.argv.some(value => value.startsWith('--smoke-') && !['--smoke-test', '--smoke-workspace-only'].includes(value))
    || process.argv.includes('--live-product-check') || process.argv.includes('--site-diagnostic')) {
    throw new Error('申请空间验收仅允许专用隔离 smoke 子模式。');
  }
  if (window.isVisible()) throw new Error('申请空间验收要求隔离窗口保持隐藏。');
  for (const name of ['getState', 'browserState', 'modelStatus', 'browserBounds', 'browserZoom', 'openTestForm', 'prepareFill', 'runAgent', 'discoveryState']) {
    if (typeof methods[name] !== 'function') throw new Error(`申请空间验收缺少 ${name}`);
  }
  const steps = new SmokeStepRunner('workspace-hidden-owned-renderer');
  const assertions: Array<{ name: string; passed: true }> = [];
  const screenshots: string[] = []; const blockedCommands: string[] = [];
  const discoveryThemeEvidence: Array<{ name: string; foreground: string; background: string; backgroundChannels: number[]; visible: boolean; contrast: number | null }> = [];
  const boundsRequests: Array<{ bounds: BrowserBounds; visibleRequested: boolean; phase: 'readonly-native-hidden' | 'named-ipc-renderer-only' }> = [];
  const expect = (condition: unknown, name: string) => { if (!condition) throw new Error(name); assertions.push({ name, passed: true }); };
  const ui = <T = unknown>(name: string, expression: string) => steps.run(name,
    () => window.webContents.executeJavaScript(expression) as Promise<T>);
  const settle = () => ui('owned-renderer-layout-settle', 'new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');
  const waitFor = async (name: string, expression: string) => {
    const until = performance.now() + 5_000;
    while (performance.now() < until) { if (await ui<boolean>(name, expression)) return; await delay(25); }
    throw new Error(name);
  };
  const click = async (id: string) => {
    await ui('owned-renderer-test-button-click', `(() => {
      const button=document.querySelector('[data-testid=${JSON.stringify(id)}]');
      if(!(button instanceof HTMLButtonElement)||button.disabled)throw new Error('本机申请空间按钮不可用：'+${JSON.stringify(id)});
      button.click();
    })()`); await settle();
  };
  const draft = async (value: string) => {
    await ui('owned-chat-composer-input-only', `(() => {
      const input=document.querySelector('textarea[aria-label="发送给助手的消息"]');
      if(!(input instanceof HTMLTextAreaElement))throw new Error('本机聊天输入框缺失');
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(input,${JSON.stringify(value)});
      input.dispatchEvent(new Event('input',{bubbles:true}));
    })()`); await settle();
  };
  const readDraft = () => ui<string>('read-owned-composer-draft', 'document.querySelector(".compose-box textarea")?.value');
  const geometry = () => ui<BrowserBounds>('read-owned-native-holder-geometry', `(() => {
    const node=document.querySelector('.browser-placeholder');if(!node)throw new Error('网页占位节点缺失');
    const r=node.getBoundingClientRect();return {x:Math.round(r.x),y:Math.round(r.y),width:Math.round(r.width),height:Math.round(r.height)};
  })()`);
  const layoutPreferences = () => ui<{ navigationCollapsed: boolean; assistantCollapsed: boolean; assistantWidth: number }>('read-owned-layout-preferences', `(() => {
    const shell=document.querySelector('.workbench'),space=document.querySelector('[data-testid="application-space"]');
    const divider=document.querySelector('[data-testid="workspace-dock-resizer"]');
    if(!shell||!space||!divider)throw new Error('本机工作区布局节点缺失');
    return {navigationCollapsed:shell.classList.contains('sidebar-collapsed'),assistantCollapsed:space.classList.contains('dock-collapsed'),assistantWidth:Number(divider.getAttribute('aria-valuenow'))};
  })()`);
  const chooseZoom = async (percent: 80 | 90 | 100) => {
    await ui('owned-browser-zoom-choice', `(() => {
      const input=document.querySelector('[data-testid="browser-zoom"]');
      if(!(input instanceof HTMLSelectElement)||input.disabled)throw new Error('本机网页缩放选项不可用');
      input.value=${JSON.stringify(String(percent))};input.dispatchEvent(new Event('change',{bubbles:true}));
    })()`); await settle();
    await waitFor('named-zoom-fixture-accepted-and-idle', `document.querySelector('[data-testid="browser-zoom"]')?.value===${JSON.stringify(String(percent))}&&document.querySelector('[data-testid="browser-zoom"]')?.disabled===false`);
  };
  const screenshot = async (name: string) => {
    await ui('close-owned-toast-before-layout-capture', 'document.querySelector(".toast button")?.click()');
    const image = await steps.run('owned-renderer-screenshot', () => window.webContents.capturePage(), 8_000);
    const path = join(stateDirectory, name); await writeFile(path, image.toPNG(), { mode: 0o600 }); screenshots.push(path);
  };
  const beforeBusiness = await methods.getState!() as AppState;
  const beforeModel = await methods.modelStatus!() as ModelStatus;
  const sourceCatalog = await methods.discoveryState!() as DiscoveryState;
  const fakeDiscovery: DiscoveryState = { sources: structuredClone(sourceCatalog.sources), runs: [] };
  const originalGetState = methods.getState!; const originalBrowserState = methods.browserState!;
  const originalBounds = methods.browserBounds!; const originalOpenTestForm = methods.openTestForm!;
  const originalPrepareFill = methods.prepareFill!;
  const initialWindowBounds = window.getBounds();
  const replaced = new Map<string, Methods[string]>();
  const replace = (name: string, method: Methods[string]) => { if (!replaced.has(name)) replaced.set(name, methods[name]!); methods[name] = method; };
  const fakeProfile = createCareerFormFixtureProfile();
  const fakeBrowser: BrowserState = { url: 'https://modelbest.jobs.feishu.cn/campus/resume/0/apply',
    title: '原创虚构 UI 上下文 · 未加载企业网页', loading: false, canGoBack: false, canGoForward: false, visible: false, zoomPercent: 100 };
  const fakeState: AppState = { ...structuredClone(beforeBusiness), profile: fakeProfile,
    jobs: Array.from({ length: 60 }, (_, index) => ({ id: `workspace-fictional-job-${String(index).padStart(2, '0')}`,
      company: `虚构企业 ${index + 1}`, title: `虚构算法验证岗 ${index + 1}`, city: '虚构测试城', type: 'campus' as const,
      description: '完全虚构的申请空间布局与岗位列表测试记录。', requirements: 'Python',
      url: `https://example.invalid/workspace-fictional-job-${index + 1}`, sourceId: 'workspace-ui-fixture', sourceName: '原创布局样本',
      publishedAt: null, deadline: null, demo: false, observedAt: '2026-10-19T00:00:00Z', firstSeenAt: '2026-10-19T00:00:00Z',
      match: { profileVersion: fakeProfile.version, score: 0, eligible: 'review' as const, reasons: [], concerns: [] } })), applications: [], sourceRuns: [] };
  const existingApplication: AppState['applications'][number] = { id: 'workspace-existing-application', jobId: fakeState.jobs[1]!.id,
    company: fakeState.jobs[1]!.company, title: fakeState.jobs[1]!.title, url: fakeState.jobs[1]!.url, status: 'assessment', deadline: null,
    notes: '虚构既有笔试进度，不能被重新加入待申请覆盖。', demo: false, createdAt: '2026-10-19T00:00:00Z', updatedAt: '2026-10-19T00:00:00Z', history: [{ at: '2026-10-19T00:00:00Z', status: 'assessment', note: '虚构既有状态' }] };
  fakeState.applications.push(structuredClone(existingApplication));
  const namedTrackCalls: string[] = [], namedNavigationCalls: string[] = [], namedDiscoveryOptions: Array<Record<string, unknown>> = [];
  const namedZoomCalls: Array<80 | 90 | 100> = [];
  const focusLayoutEvidence: Array<{ navigationCollapsed: boolean; assistantCollapsed: boolean; assistantWidth: number; before: BrowserBounds; focused: BrowserBounds; restored: BrowserBounds }> = [];
  let heldChat: { resolve(value: unknown): void } | undefined; let fixtureChatCalls = 0; let safeCareerCancels = 0;
  let ownedFixtureObserved = false;
  try {
    steps.setStage('native-view-hidden-and-prohibited-actions-guarded');
    replace('browserBounds', async (bounds: BrowserBounds, visible: boolean) => {
      boundsRequests.push({ bounds: { ...bounds }, visibleRequested: visible === true, phase: 'readonly-native-hidden' });
      return originalBounds(bounds, false);
    });
    for (const name of ['fillApproved', 'runCareerFill', 'prepareCareerFill', 'configureModel', 'cancelAgent', 'exportTelemetry',
      'beginMeasurement', 'finishMeasurement', 'reviewMeasurement', 'exportData', 'importApplyDock', 'importResume',
      'saveProfile', 'confirmCareerRecord', 'saveJob', 'deleteJob', 'saveApplication', 'deleteApplication', 'trackJob',
      'loadDemo', 'clearDemo', 'refreshSource', 'browserNavigate', 'browserBack', 'browserForward', 'browserReload',
      'capturePage', 'collectPageJobs', 'discoverJobs', 'cancelDiscovery', 'addDiscoverySource']) {
      if (typeof methods[name] === 'function') replace(name, async () => { blockedCommands.push(name); throw new Error('申请空间 UI 验收禁止网页输入、模型、外部导航、对话框或业务改写。'); });
    }
    // Cleanup calls are expected when a fictional page context changes. They never invoke the executor.
    if (typeof methods.cancelCareerFill === 'function') replace('cancelCareerFill', async () => { safeCareerCancels++; });
    await originalBounds({ x: 0, y: 0, width: 1000, height: 700 }, false);
    const localPage = await originalOpenTestForm() as BrowserState;
    expect(localPage.url.startsWith('file:') && !localPage.visible, 'ownedReadonlyNativeFixtureLoadedWithoutShowingWindow');
    await steps.run('wait-owned-file-navigation-stable-before-production-observer', async () => {
      const until = performance.now() + 4500; let consecutive = 0;
      while (performance.now() < until) {
        const current = await originalBrowserState() as BrowserState;
        consecutive = current.url === localPage.url && current.loading === false ? consecutive + 1 : 0;
        if (consecutive >= 4) return;
        await delay(75);
      }
      throw new Error('本机只读样表导航未在限时内稳定，未继续生产观察。');
    }, 5000);
    const localPlan = await originalPrepareFill({ useModel: false }) as FillPlan;
    ownedFixtureObserved = localPlan.url === localPage.url && localPlan.items.length > 0;
    expect(ownedFixtureObserved, 'actualProductionObserverReadsOnlyOwnedLocalFixtureWithoutModel');
    expect(JSON.stringify(await originalGetState()) === JSON.stringify(beforeBusiness), 'readonlyFixtureObservationDoesNotChangeBusinessStore');
    // The native file page was already hidden and read above. From here onward
    // the named IPC fixture owns the fictional browser context. Calling the
    // real bounds method would publish file-page state over that fixture via
    // setVisible(), even without navigation; do not mix those two state sources.
    replace('browserBounds', async (bounds: BrowserBounds, visible: boolean) => {
      boundsRequests.push({ bounds: { ...bounds }, visibleRequested: visible === true, phase: 'named-ipc-renderer-only' });
    });
    replace('getState', async () => structuredClone(fakeState));
    replace('browserState', async () => structuredClone(fakeBrowser));
    // This is a renderer-to-IPC binding fixture, not a real WebContents zoom.
    // Do not call the original method or let a zoom preference reach a real page.
    replace('browserZoom', async (percent: unknown) => {
      if (percent !== 80 && percent !== 90 && percent !== 100) throw new Error('命名缩放fixture只接受80/90/100。');
      namedZoomCalls.push(percent); fakeBrowser.zoomPercent = percent;
      send({ type: 'browser', state: structuredClone(fakeBrowser) }); return structuredClone(fakeBrowser);
    });
    replace('telemetryState', async () => ({ runs: [] }));
    replace('discoveryState', async () => structuredClone(fakeDiscovery));
    replace('trackJob', async (jobId: string) => {
      namedTrackCalls.push(jobId); const job = fakeState.jobs.find(item => item.id === jobId); if (!job) throw new Error('命名fixture岗位不存在');
      if (!fakeState.applications.some(item => item.jobId === jobId)) fakeState.applications.push({ id: 'workspace-new-saved-application', jobId,
        company: job.company, title: job.title, url: job.url, status: 'saved', deadline: null, notes: '命名UI跟踪fixture，不是真实申请', demo: false,
        createdAt: '2026-10-19T00:00:00Z', updatedAt: '2026-10-19T00:00:00Z', history: [{ at: '2026-10-19T00:00:00Z', status: 'saved', note: '命名fixture加入待申请' }] });
      send({ type: 'state', state: structuredClone(fakeState) }); return structuredClone(fakeState);
    });
    replace('discoverJobs', async (options: Record<string, unknown> = {}) => {
      namedDiscoveryOptions.push(structuredClone(options));
      const ids = options.sourceIds as string[];
      const probe: DiscoveryReport = { id: `workspace-region-probe-${namedDiscoveryOptions.length}`,
        startedAt: '2026-10-19T00:00:00.000Z', finishedAt: '2026-10-19T00:00:00.000Z', status: 'partial',
        plan: { profileVersion: fakeProfile.version, keywords: ['虚构region协议'], cities: [], educationSummary: '虚构资料', notes: ['仅检验命名IPC请求参数，未联网'] },
        options: { sourceIds: ids, maxSources: ids.length, maxPages: 1, pageSize: 1, detailLimit: 0,
          includeExperienced: options.includeExperienced === true, region: options.region as 'mainland' | 'overseas' | 'all' },
        sources: [], unviewedSources: ids.map(id => ({ sourceId: id, name: fakeDiscovery.sources.find(source => source.id === id)?.name ?? '虚构来源', reason: '命名协议未执行网络读取' })),
        uniqueJobs: 0, completeDetails: 0, duplicateCount: 0, scopeNote: '命名region参数fixture，未执行实际采集。' };
      fakeDiscovery.runs = [probe]; return { jobs: [], matches: [], collections: [], report: probe };
    });
    replace('prepareFill', async () => { blockedCommands.push('prepareFill-after-readonly-probe'); throw new Error('布局检查不执行表单识别或填写。'); });
    replace('runAgent', async () => {
      fixtureChatCalls++;
      if (heldChat) throw new Error('虚构聊天协议不得并发。');
      return new Promise(resolve => { heldChat = { resolve }; });
    });
    send({ type: 'state', state: structuredClone(fakeState) });
    send({ type: 'browser', state: structuredClone(fakeBrowser) });
    send({ type: 'telemetry', state: { runs: [] } });
    send({ type: 'navigate', page: 'browser' });
    window.setSize(1480, 900); await settle();
    await waitFor('fictional-browser-context-accepted', `document.querySelector('[data-testid="workspace-show-web"]')?.textContent.includes(${JSON.stringify(fakeBrowser.title)})===true&&document.querySelector('input[aria-label="网页地址"]')?.value===${JSON.stringify(fakeBrowser.url)}`);
    await waitFor('single-application-space-mounted', `Boolean(document.querySelector('[data-testid="application-space"]')&&document.querySelector('[data-testid="agent-dock"]')&&document.querySelector('[data-testid="career-fill-panel"]'))`);

    steps.setStage('one-space-mission-navigation-and-persistent-panels');
    expect(await ui<boolean>('read-main-navigation-count', `document.querySelectorAll('nav[aria-label="主导航"] .nav-button').length===5`), 'missionOverviewAndFourWorkflowNavigationItems');
    expect(await ui<boolean>('single-browser-and-composer', `document.querySelectorAll(".browser-page").length===1&&document.querySelectorAll('[data-testid="agent-dock"]').length===1&&document.querySelectorAll(".compose-box textarea").length===1`), 'exactlyOneBrowserAndOneSharedChatComposer');
    expect(await ui<boolean>('one-top-autofill-entry', `document.querySelectorAll('[data-testid="quick-fill"]').length===1&&document.querySelector('[data-testid="quick-fill"]')?.textContent.trim()==="自动填写"`), 'singlePrimaryAutomaticFillButtonRemainsDiscoverable');
    await ui('mark-owned-persistent-nodes', `(() => {window.__offerWorkspaceSmokeNodes={browser:document.querySelector('.browser-page'),holder:document.querySelector('.browser-placeholder'),chat:document.querySelector('[data-testid="agent-dock"]'),career:document.querySelector('[data-testid="career-fill-panel"]')};})()`);
    const sameNodes = () => ui<boolean>('read-persistent-node-identities', `(() => {const n=window.__offerWorkspaceSmokeNodes;return n.browser===document.querySelector('.browser-page')&&n.holder===document.querySelector('.browser-placeholder')&&n.chat===document.querySelector('[data-testid="agent-dock"]')&&n.career===document.querySelector('[data-testid="career-fill-panel"]');})()`);
    await click('workspace-tab-chat'); await draft('切换轨迹后仍保留的虚构草稿');
    const initialGeometry = await geometry();
    expect(initialGeometry.width > 400 && initialGeometry.height > 300, 'webViewportHasUsableSpaceAt1480Pixels');
    for (const id of ['workspace-tab-activity', 'workspace-tab-details', 'workspace-tab-chat']) {
      await click(id);
      expect(JSON.stringify(await geometry()) === JSON.stringify(initialGeometry), `${id}.doesNotMoveNativeWebViewport`);
      expect(await sameNodes(), `${id}.doesNotRemountBrowserChatOrCareerPortal`);
    }
    expect(await readDraft() === '切换轨迹后仍保留的虚构草稿', 'chatDraftSurvivesAllDockTabs');
    await click('workspace-tab-activity');
    expect(await ui<boolean>('compact-empty-trajectory-without-fabricated-usage', `(() => {
      const pane=document.querySelector('[data-testid="workspace-dock"]');
      const spans=pane?.querySelectorAll('[data-testid="telemetry-span"]');
      return Boolean(pane)&&spans.length===0&&!pane.querySelector('[data-testid="telemetry-savings"]')&&!pane.querySelector('[data-testid="telemetry-tokens"]');
    })()`), 'emptyCompactTrajectoryDoesNotInventStepsTokenUsageOrEfficiency');
    for (const page of ['agent', 'telemetry', 'apply', 'browser'] as const) {
      send({ type: 'navigate', page }); await settle();
      expect(await sameNodes(), `legacyPage.${page}.SharesSameMountedApplicationSpace`);
    }
    await click('workspace-show-web'); await click('workspace-tab-chat');
    expect(await readDraft() === '切换轨迹后仍保留的虚构草稿', 'chatDraftSurvivesLegacySpaceNavigationAliases');
    expect(JSON.stringify(await geometry()) === JSON.stringify(initialGeometry), 'returnToWebRestoresExactViewportGeometry');

    steps.setStage('recommendation-position-and-dock-width');
    await click('workspace-show-recommendations');
    await waitFor('recommendations-mounted-in-existing-space', 'document.querySelectorAll("[data-apply-job-id]").length===6');
    await waitFor('discovery-default-domestic-source-loaded', `document.querySelectorAll('.discovery-source-row[data-provider="feishu"] input:checked,.discovery-source-row[data-provider="tencent-campus"] input:checked').length===3`);
    expect(await ui<boolean>('new-jobs-primary-visible-by-default', `(() => {
      const discovery=document.querySelector('[data-testid="job-discovery"]');
      return discovery instanceof HTMLDetailsElement&&discovery.open&&discovery.checkVisibility()
        &&discovery.querySelector('[data-testid="discovery-start"]')?.checkVisibility()===true
        &&document.querySelector('[data-testid="workspace-show-recommendations"]')?.textContent.includes('找新岗位');
    })()`), 'newJobDiscoveryIsExpandedPrimaryActionInApplicationSpace');
    expect(await ui<boolean>('default-three-domestic-only', `(() => {
      const checked=[...document.querySelectorAll('.discovery-source-row')].filter(row=>row.querySelector('input')?.checked);
      return checked.length===3&&checked.every(row=>['feishu','tencent-campus'].includes(row.getAttribute('data-provider')))
        &&document.querySelector('.discovery-experienced input')?.checked===false;
    })()`), 'defaultSelectionIncludesOnlyThreeDomesticSourcesAndExcludesOverseasAndExperienced');
    expect(await ui<boolean>('bounded-local-preview-not-new-search', `(() => {
      const library=document.querySelector('[data-testid="library-featured"]');
      return library?.getAttribute('data-featured-limit')==='6'&&library.querySelectorAll('[data-apply-job-id]').length===6
        &&library.textContent.includes('并非本轮新搜索')&&!library.textContent.includes('继续加载岗位');
    })()`), 'savedLibraryPreviewIsExplicitlyLocalAndBoundedToSixOfSixtyRecords');
    const domesticIds = fakeDiscovery.sources.filter(source => source.enabled && ['feishu', 'tencent-campus'].includes(source.provider)).map(source => source.id);
    const foreignId = fakeDiscovery.sources.find(source => source.enabled && ['lever', 'ashby'].includes(source.provider))!.id;
    const experiencedId = fakeDiscovery.sources.find(source => source.provider === 'tencent')!.id;
    const chooseSource = async (id: string, checked: boolean) => {
      await ui('owned-source-region-choice', `(() => {const settings=document.querySelector('[data-testid="discovery-source-settings"]');if(!settings.open)settings.querySelector('summary').click();const input=document.querySelector('.discovery-source-row[data-source-id="'+${JSON.stringify(id)}+'"] input');if(!(input instanceof HTMLInputElement)||input.disabled)throw new Error('本机来源不可选择');if(input.checked!==${checked})input.click();})()`); await settle();
    };
    const probeRegion = async (region: 'mainland' | 'overseas' | 'all', name: string) => {
      const scopeVisible = await ui<boolean>('owned-discovery-scope-visible-before-request', `document.querySelector('[data-testid="discovery-region"]')?.getAttribute('data-region')===${JSON.stringify(region)}`);
      const count = namedDiscoveryOptions.length; await click('discovery-start');
      await waitFor('named-region-probe-finished', 'document.querySelector(\'[data-testid="discovery-start"]\')?.disabled===false');
      expect(scopeVisible && namedDiscoveryOptions.length === count + 1 && namedDiscoveryOptions[count]?.region === region, name);
    };
    await probeRegion('mainland', 'defaultDiscoveryRequestExplicitlyUsesMainlandRegion');
    await chooseSource(foreignId, true);
    await probeRegion('all', 'addingAnExplicitForeignSourceMakesMixedScopeVisibleAndRequestsAll');
    for (const id of domesticIds) await chooseSource(id, false);
    await probeRegion('overseas', 'explicitForeignOnlySourceSelectionRequestsOverseas');
    await chooseSource(foreignId, false); for (const id of domesticIds) await chooseSource(id, true);
    await ui('explicitly-enable-owned-experienced-selection', `document.querySelector('.discovery-experienced input').click()`); await settle();
    await chooseSource(experiencedId, true);
    await probeRegion('mainland', 'tencentExperiencedSelectionStillUsesDomesticRegion');
    await ui('restore-owned-default-experienced-toggle', `(() => {const input=document.querySelector('.discovery-experienced input');if(input.checked)input.click();})()`); await settle();
    await ui('close-owned-source-settings', `(() => {const settings=document.querySelector('[data-testid="discovery-source-settings"]');if(settings.open)settings.querySelector('summary').click();})()`); await settle();
    const firstDomesticId = domesticIds[0]!;
    const sourceInputSelector = `.discovery-source-row[data-source-id="${firstDomesticId}"] input`;
    await ui('change-owned-source-selection', `(() => {
      const settings=document.querySelector('[data-testid="discovery-source-settings"]');if(!(settings instanceof HTMLDetailsElement))throw new Error('来源设置缺失');
      if(!settings.open)settings.querySelector('summary').click();const input=document.querySelector(${JSON.stringify(sourceInputSelector)});
      if(!(input instanceof HTMLInputElement)||input.disabled||!input.checked)throw new Error('国内来源选项不可用');input.click();
    })()`); await settle();
    await click('workspace-show-web'); await click('workspace-show-recommendations');
    await waitFor('source-selection-memory-loaded', `document.querySelector(${JSON.stringify(sourceInputSelector)})?.checked===false&&document.querySelectorAll('.discovery-source-row input:checked').length===2`);
    expect(await ui<boolean>('source-selection-retained-on-return', `document.querySelector(${JSON.stringify(sourceInputSelector)})?.checked===false`), 'sourceChoiceSurvivesRoundTripWithoutResettingToDefaults');
    await ui('restore-owned-source-selection', `(() => {const settings=document.querySelector('[data-testid="discovery-source-settings"]');if(!settings.open)settings.querySelector('summary').click();document.querySelector(${JSON.stringify(sourceInputSelector)}).click();settings.querySelector('summary').click();})()`); await settle();

    const reportJobIds = [0, 1, 8, 9, 10, 11, 12, 13].map(index => fakeState.jobs[index]!.id);
    const reportSource = fakeDiscovery.sources.find(source => source.id === firstDomesticId)!;
    const reportTime = '2026-10-19T02:10:00.000Z';
    const eventReport: DiscoveryReport = { id: 'workspace-fictional-discovery-event', startedAt: reportTime, finishedAt: reportTime, status: 'partial',
      plan: { profileVersion: fakeProfile.version, keywords: ['原创虚构UI候选'], cities: ['虚构测试城'], educationSummary: '虚构硕士', notes: ['命名界面协议样本，无网络采集'] },
      options: { sourceIds: [firstDomesticId], maxSources: 1, maxPages: 1, pageSize: 20, detailLimit: 10, includeExperienced: false, region: 'mainland' },
      sources: [{ sourceId: firstDomesticId, name: reportSource.name, url: reportSource.url, provider: reportSource.provider,
        status: 'partial', reason: '虚构范围报告，仅检查本轮事件展示', pagesRequested: 1, pagesSucceeded: 1, entriesRead: 8, detailChecked: 8,
        detailComplete: 8, matchedCount: 8, excludedCount: 0, officialTotal: null, requestURLs: [], warnings: ['无真实网络请求'],
        jobIds: reportJobIds, unviewed: ['其余官网范围尚未查看'] }], unviewedSources: [], uniqueJobs: 8, completeDetails: 8, duplicateCount: 0,
      scopeNote: '这是纯UI事件fixture，不能声称真实官网覆盖或新增入库。' };
    fakeState.jobs[0]!.match = { ...fakeState.jobs[0]!.match, eligible: 'review', score: 100 };
    fakeState.jobs[8]!.match = { ...fakeState.jobs[8]!.match, eligible: 'likely', score: 99 };
    fakeState.jobs[9]!.match = { ...fakeState.jobs[9]!.match, eligible: 'likely', score: 99 };
    fakeState.jobs[13]!.match = { ...fakeState.jobs[13]!.match, eligible: 'likely', score: 100 };
    fakeDiscovery.runs = [eventReport];
    send({ type: 'state', state: structuredClone(fakeState) });
    send({ type: 'discovery', state: structuredClone(fakeDiscovery) });
    await waitFor('discovery-event-candidates-rendered', `document.querySelector('[data-testid="discovery-candidates"]')?.getAttribute('data-report-id')===${JSON.stringify(eventReport.id)}&&document.querySelectorAll('[data-testid="discovery-candidate"]').length===6`);
    expect(await ui<boolean>('candidate-cards-bound-to-event-job-ids', `(() => {
      const expected=new Set(${JSON.stringify(reportJobIds)}),rows=[...document.querySelectorAll('[data-testid="discovery-candidate"]')];
      return rows.length===6&&rows.every(row=>expected.has(row.getAttribute('data-job-id'))&&row.querySelector('[data-testid="discovery-apply"]')?.textContent.includes('去网申'))
        &&document.querySelector('[data-testid="discovery-report"]')?.textContent.includes('本轮候选 8 条');
    })()`), 'chatDiscoveryEventDisplaysSixCardsFromExactlyItsReportedSavedJobIds');
    expect(await ui<boolean>('candidate-rank-score-and-id-match-chat-order', `(() => {
      const rows=[...document.querySelectorAll('[data-testid="discovery-candidate"]')];
      return rows[0]?.getAttribute('data-job-id')===${JSON.stringify(fakeState.jobs[13]!.id)}
        &&rows[1]?.getAttribute('data-job-id')===${JSON.stringify(fakeState.jobs[8]!.id)}
        &&rows[2]?.getAttribute('data-job-id')===${JSON.stringify(fakeState.jobs[9]!.id)}
        &&rows.every((row,index)=>row.querySelector('h4')?.textContent.startsWith(String(index+1)+'.'));
    })()`), 'candidateCardsUseSameEligibilityScoreAndIdOrderWithStableVisibleNumbers');
    const discoveryColors = await ui<Array<{ name: string; foreground: string; background: string; backgroundChannels: number[]; visible: boolean }>>('computed-merged-discovery-text-and-surface-colors', `(() => {
      const targets=[['candidate title','[data-testid="discovery-candidate"] h4'],['primary action description','.discovery-primary-action p'],
        ['partial report title','[data-testid="discovery-report"].partial>div>strong'],['existing tracked state','[data-testid="discovery-track"]:disabled']];
      return targets.map(([name,selector])=>{
        const node=document.querySelector(selector);if(!(node instanceof HTMLElement))return {name,foreground:'',background:'',backgroundChannels:[],visible:false};
        const layers=[];let surface=node;
        while(surface){const channels=getComputedStyle(surface).backgroundColor.match(/[\\d.]+/g)?.map(Number);if(channels&&channels.length>=3){const alpha=channels[3]??1;if(alpha>0)layers.push([...channels.slice(0,3),alpha]);if(alpha>=1)break;}surface=surface.parentElement;}
        let rgb=[0,0,0];for(const layer of layers.reverse())rgb=layer.slice(0,3).map((channel,index)=>channel*layer[3]+rgb[index]*(1-layer[3]));
        return {name,foreground:getComputedStyle(node).color,background:'rgb('+rgb.join(', ')+')',backgroundChannels:rgb,visible:node.checkVisibility()};
      });
    })()`);
    discoveryThemeEvidence.push(...discoveryColors.map(sample => ({ ...sample, contrast: contrastRatio(sample.foreground, sample.background) ?? null })));
    expect(discoveryThemeEvidence.length === 4 && discoveryThemeEvidence.every(sample => sample.visible && sample.backgroundChannels.length === 3
      && sample.backgroundChannels.every(channel => channel < 100) && sample.contrast !== null && sample.contrast >= 4.5),
    'mergedDiscoveryCandidatePrimaryPartialAndTrackedLabelsUseDarkSurfacesWithActualContrastAtLeast45');
    await screenshot('workspace-discovery-candidates-pixel-merged-renderer-only.png');
    const freshTrackSelector = `[data-testid="discovery-candidate"][data-job-id="${reportJobIds[0]}"] [data-testid="discovery-track"]`;
    await ui('click-owned-candidate-track', `document.querySelector(${JSON.stringify(freshTrackSelector)}).click()`);
    await waitFor('candidate-tracked-status-rendered', `document.querySelector(${JSON.stringify(freshTrackSelector)})?.disabled===true&&document.querySelector(${JSON.stringify(freshTrackSelector)})?.textContent.includes('已加入')===true`);
    expect(namedTrackCalls.length === 1 && namedTrackCalls[0] === reportJobIds[0] && fakeState.applications.find(item => item.jobId === reportJobIds[0])?.status === 'saved', 'oneCandidateClickUsesNamedTrackJobOnceAndCreatesOnlySavedStatus');
    await ui('attempt-disabled-existing-candidate-track', `document.querySelector('[data-testid="discovery-candidate"][data-job-id="'+${JSON.stringify(reportJobIds[1])}+'"] [data-testid="discovery-track"]').click()`);
    expect(namedTrackCalls.length === 1 && JSON.stringify(fakeState.applications.find(item => item.id === existingApplication.id)) === JSON.stringify(existingApplication), 'alreadyTrackedCandidateKeepsExistingAssessmentHistoryWithoutAnotherWrite');
    await waitFor('library-excludes-latest-run-duplicates', `(() => {const ids=new Set(${JSON.stringify(reportJobIds)});return document.querySelectorAll('[data-apply-job-id]').length===6&&[...document.querySelectorAll('[data-apply-job-id]')].every(row=>!ids.has(row.getAttribute('data-apply-job-id')));})()`);
    expect(await ui<boolean>('latest-candidates-not-repeated-as-local-featured', `(() => {
      const ids=new Set(${JSON.stringify(reportJobIds)});return [...document.querySelectorAll('[data-apply-job-id]')].every(row=>!ids.has(row.getAttribute('data-apply-job-id')));
    })()`), 'currentRunCandidateCardsAreNotDuplicatedInLocalLibraryPreview');
    await settle();
    const listSnapshot = await ui<{ count: number; scroll: number }>('remember-owned-recommendation-position', `(() => {
      const list=document.querySelector('[data-testid="workspace-recommendations"]');const root=list.querySelector('.page-scroll')||list.closest('.page-scroll')||list;
      root.scrollTop=Math.min(360,root.scrollHeight-root.clientHeight);root.dispatchEvent(new Event('scroll'));
      return {count:list.querySelectorAll('[data-apply-job-id]').length,scroll:root.scrollTop};
    })()`);
    await settle();
    await click('workspace-show-web'); await click('workspace-show-recommendations');
    await waitFor('latest-report-and-cards-restored', `document.querySelector('[data-testid="discovery-candidates"]')?.getAttribute('data-report-id')===${JSON.stringify(eventReport.id)}&&document.querySelectorAll('[data-testid="discovery-candidate"]').length===6`);
    await waitFor('restored-library-has-no-current-run-duplicates', `(() => {const ids=new Set(${JSON.stringify(reportJobIds)});return [...document.querySelectorAll('[data-apply-job-id]')].every(row=>!ids.has(row.getAttribute('data-apply-job-id')));})()`);
    await settle();
    expect(await ui<boolean>('read-restored-recommendation-position', `(() => {
      const list=document.querySelector('[data-testid="workspace-recommendations"]');const root=list.querySelector('.page-scroll')||list.closest('.page-scroll')||list;
      return list.querySelectorAll('[data-apply-job-id]').length>=${listSnapshot.count}&&Math.abs(root.scrollTop-${listSnapshot.scroll})<=2;
    })()`), 'boundedLibraryPreviewAndScrollSurviveRoundTripToWeb');
    await click('workspace-show-web');
    expect(await sameNodes(), 'recommendationSwitchDoesNotUnmountBrowserChatOrCareerPortal');
    const beforeToggle = await geometry(); await click('workspace-dock-toggle');
    const collapsedGeometry = await geometry();
    expect(collapsedGeometry.width > beforeToggle.width, 'collapsingDockGivesMoreWidthToWebsite');
    await click('workspace-dock-toggle');
    expect(JSON.stringify(await geometry()) === JSON.stringify(beforeToggle), 'expandingDockRestoresPreviousExactWebsiteBounds');
    expect(await sameNodes(), 'dockCollapseKeepsAllPortalAndChatNodesMounted');
    expect(await ui<boolean>('keyboard-resizer-accessible', `document.querySelector('[data-testid="workspace-dock-resizer"]')?.getAttribute("role")==="separator"`), 'dockWidthControlHasAccessibleSeparatorRole');
    const beforeKeyResize = await geometry();
    await ui('owned-resizer-arrow-right-key', `document.querySelector('[data-testid="workspace-dock-resizer"]').dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowRight',bubbles:true}))`); await settle();
    expect((await geometry()).width !== beforeKeyResize.width, 'keyboardArrowAdjustsDockWidthWhenIdle');
    await ui('owned-resizer-arrow-left-key', `document.querySelector('[data-testid="workspace-dock-resizer"]').dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowLeft',bubbles:true}))`); await settle();
    expect(JSON.stringify(await geometry()) === JSON.stringify(beforeKeyResize), 'oppositeArrowRestoresPreviousDockWidthAndBounds');

    steps.setStage('focus-mode-and-zoom-named-ipc-only');
    expect(await ui<boolean>('focus-and-zoom-controls-discoverable', `(() => {
      const focus=document.querySelector('[data-testid="browser-focus-toggle"]'),zoom=document.querySelector('[data-testid="browser-zoom"]');
      return focus instanceof HTMLButtonElement&&focus.checkVisibility()&&!focus.disabled&&focus.getAttribute('aria-label')==='专注网页'
        &&focus.getAttribute('aria-pressed')==='false'&&zoom instanceof HTMLSelectElement&&zoom.checkVisibility()&&!zoom.disabled
        &&zoom.getAttribute('aria-label')==='网页缩放'&&zoom.value==='100'
        &&JSON.stringify([...zoom.options].map(option=>[option.value,option.textContent]))===JSON.stringify([['100','100%'],['90','90%'],['80','80%']]);
    })()`), 'visibleAccessibleFocusAndAllThreeZoomOptionsExistAtOneHundredPercent');
    const zoomGeometry = await geometry();
    for (const percent of [90, 80, 100] as const) {
      const callsBefore = namedZoomCalls.length;
      await chooseZoom(percent);
      expect(namedZoomCalls.length === callsBefore + 1 && namedZoomCalls.at(-1) === percent && fakeBrowser.zoomPercent === percent,
        `zoom.${percent}.CallsNamedBrowserZoomExactlyOnceAndUsesReturnedState`);
      expect(JSON.stringify(await geometry()) === JSON.stringify(zoomGeometry) && await sameNodes(),
        `zoom.${percent}.DoesNotResizeOrRemountNativeHolderAndChat`);
    }
    const savedLayout = await layoutPreferences();
    await ui('owned-preferred-width-before-focus', `document.querySelector('[data-testid="workspace-dock-resizer"]').dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowRight',shiftKey:true,bubbles:true}))`); await settle();
    expect((await layoutPreferences()).assistantWidth > savedLayout.assistantWidth, 'focusRestorationStartsFromUserAdjustedDockWidth');
    for (const navigationCollapsed of [false, true]) {
      for (const assistantCollapsed of [false, true]) {
        if ((await layoutPreferences()).navigationCollapsed !== navigationCollapsed) await click('sidebar-toggle');
        if ((await layoutPreferences()).assistantCollapsed !== assistantCollapsed) await click('workspace-dock-toggle');
        const preferences = await layoutPreferences(); const before = await geometry();
        await click('browser-focus-toggle');
        await waitFor('focused-native-holder-receives-rest-of-space', `document.querySelector('[data-testid="application-space"]')?.getAttribute('data-browser-focus')==='true'`);
        const focused = await geometry();
        const label = `focus.navigation-${navigationCollapsed ? 'collapsed' : 'open'}.assistant-${assistantCollapsed ? 'collapsed' : 'open'}`;
        expect(await ui<boolean>('focus-hides-both-sidebars-and-divider-keeps-browser-controls', `(() => {
          const nav=document.querySelector('.workbench-nav'),dock=document.querySelector('[data-testid="workspace-dock"]');
          const divider=document.querySelector('[data-testid="workspace-dock-resizer"]'),focus=document.querySelector('[data-testid="browser-focus-toggle"]');
          return nav?.checkVisibility()===false&&dock?.checkVisibility()===false&&divider?.checkVisibility()===false
            &&divider.getAttribute('aria-disabled')==='true'&&divider.tabIndex===-1
            &&document.querySelector('.browser-toolbar')?.checkVisibility()===true&&document.querySelector('.workspace-canvas-tabs')?.checkVisibility()===true
            &&focus?.getAttribute('aria-pressed')==='true'&&focus.getAttribute('aria-label')==='返回并排'
            &&document.querySelectorAll('.browser-placeholder').length===1;
        })()`), `${label}.HidesNavigationAssistantRailAndDividerButKeepsBrowserToolbar`);
        expect(focused.width > before.width + 80 && await sameNodes(), `${label}.GainsWebsiteWidthWithoutRemountingAnySharedNodes`);
        await ui('attempt-hidden-focused-resizer-key', `document.querySelector('[data-testid="workspace-dock-resizer"]').dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowRight',bubbles:true}))`); await settle();
        expect(JSON.stringify(await geometry()) === JSON.stringify(focused) && JSON.stringify(await layoutPreferences()) === JSON.stringify(preferences),
          `${label}.HiddenSeparatorCannotChangeSavedPreferences`);
        await click('browser-focus-toggle');
        await waitFor('split-mode-returned', `document.querySelector('[data-testid="application-space"]')?.getAttribute('data-browser-focus')==='false'`);
        const restored = await geometry();
        focusLayoutEvidence.push({ ...preferences, before, focused, restored });
        expect(JSON.stringify(await layoutPreferences()) === JSON.stringify(preferences) && JSON.stringify(restored) === JSON.stringify(before),
          `${label}.RestoresExactSidebarPreferencesDockWidthAndWebsiteBounds`);
        expect(await sameNodes() && await readDraft() === '切换轨迹后仍保留的虚构草稿', `${label}.PreservesSharedChatDraftAndCareerPortal`);
      }
    }
    if ((await layoutPreferences()).navigationCollapsed !== savedLayout.navigationCollapsed) await click('sidebar-toggle');
    if ((await layoutPreferences()).assistantCollapsed !== savedLayout.assistantCollapsed) await click('workspace-dock-toggle');
    await ui('restore-owned-width-after-focus-checks', `document.querySelector('[data-testid="workspace-dock-resizer"]').dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowLeft',shiftKey:true,bubbles:true}))`); await settle();
    expect(JSON.stringify(await layoutPreferences()) === JSON.stringify(savedLayout) && JSON.stringify(await geometry()) === JSON.stringify(beforeKeyResize),
      'focusAndZoomChecksLeaveOriginalSplitLayoutAndWebsiteBoundsIntact');

    steps.setStage('owned-chat-request-locks-layout-without-model');
    await click('workspace-tab-chat'); await draft('本机申请空间虚构协议请求');
    await ui('send-owned-fixture-chat-request', `document.querySelector('button[aria-label="发送"]').click()`);
    await waitFor('held-named-chat-method-called', `Boolean(document.querySelector('button[aria-label="停止当前任务"]'))`);
    const busyGeometry = await geometry();
    expect(await ui<boolean>('layout-actions-disabled-during-chat-task', `(() => {
      const ids=['workspace-tab-chat','workspace-tab-activity','workspace-tab-details','workspace-dock-toggle'];
      return ids.every(id=>document.querySelector('[data-testid="'+id+'"]')?.disabled===true)
        &&document.querySelector('[data-testid="workspace-dock-resizer"]')?.getAttribute('aria-disabled')==='true'
        &&[...document.querySelectorAll('nav[aria-label="主导航"] .nav-button')].every(node=>node.disabled===true)
        &&document.querySelector('[data-testid="quick-fill"]')?.disabled===true
        &&document.querySelector('[data-testid="browser-focus-toggle"]')?.disabled===true
        &&document.querySelector('[data-testid="browser-zoom"]')?.disabled===true;
    })()`), 'runningChatTaskLocksTabsDockResizerNavigationAndAutomaticFill');
    const busyZoomCalls = namedZoomCalls.length; const busyPreferences = await layoutPreferences();
    await ui('attempt-disabled-layout-controls-during-fixture-request', `(() => {
      document.querySelector('[data-testid="workspace-tab-activity"]').click();
      document.querySelector('[data-testid="workspace-dock-toggle"]').click();
      document.querySelector('[data-testid="workspace-dock-resizer"]').dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowRight',bubbles:true}));
      document.querySelector('[data-testid="browser-focus-toggle"]').click();
      const zoom=document.querySelector('[data-testid="browser-zoom"]');zoom.value='80';zoom.dispatchEvent(new Event('change',{bubbles:true}));
    })()`); await settle();
    expect(JSON.stringify(await geometry()) === JSON.stringify(busyGeometry), 'disabledBusyControlsDoNotResizeWebViewport');
    expect(namedZoomCalls.length === busyZoomCalls && fakeBrowser.zoomPercent === 100
      && JSON.stringify(await layoutPreferences()) === JSON.stringify(busyPreferences)
      && await ui<boolean>('busy-focus-mode-remains-split', `document.querySelector('[data-testid="application-space"]')?.getAttribute('data-browser-focus')==='false'`),
    'runningChatRejectsFocusAndSyntheticZoomChangesWithoutCallingNativeOrChangingPreferences');
    // The synthetic change above bypasses the disabled browser UI and mutates
    // only the owned select element. Restore the returned fixture state explicitly.
    send({ type: 'browser', state: structuredClone(fakeBrowser) }); await settle();
    if (!heldChat) throw new Error('虚构聊天请求未进入命名 IPC。');
    heldChat.resolve({ taskId: 'workspace-ui-fictional-task', status: 'completed', finalText: '这是本机界面协议回复，没有模型请求或网页填写。', sessionId: 'workspace-ui-fictional-session', events: [] });
    heldChat = undefined;
    await waitFor('fixture-chat-completed-without-model', `Boolean(document.querySelector('[data-message-status="completed"]'))&&!document.querySelector('[data-streaming="true"]')`);
    expect(fixtureChatCalls === 1, 'oneNamedChatProtocolRequestWithoutCallingModel');
    await draft('接下来继续使用的虚构草稿'); await click('workspace-tab-activity'); await click('workspace-tab-chat');
    expect(await readDraft() === '接下来继续使用的虚构草稿' && await ui<boolean>('shared-chat-reply-preserved', `document.querySelector('[data-testid="agent-dock"]')?.textContent.includes("这是本机界面协议回复")===true`), 'chatReplyAndNextDraftSurviveActivityRoundTrip');

    steps.setStage('two-layout-screenshots-and-preservation');
    await screenshot('workspace-web-chat-1480-renderer-only.png');
    window.setSize(1080, 780); await settle();
    expect(await ui<boolean>('narrow-space-without-horizontal-page-overflow', 'document.documentElement.scrollWidth<=window.innerWidth+1'), 'workspaceFits1080PixelWindowWithoutPageHorizontalOverflow');
    expect((await geometry()).width >= 400, 'webViewportStillUsableAt1080Pixels');
    expect(await ui<boolean>('narrow-toolbar-primary-viewport-controls-within-canvas', `(() => {
      const canvas=document.querySelector('[data-testid="workspace-browser"]')?.getBoundingClientRect();
      return !!canvas&&['quick-fill','browser-focus-toggle','browser-zoom'].every(id=>{
        const node=document.querySelector('[data-testid="'+id+'"]'),r=node?.getBoundingClientRect();
        return node?.checkVisibility()===true&&!!r&&r.width>20&&r.left>=canvas.left-1&&r.right<=Math.min(canvas.right,innerWidth)+1;
      });
    })()`), 'automaticFillFocusAndZoomRemainInsideVisibleCanvasAt1080Pixels');
    await screenshot('workspace-web-chat-1080-renderer-only.png');
    const narrowSplit = await geometry();
    await click('browser-focus-toggle');
    expect((await geometry()).width > narrowSplit.width + 80 && await sameNodes(), 'narrowFocusModeAddsWebsiteWidthWithoutRecreatingBrowser');
    await screenshot('workspace-focus-1080-renderer-only.png');
    await click('browser-focus-toggle');
    expect(JSON.stringify(await geometry()) === JSON.stringify(narrowSplit), 'narrowFocusReturnRestoresOriginalWebsiteBounds');
    await click('workspace-tab-activity'); await screenshot('workspace-activity-1080-renderer-only.png');
    steps.setStage('candidate-go-application-is-navigation-only');
    await click('workspace-show-recommendations');
    await waitFor('candidate-go-button-restored', `document.querySelector('[data-testid="discovery-candidate"][data-job-id="'+${JSON.stringify(reportJobIds[0])}+'"] [data-testid="discovery-apply"]')?.disabled===false`);
    replace('browserNavigate', async (url: string) => { namedNavigationCalls.push(url); fakeBrowser.url = url; fakeBrowser.title = '命名候选岗位导航fixture'; return structuredClone(fakeBrowser); });
    await ui('open-owned-candidate-application', `document.querySelector('[data-testid="discovery-candidate"][data-job-id="'+${JSON.stringify(reportJobIds[0])}+'"] [data-testid="discovery-apply"]').click()`);
    await waitFor('candidate-navigation-only-shows-autofill-entry', `document.querySelector('.workspace-browser-host')?.checkVisibility()===true&&document.querySelector('input[aria-label="网页地址"]')?.value===${JSON.stringify(fakeState.jobs[0]!.url)}&&document.querySelector('[data-testid="quick-fill"]')?.checkVisibility()===true`);
    expect(namedNavigationCalls.length === 1 && namedNavigationCalls[0] === fakeState.jobs[0]!.url && blockedCommands.length === 0,
      'candidateGoApplicationNavigatesOnlyAndShowsExistingAutomaticFillButtonWithoutFillingOrSubmitting');
    steps.setStage('job-library-management-is-distinct-from-discovery');
    send({ type: 'navigate', page: 'jobs' });
    await waitFor('saved-job-library-visible', 'document.querySelector(\'[aria-label="筛选已保存岗位"]\')?.checkVisibility()===true');
    expect(await ui<boolean>('job-library-not-second-discovery-surface', `(() => {
      return document.querySelector('.topbar h1')?.textContent==='岗位库'
        &&!document.querySelector('[data-testid="job-discovery"]')
        &&document.querySelector('input[aria-label="筛选已保存岗位"]')?.placeholder.includes('已保存')
        &&document.querySelectorAll('.job-card').length===60;
    })()`), 'jobLibraryManagesAllSixtySavedRecordsWithoutDuplicatingDiscovery');
    expect(JSON.stringify(await originalGetState()) === JSON.stringify(beforeBusiness), 'actualProfileJobsApplicationsAndBusinessStoreUnchanged');
    expect((await originalBrowserState() as BrowserState).visible === false, 'actualNativeViewStayedHidden');
    expect(!window.isVisible(), 'isolatedWindowStayedHidden');
    expect(blockedCommands.length === 0, 'noForbiddenNativeFillModelNetworkDialogOrBusinessCommandAttempted');
    const report = { ok: true, assertionCount: assertions.length, assertions, screenshots, boundsRequests, safeCareerCancels,
      uiProtocolFixtureOnly: true, actualReadonlyOwnedFixtureObserved: ownedFixtureObserved, nativeInputs: 0,
      nativeEnterpriseInputs: 0, realModelCalls: 0, paidModelCalls: 0, submitted: false, fixtureChatCalls,
      businessStoreUnchanged: true, actualNativeViewRemainedHidden: true, isolatedWindowRemainedHidden: true,
      namedIpcBoundsScope: 'Renderer-requested rectangles only; the fictional-context phase does not call native setBounds/setVisible or replace real controller events.',
      nativeSetBoundsBehaviorEvaluated: false,
      screenshotScope: 'Owned renderer layout only. Electron renderer captures do not composite the hidden native webpage; no enterprise-page pixels or fabricated web content.',
      compactEmptyTrajectoryDoesNotClaimUsage: true, realManualBenchmark: false, productionEfficiencySamples: 0,
      focusLayoutEvidence, namedZoomCalls, zoomBindingIsNamedIpcFixtureOnly: true, nativeZoomCalls: 0,
      syntheticDiscoveryStateAndEventOnly: true, realDiscoveryRequests: 0, fixtureCandidateIds: reportJobIds, namedDiscoveryOptions, namedTrackCalls, namedNavigationCalls, discoveryThemeEvidence,
      trackingAndNavigationAreNamedProtocolFixturesOnly: true, actualApplicationSubmission: false,
      blockedCommands, harness: steps.snapshot(), interactionMethod: 'Scripted clicks and own React composer setter/input only in isolated owned renderer; no native input, provider, clipboard, private store or enterprise page.' };
    await writeFile(join(stateDirectory, 'smoke-workspace-report.json'), JSON.stringify(report, null, 2), { mode: 0o600 }); return report;
  } catch (error) {
    // Failure evidence has a separate deadline; a timed-out test scope must not
    // resume UI actions. This reads only this isolated, fictional renderer.
    const diagnostics = new SmokeStepRunner('workspace-owned-renderer-failure-evidence');
    let rendererFailure: unknown;
    let failureScreenshot: string | undefined;
    try {
      rendererFailure = await diagnostics.run('readonly-owned-dom-state', () => window.webContents.executeJavaScript(`(() => ({
        applicationSpace:Boolean(document.querySelector('[data-testid="application-space"]')),
        agentDock:Boolean(document.querySelector('[data-testid="agent-dock"]')),
        careerFillPanel:Boolean(document.querySelector('[data-testid="career-fill-panel"]')),
        browserCount:document.querySelectorAll('.browser-page').length,
        boundaryHeading:document.querySelector('.loading-page h2')?.textContent||'',
        boundaryMessage:document.querySelector('.loading-page p')?.textContent||'',
        fixtureBodyText:document.body.innerText.slice(0,2000)
      }))()`));
    } catch {
      rendererFailure = { evidenceUnavailable: true, reason: 'Owned renderer readonly failure evidence could not be collected.' };
    }
    try {
      const image = await diagnostics.run('readonly-owned-renderer-failure-screenshot', () => window.webContents.capturePage(), 8_000);
      failureScreenshot = join(stateDirectory, 'workspace-failure-renderer-only.png');
      await writeFile(failureScreenshot, image.toPNG(), { mode: 0o600 });
      screenshots.push(failureScreenshot);
    } catch { /* Preserve the original failure even when compositor evidence is unavailable. */ }
    await writeFile(join(stateDirectory, 'smoke-workspace-failure.json'), JSON.stringify({ ok: false, assertionCount: assertions.length,
      assertions, screenshots, blockedCommands, nativeInputs: 0, realModelCalls: 0, discoveryThemeEvidence, focusLayoutEvidence, namedZoomCalls, nativeZoomCalls: 0, rendererFailure, failureScreenshot,
      evidenceScope: 'Hidden isolated own renderer with fictional data; no private application, native form or provider diagnostics.',
      message: error instanceof Error ? error.message : '申请空间隔离验收未完成。', harness: steps.snapshot() }, null, 2), { mode: 0o600 });
    throw error;
  } finally {
    if (heldChat) heldChat.resolve({ taskId: 'workspace-ui-cleanup', status: 'cancelled', finalText: '', sessionId: 'workspace-ui-fictional-session', events: [] });
    for (const [name, method] of replaced) methods[name] = method;
    send({ type: 'state', state: beforeBusiness }); send({ type: 'model', status: beforeModel });
    await originalBounds({ x: 0, y: 0, width: 0, height: 0 }, false).catch(() => {});
    window.setBounds(initialWindowBounds);
  }
}
