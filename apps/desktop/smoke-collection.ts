import { app, type BrowserWindow } from 'electron';
import type { BrowserController } from '../../packages/browser/src/controller.js';
import type { DomainStore } from '../../packages/domain/src/store.js';
import type { AppEvent, AppState, SourceCollectionReport, SourceRun } from '../../packages/shared/src/contracts.js';
import { validateCollectionReport } from '../../packages/shared/src/source-collection.js';

const LIST = 'https://jobs.bytedance.com/campus/position';
const PAGE_TWO = `${LIST}?page=2`;
const FIRST_DETAIL = `${LIST}/fixture-collection-one/detail`;
const SECOND_DETAIL = `${LIST}/fixture-collection-two/detail`;
const FIRST_TITLE = '算法工程师（虚构分页验收甲）';
const SECOND_TITLE = '大模型算法工程师（虚构分页验收乙）';
const FIRST_DESCRIPTION = '虚构岗位甲的完整职责：研究用于本机验收的合成算法数据。这不是实际招聘信息。';
const SECOND_DESCRIPTION = '虚构岗位乙的完整职责：实现用于本机验收的大模型评测流程。这不是实际招聘信息。';
const TRUST_STORAGE = 'offeragent-fictional-native-next-clicks';

const shell = (title: string, body: string) => `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><title>${title}</title><style>
  body{font:16px system-ui,sans-serif;color:#263f31;background:#f6faf7;margin:24px}h1{font-size:24px}h2{font-size:18px}
  .position-list{padding:0;list-style:none}.position-item{padding:18px;margin:18px 0;border:1px solid #9bbca7;border-radius:10px;background:white}
  .position-item a{display:block;color:#174b2e;text-decoration:none}.positionItem-subTitle{display:flex;gap:24px}nav{padding:16px 0}
  nav a,nav button{display:inline-block;font:inherit;padding:10px 24px;border:1px solid #467858;border-radius:6px;color:#174b2e;background:white}
  main{max-width:700px}p{line-height:1.65}.fixture-note{font-size:13px;color:#586d60}
  </style></head><body><p class="fixture-note">OfferAgent 本机虚构采集验收页；内容通过隔离测试路由提供，未访问招聘官网服务器。</p>${body}</body></html>`;

function listHTML(page: 1 | 2): string {
  const first = page === 1, title = first ? FIRST_TITLE : SECOND_TITLE, detail = first ? FIRST_DETAIL : SECOND_DETAIL;
  const next = first ? `<a class="ant-pagination-next" aria-label="下一页" href="${PAGE_TWO}">下一页</a>`
    : '<button class="ant-pagination-next ant-pagination-disabled" aria-label="下一页" disabled>下一页</button>';
  return shell(`虚构职位列表第 ${page} 页`, `<h1>虚构 AI / 算法职位列表</h1><ul class="position-list"><li class="position-item"><a href="${detail}">
    <div class="positionItem"><h3>${title}</h3><div class="positionItem-subTitle"><span>杭州</span><span>校园招聘</span></div>
    <p>虚构列表摘要 ${first ? '甲' : '乙'}，完整职责需要打开详情读取。</p></div></a></li></ul>
    <nav class="pagination" aria-label="职位列表分页"><span>第 ${page} 页，共 2 页 </span>${next}</nav>
    <script>document.querySelector('.ant-pagination-next').addEventListener('click', event => {
      if (event.isTrusted && !event.currentTarget.disabled) sessionStorage.setItem('${TRUST_STORAGE}', String(Number(sessionStorage.getItem('${TRUST_STORAGE}') || 0) + 1));
    });</script>`);
}

function detailHTML(first: boolean): string {
  return shell(first ? FIRST_TITLE : SECOND_TITLE, `<main class="positionDetail"><h1 class="positionDetail-title">${first ? FIRST_TITLE : SECOND_TITLE}</h1>
    <h2>岗位职责</h2><p>${first ? FIRST_DESCRIPTION : SECOND_DESCRIPTION}</p>
    <h2>岗位要求</h2><p>${first ? 'Python，合成数据实验，2027 届。' : 'PyTorch，大模型工具测试，2027 届。'}</p></main>`);
}

async function waitFor<T>(read: () => Promise<T>, predicate: (value: T) => boolean, message: string): Promise<T> {
  const until = Date.now() + 5_000;
  for (;;) {
    const value = await read();
    if (predicate(value)) return value;
    if (Date.now() >= until) throw new Error(message);
    await new Promise(done => setTimeout(done, 50));
  }
}

