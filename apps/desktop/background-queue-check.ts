import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { WebContentsView } from 'electron';
import { runBackgroundOrdinaryFill } from '../../packages/browser/src/background-executor.js';
import { BACKGROUND_READ_FORM, backgroundWriteScript } from '../../packages/browser/src/background-scripts.js';
import { emptyCareerInput, newCareerRecord } from '../../packages/profile/src/career-input.js';
import type { Profile } from '../../packages/shared/src/contracts.js';
import {readFile} from 'node:fs/promises';
import {join,dirname,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createFeishuFixtureScripts,FEISHU_READ_HELPERS} from '../../packages/browser/src/feishu-scripts.js';
import {backgroundCareerWriteScript,runBackgroundCareerFill} from '../../packages/browser/src/background-career.js';
import {backgroundCareerActionScript} from '../../packages/browser/src/background-career-actions.js';

/** Call only from the hidden smoke entry after app.ready. No normal store, model or OS input. */
export async function runBackgroundQueueDOMCheck():Promise<{passed:true;assertionCount:number;verifiedCount:number;monthVerifiedCount:number;careerVerifiedCount:number;nativeInputCount:0;paidRequests:0;scope:string}> {
  const p:Profile={version:4,updatedAt:'2026-10-19T00:00:00Z',fullName:'虚构候选人',fullNameEn:'',email:'candidate@example.invalid',phone:'13800000000',school:'',schoolEn:'',degree:'',major:'',majorEn:'',graduationMonth:'',skills:[],cities:[],targetRoles:[],resumeText:'',career:{...emptyCareerInput(),sources:[],educations:[{
    ...newCareerRecord('educations','fictional-master'),school:'虚构大学',degree:'硕士',major:'计算机',startDate:'2025-09',endDate:'2027-06',
    revision:1,confirmation:'confirmed',confirmedRevision:1,confirmedAt:'2026-10-19T00:00:00Z'}],internships:[],projects:[],publications:[],primaryEducationId:'fictional-master'}};
  let html='';
  const server=createServer((_request,response)=>{response.writeHead(200,{'content-type':'text/html;charset=utf-8'});response.end(html);});
  server.listen(0,'127.0.0.1');await once(server,'listening');const address=server.address();assert.ok(address&&typeof address==='object');
  const view=new WebContentsView({webPreferences:{sandbox:true,contextIsolation:true,nodeIntegration:false,backgroundThrottling:false}});
  view.setBounds({x:0,y:0,width:1280,height:900});view.setVisible(false);const contents=view.webContents;
  let generation=0;contents.on('did-start-navigation',(_event,_url,_inPlace,main)=>{if(main)generation++;});
  const url=`http://127.0.0.1:${address.port}/synthetic-form`;let assertionCount=0;
  const check=(condition:unknown,message:string)=>{assert.ok(condition,message);assertionCount++;};
  const shell=(body:string,script='')=>`<!doctype html><html><head><meta charset="utf-8"><style>body{font:16px sans-serif}input,select,textarea{display:block;width:300px;margin:8px;height:32px}</style></head><body><form>${body}<button type="submit">提交样表</button></form><script>window.checks={clicks:0,submits:0,inputs:0,firstName:true};document.addEventListener('click',()=>checks.clicks++);document.querySelector('form').addEventListener('submit',e=>{e.preventDefault();checks.submits++});document.addEventListener('input',()=>checks.inputs++);${script}</script></body></html>`;
  const transport={read:()=>contents.executeJavaScript(BACKGROUND_READ_FORM),write:(input:Parameters<typeof backgroundWriteScript>[0])=>contents.executeJavaScript(backgroundWriteScript(input)),
    getProfile:async()=>structuredClone(p),getURL:()=>contents.getURL(),getGeneration:()=>generation};
  try{
    html=shell(`<label for="name">姓名</label><input id="name"><label for="email">邮箱</label><input id="email" type="email"><label for="phone">手机号</label><input id="phone" type="tel"><label for="degree">学历</label><select id="degree"><option value="-1">请选择</option><option value="master">硕士</option></select><label for="existing">已有说明</label><textarea id="existing">保留网页原文</textarea><label for="consent">隐私协议</label><input id="consent" type="checkbox"><label for="attachment">简历附件</label><input id="attachment" type="file">`,
      `document.getElementById('name').addEventListener('input',event=>{if(checks.firstName){checks.firstName=false;event.target.value='';}})`);
    await contents.loadURL(url);check(!contents.isFocused(),'hidden view must not obtain input focus');
    const result=await runBackgroundOrdinaryFill(transport,p,new AbortController().signal,()=>{});
    const actual=await contents.executeJavaScript(`({name:document.getElementById('name').value,email:document.getElementById('email').value,phone:document.getElementById('phone').value,degree:document.getElementById('degree').value,existing:document.getElementById('existing').value,checked:document.getElementById('consent').checked,files:document.getElementById('attachment').files.length,checks,active:document.activeElement.tagName})`);
    check(result.verifiedCount===4,'four actual Chromium controls must be independently verified');
    check(actual.name===p.fullName&&actual.email===p.email&&actual.phone===p.phone,'actual text values must match synthetic profile');
    check(actual.degree==='master','native select must match its unique option');
    check(actual.existing==='保留网页原文','existing non-target text must survive');
    check(actual.checked===false&&actual.files===0,'agreement and attachment remain untouched');
    check(actual.checks.inputs===5,'one unchanged failed input gets exactly one retry');
    check(actual.checks.clicks===0&&actual.checks.submits===0,'no clicks or submission events');
    check(actual.active==='BODY'&&!contents.isFocused(),'background writes must not focus a field or window');
    html=shell(`<label for="selected">姓名</label><select id="selected"><option value="manager" selected>Selection Manager</option><option value="fictional">虚构候选人</option></select>`);
    {const loaded=once(contents,'did-finish-load');contents.reload();await loaded;}
    const selected=await runBackgroundOrdinaryFill(transport,p,new AbortController().signal,()=>{});
    check(selected.verifiedCount===0,'a legitimate existing selection must not be treated as a placeholder');
    check(await contents.executeJavaScript(`document.getElementById('selected').value==='manager'`),'existing selection preserved by fixed atomic page guard');
    html=shell(`<label for="secret">Password</label><input id="secret" type="password">`,`Object.defineProperty(document.getElementById('secret'),'value',{get(){throw new Error('must not read credential')}});`);
    {const loaded=once(contents,'did-finish-load');contents.reload();await loaded;}
    const login=await runBackgroundOrdinaryFill(transport,p,new AbortController().signal,()=>{});
    check(login.verifiedCount===0&&login.pendingCount===1,'password page is waiting-user before reading credential getters');
    check(!contents.isFocused(),'all cases remain unfocused');
    html=shell(`<label for="graduation">毕业时间</label><input id="graduation" type="month" min="2026-01" max="2028-12"><label for="day">预计毕业时间</label><input id="day" type="date">`);
    {const loaded=once(contents,'did-finish-load');contents.reload();await loaded;}
    const monthResult=await runBackgroundOrdinaryFill(transport,p,new AbortController().signal,()=>{});
    check(monthResult.verifiedCount===1,'exact confirmed graduation month can use native month setter');
    check(await contents.executeJavaScript(`document.getElementById('graduation').value==='2027-06'&&document.getElementById('graduation').validity.valid`),'month value and browser validity independently checked');
    check(await contents.executeJavaScript(`document.getElementById('day').value===''&&checks.submits===0&&checks.clicks===0`),'a month-only profile never invents a full day or submits');
    html=shell(`<label for="graduation">毕业时间</label><input id="graduation" type="month" min="2028-01">`);
    {const loaded=once(contents,'did-finish-load');contents.reload();await loaded;}
    const invalidMonth=await runBackgroundOrdinaryFill(transport,p,new AbortController().signal,()=>{});
    check(invalidMonth.verifiedCount===0&&await contents.executeJavaScript(`document.getElementById('graduation').value===''`),'native month out of website bounds is refused before setter');
    html=(await readFile(join(resolve(dirname(fileURLToPath(import.meta.url)),'../..'),'apps/desktop/fixtures/feishu-career.html'),'utf8'))
      .replace("if (kind === 'education') addGroup(kind); else section.append(makeAdd(kind, true));","addGroup(kind);");
    {const loaded=once(contents,'did-finish-load');contents.reload();await loaded;}
    const scopeOrigin=new URL(url).origin,scoped=createFeishuFixtureScripts(scopeOrigin);
    const helpers=FEISHU_READ_HELPERS.replace(/const fsScope = \(\) => location\.protocol === 'https:' && location\.hostname === 'modelbest\.jobs\.feishu\.cn'\s*&& \(!location\.port \|\| location\.port === '443'\);/,
      `const fsScope = () => location.origin === ${JSON.stringify(scopeOrigin)};`);
    check(helpers!==FEISHU_READ_HELPERS,'fixture scope must be explicit exact loopback');
    const careerProfile=structuredClone(p);
    careerProfile.career!.internships=[{...newCareerRecord('internships','fixture-intern'),organization:'虚构星河公司',role:'算法实习生',description:'虚构检索实现。',startDate:'2026-06',endDate:'',current:true,
      revision:1,confirmation:'confirmed',confirmedRevision:1,confirmedAt:'2026-10-19T00:00:00Z'}];
    careerProfile.career!.projects=[{...newCareerRecord('projects','fixture-project'),name:'虚构Agent项目',role:'主要开发者',description:'实现虚构工具循环。',url:'https://example.invalid/fictional-project',startDate:'2025-10',endDate:'',ongoing:true,
      revision:1,confirmation:'confirmed',confirmedRevision:1,confirmedAt:'2026-10-19T00:00:00Z'}];
    await contents.executeJavaScript(`document.getElementById('fictional-education[0].school').value=${JSON.stringify(careerProfile.career!.educations[0]!.school)}`);
    const careerBefore=await contents.executeJavaScript(scoped.READ_FEISHU_CAREER);
    check(careerBefore.supported===true&&careerBefore.groups.length===3,'reviewed synthetic legacy DOM has exactly three initial groups');
    const careerResult=await runBackgroundCareerFill({
      read:()=>contents.executeJavaScript(scoped.READ_FEISHU_CAREER),getURL:()=>contents.getURL(),getGeneration:()=>generation,getProfile:async()=>structuredClone(careerProfile),
      write:input=>contents.executeJavaScript(backgroundCareerWriteScript(input,{read:scoped.READ_FEISHU_CAREER,helpers})),
      action:input=>contents.executeJavaScript(backgroundCareerActionScript(input,helpers)),
      popup:async(fieldId,type)=>{const side=/^(.*):(start|end)$/.exec(fieldId);const code=type==='combobox'?scoped.readFeishuSelectPopup(fieldId):scoped.readFeishuMonthPopup(side![1]!,side![2] as 'start'|'end');return (await contents.executeJavaScript(code)).popup;},
    },careerProfile,new AbortController().signal,()=>{});
    const careerAfter=await contents.executeJavaScript(scoped.READ_FEISHU_CAREER);
    const careerFields=Object.fromEntries(careerAfter.groups.flatMap((group:any)=>group.fields.map((field:any)=>[field.fieldId,field.value])));
    check(careerResult.verifiedCount===15,'15 supported career fields must verify in hidden Chromium');
    check(careerFields['education[0].degree']==='硕士','exact associated custom degree option selected');
    check(careerFields['education[0].period:start']==='2025-09'&&careerFields['education[0].period:end']==='2027-06','start and end months independently match confirmed education');
    check(careerFields['internship[0].period:start']==='2026-06'&&careerFields['internship[0].period:end']==='至今','internship start and until-now are selected');
    check(careerFields['project[0].period:start']==='2025-10'&&careerFields['project[0].period:end']==='至今','project month and until-now are selected');
    check(careerAfter.groups.filter((group:any)=>group.kind!=='education').every((group:any)=>group.fields.find((field:any)=>field.side==='end').untilNow===true),'both end controls independently expose untilNow true');
    check(JSON.stringify(careerBefore.protectedControls)===JSON.stringify(careerAfter.protectedControls),'all observed non-career protected controls unchanged');
    const counters=await contents.executeJavaScript('window.feishuCareerFixture');
    check(counters.adds===0&&counters.submissions===0&&counters.submitClicks===0,'no add-group, submit or submission action');
    check(counters.selections===1&&counters.untilNow===2&&counters.years===4&&counters.months===4,'expected narrow popup phases executed exactly once');
    check(!contents.isFocused(),'complex background DOM phases never focus the webcontents/window');
    return {passed:true,assertionCount,verifiedCount:result.verifiedCount,monthVerifiedCount:monthResult.verifiedCount,careerVerifiedCount:careerResult.verifiedCount,nativeInputCount:0,paidRequests:0,scope:'hidden Chromium loopback synthetic ordinary and reviewed career controls; not enterprise validation'};
  }finally{
    if(!contents.isDestroyed())contents.close({waitForBeforeUnload:false});server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));
  }
}
