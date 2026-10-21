import {app,BrowserWindow,WebContentsView} from 'electron';
import {mkdtemp,writeFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import assert from 'node:assert/strict';
import {attachPlaywrightView} from '../../packages/browser/src/playwright-view.js';
import {READ_UNIVERSAL_FORM,UNIVERSAL_CONTROL_SELECTOR} from '../../packages/browser/src/universal-read.js';
import {READ_FORM} from '../../packages/browser/src/read-scripts.js';

// Original fictional DOM. The production reader runs read-only; no API or form
// actions, and no real site/profile is consulted to make these expected labels.
const directory=await mkdtemp(resolve('.backups/universal-purpose-browser-'));
app.setPath('userData',directory);await app.whenReady();
const window=new BrowserWindow({show:false}),view=new WebContentsView({webPreferences:{sandbox:true,contextIsolation:true,nodeIntegration:false,backgroundThrottling:false,partition:'universal-purpose-fictional'}});
window.contentView.addChildView(view);view.setBounds({x:0,y:0,width:1200,height:900});
const html=`<meta charset="utf-8"><style>body{font:16px sans-serif}input{min-height:24px}form,fieldset,nav,header,search{margin:6px}label{display:block}</style>
 <nav><form><input id="navbar" title="搜索职位" placeholder="Keyword"></form></nav>
 <form><input id="standalone" title="Search jobs" placeholder="Keyword"></form>
 <nav><form><input id="search-with-submit" title="Search positions" placeholder="Keyword"><input type="submit" value="Search"></form></nav>
 <form><input id="keyword" placeholder="Keyword"></form>
 <nav><input id="native-search" type="search" placeholder="Keyword"></nav>
 <form role="search"><input id="search-landmark" placeholder="Keyword"></form>
 <header><input id="not-a-job-search" title="Search project architecture" placeholder="Keyword"></header>
 <form><fieldset><legend>申请问题</legend><label>请介绍你做过的搜索项目<input id="question-search" type="search"></label><label>搜索职位<input id="fieldset-search" type="search" title="Search jobs"></label></fieldset></form>
 <form><label>请介绍搜索项目<input id="bare-question" type="search"></label></form>
 <label>Search jobs<input id="label-only"></label>
 <nav><div><input id="owned-select" role="combobox" aria-controls="owned-options" title="Search jobs" aria-label="岗位意向" aria-valuetext=""></div></nav><div id="owned-options" role="listbox" hidden><div role="option">虚构方向</div></div>
 <fieldset><legend>Education</legend><label>学校名称<input id="school" value="虚构大学"></label><label>Search jobs<input id="career-search" type="search" title="Search jobs"></label></fieldset>
 <form><label>邮箱<input id="email" type="email" value="fixture@example.invalid"></label><header><input id="shared-application" type="search" title="Search jobs"></header></form>
 <fieldset><legend>更新说明</legend>
  <label>同步更新在线简历<input id="optional-sync" type="checkbox"></label>
  <label>同步更新在线简历<input id="required-sync" type="checkbox" required></label>
  <label>同步更新在线简历<input id="aria-required-sync" type="checkbox" aria-required="true"></label>
  <label>Sync my online resume<input id="english-sync" type="checkbox"></label>
  <label>是否接受异地工作<input id="qualification" type="checkbox"></label>
  <label>你是否做过同步更新在线简历功能<input id="biography-checkbox" type="checkbox"></label>
  <label>同步更新在线简历<input id="biography-text" value="KEEP"></label>
 </fieldset>
 <fieldset><legend>双语更新说明</legend>
  <label><span>同步更新在线简历</span><span> / </span><span>Synchronously update online resume</span><input id="bilingual-sync" type="checkbox"></label>
  <label>Synchronously update online resume<input id="adverb-sync" type="checkbox"></label>
  <label><span>Sync my online resume</span> / <span>同步更新在线简历</span><input id="reverse-sync" type="checkbox"></label>
  <label><span>同步更新在线简历</span> / <span>申请人拥有工作许可</span><input id="mixed-qualification" type="checkbox"></label>
  <label><span>同步更新在线简历</span> / <span>Update online resume and confirm work eligibility</span><input id="mixed-extra-action" type="checkbox"></label>
  <label>同步更新在线简历 / <input id="empty-alias" type="checkbox"></label>
  <label>同步更新在线简历 / Synchronously update online resume / Confirm work authorization<input id="three-aliases" type="checkbox"></label>
  <label><span>同步更新在线简历</span> / <span>Synchronously update online resume</span><input id="required-bilingual" type="checkbox" required></label>
  <label><span>同步更新在线简历</span> / <span>Synchronously update online resume</span><input id="aria-required-bilingual" type="checkbox" aria-required="true"></label>
 </fieldset>`;
try{
 await view.webContents.loadURL('data:text/html;charset=utf-8,'+encodeURIComponent(html));const attached=await attachPlaywrightView(view.webContents),page=attached.page;let checks=0;
 const state=()=>page.locator(UNIVERSAL_CONTROL_SELECTOR).evaluateAll(elements=>elements.map(e=>({id:e.id,value:(e as HTMLInputElement).value,checked:(e as HTMLInputElement).checked,focused:e===e.ownerDocument.activeElement,html:e.outerHTML})));
 const before=await state(),base:any=await page.evaluate(READ_FORM),read:any=await page.evaluate(READ_UNIVERSAL_FORM);
 assert.equal(read.fields.length,base.fields.length);assert.deepEqual(read.fields.map((field:any)=>({index:field.index,identity:field.identity})),base.fields.map((field:any)=>({index:field.index,identity:field.identity})));checks+=2;
 const index=async(id:string)=>page.locator('#'+id).evaluate((element,selector)=>Array.from(document.querySelectorAll(selector)).filter(node=>!node.parentElement?.closest('[role="combobox"]')).indexOf(element),UNIVERSAL_CONTROL_SELECTOR);
 const field=async(id:string)=>{const actual=read.fields.find((field:any)=>field.index===indexMap[id]);assert.ok(actual,'Field must remain observable: '+id);return actual;};
 const ids=['navbar','standalone','search-with-submit','keyword','native-search','search-landmark','not-a-job-search','question-search','fieldset-search','bare-question','label-only','owned-select','school','career-search','email','shared-application','optional-sync','required-sync','aria-required-sync','english-sync','qualification','biography-checkbox','biography-text',
  'bilingual-sync','adverb-sync','reverse-sync','mixed-qualification','mixed-extra-action','empty-alias','three-aliases','required-bilingual','aria-required-bilingual'];
 const indexMap:Record<string,number>={};for(const id of ids)indexMap[id]=await index(id);
 for(const id of ['navbar','standalone','search-with-submit','native-search','search-landmark']){assert.equal((await field(id)).purpose,'site-search',id);checks++;}
 for(const id of ['keyword','not-a-job-search','question-search','fieldset-search','bare-question','label-only','owned-select','school','career-search','email','shared-application','required-sync','aria-required-sync','qualification','biography-checkbox','biography-text']){assert.equal((await field(id)).purpose,'application',id);checks++;}
 for(const id of ['optional-sync','english-sync']){assert.equal((await field(id)).purpose,'site-preference');assert.equal((await field(id)).purposeReason,'optional-resume-sync');checks+=2;}
 assert.equal((await field('owned-select')).ownedSelect,true);assert.equal((await field('required-sync')).required,true);assert.equal((await field('aria-required-sync')).required,true);checks+=3;
 assert.equal((await field('navbar')).purposeReason,'navigation-search');assert.equal((await field('standalone')).purposeReason,'standalone-job-search');checks+=2;
 assert.deepEqual(await state(),before);checks++;
 // Append-only coverage: the original 33 purpose assertions stay unchanged.
 for(const id of ['bilingual-sync','adverb-sync','reverse-sync']){assert.equal((await field(id)).purpose,'site-preference',id);assert.equal((await field(id)).purposeReason,'optional-resume-sync');checks+=2;}
 for(const id of ['mixed-qualification','mixed-extra-action','empty-alias','three-aliases','required-bilingual','aria-required-bilingual']){assert.equal((await field(id)).purpose,'application',id);checks++;}
 assert.equal((await field('bilingual-sync')).label,'同步更新在线简历 / Synchronously update online resume');assert.equal((await field('required-bilingual')).required,true);assert.equal((await field('aria-required-bilingual')).required,true);checks+=3;
 await attached.close();
 const report={universalPurpose:true,ok:true,checks,realEmployer:false,paidRequests:0,navigationSearchExcluded:true,keywordAloneRetained:true,applicationSearchRetained:true,ownedSelectRetained:true,requiredCheckboxRetained:true,optionalSyncClassified:true,bilingualSyncAliasesValidated:true,mixedAliasQuestionRetained:true,indicesAndIdentitiesRetained:true,zeroPageWrites:true};
 await writeFile(join(directory,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));view.webContents.close();window.destroy();app.exit(0);
}catch(error){console.error(error);window.destroy();app.exit(1);}
