import {app,BrowserWindow,WebContentsView} from 'electron';
import {mkdtemp,writeFile} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import assert from 'node:assert/strict';
import {attachPlaywrightView} from '../../packages/browser/src/playwright-view.js';
import {UniversalFormSession} from '../../packages/browser/src/universal-form.js';
import {READ_UNIVERSAL_FORM} from '../../packages/browser/src/universal-read.js';
import {profile} from './moka-form.js';
import {universalErrorCode} from '../../packages/browser/src/universal-errors.js';

const dir=await mkdtemp(resolve('.backups/moka-interaction-'));app.setPath('userData',dir);await app.whenReady();
const win=new BrowserWindow({show:false}),view=new WebContentsView({webPreferences:{partition:'moka-interaction-fictional',sandbox:true,contextIsolation:true,nodeIntegration:false,backgroundThrottling:false}});
win.contentView.addChildView(view);view.setBounds({x:0,y:0,width:1100,height:800});
// Original fixture reproduces observed ownership/marker semantics; it is not an employer capture.
const proxy=(id:string,placeholder='')=>`<div><label><span class="sd-Input-display-value-fixture" hidden></span><input id="${id}" placeholder="${placeholder}"><span>\ue732</span></label><ul class="sd-Select-options-fixture" hidden></ul></div>`;
const widget=(id:string,label:string)=>`<div class="field"><div>${label}</div><div>${proxy(id)}</div></div>`;
const range=`<div><div>就读时间 / Education period</div><div class="month-range-select"><span>${proxy('sy','年 / Year')}${proxy('sm','月 / Month')}</span><span>-</span><span>${proxy('ey','年 / Year')}${proxy('em','月 / Month')}</span></div></div>`;
const html=`<meta charset="utf-8"><form onsubmit="window.submits++;return false"><label>姓名<input id="name"></label><label>邮箱<input id="email"></label><fieldset><legend>教育经历</legend>${widget('school','学校名称')}${widget('major','专业名称')}${widget('degree','学历')}${range}<label>GPA<input id="gpa"></label></fieldset><button id="add" type="button" onclick="window.adds++"><span><span>添加教育经历</span></span></button><fieldset><legend>实习经历</legend><label>公司名称<input id="company"></label><label>职位名称<input id="role"></label><div class="month-range-select"><label>至今<input id="present" type="checkbox"></label></div></fieldset><input type="checkbox" aria-label="同意隐私协议"><button id="submit">提交申请</button></form><div id="foreign"><div role="option">虚构甲大学</div></div><script>window.submits=0;window.adds=0;window.mode='normal';window.choices=0;
for(const id of ['school','major','degree','sy','sm','ey','em']){const input=document.getElementById(id),owner=input.parentElement.parentElement,list=owner.querySelector('ul');input.oninput=()=>{list.replaceChildren();const count=window.mode==='duplicate'?2:1;for(let i=0;i<count;i++){const li=document.createElement('li');li.className='sd-Select-option-fixture';li.textContent=input.value;li.onclick=()=>{window.choices++;if(window.mode!=='noCommit'){const marker=owner.querySelector('.sd-Input-display-value-fixture');marker.textContent=input.value;marker.hidden=false;input.value='';}list.hidden=true;};list.append(li);}list.hidden=false;};}
</script>`;
try{
 await view.webContents.loadURL('data:text/html;charset=utf-8,'+encodeURIComponent(html));const attached=await attachPlaywrightView(view.webContents),page=attached.page;
 const make=()=>new UniversalFormSession(page,profile,async()=>profile,()=>1,new AbortController().signal);
 let checks=0;
 const fact=(session:UniversalFormSession,kind:string,record='contact')=>session.facts.find(f=>f.kind===kind&&f.record===record)!;
 const fill=async(session:UniversalFormSession,label:string,kind:string,record='contact')=>{const x=await session.inspect(),f=fact(session,kind,record),field=x.fields.find(e=>e.label===label&&e.candidates.includes(f.ref));assert.ok(field,label);return session.fillGroup(x.observation,[{target:field.ref,fact:f.ref}]);};
 let session=make(),x=await session.inspect();assert.equal(x.actions.length,1);checks++;
 const email=x.fields.find(f=>f.label==='邮箱')!;
 // Geometry and decorative nodes change between observe and write. DOM identity is intact.
 await page.locator('form').evaluate(e=>{e.style.transform='translateY(11.5px)';e.prepend(document.createElement('div'));});
 assert.equal((await session.act({observation:x.observation,action:'fill',target:email.ref,fact:fact(session,'email').ref})).verified,true);checks++;
 x=await session.inspect();await page.locator('#name').fill('外部真实变化');
 await assert.rejects(session.act({observation:x.observation,action:'fill',target:x.fields.find(f=>f.label==='姓名')!.ref,fact:fact(session,'fullName').ref}),/PAGE_CHANGED_REOBSERVE/);checks++;
 // Query text alone cannot make a school count as filled or bind an education.
 await page.locator('#school').fill(profile.career!.educations[0]!.school);await page.locator('#school').evaluate(e=>(e.parentElement!.parentElement!.querySelector('ul') as HTMLElement).hidden=true);
 const read:any=await page.evaluate(READ_UNIVERSAL_FORM);assert.equal(read.fields.find((f:any)=>f.label==='学校名称').value,'');assert.equal(read.fields.find((f:any)=>f.label==='学校名称').queryPending,true);assert.equal(read.fields.find((f:any)=>f.label==='至今').type,'checkbox');checks+=3;
 const selected=await fill(session,'学校名称','school','education-1');assert.equal(selected.verified,1,JSON.stringify(selected));assert.equal(selected.failures.length,0);assert.equal(await page.locator('#school').inputValue(),'');checks++;
 assert.equal((await fill(session,'专业名称','major','education-1')).verified,1);checks++;
 for(const [caption,kind] of [['开始时间','startDate'],['结束时间','endDate']])for(const part of ['年','月']){assert.equal((await fill(session,'就读时间 / Education period · '+caption+' · '+part,kind!,'education-1')).verified,1);checks++;}
 assert.equal((await fill(session,'公司名称','organization','internship-1')).verified,1);checks++;
 assert.equal((await fill(session,'职位名称','role','internship-1')).verified,1);checks++;
 let final=await session.verify();assert.equal(final.verified,9);assert.equal(await page.locator('#gpa').inputValue(),'');assert.equal(await page.locator('#present').isChecked(),false);assert.equal(await page.locator('[aria-label="同意隐私协议"]').isChecked(),false);checks+=4;
 assert.equal((await fill(session,'至今','endDate','internship-1')).verified,1);assert.equal((await session.verify()).verified,10);await page.locator('#present').uncheck();assert.equal((await session.verify()).verified,9);checks+=3;session.close();
 // A stale Add still has strict target validation, unlike harmless layout churn.
 session=make();x=await session.inspect();await page.locator('form').evaluate(e=>e.prepend(document.createElement('div')));
 await assert.rejects(session.act({observation:x.observation,action:'add',target:x.actions[0]!.ref}),/PAGE_CHANGED_REOBSERVE/);checks++;session.close();
 // Distinct identical options are ambiguous, never pick the first.
 await page.evaluate("window.mode='duplicate'");session=make();const ambiguous=await fill(session,'学历','degree','education-1');assert.equal(ambiguous.verified,0);assert.equal(ambiguous.failures[0]!.reason,'OWNED_OPTION_AMBIGUOUS');assert.equal(await page.evaluate('window.choices'),6);checks++;session.close();
 await page.locator('#degree').evaluate(e=>(e.parentElement!.parentElement!.querySelector('ul') as HTMLElement).hidden=true);
 await page.evaluate("window.mode='noCommit'");session=make();const noCommit=await fill(session,'学历','degree','education-1');assert.equal(noCommit.verified,0);assert.equal(noCommit.failures[0]!.reason,'OWNED_SELECTION_NOT_COMMITTED');final=await session.verify();assert.equal(final.verified,0);assert.ok(final.remaining.some(f=>f.label==='学历'&&f.reason.includes('真正选中')));checks++;session.close();
 assert.equal(universalErrorCode(new Error('locator.fill: PRIVATE VALUE fixture@example.invalid')),'BROWSER_OPERATION_FAILED');assert.equal(await page.evaluate('window.submits'),0);assert.equal(await page.evaluate('window.adds'),0);checks+=3;
 await attached.close();const result={mokaInteraction:true,ok:true,checks,paidRequests:0,employerSite:false};await writeFile(join(dir,'report.json'),JSON.stringify(result));console.log(JSON.stringify(result));view.webContents.close();win.destroy();app.exit(0);
}catch(e){console.error(e);win.destroy();app.exit(1);}
