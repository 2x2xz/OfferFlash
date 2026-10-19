import type { BrowserWindow } from 'electron';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { AppEvent, AppState, FillPlan, JobInput } from '../../packages/shared/src/contracts.js';
import { SmokeDeadlineError, SmokeStepRunner } from './smoke-deadline.js';

/** Renderer and native-keyboard regression checks. Only isolated, explicit UI fixtures are used. */
export async function smokeUINavigation(
  window: BrowserWindow,
  methods: Record<string, (...args: any[]) => Promise<any>>,
  send: (event: AppEvent) => void,
  stateDirectory: string,
) {
  if (!process.argv.includes('--smoke-test')) throw new Error('UI 回归样本只能在隔离桌面 smoke 中运行。');
  for (const method of ['getState', 'loadDemo', 'saveJob', 'saveApplication', 'browserState', 'openTestForm', 'prepareFill']) {
    if (typeof methods[method] !== 'function') throw new Error(`UI smoke 缺少实际方法：${method}`);
  }
  const assertions: Record<string, unknown> = { fixtureOnly: true, realSiteVerified: false, screenshots: [] as string[] };
  const sections: Record<string, boolean> = {};
  const steps = new SmokeStepRunner('ui-navigation');
  const evaluate = <T = any>(code: string): Promise<T> => steps.run('renderer-script', () => window.webContents.executeJavaScript(code));
  const frames = () => steps.run('two-animation-frames', () => window.webContents.executeJavaScript('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))'));
  async function activateNativeUI() {
    await steps.run('activate-native-ui', async () => {
      const { app } = await import('electron');
      app.focus({ steal: true }); window.show(); window.focus(); window.webContents.focus();
      const deadline = Date.now() + 600;
      while (!window.isFocused() || !window.webContents.isFocused()) {
        if (Date.now() >= deadline) throw new Error('UI smoke window did not obtain native focus within 600ms');
        await new Promise(resolve => setTimeout(resolve, Math.min(20, deadline - Date.now())));
      }
    }, 600);
  }
  function assertNativeUIFocused() {
    steps.assertActive();
    if (!window.isFocused() || !window.webContents.isFocused()) throw new Error('UI smoke lost native focus before sending input');
  }
  function expect(condition: unknown, message: string): asserts condition { if (!condition) throw new Error(message); }
  async function waitFor(code: string, message: string, timeoutMs = 12_000) {
    const until = Date.now() + timeoutMs;
    do {
      if (await steps.run('wait-renderer-state', () => window.webContents.executeJavaScript(code) as Promise<boolean>, Math.max(1, Math.min(5_000, until - Date.now())))) return;
      await new Promise(resolve => setTimeout(resolve, 35));
    } while (Date.now() < until);
    throw new Error(message);
  }
  async function navigate(page: 'browser' | 'jobs' | 'dashboard' | 'applications') {
    send({ type: 'navigate', page });
    await waitFor(`document.querySelector('.topbar h1')?.textContent === ${JSON.stringify({ browser: '内置浏览器', jobs: '岗位库', dashboard: '任务总览', applications: '申请进度' }[page])}`, `没有切换到 ${page}`);
    await frames();
  }
  async function screenshot(name: string) {
    await evaluate('document.querySelector(".toast button")?.click()');
    await frames();
    const path = join(stateDirectory, name);
    await writeFile(path, (await steps.run('renderer-screenshot', () => window.webContents.capturePage(), 8_000)).toPNG());
    (assertions.screenshots as string[]).push(path);
  }
  async function section(name: string, work: () => Promise<unknown>) {
    try { steps.assertActive(); steps.setStage(name); assertions[name] = await work(); sections[name] = true; }
    catch (error) {
      sections[name] = false;
      assertions[name] = { ok: false, error: error instanceof Error ? error.message : String(error), harness: steps.snapshot() };
      await writeFile(join(stateDirectory, `ui-navigation-${name}-failure.json`), JSON.stringify(assertions[name], null, 2));
      // Electron cannot cancel a suspended script/capture. Stop the whole smoke
      // instead of starting chat/native checks alongside that pending operation.
      if (error instanceof SmokeDeadlineError) throw error;
    }
  }
  async function setInput(selector: string, value: string, kind: 'input' | 'select' = 'input') {
    await evaluate(`(() => {
      const input = document.querySelector(${JSON.stringify(selector)});
      if (!input) throw new Error('未找到 UI 输入');
      input.focus();
      const proto = ${kind === 'select' ? 'HTMLSelectElement' : 'HTMLInputElement'}.prototype;
      Object.getOwnPropertyDescriptor(proto, 'value').set.call(input, ${JSON.stringify(value)});
      input.dispatchEvent(new Event(${JSON.stringify(kind === 'select' ? 'change' : 'input')}, {bubbles:true}));
    })()`);
    await frames();
  }
  async function focus(selector: string) {
    await activateNativeUI();
    await evaluate(`(() => {
      const item = document.querySelector(${JSON.stringify(selector)});
      if (!item) throw new Error('未找到可聚焦 UI 元素');
      item.scrollIntoView({block:'center'}); item.focus({preventScroll:true});
    })()`);
    await frames();
  }
  async function press(keyCode: string, nativeTextKey = false) {
    await activateNativeUI(); assertNativeUIFocused();
    window.webContents.sendInputEvent({ type: 'keyDown', keyCode });
    // A focused native text input's implicit form submit needs the Return character,
    // while the focusable application's keydown handler is already exercised without it.
    if (nativeTextKey && keyCode === 'Return') window.webContents.sendInputEvent({ type: 'char', keyCode: '\r' });
    window.webContents.sendInputEvent({ type: 'keyUp', keyCode });
    await frames();
  }
  async function click(selector: string) {
    await activateNativeUI();
    const point = await evaluate<{ x: number; y: number }>(`(async () => {
      const item = document.querySelector(${JSON.stringify(selector)});
      if (!item || item.disabled) throw new Error('UI 点击目标不存在或不可用');
      item.scrollIntoView({block:'center'});
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      const r = item.getBoundingClientRect();
      if (!r.width || !r.height) throw new Error('UI 点击目标不可见');
      return {x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2)};
    })()`);
    assertNativeUIFocused();
    window.webContents.sendInputEvent({ type: 'mouseMove', ...point });
    window.webContents.sendInputEvent({ type: 'mouseDown', ...point, button: 'left', clickCount: 1 });
    window.webContents.sendInputEvent({ type: 'mouseUp', ...point, button: 'left', clickCount: 1 });
    await frames();
  }
  const ids = { multiple: 'ui-smoke-multicity', unsuitable: 'ui-smoke-unsuitable', waiting: 'ui-smoke-waiting', task: 'ui-smoke-task', offer: 'ui-smoke-offer', keyboard: 'ui-smoke-keyboard-3' };
  const company = '虚构 UI 回归企业';
  await methods.loadDemo!();
  const jobFixture: JobInput = { id: ids.multiple, company, title: 'UI导航测试 多城市资格待核对', city: '上海、杭州、深圳等 4 个城市', type: 'campus',
    description: '仅本地 UI 测试：Python 与大模型研发。', requirements: '具体毕业窗口需人工核对。', url: 'https://example.invalid/ui-smoke/multicity', sourceId: 'ui-smoke', sourceName: '虚构本地 UI 样本', publishedAt: null, deadline: null, demo: true };
  await methods.saveJob!(jobFixture);
  await methods.saveJob!({ ...jobFixture, id: ids.unsuitable, title: 'UI导航测试 已知不符岗位', city: '北京', url: 'https://example.invalid/ui-smoke/unsuitable', deadline: '2000-01-01' });
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date());
  const part = (type: string) => parts.find(value => value.type === type)!.value;
  const today = `${part('year')}-${part('month')}-${part('day')}`;
  for (const [id, status, deadline] of [[ids.waiting, 'applied', '2000-01-01'], [ids.task, 'assessment', today], [ids.offer, 'offer', today]] as const) {
    await methods.saveApplication!({ id, company, title: `UI导航测试 ${id}`, url: '', status, deadline, notes: '虚构 UI 回归记录，不代表企业通知或真实投递。' });
  }
  // A tall column makes unintended native Space scrolling observable, rather than testing on a non-scrollable page.
  for (let index = 0; index < 8; index++) await methods.saveApplication!({
    id: `ui-smoke-keyboard-${index}`, company, title: `键盘回归岗位 ${index}`, url: '', status: 'saved', deadline: null,
    notes: '仅本地测试的较长说明，用于建立可滚动看板；此记录没有真实申请。',
  });

  await section('browserAddress', async () => {
    await methods.openTestForm!();
    await navigate('browser');
    const initial = await methods.browserState!();
    await focus('[aria-label="网页地址"]');
    await setInput('[aria-label="网页地址"]', 'example.invalid/ui-unsubmitted-draft');
    await evaluate('document.querySelector(\'[aria-label="网页地址"]\').blur()');
    await frames();
    expect(await evaluate('document.querySelector(\'[aria-label="网页地址"]\').value === "example.invalid/ui-unsubmitted-draft"'), '地址失焦吞掉了未提交草稿');
    expect((await methods.browserState!()).url === initial.url, '编辑地址草稿触发了导航');
    await focus('[aria-label="网页地址"]');
    await setInput('[aria-label="网页地址"]', 'javascript:alert(1)');
    await focus('[aria-label="网页地址"]');
    await evaluate(`(() => {
      window.__uiAddressKeys = [];
      const input = document.querySelector('[aria-label="网页地址"]');
      for (const type of ['keydown', 'keypress', 'keyup']) input.addEventListener(type, event => {
        window.__uiAddressKeys.push({type, key:event.key, trusted:event.isTrusted, composing:event.isComposing});
      }, {once:true});
      document.querySelector('.browser-address').addEventListener('submit', event => {
        window.__uiAddressKeys.push({type:'submit', trusted:event.isTrusted});
      }, {once:true});
    })()`);
    await press('Return', true);
    await waitFor('Boolean(document.querySelector("#browser-address-error"))', '无效网址回车后没有字段错误');
    expect((await methods.browserState!()).url === initial.url, '被拒绝的网址仍改变了浏览器目标');
    expect(await evaluate('document.querySelector(\'[aria-label="网页地址"]\').getAttribute("aria-invalid") === "true"'), '地址错误没有暴露 aria-invalid');
    await press('Escape');
    await waitFor(`document.querySelector('[aria-label="网页地址"]').value === ${JSON.stringify(initial.url)} && !document.querySelector('#browser-address-error')`, 'Escape 没有还原实际网址及清除错误');
    send({ type: 'browser', state: { ...initial, loading: true } });
    await frames();
    const loadingFeedback = await evaluate('document.querySelector(".browser-content-heading").innerText.includes("页面加载中") && document.querySelector(".browser-address button").disabled');
    send({ type: 'browser', state: await methods.browserState!() });
    await frames();
    expect(loadingFeedback, '已知 loading 状态没有显示加载反馈或禁止重复导航');
    await screenshot('ui-browser-address.png');
    return { ok: true, draftPreservedOnBlur: true, noNavigationForDraftOrInvalidInput: true, escapeRestoresActualURL: true, loadingFixtureFeedback: loadingFeedback,
      nativeAddressKeyEvents: await evaluate('window.__uiAddressKeys') };
  });

  await section('formPreview', async () => {
    await methods.openTestForm!();
    await navigate('browser');
    // Restore an uncommitted address left by a prior failed group before capturing other UI states.
    await focus('[aria-label="网页地址"]');
    await press('Escape');
    const plan = await methods.prepareFill!() as FillPlan;
    send({ type: 'form-preview', plan });
    await waitFor(`document.querySelector('.form-preview')?.getAttribute('data-plan-id') === ${JSON.stringify(plan.id)}`, '真实填写预览没有显示');
    if (!await evaluate('document.querySelector(".browser-manual-tools").open')) await click('.browser-manual-tools > summary');
    const ready = plan.items.filter(item => item.status === 'ready');
    expect(ready.length >= 2, '隔离虚构资料未产生可用于勾选验证的 ready 字段');
    const first = ready[0]!;
    const checkbox = `[id=${JSON.stringify(`preview-${plan.id}-${first.fieldId}`)}]`;
    const label = `[for=${JSON.stringify(`preview-${plan.id}-${first.fieldId}`)}]`;
    expect(await evaluate(`document.querySelector(${JSON.stringify(checkbox)}).checked`), '预览的可填项没有默认勾选');
    await click(label);
    expect(await evaluate(`!document.querySelector(${JSON.stringify(checkbox)}).checked`), '点击字段标签没有切换真实 checkbox');
    await click('.preview-selection-tools button:first-child');
    expect(await evaluate(`document.querySelectorAll('.form-preview input[type=checkbox]:checked').length === ${ready.length}`), '全选未选中全部可填项');
    await click('.preview-selection-tools button:last-child');
    expect(await evaluate('document.querySelectorAll(".form-preview input[type=checkbox]:checked").length === 0 && document.querySelector(".fill-confirm button").disabled'), '清空选择后仍可执行填写');
    const name = ready.find(item => item.label === '姓名');
    const degree = ready.find(item => item.label === '学历');
    expect(name && degree, '真实样表未提供姓名及学历可填字段，无法验证文本与原生下拉');
    for (const item of [name, degree]) await click(`[for=${JSON.stringify(`preview-${plan.id}-${item.fieldId}`)}]`);
    await click('.fill-confirm button');
    await waitFor('document.querySelectorAll(".preview-row.verified").length === 2 && document.querySelectorAll(".preview-row.unresolved").length === 0', '真实原生填写没有同时验证姓名与学历下拉');
    expect(await evaluate('Array.from(document.querySelectorAll(".preview-row.verified")).some(row => row.innerText.includes("学历"))'), '学历没有显示实际重读后的已验证结果');
    expect(await evaluate('document.querySelector(".fill-confirm button").disabled && document.querySelector(".preview-row.verified input[type=checkbox]") === null'), '一次性预览被允许重复填写已完成项');
    await evaluate('document.querySelector(".preview-row.verified").scrollIntoView({block:"center"}); document.activeElement?.blur()');
    await screenshot('ui-form-preview-complete.png');
    return { ok: true, realPlanId: plan.id, labelTogglesCheckbox: true, selectAllAndClear: true, nativeVerifiedFields: 2, nativeSelectVerified: true, actualUnresolvedSelectFields: 0, repeatedFillBlocked: true };
  });

  await section('jobsFilters', async () => {
    send({ type: 'state', state: await methods.getState!() });
    await navigate('jobs');
    await setInput('[aria-label="筛选已保存岗位"]', 'UI导航测试');
    await setInput('[aria-label="城市筛选"]', '杭州', 'select');
    await waitFor('document.querySelectorAll(".job-card").length === 1 && document.querySelector(".job-card").innerText.includes("多城市资格待核对")', '明示多城市岗位未匹配杭州筛选');
    const filtered = await evaluate('document.querySelector(".filters .filter-count").textContent');
    await screenshot('ui-jobs-multicity.png');
    await click('.jobs-clear-filters');
    const state = await methods.getState!() as AppState;
    const visible = state.jobs.filter(job => !job.demo || state.settings.showDemo).length;
    await waitFor(`document.querySelectorAll('.job-card').length === ${visible}`, '清除筛选后没有恢复本地岗位范围');
    expect(await evaluate('document.querySelector(\'[aria-label="筛选已保存岗位"]\').value === "" && document.querySelector(\'[aria-label="城市筛选"]\').value === "" && document.querySelector(".jobs-clear-filters").disabled'), '清除按钮没有清除实际筛选状态');
    return { ok: true, explicitMulticityMatched: true, filteredLabel: filtered, restoredSavedJobs: visible };
  });

  await section('dashboardFacts', async () => {
    const actual = await methods.getState!() as AppState;
    const multiple = actual.jobs.find(job => job.id === ids.multiple);
    const unsuitable = actual.jobs.find(job => job.id === ids.unsuitable);
    expect(multiple && unsuitable && unsuitable.match.eligible === 'unsuitable', '隔离样本没有形成真实的已知条件不符岗位');
    // Feed a valid historical-score fixture through the public app event boundary, not React internals.
    // The SQLite match score remains unchanged; this checks rendering of a possible stale high score.
    send({ type: 'state', state: { ...actual, jobs: [multiple, { ...unsuitable, match: { ...unsuitable.match, score: 100 } }],
      applications: actual.applications.filter(item => [ids.waiting, ids.task, ids.offer].includes(item.id)) } });
    await navigate('dashboard');
    await waitFor('Boolean(document.querySelector(\'[data-dashboard-section="recommended"]\'))', '工作台推荐区域缺失');
    expect(await evaluate(`!document.querySelector('[data-dashboard-section="recommended"] [data-job-id=${JSON.stringify(ids.unsuitable)}]') && Boolean(document.querySelector('[data-dashboard-section="recommended"] [data-job-id=${JSON.stringify(ids.multiple)}]'))`), '高分已知不符岗位进入推荐或复核候选被丢弃');
    expect(await evaluate(`document.querySelector('[data-dashboard-section="agenda"] [data-application-id=${JSON.stringify(ids.waiting)}]').getAttribute('data-waiting-on') === 'other' && document.querySelector('[data-dashboard-section="agenda"] [data-application-id=${JSON.stringify(ids.task)}]').getAttribute('data-waiting-on') === 'user'`), '工作台没有区分等待企业和用户待办');
    expect(await evaluate('document.querySelector(\'[data-dashboard-section="agenda"]\').innerText.includes("等待企业") && document.querySelector(\'[data-dashboard-section="agenda"]\').innerText.includes("由你处理")'), '等待方标记只存在于属性，没有呈现给用户');
    await screenshot('ui-dashboard-boundaries.png');
    const unchanged = (await methods.getState!() as AppState).jobs.find(job => job.id === ids.unsuitable)!.match.score === unsuitable.match.score;
    expect(unchanged, 'UI 旧分数回归样本改写了业务评分');
    send({ type: 'state', state: await methods.getState!() });
    return { ok: true, staleHighScoreFixtureOnly: true, actualStoreScoreUnchanged: true, unsuitableNotRecommended: true, waitingPartyVisible: true };
  });

  await section('applicationKeyboard', async () => {
    send({ type: 'state', state: await methods.getState!() });
    await navigate('applications');
    const selector = `.keyboard-activatable[data-application-id=${JSON.stringify(ids.keyboard)}]`;
    const outcomes: Array<{ view: string; key: string; focusRestored: boolean; scrollUnchanged: boolean }> = [];
    for (const mode of ['看板视图', '列表视图']) {
      await click(`[aria-label=${JSON.stringify(mode)}]`);
      expect(await evaluate(`document.querySelector('[aria-label=${JSON.stringify(mode)}]').getAttribute('aria-pressed') === 'true'`), '申请视图未标记当前 aria-pressed');
      for (const key of ['Space', 'Return']) {
        await focus(selector);
        const before = await evaluate<number>('Array.from(document.querySelectorAll(".page-scroll")).find(el => el.offsetParent !== null).scrollTop');
        await press(key);
        await waitFor('Boolean(document.querySelector("[role=dialog]"))', `${mode} ${key} 没有打开记录`);
        expect(await evaluate('document.querySelector("[role=dialog]").innerText.includes("这份申请的下一步")'), '键盘打开的不是实际申请编辑弹窗');
        const after = await evaluate<number>('Array.from(document.querySelectorAll(".page-scroll")).find(el => el.offsetParent !== null).scrollTop');
        expect(before === after, `${mode} ${key} 导致后台页面滚动`);
        await press('Escape');
        await waitFor(`!document.querySelector('[role=dialog]') && document.activeElement?.getAttribute('data-application-id') === ${JSON.stringify(ids.keyboard)}`, '弹窗关闭后没有把焦点还给原申请卡片');
        outcomes.push({ view: mode, key, focusRestored: true, scrollUnchanged: true });
      }
    }
    await screenshot('ui-application-keyboard-focus.png');
    return { ok: true, nativeKeyboard: true, outcomes };
  });
  send({ type: 'state', state: await methods.getState!() });
  const ok = Object.keys(sections).length === 5 && Object.values(sections).every(Boolean);
  assertions.sections = sections;
  assertions.harness = steps.snapshot();
  return { ok, assertions };
}
