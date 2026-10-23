import {app,BrowserWindow,ipcMain} from 'electron';
import {build} from 'esbuild';
import {mkdtemp,writeFile} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import assert from 'node:assert/strict';
import {attachPlaywrightView} from '../../packages/browser/src/playwright-view.js';
import {openDatabaseFile,writeDocument} from '../../packages/domain/src/sqlite.js';
import {createApplicationAssetsStore} from '../../packages/domain/src/application-assets.js';
import {universalQuestion,eligibleUniversalAnswers,universalAnswerMatches} from '../../packages/forms/src/universal-answers.js';
import {profile} from './moka-form.js';

// Production React components + production SQLite answer store, in an isolated
// hidden renderer. No employer page, normal user data, model, or form executor.
const directory=await mkdtemp(resolve('.backups/ui-interaction-'));
app.setPath('userData',join(directory,'electron'));await app.whenReady();
const dataDirectory=join(directory,'data');let file=await openDatabaseFile({directory:dataDirectory});
await file.transact(db=>{writeDocument(db,'profile','current',profile,profile.updatedAt);writeDocument(db,'settings','current',{showDemo:false},profile.updatedAt);});
let assets=createApplicationAssetsStore(file);
const initial={profile,jobs:[],applications:[],sourceRuns:[],settings:{showDemo:false}};
const fields=[{label:'兴趣爱好',section:'个人信息',type:'text',value:'',editable:true},{label:'常用工具',section:'个人信息',type:'select',value:'',editable:true},{label:'是否接受出差',section:'其它信息',type:'textarea',value:'',editable:true},{label:'为什么希望加入本公司',section:'补充问题',type:'textarea',value:'',editable:true}];
const questions=fields.map(field=>universalQuestion(field,'https://fictional.invalid/apply/one',undefined,[])!);questions[1]!.options=['Python','Figma','Excel'];
const result={status:'failed',verified:7,alreadyCorrect:17,matchedConfirmed:24,failureCode:'MODEL_REQUEST_FAILED',pending:4,message:'模型或页面操作中断，已停止后续写入。本次新填写并独立核实7项。当前页面有24项与已确认资料一致，其中17项原本正确。仅限本次观察范围，未提交申请。',remaining:fields.map((field,index)=>({...field,reason:'个人资料里没有这项信息',reasonCode:'missing-data',question:questions[index]})),drafts:[],submitted:false};
let saves=0,confirms=0,continues=0,externalRequests=0;const errors:string[]=[];
ipcMain.handle('ui-interaction-fixture',async(_event,name:string,args:any[])=>{
 if(name==='getState')return initial;if(name==='applicationAssets')return assets.getState();
 if(name==='saveAnswer'){saves++;return assets.saveAnswer(args[0],args[1]);}
 if(name==='setQuestionDecision')return assets.setQuestionDecision!(args[0]);
 if(name==='confirmAnswer'){confirms++;return assets.confirmAnswer(args[0],args[1],args[2]);}
 if(name==='runUniversalFill'){continues++;return result;}
 throw Error('Unexpected fixture operation: '+name);
});
const preload=join(directory,'preload.cjs');await writeFile(preload,"const {contextBridge,ipcRenderer}=require('electron');contextBridge.exposeInMainWorld('fixtureStorage',{request:(name,args)=>ipcRenderer.invoke('ui-interaction-fixture',name,args)});");
await build({stdin:{contents:`import React from 'react';import{createRoot}from'react-dom/client';import{App}from${JSON.stringify(resolve('apps/desktop/renderer/App.tsx'))};
${['styles.css','Workbench.css','MissionHome.css','MissionProgress.css','InteractionDesign.css'].map(name=>'import '+JSON.stringify(resolve('apps/desktop/renderer/'+name))+';').join('\n')}
const listeners=new Set();const request=(name,...args)=>window.fixtureStorage.request(name,args);const workflow={workflows:[],activeWorkflowId:null};const telemetry={runs:[],spans:[],reviews:[],activeRunId:null};
const api={getState:()=>request('getState'),getSources:async()=>[],modelStatus:async()=>({mode:'live',provider:'fictional-ui',modelId:'no-api',configured:true}),browserState:async()=>({url:'https://fictional.invalid/apply/one',title:'虚构申请页面 · 仅界面验收',loading:false,canGoBack:false,canGoForward:false,visible:true,zoomPercent:100}),onEvent:callback=>{listeners.add(callback);return()=>listeners.delete(callback);},workflowState:async()=>workflow,telemetryState:async()=>telemetry,applicationAssets:()=>request('applicationAssets'),setQuestionDecision:(...args)=>request('setQuestionDecision',...args),saveAnswer:(...args)=>request('saveAnswer',...args),confirmAnswer:(...args)=>request('confirmAnswer',...args),browserBounds:async(bounds,visible)=>{window.__lastBounds={bounds,visible};},setFieldCompanionMotion:async()=>{},beginMeasurement:async()=>({id:'fictional-ui-measurement'}),finishMeasurement:async()=>{},runUniversalFill:()=>request('runUniversalFill'),sensitiveIdentityState:async()=>({version:0,hasValue:false,available:false})};
window.offer=api;window.__ui={navigate:page=>listeners.forEach(fn=>fn({type:'navigate',page})),changeProfile:()=>request('getState').then(state=>listeners.forEach(fn=>fn({type:'state',state:{...state,profile:{...state.profile,version:state.profile.version+1}}})))};
createRoot(document.getElementById('root')).render(<App/>);`,loader:'tsx',resolveDir:resolve('.'),sourcefile:'ui-interaction-fixture.tsx'},outfile:join(directory,'renderer.js'),bundle:true,platform:'browser',format:'iife',jsx:'automatic',define:{'process.env.NODE_ENV':'"production"'},loader:{'.woff2':'file'}});
await writeFile(join(directory,'index.html'),'<!doctype html><meta charset="utf-8"><link rel="stylesheet" href="renderer.css"><div id="root"></div><script src="renderer.js"></script>');
const window=new BrowserWindow({show:false,width:1480,height:980,webPreferences:{preload,sandbox:true,contextIsolation:true,nodeIntegration:false,backgroundThrottling:false}});
window.webContents.session.webRequest.onBeforeRequest((details,done)=>{const allowed=/^(file|data|devtools):/.test(details.url);if(!allowed)externalRequests++;done({cancel:!allowed});});
let bridge:Awaited<ReturnType<typeof attachPlaywrightView>>|undefined;let checks=0;const widths:any[]=[];
async function screenshot(name:string){await window.webContents.executeJavaScript(`(async()=>{await document.fonts.ready;await Promise.all(document.getAnimations().filter(a=>a.effect?.getTiming().iterations!==Infinity).map(a=>a.finished.catch(()=>{})));await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));})()`);await writeFile(join(directory,name),(await window.webContents.capturePage()).toPNG());}
try{
 await window.loadFile(join(directory,'index.html'));bridge=await attachPlaywrightView(window.webContents);const page=bridge.page;page.on('pageerror',e=>errors.push(e.message));
 await page.waitForSelector('.mission-home');await page.evaluate('window.__ui.navigate("browser")');await page.waitForSelector('[data-testid="quick-fill"]');
 for(const width of [1480,1280,1080]){window.setSize(width,900);await page.waitForFunction('Math.abs(innerWidth-'+width+')<2');await page.waitForFunction('window.__lastBounds?.visible===true');
  const dimensions=await page.locator('.browser-placeholder').boundingBox();assert.ok(dimensions);assert.ok(dimensions.width>=width-120,JSON.stringify(dimensions));checks++;
  const overflow=await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth);assert.equal(overflow,false);checks++;
  widths.push({window:width,web:Math.round(dimensions.width),height:Math.round(dimensions.height)});
 }
 window.setSize(1480,980);await page.waitForFunction('innerWidth===1480');
 // Show an explicitly fictional static document in the blank native holder for the visual preview.
 await page.locator('.browser-placeholder').evaluate(el=>{const preview=document.createElement('div');preview.id='ui-preview-document';preview.innerHTML='<div style="padding:44px 56px;max-width:1000px;margin:auto;color:#24334a"><small style="color:#717d93">界面预览 · 虚构内容 · 未连接企业网站</small><h1 style="margin-top:30px;font-size:28px">你的网申页面，完整留在视野里。</h1><p style="font-size:15px;color:#64718a;margin-top:15px">左侧按需展开助手，网页空间优先。需要补充资料时，跟着提示一步一步完成。</p><div style="margin-top:38px;height:280px;border:1px dashed #d7ddeb;border-radius:16px;background:#fafbfe;display:grid;place-items:center;color:#78849c">企业官网显示区域 · 保留原网页操作</div></div>';el.append(preview);});
 await screenshot('web-priority.png');
 await page.locator('[data-testid="browser-focus-toggle"]').click();await page.waitForSelector('.browser-focus-mode');
 await page.locator('[data-testid="quick-fill"]').click();
 await page.waitForSelector('[data-testid="application-answer-alert"]');await page.waitForSelector('[data-testid="universal-missing-questions"]');
 assert.equal(await page.locator('.browser-focus-mode').count(),0);checks++;
 assert.equal(await page.locator('[data-testid="workspace-tab-details"]').getAttribute('aria-selected'),'true');checks++;
 assert.equal(await page.locator('[data-testid="universal-answer-remember"]').isDisabled(),true);checks++;
 assert.equal(await page.locator('[data-testid="quick-fill-status"]').count(),0);checks++;
 assert.equal(await page.locator('[data-testid="universal-fill-result"]').count(),1);checks++;
 assert.equal(await page.locator('.universal-result-report').isVisible(),false);checks++;
 assert.deepEqual(await page.locator('.universal-result-counts dd').allTextContents(),['7','17','4']);checks++;
 assert.equal(await page.locator('[data-testid="universal-fill-result"]').getAttribute('data-status'),'interrupted');checks++;

 const guideArrow=page.locator('[data-testid="universal-missing-questions"] .answer-next-cue .pixel-guide-arrow');
 assert.equal(await guideArrow.getAttribute('aria-hidden'),'true');assert.equal(await guideArrow.evaluate(el=>getComputedStyle(el).pointerEvents),'none');checks+=2;
 assert.equal(await guideArrow.locator('svg').evaluate(el=>getComputedStyle(el).animationName),'pixel-point-right');checks++;
 assert.equal(await page.locator('.brand-mark').evaluate(el=>getComputedStyle(el).backgroundColor),'rgba(0, 0, 0, 0)');assert.equal(await page.locator('.offerflash-mark path').first().getAttribute('fill'),'#5145c7');checks+=2;

 await page.locator('[data-testid="universal-answer-input"]').fill('虚构示例：徒步与阅读');
 await page.locator('[data-testid="universal-answer-remember"]').click();
 await page.waitForFunction('document.querySelector("#active-answer-question")?.textContent==="常用工具"');
 assert.equal(saves,1);assert.equal(confirms,1);assert.equal(continues,1);checks+=3;
 assert.ok((await page.locator('[data-testid=application-answer-alert]').textContent())?.includes('需要你回答 3 个问题'));checks++;
 await page.locator('[data-testid="universal-answer-choice"]').filter({hasText:'Figma'}).click();
 assert.equal(await page.locator('[data-testid="universal-answer-choice"]').filter({hasText:'Figma'}).getAttribute('aria-pressed'),'true');checks++;
 await screenshot('guided-answer.png');
 await page.locator('[data-testid="universal-answer-remember"]').click();await page.waitForFunction('document.querySelector("#active-answer-question")?.textContent==="是否接受出差"');

 const scope=page.locator('.answer-reuse-scope');assert.equal(await scope.count(),1);checks++;
 const scopeGeometry=await scope.evaluate(el=>[...el.querySelectorAll('label')].map(label=>{const input=label.querySelector('input')!.getBoundingClientRect(),text=label.querySelector('span')!.getBoundingClientRect();return{inputWidth:input.width,textWidth:text.width,rowHeight:label.getBoundingClientRect().height,gap:text.left-input.right};}));
 for(const row of scopeGeometry){assert.ok(row.inputWidth<=18);assert.ok(row.textWidth>=160);assert.ok(row.rowHeight<=42);assert.ok(row.gap>=6);checks+=4;}
 assert.equal(await page.locator('[data-testid=universal-answer-input]').evaluate(el=>el===document.activeElement),true);checks++;
 await screenshot('compact-answer-scope.png');
 assert.equal(await page.getByText(result.message,{exact:true}).count(),1);checks++;
 window.setSize(1080,780);await page.waitForFunction('innerWidth===1080');
 const narrowScope=await scope.evaluate(el=>({width:el.getBoundingClientRect().width,inputs:[...el.querySelectorAll('input')].map(node=>node.getBoundingClientRect().width),labels:[...el.querySelectorAll('label')].map(node=>node.getBoundingClientRect().height)}));
 assert.ok(narrowScope.width>=200);assert.ok(narrowScope.inputs.every(width=>width<=18));assert.ok(narrowScope.labels.every(height=>height<=42));checks+=3;
 await screenshot('compact-answer-scope-narrow.png');window.setSize(1480,980);await page.waitForFunction('innerWidth===1480');
 await page.locator('[data-testid=universal-answer-input]').fill('虚构示例：可以按合理安排出差');await page.locator('[data-testid=answer-reuse-personal]').check();await page.locator('[data-testid=universal-answer-remember]').click();await page.waitForFunction('document.querySelector("#active-answer-question")?.textContent==="为什么希望加入本公司"');
 assert.equal(await page.locator('[data-testid=answer-reuse-personal]').count(),0);checks++;
 await page.locator('[data-testid=universal-answer-skip]').click();await page.waitForSelector('[data-testid="universal-answer-continue"]');
 assert.equal(saves,3);assert.equal(confirms,3);assert.equal(continues,1);checks+=3;
 // Check narrow layout again with the answer panel expanded; primary controls remain inside the viewport.
 window.setSize(1080,780);await page.waitForFunction('innerWidth===1080');
 const buttonBox=await page.locator('[data-testid="quick-fill"]').boundingBox();assert.ok(buttonBox&&buttonBox.x+buttonBox.width<=1080);checks++;
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);checks++;
 await screenshot('narrow-answer.png');
 await page.locator('[data-testid="universal-answer-continue"]').click();await page.waitForFunction('document.querySelector("#active-answer-question")?.textContent==="兴趣爱好"');assert.equal(continues,2);checks++;
 await page.waitForSelector('[data-testid=remembered-answer-review]');assert.equal(await page.locator('[data-testid=universal-answer-input]').inputValue(),'虚构示例：徒步与阅读');assert.equal(saves,3);checks+=2;
 // Reopen the actual SQLite file, then apply production matching at a different site.
 await file.close();file=await openDatabaseFile({directory:dataDirectory});assets=createApplicationAssetsStore(file);
 const saved=await assets.getState();assert.equal(saved.answers.length,3);checks++;
 for(let i=0;i<3;i++){const field={...fields[i]!,section:'补充资料'};const next=universalQuestion(field,'https://another.invalid/application/99',undefined,[])!;
  const matches=eligibleUniversalAnswers({answers:saved.answers},profile.version).filter(a=>universalAnswerMatches(a,next,field));assert.equal(matches.length,1);checks++;
 }
 assert.equal(saved.answers.some(a=>a.questionPattern===questions[3]!.key),false);checks++;
 // A state change clears stale questions rather than applying answers to another profile version.
 await page.evaluate('window.__ui.changeProfile()');await page.waitForSelector('[data-testid="universal-missing-questions"]',{state:'detached'});checks++;
 window.setSize(1280,900);await page.evaluate('window.__ui.navigate("dashboard")');
 await page.getByRole('button',{name:'设置与工具',exact:true}).click();await page.locator('[data-testid="onboarding-reopen"]').click();await page.waitForSelector('[data-testid="onboarding-dialog"]');
 assert.ok((await page.locator('[data-testid="onboarding-dialog"]').textContent())?.includes('现在只做这件事'));checks++;
 await page.locator('.modal').evaluate(async el=>{await document.fonts.ready;await Promise.all(el.getAnimations({subtree:true}).filter(a=>a.effect?.getTiming().iterations!==Infinity).map(a=>a.finished.catch(()=>{})));await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));});
 await screenshot('onboarding.png');
 const onboardingArrow=page.locator('.onboarding-primary-target .pixel-guide-arrow');assert.equal(await onboardingArrow.count(),1);checks++;
 await page.emulateMedia({reducedMotion:'reduce'});assert.equal(await onboardingArrow.locator('svg').evaluate(el=>getComputedStyle(el).animationName),'none');checks++;

 assert.deepEqual(errors,[]);assert.equal(externalRequests,0);checks+=2;
 const report={checks,widths,saves,confirms,fillButtonReceipts:continues,externalRequests,errors,directory,scope:'isolated production UI and production SQLite; no model, employer, native field execution or normal app restart'};
 await writeFile(join(directory,'validation.json'),JSON.stringify(report,null,2));console.log('UI_INTERACTION_RESULT '+JSON.stringify(report));
}catch(e){await writeFile(join(directory,'failure.png'),(await window.webContents.capturePage()).toPNG());await writeFile(join(directory,'failure.txt'),String(e)+'\n'+errors.join('\n'));console.error('UI_INTERACTION_FAILURE '+directory,e);process.exitCode=1;}
finally{await bridge?.close();window.destroy();await file.close();app.exit(Number(process.exitCode??0));}
