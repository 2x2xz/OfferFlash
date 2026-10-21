import {app,BrowserWindow} from 'electron';
import {mkdtemp,writeFile} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import assert from 'node:assert/strict';
import {FieldCompanion,FIELD_COMPANION_WORLD_ID} from '../../packages/browser/src/field-companion.js';
import {attachPlaywrightView} from '../../packages/browser/src/playwright-view.js';
// Decorative playback over static cards: no form controls, form executor,
// normal profile/session, employer page, API, upload, or submission.
const directory=await mkdtemp(resolve('.backups/pixel-effects-'));app.setPath('userData',join(directory,'electron'));await app.whenReady();
const html=join(directory,'preview.html');await writeFile(html,`<!doctype html><meta charset="utf-8"><style>*{box-sizing:border-box}body{margin:0;font-family:-apple-system,'PingFang SC',sans-serif;background:#f6f7fc;color:#25304a}header{padding:34px 42px;border-bottom:1px solid #e0e4ef;background:#fff}header small{font-size:12px;color:#736aab}h1{font-size:28px;margin:10px 0}header p{font-size:14px;margin:0;color:#69758d}.stage{position:relative;height:560px;margin:28px 42px;background:#fff;border:1px solid #e0e4ef;border-radius:20px;overflow:hidden}.card{position:absolute;width:280px;padding:22px;border:1px solid #dcd7fb;border-radius:14px;background:#f4f2ff;font-size:16px;font-weight:600}.card small{display:block;font-size:12px;font-weight:400;margin-top:6px;color:#6e7590}#one{left:72px;top:75px}#two{left:650px;top:220px}#three{left:300px;top:400px}.caption{position:absolute;left:24px;top:20px;font-size:12px;color:#7b859c}.footer{margin:0 42px;color:#707b92;font-size:12px}</style><header><small>像素闪电侠 · 纯装饰预览 · 不填写网页</small><h1>跑到当前操作旁边，带着闪电尾迹。</h1><p>实际填写时跟随经过校验的目标；这里仅在三张静态卡片之间演示移动。</p></header><div class="stage"><span class="caption">保留原来的红金角色与分叉电弧</span><div class="card" id="one">① 准备处理<small>跟随观察到的目标位置</small></div><div class="card" id="two">② 移动到下一项<small>像素残影 · 分叉闪电 · 火花</small></div><div class="card" id="three">③ 需要你核对<small>停下提示，等待确认</small></div></div><p class="footer">装饰层不接收鼠标、不移动焦点、不修改页面内容；支持关闭及减少动态效果。</p>`);
const window=new BrowserWindow({show:false,width:1180,height:860,webPreferences:{sandbox:true,contextIsolation:true,nodeIntegration:false,backgroundThrottling:false}});let externalRequests=0;
window.webContents.session.webRequest.onBeforeRequest((details,done)=>{const allowed=/^(?:file|data|devtools):/.test(details.url);if(!allowed)externalRequests++;done({cancel:!allowed});});
const companion=new FieldCompanion(window.webContents);let bridge:Awaited<ReturnType<typeof attachPlaywrightView>>|undefined;let checks=0;
const readState=(body:string)=>window.webContents.executeJavaScriptInIsolatedWorld(FIELD_COMPANION_WORLD_ID,[{code:`(()=>{const state=Object.values(globalThis).find(v=>v&&typeof v==='object'&&v.runner&&v.host);${body}})()`}],false);
try{
 await window.loadFile(html);bridge=await attachPlaywrightView(window.webContents);const page=bridge.page;
 const unchanged=await page.evaluate(()=>({text:document.body.innerText,focus:document.activeElement?.tagName,scroll:scrollY,controls:document.querySelectorAll('input,textarea,select,form').length}));assert.equal(unchanged.controls,0);checks++;
 const one=await page.locator('#one').boundingBox(),two=await page.locator('#two').boundingBox(),three=await page.locator('#three').boundingBox();assert.ok(one&&two&&three);checks++;
 await companion.show({phase:'approach',bounds:one!});await companion.show({phase:'approach',bounds:two!});
 await readState(`return new Promise((resolve,reject)=>{const start=performance.now();function sample(){const active=state?.wakePaths?.[0]?.getAnimations()[0],time=Number(active?.currentTime??0);if(time>=160&&time<650)return resolve(true);if(performance.now()-start>1500)return reject(Error('No actual wake animation observed'));requestAnimationFrame(sample);}sample();});`);checks++;
 const moving=await readState(`return {runner:state.runner.dataset.visible,phase:state.runner.dataset.phase,hostPointer:getComputedStyle(state.host).pointerEvents,rootClosed:state.host.shadowRoot===null,wake:state.wake.style.visibility,arcs:state.wakePaths.length,position:state.runner.style.transform};`) as any;
 assert.equal(moving.runner,'true');assert.equal(moving.phase,'approach');assert.equal(moving.hostPointer,'none');assert.equal(moving.rootClosed,true);assert.equal(moving.wake,'visible');assert.equal(moving.arcs,8);checks+=6;
 await writeFile(join(directory,'field-runner.png'),(await window.webContents.capturePage()).toPNG());
 await companion.show({phase:'attention',bounds:three!});assert.equal(await readState(`return state.attention.dataset.visible;`),'true');checks++;
 await writeFile(join(directory,'field-attention.png'),(await window.webContents.capturePage()).toPNG());
 const after=await page.evaluate(()=>({text:document.body.innerText,focus:document.activeElement?.tagName,scroll:scrollY,controls:document.querySelectorAll('input,textarea,select,form').length}));assert.deepEqual(after,unchanged);checks++;
 await companion.setEnabled(true,true);await companion.show({phase:'approach',bounds:one!});assert.equal(await readState(`return getComputedStyle(state.runner).transitionDuration;`),'0s');assert.equal(await readState(`return state.runner.dataset.reduced;`),'true');checks+=2;
 await companion.setEnabled(false);assert.equal(await readState(`return !!state?.host?.isConnected;`),false);checks++;
 await companion.setEnabled(true,false);await companion.show({phase:'approach',bounds:two!});await companion.clear();assert.equal(await readState(`return !!state?.host?.isConnected;`),false);checks++;
 assert.equal(externalRequests,0);checks++;
 const result={checks,externalRequests,fieldWrites:0,focusAndTextUnchanged:true,closedShadow:true,directory,scope:'production FieldCompanion on static decorative cards; no form execution or real employer'};await writeFile(join(directory,'validation.json'),JSON.stringify(result,null,2));console.log('PIXEL_EFFECTS_RESULT '+JSON.stringify(result));
}catch(error){await writeFile(join(directory,'failure.txt'),String(error));console.error('PIXEL_EFFECTS_FAILURE '+directory,error);process.exitCode=1;}
finally{await companion.dispose();await bridge?.close();window.destroy();app.exit(Number(process.exitCode??0));}
