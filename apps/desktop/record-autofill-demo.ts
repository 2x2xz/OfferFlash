import {app,BrowserWindow,session} from 'electron';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {setTimeout as delay} from 'node:timers/promises';
import assert from 'node:assert/strict';
import {FieldCompanion} from '../../packages/browser/src/field-companion.js';
import {runBackgroundOrdinaryFill} from '../../packages/browser/src/background-executor.js';
import {BACKGROUND_READ_FORM,backgroundWriteScript} from '../../packages/browser/src/background-scripts.js';
import {createCareerFormFixtureProfile} from './fixtures/career-form-profile.js';
import type {BrowserBounds} from '../../packages/shared/src/contracts.js';

if(!process.argv.includes('--record-fictional-autofill'))throw new Error('Isolated fictional recording only');
const root=resolve(process.argv.find(arg=>arg.startsWith('--demo-root='))?.slice(12)??'.');
const output=resolve(process.argv.find(arg=>arg.startsWith('--demo-output='))?.slice(14)??'');
if(!output.startsWith(join(root,'.backups')+'/'))throw new Error('Output must stay in ignored evidence directory');
await mkdir(output,{recursive:true,mode:0o700});
app.setName('OfferFlash Demo Recorder');app.setPath('userData',join(output,'isolated-session'));
app.setPath('sessionData',join(output,'isolated-browser'));
await app.whenReady();
const target='https://offerflash-demo.invalid/application',html=await readFile(join(root,'apps/desktop/fixtures/autofill-demo.html'),'utf8');
const ownSession=session.fromPartition(`offerflash-record-${randomUUID()}`);
let blockedRequests=0;
ownSession.webRequest.onBeforeRequest((details,callback)=>{const allowed=details.url===target||details.url.startsWith('data:');if(!allowed)blockedRequests++;callback({cancel:!allowed});});
await ownSession.protocol.handle('https',request=>new Response(request.url===target?html:'blocked',{status:request.url===target?200:403,headers:{'content-type':'text/html;charset=utf-8'}}));
const window=new BrowserWindow({show:false,width:1280,height:780,useContentSize:true,webPreferences:{session:ownSession,contextIsolation:true,sandbox:true,nodeIntegration:false,backgroundThrottling:false}});
const contents=window.webContents;contents.setWindowOpenHandler(()=>({action:'deny'}));
contents.on('will-navigate',(event,url)=>{if(url!==target)event.preventDefault();});
const companion=new FieldCompanion(contents);
const profile=createCareerFormFixtureProfile();profile.fullName='林小闪（演示）';profile.fullNameEn='Xiaoshan Lin';profile.email='flash-demo@example.invalid';
profile.school='星河科技大学（虚构）';profile.schoolEn='Fictional Starfield University';
profile.career!.educations=profile.career!.educations.slice(0,1);profile.career!.educations[0]!.school=profile.school;profile.career!.educations[0]!.schoolEn=profile.schoolEn;
let generation=0;contents.on('did-start-navigation',(_event,_url,_inPlace,main)=>{if(main)generation++;});
const read=<T=any>(script:string)=>contents.executeJavaScript(script,false) as Promise<T>;
const setUI=(code:string)=>read(`(()=>{${code}})()`);
const frames:Array<{file:string;atMs:number}>=[];let recording=true;let captureTask:Promise<void>|undefined;
let last:BrowserBounds|undefined,writes=0;const verified:Array<{count:number;atMs:number}>=[];
const clock=performance.now();
try{
 await contents.loadURL(target);assert.equal(window.isVisible(),false);assert.equal(contents.isFocused(),false);
 contents.debugger.attach('1.3');await contents.debugger.sendCommand('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'no-preference'}]});
 // Real Chromium frames, sampled against the wall clock. No animation seeking or post-hoc speedup.
 captureTask=(async()=>{while(recording){const tick=performance.now(),image=await contents.capturePage();const file=`frame-${String(frames.length).padStart(4,'0')}.png`;const atMs=performance.now()-clock;
   await writeFile(join(output,file),image.toPNG());frames.push({file,atMs});await delay(Math.max(1,50-(performance.now()-tick)));}})();
 await delay(800);await setUI(`document.getElementById('start-demo').click();`);assert.equal(await read('window.demo.startRequested'),true);
 const observed=await read(BACKGROUND_READ_FORM);assert.equal(observed.fields.length,8);assert.ok(observed.fields.every((field:any)=>field.value===''));
 await setUI(`document.getElementById('start-demo').disabled=true;document.getElementById('start-demo').textContent='ϟ 正在填写';document.getElementById('read-step').className='step done';document.getElementById('fill-step').className='step active';document.getElementById('message').textContent='识别到了 8 个信息项。我来逐项填写，再核对一遍。';`);
 const started=performance.now();
 const result=await runBackgroundOrdinaryFill({read:()=>read(BACKGROUND_READ_FORM),getProfile:async()=>structuredClone(profile),getURL:()=>contents.getURL(),getGeneration:()=>generation,
  async write(input){const raw=await read(BACKGROUND_READ_FORM),field=raw.fields.find((entry:any)=>entry.index===input.index);assert.ok(field);last={...field.bounds};
   await setUI(`document.getElementById('current').textContent=${JSON.stringify('正在填写：')}+${JSON.stringify(field.label)};`);
   await companion.show({phase:'approach',bounds:last!});await companion.show({phase:'typing',bounds:last!});
   const outcome=await read<{status:'written'|'stale'|'unsupported'|'nonempty'}>(backgroundWriteScript(input));if(outcome.status==='written')writes++;return outcome;
  }},profile,new AbortController().signal,(count,pending)=>{verified.push({count,atMs:performance.now()-started});
   void setUI(`document.getElementById('progress-copy').textContent='已核对 ${count} / 8 项';document.getElementById('progress-bar').style.width='${count/8*100}%';document.getElementById('verify-step').className='step active';`);
  });
 const fillingMs=performance.now()-started;await delay(80);
 const after=await read(`({values:[...document.querySelectorAll('input,select')].map(n=>n.value),valid:[...document.querySelectorAll('input,select')].every(n=>n.validity.valid),...window.demo,active:document.activeElement.tagName,bridge:typeof window.offer})`);
 assert.equal(result.verifiedCount,8);assert.equal(result.pendingCount,0);assert.equal(writes,8);assert.equal(after.inputs,8);assert.equal(after.submissions,0);assert.equal(after.valid,true);
 assert.deepEqual(after.values,[profile.fullName,profile.fullNameEn,profile.email,profile.phone,profile.school,'master',profile.major,profile.graduationMonth]);
 assert.equal(after.active,'BODY');assert.equal(after.bridge,'undefined');assert.equal(contents.isFocused(),false);
 if(last)await companion.show({phase:'verified',bounds:last});
 await setUI(`document.getElementById('start-demo').textContent='✓ 已填写';document.getElementById('fill-step').className='step done';document.getElementById('verify-step').className='step done';document.getElementById('message').textContent='8 项信息已经填好并核对。剩下的，交给你最后检查。';document.getElementById('current').textContent='完成填写，未提交申请';document.getElementById('review').textContent='✓ 8 项已核对 · 等你检查';document.getElementById('review').className='review complete';`);
 await delay(1200);recording=false;await captureTask;
 assert.ok(frames.length>=40&&frames.length<=300);
 const lines=frames.flatMap((frame,index)=>[`file '${frame.file}'`,`duration ${((frames[index+1]?.atMs??frame.atMs+50)-frame.atMs)/1000}`]);lines.push(`file '${frames.at(-1)!.file}'`);
 await writeFile(join(output,'frames.ffconcat'),'ffconcat version 1.0\n'+lines.join('\n')+'\n');
 await writeFile(join(output,'recording-report.json'),JSON.stringify({ok:true,frames:frames.length,capturedDurationMs:frames.at(-1)!.atMs-frames[0]!.atMs,fillingMs,verified,writes,verifiedCount:result.verifiedCount,pendingCount:result.pendingCount,
  page:'original local demonstration form',job:{company:'面壁智能',title:'语言大模型算法研究员',officialURL:'https://modelbest.jobs.feishu.cn/campus/m/position/7550158206165944639/detail',checkedOn:'2026-10-19'},
  people:'fictional only',productionModules:['runBackgroundOrdinaryFill','backgroundWriteScript','FieldCompanion'],nativeInputs:0,enterpriseRequests:0,paidModelCalls:0,submissions:after.submissions,animationSeeking:false,speedup:false,blockedRequests},null,2));
 console.log(JSON.stringify({ok:true,frames:frames.length,verifiedCount:8,submissions:0}));
}catch(error){recording=false;await captureTask?.catch(()=>{});await writeFile(join(output,'recording-failure.json'),JSON.stringify({error:String(error),frames:frames.length}));throw error;}
finally{await companion.dispose();if(contents.debugger.isAttached())contents.debugger.detach();window.destroy();app.quit();}
