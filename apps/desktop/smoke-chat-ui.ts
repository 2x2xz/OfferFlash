import type { BrowserWindow } from 'electron';
import { createServer, type ServerResponse } from 'node:http';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { AppEvent } from '../../packages/shared/src/contracts.js';
import { SmokeStepRunner } from './smoke-deadline.js';

// Installed only in the application's isolated smoke renderer. Captures the UI
// payload without reading, clearing, replacing, or restoring the OS clipboard.
export const INSTALL_SMOKE_CLIPBOARD_FIXTURE = `(() => {
  if (Object.hasOwn(window, '__offerAgentSmokeClipboard')) throw new Error('Clipboard fixture is already installed');
  const target = navigator.clipboard;
  if (!target || typeof target.writeText !== 'function') throw new Error('Application clipboard interface is unavailable');
  const descriptor = Object.getOwnPropertyDescriptor(target, 'writeText');
  const original = target.writeText;
  const writes = [];
  Object.defineProperty(target, 'writeText', { configurable: true, enumerable: descriptor?.enumerable ?? false,
    writable: true, value: async text => {
      if (typeof text !== 'string') throw new Error('Clipboard fixture accepts text only');
      writes.push(text);
    } });
  Object.defineProperty(window, '__offerAgentSmokeClipboard', { configurable: true, value: {
    writes, nativeCopyClickObserved: false,
    restore: () => {
      if (descriptor) Object.defineProperty(target, 'writeText', descriptor);
      else if (!delete target.writeText) throw new Error('Clipboard fixture could not be removed');
      const restored = target.writeText === original;
      delete window.__offerAgentSmokeClipboard;
      return restored;
    }
  } });
  return true;
})()`;
export const RESTORE_SMOKE_CLIPBOARD_FIXTURE = `(() => {
  const fixture = window.__offerAgentSmokeClipboard;
  if (!fixture) throw new Error('Clipboard fixture was not installed');
  return fixture.restore();
})()`;

/** Synthetic protocol responses and a loopback help page; no real model or recruiting site. */
async function fixture(hold = false, fail = false) {
  let stream: ServerResponse | undefined;
  let url = '';
  const delta = (text: string) => stream?.write(`data: ${JSON.stringify({ id: 'ui-fixture', object: 'chat.completion.chunk', created: 1, model: 'offeragent-protocol-test', choices: [{ index: 0, delta: { role: 'assistant', content: text }, finish_reason: null }] })}\n\n`);
  const markdown = () => `## 虚构的岗位对比\n\n- **先核对资格**\n- 查看来源，再决定下一步\n\n| 岗位 | 下一步 |\n| --- | --- |\n| 虚构算法岗位 | 核实毕业时间 |\n\n[虚构帮助页](${url}/help)\n\n\`\`\`text\n本机 UI 验收代码片段\n\`\`\`\n\n![图片说明](https://example.invalid/must-not-load.png)\n<script>window.fixtureUnsafe=true</script>\n[禁止链接](javascript:alert(1))\n\n${Array.from({ length: 30 }, (_, i) => `${i + 1}. 虚构说明第 ${i + 1} 项：以保存的来源和已确认资料为依据。`).join('\n')}`;
  const server = createServer(async (request, response) => {
    if (request.url === '/help' && request.method === 'GET') { response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }).end('<!doctype html><title>虚构帮助页</title><h1>OfferAgent 本机虚构帮助页</h1>'); return; }
    if (request.headers.authorization !== 'Bearer local-protocol-fixture-key') { response.writeHead(401).end(); return; }
    for await (const _chunk of request) { /* consume the synthetic request */ }
    stream = response;
    response.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' });
    if (fail) {
      delta('失败前实际收到的片段。\n');
      setTimeout(() => { response.write('data: {"error":{"message":"本机虚构协议错误","type":"invalid_request_error"}}\n\n'); response.end('data: [DONE]\n\n'); }, 150);
      return;
    }
    delta(hold ? Array.from({ length: 60 }, (_, i) => `部分回复第 ${i + 1} 行，尚未完成。\n`).join('') : markdown());
    if (!hold) {
      response.write(`data: ${JSON.stringify({ id: 'ui-fixture', object: 'chat.completion.chunk', created: 1, model: 'offeragent-protocol-test', choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] })}\n\ndata: [DONE]\n\n`);
      response.end();
    }
  });
  await new Promise<void>(done => server.listen(0, '127.0.0.1', done));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('UI fixture has no port');
  url = `http://127.0.0.1:${address.port}`;
  return { baseURL: `${url}/v1`, helpURL: `${url}/help`, markdown, delta, close: () => new Promise<void>(done => { server.close(() => done()); server.closeAllConnections(); }) };
}

