import {auditRealForm} from './real-form-record-audit.js';
import {app,BrowserWindow,ipcMain} from 'electron';
import {mkdir,writeFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {setTimeout as delay} from 'node:timers/promises';
import {BrowserController} from '../../packages/browser/src/controller.js';
import {READ_FORM} from '../../packages/browser/src/read-scripts.js';
import {READ_FEISHU_CAREER} from '../../packages/browser/src/feishu-scripts.js';
import {prepareOneClickCareer} from '../../packages/ui/src/one-click-career.js';
import {createCareerFormFixtureProfile} from './fixtures/career-form-profile.js';
import type {CareerFillOutcome} from '../../packages/shared/src/contracts.js';

if(!process.argv.includes('--real-form-record'))throw new Error('REAL_FORM_RECORD_REQUIRED');
const root=resolve(process.argv.find(a=>a.startsWith('--demo-root='))?.slice(12)??'.');
const directory=resolve(process.argv.find(a=>a.startsWith('--demo-output='))?.slice(14)??'');
if(!directory.startsWith(join(root,'.backups')+'/'))throw new Error('ISOLATED_DIRECTORY_REQUIRED');
await mkdir(join(directory,'browser-session'),{recursive:true,mode:0o700});
app.setName('OfferFlash Real Form Recorder');app.setPath('userData',directory);app.setPath('sessionData',join(directory,'browser-session'));
await app.whenReady();
const profile=createCareerFormFixtureProfile();profile.fullName='林小闪';profile.fullNameEn='Xiaoshan Lin';profile.email='flash-demo@example.invalid';profile.phone='13800000000';
profile.school='清华大学';profile.schoolEn='Tsinghua University';profile.career!.educations[0]!.school=profile.school;profile.career!.educations[0]!.schoolEn=profile.schoolEn;profile.career!.educations[1]!.school='北京大学';profile.career!.educations[1]!.schoolEn='Peking University';
profile.career!.projects[0]!.url='https://example.invalid/flash-demo/retrieval';profile.career!.projects[1]!.url='https://example.invalid/flash-demo/workflow';
profile.career!.internships[0]!.role='算法实习生';profile.career!.projects[0]!.role='主要开发者';profile.career!.projects[1]!.role='主要负责人';
const window=new BrowserWindow({title:'OfferFlash · 真实企业页录制（虚构资料，不提交）',width:1440,height:1000,minWidth:1100,minHeight:780,show:true,backgroundColor:'#111722',webPreferences:{preload:join(root,'apps/desktop/real-form-record-preload.cjs'),contextIsolation:true,nodeIntegration:false,sandbox:true}});
window.on('page-title-updated',e=>e.preventDefault());
let busy=false,stopping=false,locked=false,recording=false,capture:Promise<void>|undefined;
let blockedRequests=0,lastMessage='等待登录与空白表单检查';
const status=(message:string)=>{lastMessage=message;if(!window.isDestroyed())window.webContents.send('real-form-record:status',{message,busy});};
const browser=new BrowserController({window,getProfile:async()=>structuredClone(profile),onState:state=>{void writeFile(join(directory,'page-status.json'),JSON.stringify({host:(()=>{try{return new URL(state.url).hostname;}catch{return '';}})(),loading:state.loading,hasError:!!state.error})).catch(()=>{});},enableFieldCompanion:true,fillRetryLimit:2});
const contents=browser.view.webContents;
const resize=()=>{const b=window.getContentBounds();browser.resize({x:0,y:116,width:b.width,height:b.height-116});};resize();browser.setVisible(true);window.on('resize',()=>{if(!busy)resize();});
contents.session.webRequest.onBeforeRequest((_request,callback)=>{if(locked){blockedRequests++;callback({cancel:true});}else callback({cancel:false});});
const ui=pathToFileURL(join(root,'apps/desktop/real-form-record.html')).href;
const authorized=(event:Electron.IpcMainInvokeEvent)=>{if(event.sender!==window.webContents||event.senderFrame!==window.webContents.mainFrame||event.senderFrame.url!==ui)throw new Error('UNAUTHORIZED');};
const read=<T=any>(script:string)=>contents.executeJavaScript(script,false) as Promise<T>;
function assertPage(){const url=new URL(contents.getURL());if(url.origin!=='https://modelbest.jobs.feishu.cn'||!/\/resume\/[^/]+\/apply/.test(url.pathname))throw new Error('请先登录并进入面壁智能的申请表。');}
async function inspect(){
 assertPage();const raw=await read(READ_FORM),career=await read(READ_FEISHU_CAREER);
 if(!career.supported)throw new Error('当前不是已适配的飞书旧版表单，请先核对页面。');
 const contactKeys=/^(?:姓名|申请人姓名|候选人姓名|真实姓名|邮箱|电子邮箱|手机号|手机号码|联系电话)\s*[*＊]?$/;
 const contacts=raw.fields.filter((f:any)=>contactKeys.test(f.label));
 const allowed=new Set([profile.fullName,profile.fullNameEn,profile.email,profile.phone]);
 const contactConflict=contacts.some((f:any)=>f.value.trim()&&!allowed.has(f.value.trim()));
 const careerNonempty=career.groups.some((g:any)=>g.fields.some((f:any)=>String(f.value).trim()));
 const safe=!contactConflict&&!careerNonempty;
 const result={safe,fieldCount:raw.fields.length,groupCount:career.groups.length,contactConflict,careerNonempty,recording:false};
 await writeFile(join(directory,'preflight-summary.json'),JSON.stringify(result,null,2));
 return {...result,message:safe?`已进入真实申请表：观察到 ${raw.fields.length} 个普通控件、${career.groups.length} 个经历组。当前没有发现已有联系人或经历资料，可以使用完整虚构履历录制。`:'页面已有联系人或履历内容，尚未开始录制或填写。请使用空白演示申请/测试账号，避免覆盖原资料。'};
}
ipcMain.handle('real-form-record:inspect',async event=>{authorized(event);if(busy)throw new Error('BUSY');try{const result=await inspect();status(result.message);return result;}catch(error){const message=error instanceof Error?error.message:'只读检查未完成';await writeFile(join(directory,'preflight-summary.json'),JSON.stringify({safe:false,message},null,2));status(message);return {safe:false,message};}});
ipcMain.handle('real-form-record:stop',event=>{authorized(event);stopping=true;browser.cancelCareerFill();status('已请求停止，等待已开始的输入核对；不会提交。');return {message:lastMessage};});
ipcMain.handle('real-form-record:start',async event=>{
 authorized(event);if(busy)throw new Error('BUSY');busy=true;stopping=false;
 const frames:Array<{file:string;atMs:number}>=[],journal:Array<{phase:string;kind:string;status?:string}>=[];
 const report:Record<string,any>={realEnterprisePage:true,realEmployerOrigin:'https://modelbest.jobs.feishu.cn',fictionalProfile:true,productionController:true,normalStoreRead:false,modelCalls:0,submissionClicked:false,uploads:0,privateURLSaved:false,stage:'preflight'};
 let careerResult:CareerFillOutcome|undefined;const start=performance.now();
 try{
  const preflight=await inspect();if(!preflight.safe)throw new Error(preflight.message);if(!window.isFocused())throw new Error('请将录制窗口保持前台后开始。');
  // Fresh isolated session only. Deny all new requests before any fictional write, including autosave POSTs and websocket handshakes.
  locked=true;report.newRequestsBlocked=true;
  const frameDir=join(directory,`take-${Date.now()}`);await mkdir(frameDir,{mode:0o700});report.frameDirectory=frameDir;
  recording=true;capture=(async()=>{while(recording&&!contents.isDestroyed()&&frames.length<2400){const tick=performance.now();
    // Crop away the account/site-header strip. Raw captures stay private until every frame is reviewed.
    const b=browser.view.getBounds(),top=100;const image=await contents.capturePage({x:0,y:top,width:b.width,height:Math.max(1,b.height-top)});
    const file=`frame-${String(frames.length).padStart(5,'0')}.png`;frames.push({file,atMs:performance.now()-start});await writeFile(join(frameDir,file),image.toPNG());await delay(Math.max(1,100-(performance.now()-tick)));}})();
  status('正在录制真实页面，填写虚构联系资料；请保持窗口在前台。');report.stage='contacts';let contactVerified=0;
  for(const key of ['fullName','email','phone']){if(stopping)throw new Error('已停止');const plan=await browser.preparePlan();const items=plan.items.filter(item=>item.profileKey===key&&item.status==='ready');if(items.length!==1)continue;const result=await browser.fillApproved(plan.id,[items[0]!.fieldId]);contactVerified+=result.verified.length;if(result.unresolved.length)throw new Error('联系字段未核实，已停止，保留页面供检查。');}
  report.contactVerified=contactVerified;report.stage='career';status('正在填写完整履历：两段教育、两段实习、两个项目；学历、起止日期、角色与链接均需核对。');
  const observation=await browser.prepareCareerFill({profileVersion:profile.version}),choice=prepareOneClickCareer(profile,observation);
  if(choice.status!=='ready')throw new Error('经历组无法唯一对应虚构资料，已停止。');const plan=await browser.prepareCareerFill(choice.options);
  careerResult=await browser.runCareerFill(plan.planId,async event=>{journal.push({phase:event.phase,kind:event.action.kind,...('status' in event?{status:event.status}:{})});});
  report.careerResult=careerResult;report.stage='independent-readback';
  const raw=await read(READ_FORM),career=await read(READ_FEISHU_CAREER);
  report.observedFieldCount=raw.fields.length;report.finalCareerGroupCount=career.groups.length;
  report.requiredEmpty=raw.fields.filter((f:any)=>f.required&&f.editable&&!String(f.value).trim()&&!['checkbox','radio','file','hidden','submit','button'].includes(f.type)).map((f:any)=>({label:f.label,type:f.type}));
  report.requiredFiles=raw.fields.filter((f:any)=>f.required&&f.type==='file').length;
  report.visibleErrors=await read(`Array.from(document.querySelectorAll('[role="alert"],.error-message,.field-error')).filter(e=>e.getClientRects().length&&getComputedStyle(e).visibility!=='hidden').map(e=>String(e.textContent||'').trim()).filter(Boolean).slice(0,30)`);
  report.wholeFormAudit=auditRealForm(raw.fields,career.groups,profile,careerResult,report.visibleErrors.length);
  report.informationComplete=report.wholeFormAudit.complete;
  status(report.informationComplete?'已填完并核对当前业务信息；未提交。录制保留等待复核。':`录制已停止：履历 ${careerResult.status}，仍有待处理内容，不能作为“整表填完”的演示。`);
  await delay(1200);recording=false;await capture;report.stage='finished';report.frameCount=frames.length;
  const lines=frames.flatMap((f,i)=>[`file '${f.file}'`,`duration ${((frames[i+1]?.atMs??f.atMs+100)-f.atMs)/1000}`]);if(frames.length)lines.push(`file '${frames.at(-1)!.file}'`);
  await writeFile(join(frameDir,'frames.ffconcat'),'ffconcat version 1.0\n'+lines.join('\n')+'\n');
  report.blockedNewRequests=blockedRequests;report.journal=journal;await writeFile(join(directory,'record-report.json'),JSON.stringify(report,null,2));return {message:lastMessage};
 }catch(error){recording=false;await capture?.catch(()=>{});report.failed=true;report.error=error instanceof Error?error.message:'录制未完成';report.careerResult=careerResult;report.careerDiagnostic=browser.getCareerDiagnostics();report.frames=frames.length;report.journal=journal;
  await writeFile(join(directory,'record-report.json'),JSON.stringify(report,null,2));status('录制未完成，已停止后续填写。请保留窗口，核对后再继续；未提交。');return {message:lastMessage};
 }finally{busy=false;status(lastMessage);}
});
window.on('closed',()=>{recording=false;browser.dispose();});app.on('window-all-closed',()=>app.quit());await window.loadFile(join(root,'apps/desktop/real-form-record.html'));
await browser.navigate('https://modelbest.jobs.feishu.cn/campus/m/position/7550158206165944639/detail');
