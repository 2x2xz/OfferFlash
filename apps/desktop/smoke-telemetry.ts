import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import type { BrowserWindow } from 'electron';
import type { AppEvent, AppState, BrowserBounds, BrowserState, FillPlan } from '../../packages/shared/src/contracts.js';
import type { TelemetryRun, TelemetryState } from '../../packages/telemetry/src/contracts.js';
import { SmokeStepRunner } from './smoke-deadline.js';

type Methods = Record<string, (...args: any[]) => Promise<any>>;

/**
 * Hidden own-renderer interactions + real isolated host/store/SDK tracing.
 * Review numbers are fictional UI inputs, NOT a real manual baseline or field correctness measurement.
 * Only the owned application.html is read, never filled. No enterprise page, model, clipboard or dialog.
 */
export async function smokeTelemetry(window: BrowserWindow, methods: Methods,
  send: (event: AppEvent) => void, stateDirectory: string) {
  if (!process.argv.includes('--smoke-test') || !process.argv.includes('--smoke-telemetry-only')
    || process.argv.includes('--live-product-check') || process.argv.includes('--site-diagnostic')) {
    throw new Error('执行轨迹验收仅允许专用隔离 smoke 子模式。');
  }
  for (const name of ['getState', 'browserState', 'browserBounds', 'telemetryState', 'beginMeasurement', 'finishMeasurement',
    'reviewMeasurement', 'openTestForm', 'prepareFill']) {
    if (typeof methods[name] !== 'function') throw new Error(`执行轨迹验收缺少 ${name}`);
  }
  if (window.isVisible()) throw new Error('执行轨迹验收要求隔离窗口保持隐藏。');
  const steps = new SmokeStepRunner('telemetry-own-renderer-real-isolated-sdk');
  const assertions: Array<{ name: string; passed: true }> = [];
  const expect = (condition: unknown, name: string) => { if (!condition) throw new Error(name); assertions.push({ name, passed: true }); };
  const ui = <T = unknown>(name: string, expression: string) => steps.run(name,
    () => window.webContents.executeJavaScript(expression) as Promise<T>);
  const waitFor = async (name: string, expression: string) => {
    const until = performance.now() + 5_000;
    while (performance.now() < until) { if (await ui<boolean>(name, expression)) return; await delay(25); }
    throw new Error(name);
  };
  const click = (id: string) => ui('own-renderer-button-click', `(() => {
    const button=document.querySelector('[data-testid=${JSON.stringify(id)}]');
    if(!(button instanceof HTMLButtonElement)||button.disabled)throw new Error('本机工作台按钮不可用');button.click();
  })()`);
  const setInput = (id: string, value: string) => ui('own-renderer-review-input-only', `(() => {
    const input=document.querySelector('[data-testid=${JSON.stringify(id)}]');
    if(!(input instanceof HTMLInputElement)||input.type==='checkbox')throw new Error('本机复核输入不可用');
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,${JSON.stringify(value)});
    input.dispatchEvent(new Event('input',{bubbles:true}));input.dispatchEvent(new Event('change',{bubbles:true}));
  })()`);
  const setChecked = (id: string, checked: boolean) => ui('own-renderer-review-checkbox-only', `(() => {
    const input=document.querySelector('[data-testid=${JSON.stringify(id)}]');
    if(!(input instanceof HTMLInputElement)||input.type!=='checkbox')throw new Error('本机复核选项不可用');
    if(input.checked!==${checked})input.click();
  })()`);
  const openDetails = async (id: string) => {
    await ui('own-renderer-expand-details', `(() => {
      const details=document.querySelector('[data-testid=${JSON.stringify(id)}]');
      if(!(details instanceof HTMLDetailsElement))throw new Error('本机执行详情不存在');
      if(!details.open){const summary=details.querySelector(':scope > summary');
        if(!(summary instanceof HTMLElement))throw new Error('本机执行详情入口不存在');summary.click();}
    })()`);
    await waitFor('own-renderer-details-expanded', `document.querySelector('[data-testid=${JSON.stringify(id)}]')?.open===true`);
  };
  const navigate = async () => {
    send({ type: 'navigate', page: 'telemetry' });
    await waitFor('telemetry-page-mounted', 'document.querySelector(\'[data-testid="telemetry-panel"][data-compact="false"]\')?.checkVisibility()===true');
  };
  const state = () => methods.telemetryState!() as Promise<TelemetryState>;
  const readRun = async (id: string) => (await state()).runs.find(run => run.id === id);
  const screenshots: string[] = []; const blockedCommands: string[] = []; const replaced = new Map<string, Methods[string]>();
  const originalBounds = methods.browserBounds!;
  let readonlyViewport: BrowserBounds = { x: 0, y: 0, width: 1000, height: 700 };
  const beforeBusiness = await methods.getState!() as AppState;
  let manualId: string | undefined; let agentId: string | undefined;
  const replace = (name: string, method: Methods[string]) => { replaced.set(name, methods[name]!); methods[name] = method; };
  const screenshot = async (name: string) => {
    const image = await steps.run('own-renderer-screenshot', () => window.webContents.capturePage());
    const path = join(stateDirectory, name); await writeFile(path, image.toPNG(), { mode: 0o600 }); screenshots.push(path);
  };
  const saveReview = async (expectedFields: string, verifiedFields: string, corrections: string, interventions: string) => {
    await openDetails('telemetry-experiments'); await openDetails('telemetry-review');
    await waitFor('review-inputs-mounted', 'Boolean(document.querySelector(\'[data-testid="telemetry-review-expectedFields"]\'))');
    await setInput('telemetry-review-expectedFields', expectedFields); await setInput('telemetry-review-verifiedFields', verifiedFields);
    await setInput('telemetry-review-manualCorrections', corrections); await setInput('telemetry-review-interventions', interventions);
    await setChecked('telemetry-review-clean', true); await click('telemetry-review-save');
  };
  try {
    steps.setStage('install-prohibited-native-provider-and-dialog-guards');
    // Keep the real viewport dimensions for readonly DOM observation while the actual native view stays hidden.
    replace('browserBounds', (bounds: BrowserBounds, _visible: boolean) => {
      if (bounds.width > 0 && bounds.height > 0) readonlyViewport = bounds;
      return originalBounds(readonlyViewport, false);
    });
    for (const name of ['fillApproved', 'runCareerFill', 'prepareCareerFill', 'cancelCareerFill', 'configureModel', 'runAgent', 'cancelAgent',
      'exportTelemetry', 'exportData', 'importApplyDock', 'importResume', 'saveProfile', 'confirmCareerRecord', 'saveJob', 'deleteJob',
      'saveApplication', 'deleteApplication', 'trackJob', 'loadDemo', 'clearDemo', 'refreshSource', 'browserNavigate', 'browserBack',
      'browserForward', 'browserReload', 'capturePage', 'collectPageJobs']) {
      if (typeof methods[name] === 'function') replace(name, async () => { blockedCommands.push(name); throw new Error('隔离轨迹 UI 检查禁止原生填写、模型、对话框或业务改写。'); });
    }
    expect((await state()).runs.length === 0, 'initialIsolatedTelemetryStoreReallyEmpty');
    expect((await state()).activeRunId === undefined, 'noActiveRunBeforeUserAction');
    await navigate();
    await waitFor('empty-state-rendered', 'Boolean(document.querySelector(\'[data-testid="telemetry-empty"]\'))');
    expect(await ui<boolean>('empty-state-has-no-invented-metrics', `(() => {
      const panel=document.querySelector('[data-testid="telemetry-panel"]');
      return panel?.getAttribute('data-run-count')==='0'&&!document.querySelector('[data-testid="telemetry-metrics"]')
        &&!document.querySelector('[data-testid="telemetry-savings"]')
        &&(!document.querySelector('[data-testid="telemetry-export"]')||document.querySelector('[data-testid="telemetry-export"]').disabled===true);
    })()`), 'emptyStateHasZeroRunsNoInventedMetricsOrSavings');
    expect(await ui<boolean>('empty-experiment-default-collapsed', 'document.querySelector(\'[data-testid="telemetry-experiments"]\')?.open===false'), 'manualExperimentDoesNotOccupyInitialOverview');
    await screenshot('telemetry-empty.png');

    steps.setStage('owned-local-readonly-form-and-real-manual-ui-timer');
    const localPage = await methods.openTestForm!() as BrowserState;
    expect(localPage.url.startsWith('file:') && new URL(localPage.url).pathname.endsWith('/apps/desktop/fixtures/application.html'), 'onlyOwnedLocalApplicationFixtureLoaded');
    await openDetails('telemetry-experiments');
    await waitFor('manual-start-button-enabled-for-owned-page', 'document.querySelector(\'[data-testid="telemetry-manual-start"]\')?.disabled===false');
    expect(await ui<boolean>('manual-clean-start-not-assumed', 'document.querySelector(\'[data-testid="telemetry-manual-clean"]\')?.checked===false'), 'blankStartingPointInitiallyUnconfirmed');
    await setInput('telemetry-manual-expected', '3'); await setChecked('telemetry-manual-clean', true);
    await click('telemetry-manual-start');
    await waitFor('manual-ui-start-navigates-to-browser', `(() => {
      const host=document.querySelector('.workspace-browser-host');
      const entry=document.querySelector('[data-testid="browser-telemetry"]');
      const status=document.querySelector('[data-testid="page-auto-fill-status"]');
      return host?.checkVisibility()===true&&entry?.checkVisibility()===true
        &&entry.textContent==='结束人工计时'&&status?.checkVisibility()===true
        &&status.textContent.includes('人工计时进行中');
    })()`);
    const manualStarted = (await state()).runs.find(run => run.mode === 'manual' && run.status === 'running');
    if (!manualStarted) throw new Error('真实人工计时未建立。'); manualId = manualStarted.id;
    expect(manualStarted.source === 'fixture' && manualStarted.expectedFields === 3 && manualStarted.cleanStartConfirmed, 'manualUiInputsReachActualFixtureStore');
    expect(/^[0-9a-f]{32}$/.test(manualStarted.traceId) && manualStarted.traceId !== '0'.repeat(32), 'manualRunUsesRealSdkTraceId');
    expect(manualStarted.modelCalls === 0 && manualStarted.observedVerifiedFields === 0, 'manualTimerDoesNotClaimModelOrActualFieldVerification');
    expect(await ui<boolean>('browser-manual-timer-entry', `(() => {
      const entry=document.querySelector('[data-testid="browser-telemetry"]');
      return entry?.textContent==='结束人工计时'&&document.querySelector('[data-testid="page-auto-fill-status"]')?.textContent.includes('人工计时进行中');
    })()`), 'browserShowsManualTimerAndEndEntry');
    await click('browser-telemetry');
    await waitFor('returned-to-full-telemetry', 'document.querySelector(\'[data-testid="telemetry-panel"][data-compact="false"]\')?.checkVisibility()===true');
    await openDetails('telemetry-experiments');
    await waitFor('manual-finish-control-mounted', 'document.querySelector(\'[data-testid="telemetry-manual-finish"]\')?.disabled===false');
    expect((await state()).activeRunId === manualId, 'returningToTelemetryDoesNotEndTimerEarly');
    await click('telemetry-manual-finish');
    await waitFor('manual-review-mounted-after-end', 'Boolean(document.querySelector(\'[data-testid="telemetry-review"]\'))&&!document.querySelector(\'[data-testid="telemetry-manual-finish"]\')');
    const manualFinished = await readRun(manualId);
    expect(manualFinished?.status === 'completed' && typeof manualFinished.durationMs === 'number' && manualFinished.durationMs > 0, 'manualEndPersistsPositiveActualElapsedTime');
    expect(manualFinished?.reviewed === false, 'endingTimerDoesNotInventHumanReview');
    expect(manualFinished?.spans.some(span => span.name === 'apply.run' && !span.parentId), 'manualTimerHasSdkRootSpan');
    await saveReview('0', '0', '0', '0');
    expect(await ui<boolean>('invalid-review-remains-visible', 'Boolean(document.querySelector(\'[data-testid="telemetry-review"] .inline-error\'))'), 'invalidZeroTargetReviewRejectedByUi');
    expect((await readRun(manualId))?.reviewed === false, 'invalidReviewDoesNotChangeActualStore');
    await saveReview('3', '3', '1', '2');
    await waitFor('manual-review-save-shown', 'document.querySelector(\'[data-testid="telemetry-review"] summary\')?.textContent.includes("人工复核已保存")===true');
    const manualReviewed = await readRun(manualId);
    expect(manualReviewed?.reviewed && manualReviewed.verifiedFields === 3 && manualReviewed.manualCorrections === 1 && manualReviewed.interventions === 2, 'fictionalManualReviewCountsPersistThroughActualIpc');
    expect(manualReviewed?.observedVerifiedFields === 0, 'fictionalReviewNeverRewritesActualExecutorVerifiedCount');
    expect(!!manualReviewed?.reviewedAt && typeof manualReviewed.reviewDurationMs === 'number' && manualReviewed.reviewDurationMs >= 0
      && typeof manualReviewed.totalDurationMs === 'number' && manualReviewed.totalDurationMs >= manualReviewed.durationMs!, 'manualFirstReviewAddsActualReviewIntervalToTotal');

    steps.setStage('actual-host-rule-only-observation-and-sdk-child-span');
    const agentStarted = await methods.beginMeasurement!({ mode: 'agent', expectedFields: 3, cleanStartConfirmed: true }) as TelemetryRun;
    agentId = agentStarted.id;
    expect(agentStarted.source === 'fixture' && agentStarted.scenarioKey === manualStarted.scenarioKey, 'agentAndManualSameOwnedPageAndProfileScenarioFromHost');
    expect(agentStarted.traceId !== manualStarted.traceId, 'separateRoundsUseSeparateSdkTraces');
    const plan = await methods.prepareFill!({ useModel: false }) as FillPlan;
    expect(plan.url === localPage.url && Array.isArray(plan.items) && plan.items.length > 0, 'actualProductionObserverReadsOwnedFixtureWithoutModel');
    const agentFinished = await methods.finishMeasurement!({ id: agentId, status: 'completed' }) as TelemetryRun;
    expect(agentFinished.status === 'completed' && (agentFinished.durationMs ?? 0) > 0, 'actualAgentRunEndsAndPersistsDuration');
    expect(agentFinished.observedVerifiedFields === 0 && agentFinished.verifiedFields === 0, 'readonlyPlanDoesNotClaimAnyFieldWasFilledOrVerified');
    expect(agentFinished.modelCalls === 0 && agentFinished.usageComplete === true && agentFinished.tokens?.totalTokens === 0, 'ruleOnlyRecognitionHasKnownZeroModelUsage');
    const root = agentFinished.spans.find(span => span.name === 'apply.run' && !span.parentId);
    const child = agentFinished.spans.find(span => span.name === 'form.recognize');
    expect(!!root && !!child && child.parentId === root.id, 'actualSdkRecognitionSpanIsChildOfActualRunRoot');
    expect(!!child && /^[0-9a-f]{16}$/.test(child.id) && /^\d+$/.test(child.startTimeUnixNano)
      && BigInt(child.endTimeUnixNano) >= BigInt(child.startTimeUnixNano), 'sdkChildSpanRetainsValidIdsAndExactExportTimestamps');
    expect(!agentFinished.spans.some(span => span.name === 'model.request' || span.name === 'form.fill' || span.name === 'career.fill'), 'noModelRequestOrNativeFillSpanWasFabricated');
    // Start from a genuinely new full view. The previous view correctly retains the
    // experiment the participant opened for review; hiding it by mutation would not test defaults.
    send({ type: 'navigate', page: 'browser' });
    await waitFor('browser-return-before-new-full-telemetry', 'document.querySelector(\'.workspace-browser-host\')?.checkVisibility()===true');
    await navigate();
    await waitFor('full-telemetry-latest-runs', 'document.querySelectorAll(\'[data-testid="telemetry-run"]\').length===2');
    expect(await ui<boolean>('default-visual-overview-not-raw-table', `(() => {
      return document.querySelector('[data-testid="telemetry-experiments"]')?.open===false
        &&document.querySelector('[data-testid="telemetry-advanced"]')?.open===false
        &&document.querySelector('[data-testid="telemetry-raw-trace"]')?.open===false
        &&!document.querySelector('[data-testid="telemetry-stage-steps"]');
    })()`), 'experimentRawTraceAndFieldDetailsInitiallyCollapsed');
    await openDetails('telemetry-advanced');
    await ui('own-renderer-expand-run-history', `(() => {const history=document.querySelector('.telemetry-history');
      if(!(history instanceof HTMLDetailsElement))throw new Error('本机执行历史不存在');
      if(!history.open)history.querySelector('summary').click();})()`);
    await waitFor('bothActualRunsRendered', 'document.querySelectorAll(\'[data-testid="telemetry-run"]\').length===2');
    await ui('select-actual-agent-run', `(() => {const button=document.querySelector('[data-testid="telemetry-run"][data-run-id=${JSON.stringify(agentId)}]');if(!button)throw new Error('本机轨迹记录缺失');button.click();})()`);
    await waitFor('actual-agent-detail-selected', `document.querySelector('[data-testid="telemetry-metrics"]')?.getAttribute('data-selected-run')===${JSON.stringify(agentId)}`);
    expect(await ui<boolean>('stages-from-actual-sdk-child-only', `(() => {
      const stages=[...document.querySelectorAll('[data-testid="telemetry-stage"]')];
      return stages.length===1&&stages[0].getAttribute('data-stage-id')==='recognize'
        &&stages[0].getAttribute('data-span-count')===${JSON.stringify(String(agentFinished.spans.filter(span => ['form.observe', 'form.recognize', 'model.request'].includes(span.name)).length))}
        &&stages[0].textContent.includes('识别页面')
        &&!document.querySelector('[data-testid="telemetry-stage"][data-stage-id="verify"]');
    })()`), 'visualPhaseDerivedFromActualRecognitionSpanWithoutInventedFillOrVerifyPhase');
    await click('telemetry-stage');
    await waitFor('actual-phase-steps-mounted', 'Boolean(document.querySelector(\'[data-testid="telemetry-stage-steps"]\'))');
    expect(await ui<boolean>('phase-opens-actual-sdk-child', `(() => {
      const steps=[...document.querySelectorAll('[data-testid="telemetry-stage-step"]')];
      return steps.length===1&&steps[0].getAttribute('data-span-id')===${JSON.stringify(child!.id)}
        &&steps[0].textContent.includes('识别与匹配字段')
        &&!steps.some(step=>step.getAttribute('data-span-id')===${JSON.stringify(root!.id)});
    })()`), 'stageExpansionShowsActualChildAndExcludesContainerDoubleCount');
    await openDetails('telemetry-raw-trace');
    expect(await ui<boolean>('actual-root-child-timeline-shown', `(() => {
      const root=document.querySelector('[data-testid="telemetry-span"][data-span-id=${JSON.stringify(root!.id)}]');
      const child=document.querySelector('[data-testid="telemetry-span"][data-span-id=${JSON.stringify(child!.id)}]');
      return root?.getAttribute('data-depth')==='0'&&child?.getAttribute('data-depth')==='1'
        &&child?.getAttribute('data-parent-id')===${JSON.stringify(root!.id)}&&root.textContent.includes('整次填写')&&child.textContent.includes('识别与匹配字段');
    })()`), 'actualSdkParentChildSpansAppearAsChineseNestedTimeline');
    expect(await ui<boolean>('trajectory-boundary-description', "document.querySelector('[data-testid=\"telemetry-panel\"]')?.textContent.includes('只含动作、计数和时间，不含资料值或私有思考')===true"), 'uiNamesToolTrajectoryInsteadOfPrivateChainOfThought');
    expect(await ui<boolean>('known-zero-token-label', "document.querySelector('[data-testid=\"telemetry-tokens\"]')?.textContent==='0 · 未调用模型'&&document.querySelector('[data-testid=\"telemetry-model-calls\"]')?.textContent==='0 次'"), 'ruleZeroTokensExplicitlyDistinguishedFromUnknownUsage');
    await openDetails('telemetry-experiments');
    expect(await ui<boolean>('fixture-excluded-from-latency', 'document.querySelector(\'[data-testid="telemetry-latency"]\')?.getAttribute("data-sample-count")==="0"&&document.querySelector(\'[data-testid="telemetry-latency"]\')?.textContent.includes("样本不足 20 轮")'), 'fixtureRunsNeverBecomeProductionLatencySamples');
    await saveReview('3', '3', '0', '0');
    await waitFor('agent-faux-review-saved', 'document.querySelector(\'[data-testid="telemetry-review"] summary\')?.textContent.includes("人工复核已保存")===true');
    const agentReviewed = await readRun(agentId);
    expect(agentReviewed?.reviewed && agentReviewed.verifiedFields === 3 && agentReviewed.observedVerifiedFields === 0, 'fictionalAgentReviewSeparateFromActualZeroExecutorCount');
    expect(!!agentReviewed?.reviewedAt && typeof agentReviewed.reviewDurationMs === 'number' && agentReviewed.reviewDurationMs >= 0
      && typeof agentReviewed.totalDurationMs === 'number' && agentReviewed.totalDurationMs >= agentReviewed.durationMs!, 'agentFirstReviewIncludesPostExecutionReviewIntervalToo');
    expect(await ui<boolean>('total-time-includes-review-label', 'document.querySelector(\'[data-testid="telemetry-total-duration"]\')?.textContent.includes("含核对总耗时")===true'), 'uiSeparatesExecutionTimeFromIncludingReviewTotal');
    expect(await ui<boolean>('fixture-pair-no-invented-savings', `(() => {
      const panel=document.querySelector('[data-testid="telemetry-comparison"]');
      return panel?.getAttribute('data-comparable')==='false'&&panel.textContent.includes('演示或测试记录不能用于实际效率比较')
        &&!document.querySelector('[data-testid="telemetry-savings"]');
    })()`), 'evenCompleteReviewedFixturePairCannotDisplayEfficiencyImprovement');
    expect(await ui<boolean>('export-entry-available-without-opening-dialog', 'document.querySelector(\'[data-testid="telemetry-export"]\')?.disabled===false'), 'exportButtonPresentAndEnabledAfterRunsWithoutInvokingDialog');
    expect(await ui<boolean>('executor-and-review-distinct-in-detail', "document.querySelector('[data-testid=\"telemetry-detail\"]')?.textContent.includes('执行器核实 0 项')&&document.querySelector('[data-testid=\"telemetry-detail\"]')?.textContent.includes('人工复核 3 项正确')"), 'uiDistinguishesActualExecutorZeroFromFictionalHumanReview');
    await screenshot('telemetry-trace-and-comparison.png');
    await ui('own-renderer-scroll-to-comparison', 'document.querySelector(\'[data-testid="telemetry-comparison"]\').scrollIntoView({block:"end"})');
    await screenshot('telemetry-comparison.png');

    steps.setStage('compact-trajectory-in-320px-agent-dock');
    send({ type: 'navigate', page: 'browser' });
    await waitFor('browser-host-shown-before-compact-tab', 'document.querySelector(\'.workspace-browser-host\')?.checkVisibility()===true');
    await click('workspace-tab-activity');
    await waitFor('compact-page-visible', 'document.querySelector(\'[data-testid="telemetry-panel"][data-compact="true"]\')?.checkVisibility()===true');
    await waitFor('compact-latest-run-loaded', `document.querySelector('[data-testid="telemetry-panel"][data-compact="true"] [data-testid="telemetry-metrics"]')?.getAttribute('data-selected-run')===${JSON.stringify(agentId)}`);
    expect(await ui<boolean>('compact-shows-overview-without-experiment', `(() => {
      const compact=document.querySelector('[data-testid="telemetry-panel"][data-compact="true"]');
      return compact?.querySelector('[data-testid="telemetry-metrics"]')?.getAttribute('data-selected-run')===${JSON.stringify(agentId)}
        &&compact.querySelector('[data-testid="telemetry-compact-details"]')?.open===true
        &&compact.querySelector('[data-testid="telemetry-stage-view"]')?.checkVisibility()===true
        &&!compact.querySelector('[data-testid="telemetry-experiments"]')
        &&!compact.querySelector('[data-testid="telemetry-advanced"]');
    })()`), 'compactStartsWithRunPickerAndMetricsWithoutExperimentOrRawTrace');
    await openDetails('telemetry-compact-details');
    expect(await ui<boolean>('compact-320-pixel-container', `(async () => {
      const space=document.querySelector('[data-testid="application-space"]');
      const dock=document.querySelector('[data-testid="workspace-dock"]');
      const compact=document.querySelector('[data-testid="telemetry-panel"][data-compact="true"]');
      if(!(space instanceof HTMLElement)||!(dock instanceof HTMLElement)||!(compact instanceof HTMLElement))return false;
      const previous=space.style.gridTemplateColumns;
      try {space.style.gridTemplateColumns='320px 7px minmax(0,1fr)';
        await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
        const rect=compact.getBoundingClientRect(),outer=dock.getBoundingClientRect();
        return outer.width<=321&&outer.width>=319&&rect.width>0&&rect.width<=320
          &&rect.left>=outer.left&&rect.right<=outer.right+1&&compact.scrollWidth<=compact.clientWidth+1
          &&compact.querySelector('[data-testid="telemetry-stage"]')?.getAttribute('data-stage-id')==='recognize';
      } finally {space.style.gridTemplateColumns=previous;}
    })()`), 'expandedCompactTrajectoryFitsActual320PixelDockWithoutPageOverflow');
    await screenshot('telemetry-compact.png');

    steps.setStage('unchanged-business-and-no-native-provider-operations');
    expect(JSON.stringify(await methods.getState!()) === JSON.stringify(beforeBusiness), 'profileJobsApplicationsAndBusinessStoreUnchanged');
    expect((await methods.browserState!() as BrowserState).visible === false, 'actualNativeViewStayedHidden');
    expect(!window.isVisible(), 'isolatedWindowStayedHidden');
    expect(blockedCommands.length === 0, 'noForbiddenFillModelDialogClipboardOrBusinessCommandAttempted');
    const finalState = await state();
    expect(finalState.runs.length === 2 && finalState.runs.every(run => run.source === 'fixture') && !finalState.activeRunId, 'exactlyTwoEndedFixtureSdkRunsAndNoActiveTimer');
    const report = { ok: true, assertionCount: assertions.length, assertions, screenshots,
      realIsolatedBackendAndStore: true, realOpenTelemetrySdk: true, uiInteractionOnlyOnOwnedRenderer: true,
      reviewCountsAreFictionalProtocolInputs: true, realManualBenchmark: false, realFieldCorrectnessEvaluated: false,
      productionEfficiencySamples: 0, nativeInputs: 0, nativeEnterpriseInputs: 0, realModelCalls: 0,
      actualRuleOnlyPlan: true, ownedLocalFixtureOnly: true, dialogsOpened: 0, exportButtonOnly: true,
      actualNativeViewRemainedHidden: true, isolatedWindowRemainedHidden: true, businessStoreUnchanged: true,
      manualRunId: manualId, agentRunId: agentId, sdkSpanCount: agentReviewed?.spans.length ?? 0,
      fixturePairCannotShowImprovement: true, blockedCommands, harness: steps.snapshot(),
      interactionMethod: 'Own renderer scripted button/checkbox click and own React review input value setter/input/change. Actual host methods and SDK trace owned local readonly fixture. No native page input or model.' };
    await writeFile(join(stateDirectory, 'smoke-telemetry-report.json'), JSON.stringify(report, null, 2), { mode: 0o600 }); return report;
  } catch (error) {
    let rendererDiagnostic: unknown = { available: false };
    try { rendererDiagnostic = await ui('readonly-owned-fixture-navigation-diagnostic', `(() => {
      const entry=document.querySelector('[data-testid="browser-telemetry"]');
      const status=document.querySelector('[data-testid="page-auto-fill-status"]');
      const host=document.querySelector('.workspace-browser-host');
      return { available:true,
        panels:[...document.querySelectorAll('[data-testid="telemetry-panel"]')].map(panel=>({
          compact:panel.getAttribute('data-compact'),visible:panel.checkVisibility(),activeMode:panel.getAttribute('data-active-mode'),runCount:panel.getAttribute('data-run-count')})),
        browserEntry:{text:entry?.textContent??null,visible:entry?.checkVisibility()??false},
        browserStatus:{text:status?.textContent??null,visible:status?.checkVisibility()??false},
        browserHost:{visible:host?.checkVisibility()??false,hidden:host instanceof HTMLElement?host.hidden:null},
      };
    })()`); } catch { /* Preserve the original failure if the isolated renderer is unavailable. */ }
    try { await screenshot('telemetry-failure.png'); } catch { /* A failed capture is not evidence of UI success. */ }
    await writeFile(join(stateDirectory, 'smoke-telemetry-failure.json'), JSON.stringify({ ok: false, assertionCount: assertions.length,
      assertions, screenshots, reviewCountsAreFictionalProtocolInputs: true, realManualBenchmark: false,
      nativeInputs: 0, realModelCalls: 0, blockedCommands, manualRunId: manualId, agentRunId: agentId,
      message: error instanceof Error ? error.message : '隔离轨迹验收未完成。', rendererDiagnostic, harness: steps.snapshot() }, null, 2), { mode: 0o600 }); throw error;
  } finally {
    for (const [name, method] of replaced) methods[name] = method;
  }
}