async function renderedReport(window: BrowserWindow, run: SourceRun): Promise<{ status: string; visible: boolean; text: string }> {
  const selector = `[data-source-run-id="${run.id}"][data-collection-status="${run.status}"]`;
  await waitFor(() => window.webContents.executeJavaScript(`Boolean(document.querySelector(${JSON.stringify(selector)}))`) as Promise<boolean>, Boolean, '采集报告没有通过状态事件显示在界面');
  await window.webContents.executeJavaScript('(() => {const tools=document.querySelector(".browser-other-tools");if(tools && !tools.open) tools.querySelector(":scope > summary").click();})()');
  await window.webContents.executeJavaScript(`document.querySelector(${JSON.stringify(selector)}).scrollIntoView({block:'nearest'})`);
  await window.webContents.executeJavaScript('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
  const result = await window.webContents.executeJavaScript(`(() => { const element=document.querySelector(${JSON.stringify(selector)}); const r=element.getBoundingClientRect(); return {
    status:element.getAttribute('data-collection-status'),visible:r.width>0&&r.height>0&&r.bottom>0&&r.top<innerHeight&&r.right>0&&r.left<innerWidth,text:element.innerText
  }; })()`);
  if (!result.visible || result.status !== run.status || !result.text.includes('首次发现')) throw new Error('采集范围报告没有可见地展示状态与首次发现数量');
  return result;
}

/** Real renderer IPC + native page input, using only fixed fictional routes in the isolated smoke session. */
export async function smokeSourceCollection(window: BrowserWindow, browser: BrowserController, store: DomainStore, send: (event: AppEvent) => void) {
  if (!process.argv.includes('--smoke-test')) throw new Error('虚构官网路由只能在隔离桌面 smoke 中启用。');
  const before = await store.getState();
  const originalApplications = JSON.stringify(before.applications);
  const priorFirstSeen = new Map(before.jobs.map(job => [job.id, job.firstSeenAt]));
  if (before.jobs.some(job => job.url === FIRST_DETAIL || job.url === SECOND_DETAIL)) throw new Error('隔离库已有本次虚构采集岗位，无法核对首次发现。');
  const routes = new Map([[LIST, listHTML(1)], [PAGE_TWO, listHTML(2)], [FIRST_DETAIL, detailHTML(true)], [SECOND_DETAIL, detailHTML(false)]]);
  const requests: Array<{ url: string; method: string; accepted: boolean }> = [];
  const session = browser.view.webContents.session;
  await session.protocol.handle('https', request => {
    const html = request.method === 'GET' ? routes.get(request.url) : undefined;
    requests.push({ url: request.url, method: request.method, accepted: html !== undefined });
    return new Response(html ?? '拒绝：不在本机固定虚构采集路由中。', {
      status: html === undefined ? 451 : 200,
      headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' },
    });
  });
  try {
    send({ type: 'navigate', page: 'browser' });
    window.show(); app.focus({ steal: true }); window.focus();
    const navigateFixture = async () => {
      await window.webContents.executeJavaScript(`window.offer.browserNavigate(${JSON.stringify(LIST)})`);
      await waitFor(async () => browser.getState().visible, Boolean, '浏览器布局没有显示原生网页区域');
      await window.webContents.executeJavaScript('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
      window.focus();
      browser.view.webContents.focus();
      // A real click on the neutral page heading acquires native page focus;
      // webContents.focus() alone may leave the renderer focused on macOS.
      const point = await browser.view.webContents.executeJavaScript('(() => {const r=document.querySelector("h1").getBoundingClientRect();return {x:Math.round(r.x+20),y:Math.round(r.y+r.height/2)}})()');
      browser.view.webContents.sendInputEvent({ type: 'mouseMove', ...point });
      browser.view.webContents.sendInputEvent({ type: 'mouseDown', ...point, button: 'left', clickCount: 1 });
      browser.view.webContents.sendInputEvent({ type: 'mouseUp', ...point, button: 'left', clickCount: 1 });
      await waitFor(async () => window.isFocused() && browser.view.webContents.isFocused(), Boolean, '隔离网页没有获得原生翻页焦点');
    };
    const collect = async (maxPages: number, detailLimit: number): Promise<{ state: AppState; run: SourceRun; report: SourceCollectionReport; rendered: { status: string; visible: boolean; text: string } }> => {
      const priorRuns = new Set((await store.getState()).sourceRuns.map(run => run.id));
      const state = await window.webContents.executeJavaScript(`window.offer.collectPageJobs({scope:'bounded-list',maxPages:${maxPages},detailLimit:${detailLimit}})`) as AppState;
      const newRuns = state.sourceRuns.filter(run => !priorRuns.has(run.id));
      if (newRuns.length !== 1 || newRuns[0]!.sourceId !== 'bytedance-campus' || !newRuns[0]!.report) throw new Error('真实采集 IPC 没有创建唯一绑定来源的报告');
      const run = newRuns[0]!, report = validateCollectionReport(run.report);
      return { state, run, report, rendered: await renderedReport(window, run) };
    };
    await navigateFixture();
    await browser.view.webContents.executeJavaScript(`sessionStorage.removeItem(${JSON.stringify(TRUST_STORAGE)})`);
    const bounded = await collect(1, 1);
    if (bounded.run.status !== 'partial' || bounded.report.stopReason !== 'page-limit' || bounded.report.pagesSucceeded !== 1
      || bounded.report.detailSucceeded !== 1 || bounded.report.newCount !== 1 || bounded.report.listedCount !== 1) throw new Error('单页预算没有保留部分完成与详情证据');
    const first = bounded.state.jobs.find(job => job.url === FIRST_DETAIL);
    if (!first || !first.description.includes(FIRST_DESCRIPTION) || !first.requirements.includes('Python') || first.publishedAt !== null) throw new Error('虚构甲岗位的详情原文或日期边界没有保留');
    const onePageClicks = await browser.view.webContents.executeJavaScript(`Number(sessionStorage.getItem(${JSON.stringify(TRUST_STORAGE)}) || 0)`);
    if (onePageClicks !== 0) throw new Error('达到单页预算后仍执行了下一页输入');

    await navigateFixture();
    const complete = await collect(2, 2);
    if (complete.run.status !== 'success' || complete.report.stopReason !== 'exhausted' || complete.report.pagesSucceeded !== 2
      || complete.report.detailSucceeded !== 2 || complete.report.listedCount !== 2 || complete.report.newCount !== 1) throw new Error('两页列表与预算内详情没有完成');
    const second = complete.state.jobs.find(job => job.url === SECOND_DETAIL);
    if (!second || !second.description.includes(SECOND_DESCRIPTION) || !second.requirements.includes('PyTorch') || second.publishedAt !== null) throw new Error('虚构乙岗位的详情原文或日期边界没有保留');
    const twoPageClicks = await browser.view.webContents.executeJavaScript(`Number(sessionStorage.getItem(${JSON.stringify(TRUST_STORAGE)}) || 0)`);
    if (twoPageClicks !== 1 || requests.filter(item => item.url === PAGE_TWO && item.accepted).length !== 1) throw new Error('没有核实下一页由一次可信原生点击触发');
    const firstSeen = new Map(complete.state.jobs.filter(job => routes.has(job.url)).map(job => [job.url, job.firstSeenAt]));

    await navigateFixture();
    const repeated = await collect(2, 2);
    const repeatClicks = await browser.view.webContents.executeJavaScript(`Number(sessionStorage.getItem(${JSON.stringify(TRUST_STORAGE)}) || 0)`);
    if (repeated.run.status !== 'success' || repeated.report.newCount !== 0 || repeatClicks !== 2) throw new Error('重复采集制造首次发现或没有执行受控原生翻页');
    for (const [url, timestamp] of firstSeen) if (repeated.state.jobs.find(job => job.url === url)?.firstSeenAt !== timestamp) throw new Error('重复采集改写首次收录时间');
    for (const [id, timestamp] of priorFirstSeen) if (repeated.state.jobs.find(job => job.id === id)?.firstSeenAt !== timestamp) throw new Error('采集改写已有岗位首次收录时间');
    if (JSON.stringify(repeated.state.applications) !== originalApplications) throw new Error('采集改写旧申请状态或历史');
    const remoteBridgeAbsent = await browser.view.webContents.executeJavaScript('typeof window.offer === "undefined" && typeof require === "undefined"');
    if (!remoteBridgeAbsent) throw new Error('虚构网页获得应用桥接或 Node 权限');
    return {
      ok: true, fixtureOnly: true, realSiteVerified: false, rendererIPC: true,
      partial: { report: bounded.report, visible: bounded.rendered.visible, nativeNextClicks: onePageClicks },
      complete: { report: complete.report, visible: complete.rendered.visible, nativeNextClicks: twoPageClicks },
      repeated: { report: repeated.report, visible: repeated.rendered.visible, nativeNextClicks: repeatClicks },
      detailSourcePreserved: true, publicationUnknown: true, firstSeenPreserved: true, existingApplicationsPreserved: true,
      remoteBridgeAbsent, requests,
    };
  } finally { session.protocol.unhandle('https'); }
}
