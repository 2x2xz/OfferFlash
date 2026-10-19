import assert from 'node:assert/strict';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { BrowserWindow, session, type WebContentsView } from 'electron';
import { createStore } from '../../packages/domain/src/index.js';
import type { ApplicationFillQueue } from '../../packages/domain/src/application-queue.js';
import { BackgroundQueueHost } from './background-queue.js';

/** Real queue host, isolated SQLite and hidden Chromium; HTTPS is served by an owned protocol fixture. */
export async function checkBackgroundQueueHost(directory: string) {
  if (!process.argv.includes('--smoke-test') || !process.argv.includes('--smoke-background-only')) throw new Error('仅供隔离验收。');
  const store = await createStore({ directory: join(directory, 'synthetic-queue-host') });
  const initial = await store.getState();
  const { version: _version, updatedAt: _updatedAt, ...input } = initial.profile;
  await store.saveProfile({ ...input, fullName: '虚构队列候选人', email: 'queue@example.invalid', phone: '13800000000' }, initial.profile.version);
  for (const [id, company] of [['one', '虚构甲'], ['login', '虚构需登录'], ['two', '虚构乙']] as const) await store.saveJob({ company, title: '原创样表验证', city: '北京', type: 'campus',
    description: '原创虚构材料', requirements: '', url: `https://queue-${id}.example.invalid/apply`, sourceId: 'fixture', sourceName: '原创隔离样本', publishedAt: null, deadline: null, demo: false });
  const state = await store.getState(), profileBefore = JSON.stringify(state.profile), applicationsBefore = JSON.stringify(state.applications);
  const pages = session.fromPartition('persist:offeragent-recruiting');
  const urls: string[] = [], events: Array<{status:string;active:string|null}> = [];
  let unexpectedNetwork = 0, assertions = 0;
  const check = (value: unknown, message: string) => { assert.ok(value, message); assertions++; };
  await pages.protocol.handle('https', request => {
    const url = new URL(request.url);
    if (request.method !== 'GET' || !/^queue-(one|login|two)\.example\.invalid$/.test(url.hostname)) { unexpectedNetwork++; return new Response('', {status:403}); }
    if (url.pathname === '/apply') urls.push(url.hostname);
    const fields = url.hostname === 'queue-login.example.invalid' ? '<input type="password" id="secret">' : '<label>姓名<input id="name"></label><label>邮箱<input id="email" type="email"></label>';
    // Wrapping label inputs are deliberately not eligible for background setter clicks, use real associations instead.
    const supported = fields.replace('<label>姓名<input id="name"></label>', '<label for="name">姓名</label><input id="name">').replace('<label>邮箱<input id="email" type="email"></label>', '<label for="email">邮箱</label><input id="email" type="email">');
    return new Response(`<!doctype html><meta charset="utf-8"><style>input{display:block;width:240px;height:32px}</style><form>${supported}<input type="checkbox" id="consent"><input type="file" id="attachment"><button type="submit">提交</button></form><script>window.submits=0;window.clicks=0;document.addEventListener('click',()=>clicks++);document.querySelector('form').addEventListener('submit',e=>{e.preventDefault();submits++});</script>`, {headers:{'content-type':'text/html;charset=utf-8'}});
  });
  const windows = BrowserWindow.getAllWindows().length;
  const host = new BackgroundQueueHost({store, getCurrentPage:()=>({url:''}), onState: value => events.push({status:value.status,active:value.activeItemId}) });
  try {
    const jobIds = ['one','login','two'].map(id => state.jobs.find(job => job.url === `https://queue-${id}.example.invalid/apply`)!.id);
    const prepared = await host.enqueue({jobIds,profileVersion:state.profile.version,acknowledgeAutosave:true});
    check(prepared.items.every(item=>item.status==='queued') && urls.length===0,'enqueue alone cannot open or fill pages');
    await host.start();
    const until = Date.now()+20_000;
    while (host.hasPendingMutation() && Date.now()<until) await delay(30);
    const result = host.state();
    check(result.status==='finished' && result.completedCount===3,'three real hidden pages must finish sequentially');
    check(result.items[0]!.verifiedCount===2 && result.items[2]!.verifiedCount===2,'each ordinary page independently verifies both contact fields');
    check(result.items[1]!.status==='waiting-user' && result.items[1]!.verifiedCount===0,'login page hands off without preventing the next company');
    check(JSON.stringify(urls)===JSON.stringify(['queue-one.example.invalid','queue-login.example.invalid','queue-two.example.invalid']),'actual document loads follow explicitly selected order');
    const queue = (host as unknown as {queue:ApplicationFillQueue}).queue;
    for (const item of result.items.filter(item=>item.verifiedCount>0)) {
      const page = queue.getPage(item.id) as unknown as {view:WebContentsView};
      const values = await page.view.webContents.executeJavaScript(`({name:document.getElementById('name').value,email:document.getElementById('email').value,consent:document.getElementById('consent').checked,files:document.getElementById('attachment').files.length,clicks,submits,bridge:typeof window.offer})`);
      check(values.name===state.profile.fullName && values.email===state.profile.email,'host-retained actual DOM matches synthetic confirmed contacts');
      check(values.consent===false && values.files===0 && values.clicks===0 && values.submits===0,'protected controls, click and submit remain untouched');
      check(!page.view.webContents.isFocused() && values.bridge==='undefined','host pages have no input focus or application bridge');
    }
    check(BrowserWindow.getAllWindows().length===windows,'background execution creates no foreground/review window');
    check(unexpectedNetwork===0,'owned fixture performs no external network or write request');
    const latest = await store.getState();
    check(JSON.stringify(latest.profile)===profileBefore && JSON.stringify(latest.applications)===applicationsBefore,'background execution cannot alter profile or mark applications submitted');
    host.close(result.items[0]!.id);
    check(host.state().items[0]!.canReview===false,'explicitly closing one draft releases that exact retained page');
    return {ok:true,assertionCount:assertions,actualHiddenPages:3,verifiedFields:4,loginHandoffs:1,nativeInputCount:0,submissions:0,externalNetworkRequests:0,events:events.length,scope:'production queue host, isolated SQLite, owned HTTPS protocol fixture; not enterprise validation'};
  } finally { await host.cancel(); host.dispose(); pages.protocol.unhandle('https'); await store.close(); }
}