export async function smokeChatUI(window: BrowserWindow, methods: Record<string, (...args: any[]) => Promise<any>>, send: (event: AppEvent) => void, stateDirectory: string) {
  if (!process.argv.includes('--smoke-test')) throw new Error('UI smoke requires an isolated smoke session');
  const assertions: Record<string, boolean> = {};
  const clipboardEvidence = { clipboardAdapter: 'fixture', osClipboardReadOrModified: false,
    copyExactReplyScope: 'UI writeText payload only; OS clipboard behavior was not tested.' };
  const steps = new SmokeStepRunner('chat-ui');
  const js = <T = any>(code: string, gesture = false): Promise<T> => steps.run('renderer-script', () => window.webContents.executeJavaScript(code, gesture));
  const settle = () => steps.run('two-animation-frames', () => window.webContents.executeJavaScript('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))'));
  const wait = async (code: string) => {
    const until = Date.now() + 6_000;
    do {
      if (await steps.run('wait-renderer-state', () => window.webContents.executeJavaScript(code) as Promise<boolean>, Math.max(1, Math.min(5_000, until - Date.now())))) return;
      await new Promise(done => setTimeout(done, 40));
    } while (Date.now() < until);
    throw new Error(`Chat UI state not reached: ${code}`);
  };
  const draft = async (text: string) => { await js(`(() => { const t=document.querySelector('textarea[aria-label="发送给助手的消息"]'); Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(t,${JSON.stringify(text)}); t.dispatchEvent(new Event('input',{bubbles:true})); })()`); await settle(); };
  const readDraft = () => js<string>('document.querySelector(".compose-box textarea").value');
  const click = async (selector: string) => { await js(`document.querySelector(${JSON.stringify(selector)}).click()`, true); await settle(); };
  const clickCopyNatively = async () => {
    await steps.run('activate-native-copy-ui', async () => {
      const { app } = await import('electron');
      app.focus({ steal: true }); window.show(); window.focus(); window.webContents.focus();
      const deadline = Date.now() + 600;
      while (!window.isFocused() || !window.webContents.isFocused()) {
        if (Date.now() >= deadline) throw new Error('Copy smoke window did not obtain native focus within 600ms');
        await new Promise(resolve => setTimeout(resolve, Math.min(20, deadline - Date.now())));
      }
    }, 600);
    const point = await js<{ x: number; y: number }>(`(async () => {
      const button = document.querySelector('button[aria-label="复制回复"]');
      if (!button || button.disabled) throw new Error('Copy button is unavailable');
      button.scrollIntoView({block:'center'});
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      const r = button.getBoundingClientRect(), x = Math.round(r.x+r.width/2), y = Math.round(r.y+r.height/2);
      const hit = document.elementFromPoint(x,y);
      if (!r.width || !r.height || !(hit === button || button.contains(hit))) throw new Error('Copy button is not visible and uncovered');
      const fixture = window.__offerAgentSmokeClipboard;
      button.addEventListener('click', event => { fixture.nativeCopyClickObserved = event.isTrusted; }, {once:true});
      return {x,y};
    })()`);
    if (!window.isFocused() || !window.webContents.isFocused()) throw new Error('Application copy check lost native focus');
    window.webContents.sendInputEvent({type:'mouseMove', ...point});
    window.webContents.sendInputEvent({type:'mouseDown', ...point, button:'left', clickCount:1});
    window.webContents.sendInputEvent({type:'mouseUp', ...point, button:'left', clickCount:1});
    await settle();
  };
  try {
    steps.setStage('draft-and-navigation');
    send({ type: 'navigate', page: 'agent' }); await settle();
    await draft('尚未发送的虚构草稿');
    send({ type: 'navigate', page: 'jobs' }); await settle();
    send({ type: 'navigate', page: 'agent' }); await settle();
    assertions.draftSurvivesNavigation = await readDraft() === '尚未发送的虚构草稿';
    const messagesBefore = await js<number>('document.querySelectorAll(".chat-message").length');
    await click('.agent-task-starters button');
    assertions.shortcutPreservesDraft = await readDraft() === '尚未发送的虚构草稿';
    await draft(''); await click('.agent-task-starters button');
    assertions.shortcutOnlyPrepares = !!(await readDraft()) && await js<number>('document.querySelectorAll(".chat-message").length') === messagesBefore;
    await js(`document.querySelector('.compose-box textarea').dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',isComposing:true,bubbles:true}))`); await settle();
    assertions.imeEnterDoesNotSend = await js<number>('document.querySelectorAll(".chat-message").length') === messagesBefore;
    const complete = await fixture();
    try {
      steps.setStage('completed-reply');
      await methods.configureModel!({ mode: 'live', provider: 'custom', modelId: 'offeragent-protocol-test', apiKey: 'local-protocol-fixture-key', baseURL: complete.baseURL });
      await draft('本机 UI 格式验收'); await click('button[aria-label="发送"]');
      await wait('!!document.querySelector("[data-message-status=completed] .assistant-output table")');
      assertions.formattedReply = await js<boolean>('!!document.querySelector(".assistant-output ul strong") && !!document.querySelector(".assistant-output pre code")');
      assertions.safeReply = await js<boolean>('!document.querySelector(".assistant-output img,.assistant-output script,.assistant-output iframe,.assistant-output a") && !window.fixtureUnsafe');
      assertions.linksWaitForClick = (await methods.browserState!()).url !== complete.helpURL;
      await js(INSTALL_SMOKE_CLIPBOARD_FIXTURE);
      try {
        await clickCopyNatively();
        await wait('document.querySelector(".toast")?.textContent.includes("已复制文字")');
        assertions.copyExactReply = await js<boolean>(`window.__offerAgentSmokeClipboard.writes.length === 1 && window.__offerAgentSmokeClipboard.writes[0] === ${JSON.stringify(complete.markdown())}`);
        assertions.nativeCopyClickObserved = await js<boolean>('window.__offerAgentSmokeClipboard.nativeCopyClickObserved === true');
      } finally {
        // Cleanup has its own deadline even if the earlier UI scope timed out.
        // It restores an API descriptor in our renderer; it never accesses OS data.
        const cleanup = new SmokeStepRunner('chat-ui-clipboard-cleanup');
        assertions.clipboardAdapterRestored = await cleanup.run('restore-fixture-descriptor', () => window.webContents.executeJavaScript(RESTORE_SMOKE_CLIPBOARD_FIXTURE));
      }
      await js('document.querySelector(".chat-body").scrollTop=0; document.querySelector(".toast button")?.click()'); await settle();
      await writeFile(join(stateDirectory, 'ui-chat-formatted.png'), (await steps.run('renderer-screenshot', () => window.webContents.capturePage(), 8_000)).toPNG());
      await click('[data-output-url]');
      await wait('!!document.querySelector(".browser-page")');
      assertions.linkOpensEmbeddedBrowser = (await methods.browserState!()).url === complete.helpURL;
    } finally { await complete.close(); }
    send({ type: 'navigate', page: 'agent' }); await settle();
    const partial = await fixture(true);
    try {
      steps.setStage('partial-and-cancelled-reply');
      await methods.configureModel!({ mode: 'live', provider: 'custom', modelId: 'offeragent-protocol-test', apiKey: 'local-protocol-fixture-key', baseURL: partial.baseURL });
      await draft('取消后需要恢复的虚构问题'); await click('button[aria-label="发送"]');
      await wait('document.querySelector(".assistant-stream")?.textContent.includes("部分回复第 60 行")');
      await draft('下一条虚构问题草稿');
      assertions.canPrepareWhileBusy = !await js<boolean>('document.querySelector(".compose-box textarea").disabled');
      await js('(() => {const b=document.querySelector(".chat-body");b.scrollTop=0;b.dispatchEvent(new Event("scroll"));})()'); await settle();
      partial.delta('后续片段不会把你拉到底部。\n');
      await wait('document.querySelector(".assistant-stream")?.textContent.includes("后续片段")');
      assertions.scrollPositionPreserved = await js<boolean>('document.querySelector(".chat-body").scrollTop < 5 && !!document.querySelector(".chat-jump-latest")');
      await click('.chat-jump-latest');
      assertions.jumpToLatest = await js<boolean>('(() => {const b=document.querySelector(".chat-body");return b.scrollHeight-b.scrollTop-b.clientHeight<65;})()');
      await click('button[aria-label="停止当前任务"]');
      await wait('!!document.querySelector("[data-message-status=cancelled]") && !document.querySelector("[data-streaming]")');
      assertions.partialReplyPreserved = await js<boolean>('document.querySelector("[data-message-status=cancelled]")?.textContent.includes("未完成的部分回复") && document.querySelector("[data-message-status=cancelled]")?.textContent.includes("部分回复第 60 行")');
      await click('button[aria-label="把原问题放回输入框"]');
      assertions.restoreDoesNotOverwrite = await readDraft() === '下一条虚构问题草稿';
      await draft(''); await click('button[aria-label="把原问题放回输入框"]');
      assertions.restoreIsManual = await readDraft() === '取消后需要恢复的虚构问题' && !await js<boolean>('!!document.querySelector("[data-streaming]")');
      await js('document.querySelector("[data-message-status=cancelled]").scrollIntoView({block:"start"}); document.querySelector(".toast button")?.click()'); await settle();
      await writeFile(join(stateDirectory, 'ui-chat-cancelled.png'), (await steps.run('renderer-screenshot', () => window.webContents.capturePage(), 8_000)).toPNG());
    } finally { await methods.cancelAgent!(); await partial.close(); }
    const failed = await fixture(false, true);
    try {
      steps.setStage('failed-reply');
      await methods.configureModel!({ mode: 'live', provider: 'custom', modelId: 'offeragent-protocol-test', apiKey: 'local-protocol-fixture-key', baseURL: failed.baseURL });
      await draft('失败后需要恢复的虚构问题'); await click('button[aria-label="发送"]');
      await wait('!!document.querySelector("[data-message-status=failed]") && !document.querySelector("[data-streaming]")');
      assertions.failedReplyMarked = await js<boolean>('document.querySelector("[data-message-status=failed]")?.textContent.includes("本次未完成") && !!document.querySelector("[data-message-status=failed] .inline-error")');
      assertions.failedPartialPreserved = await js<boolean>('document.querySelector("[data-message-status=failed]")?.textContent.includes("失败前实际收到的片段")');
      await click('[data-message-status=failed] button[aria-label="把原问题放回输入框"]');
      assertions.failedRestoreIsManual = await readDraft() === '失败后需要恢复的虚构问题' && !await js<boolean>('!!document.querySelector("[data-streaming]")');
      await js('document.querySelector("[data-message-status=failed]").scrollIntoView({block:"center"}); document.querySelector(".toast button")?.click()'); await settle();
      await writeFile(join(stateDirectory, 'ui-chat-failed.png'), (await steps.run('renderer-screenshot', () => window.webContents.capturePage(), 8_000)).toPNG());
    } finally { await methods.cancelAgent!(); await failed.close(); }
    await methods.configureModel!({ mode: 'demo', provider: '', modelId: '', apiKey: '' });
    return { ok: Object.values(assertions).every(Boolean), assertions, ...clipboardEvidence, harness: steps.snapshot() };
  } catch (error) {
    await writeFile(join(stateDirectory, 'ui-chat-failure.json'), JSON.stringify({ ok: false, error: error instanceof Error ? error.message : String(error), assertions, ...clipboardEvidence, harness: steps.snapshot() }, null, 2));
    throw error;
  }
}
