import {app,BrowserWindow,WebContentsView} from 'electron';
import {mkdtemp,writeFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import assert from 'node:assert/strict';
import {attachPlaywrightView} from '../../packages/browser/src/playwright-view.js';
import {UniversalFormSession} from '../../packages/browser/src/universal-form.js';
import {READ_UNIVERSAL_FORM} from '../../packages/browser/src/universal-read.js';
import {createOwnedSelectController} from '../../packages/browser/src/owned-select.js';
import {OWNED_SELECT_HELPERS} from '../../packages/browser/src/select-shape.js';
import {overrideProfile as profile} from './override-profile.js';
import {openDatabaseFile,writeDocument} from '../../packages/domain/src/sqlite.js';
import {createApplicationAssetsStore} from '../../packages/domain/src/application-assets.js';
import type {ConfirmedAnswer} from '../../packages/shared/src/application-assets.js';

// These are original, fictional widgets. They are behavioral regression cases,
// not employer compatibility evidence or a replacement for a model benchmark.
const directory=await mkdtemp(resolve('.backups/generic-controls-browser-'));
app.setPath('userData',directory);await app.whenReady();
const window=new BrowserWindow({show:false});
const view=new WebContentsView({webPreferences:{sandbox:true,contextIsolation:true,nodeIntegration:false,backgroundThrottling:false,partition:'generic-controls-fictional'}});
window.contentView.addChildView(view);view.setBounds({x:0,y:0,width:1200,height:900});

const sd=(id:string,label:string,values:string[],placeholder='Choose',rerender=false)=>`<div class="widget" data-widget="sd" data-values='${JSON.stringify(values)}'${rerender?' data-rerender="true"':''}><div>${label}</div><div class="single-control"><label class="select"><span class="sd-Input-display-value-fixture" hidden></span><input id="${id}" placeholder="${placeholder}" autocomplete="off"></label><i class="arrow"></i><div class="choice-menu" hidden></div></div></div>`;
const aria=(id:string,label:string,values:string[],portal=false,rerender=false)=>`<div class="widget" data-widget="aria" data-values='${JSON.stringify(values)}'${rerender?' data-rerender="true"':''}><div>${label}</div><button type="button" role="combobox" id="${id}" aria-label="${label}" aria-expanded="false" aria-valuetext=""${portal?' aria-controls="'+id+'-menu"':''}>Choose</button>${portal?'':`<div role="listbox" id="${id}-menu" hidden></div>`}</div>${portal?`<div role="listbox" id="${id}-menu" data-portal-owner="${id}" hidden></div>`:''}`;
const portal=(id:string,label:string,values:string[],rerender=false)=>aria(id,label,values,true,rerender);
const script=String.raw`
window.events={selected:[],submit:0,consent:0,upload:0,checkbox:0};
window.wire=()=>{
 for(const root of document.querySelectorAll('[data-widget]')){
  const kind=root.dataset.widget,input=root.querySelector('input,[role="combobox"]');
  const menu=kind==='sd'?root.querySelector('.choice-menu'):document.getElementById(input.id+'-menu');
  const values=JSON.parse(root.dataset.values);
  const close=()=>{menu.hidden=true;if(kind==='aria')input.setAttribute('aria-expanded','false');};
  const render=()=>{
   const query=kind==='sd'?input.value:'';menu.replaceChildren();
   for(const value of values.filter(value=>!query||value.toLowerCase().includes(query.toLowerCase()))){
    const option=document.createElement('div');option.className='choice-row';if(kind==='aria')option.setAttribute('role','option');option.textContent=value;
    option.onmousedown=event=>event.preventDefault();
    option.onclick=()=>{
     window.events.selected.push({id:input.id,value});
     if(kind==='sd'){const marker=root.querySelector('[class*="Input-display-value-"]');marker.textContent=value;marker.hidden=false;input.value='';input.placeholder='';}
     else{input.setAttribute('aria-valuetext',value);input.textContent=value;}
     close();input.dispatchEvent(new Event('change',{bubbles:true}));
     if(root.dataset.rerender==='true'){
      const fresh=input.cloneNode(true);fresh.setAttribute('data-recreated','yes');input.replaceWith(fresh);window.wire();
     }
    };menu.append(option);
   }
   menu.hidden=false;if(kind==='aria')input.setAttribute('aria-expanded','true');
  };
  input.onclick=render;if(kind==='sd')input.oninput=render;
  input.onkeydown=event=>{if(event.key==='Escape')close();};
  input.onblur=()=>{close();if(kind==='sd'&&root.querySelector('[class*="Input-display-value-"]').hidden)input.value='';};
 }
};window.wire();
document.querySelector('form').onsubmit=event=>{event.preventDefault();window.events.submit++;};
document.querySelector('#consent').onchange=()=>window.events.consent++;
document.querySelector('#upload').onchange=()=>window.events.upload++;
document.querySelector('#current')?.addEventListener('change',()=>window.events.checkbox++);
`;
const pageHTML=(content:string)=>String.raw`<meta charset="utf-8"><style>body{font:16px sans-serif}input,button{min-height:28px}.widget{position:relative;margin:10px 0;padding:3px}.single-control{display:inline-block;position:relative}.arrow:before{content:"\e732"}.choice-menu,[role=listbox]{position:absolute;background:#fff;border:1px solid #555;z-index:5;min-width:220px}.choice-row,[role=option]{padding:5px;cursor:pointer}label:focus-within [class*="Input-display-value-"]{display:none}fieldset{margin:12px 0}input[type=file]{width:180px}</style><form>${content}<label>同意隐私协议<input id="consent" type="checkbox"></label><label>上传简历<input id="upload" type="file"></label><button type="submit">提交申请</button></form><script>${script}</script>`;

try{
 await view.webContents.loadURL('data:text/html;charset=utf-8,'+encodeURIComponent(pageHTML('<label>姓名<input></label>')));
 const attached=await attachPlaywrightView(view.webContents),page=attached.page;
 const readEvents=()=>page.evaluate('window.events') as Promise<{selected:Array<{id:string;value:string}>;submit:number;consent:number;upload:number;checkbox:number}>;
 let session:UniversalFormSession|undefined,checks=0;
 const load=async(content:string,answers:ConfirmedAnswer[]=[])=>{session?.close();await page.setContent(pageHTML(content));session=new UniversalFormSession(page,profile,async()=>profile,()=>1,new AbortController().signal,true,{answers});};
 const fact=(kind:string,record:string)=>{const result=session!.facts.find(f=>f.kind===kind&&f.record===record);assert.ok(result,kind+' '+record);return result;};
 const fill=async(label:string,kind:string,record:string)=>{
  const x=await session!.inspect(),f=fact(kind,record),field=x.fields.find(field=>field.label===label&&field.candidates.includes(f.ref));
  assert.ok(field,'No actionable field: '+label+' / '+JSON.stringify(x));
  const result=await session!.fillGroup(x.observation,[{target:field.ref,fact:f.ref}]);
  assert.equal(result.verified,1,label+' / '+JSON.stringify(result));checks++;return result;
 };
 const noMenus=async()=>{assert.equal(await page.locator('.choice-menu:visible,[role="listbox"]:visible').count(),0,'Transaction must close its popup');checks++;};
 const noUnsafe=async()=>{const events=await readEvents();assert.equal(events.submit+events.consent+events.upload,0);assert.equal(await page.locator('#consent').isChecked(),false);assert.equal(await page.locator('#upload').inputValue(),'');checks+=3;};

 // A control's operation must not depend on whether its label names a school,
 // degree or language. Each transaction reads the options the page rendered.
 await load(`<fieldset><legend>教育经历</legend>${sd('school','学校名称',['虚构乙大学','虚构甲大学'])}${aria('degree','学历',['本科','硕士'])}${portal('major','专业名称',['统计学','人工智能'])}</fieldset>`);
 assert.ok(await page.locator('.arrow').evaluate(e=>getComputedStyle(e,'::before').content.includes('\ue732')),'Fixture must render a real CSS icon, not the text e732');checks++;
 await fill('学校名称','school','education-1');await fill('学历','degree','education-1');await fill('专业名称','major','education-1');await noMenus();
 const first=await session!.verify();assert.equal(first.verified,3);assert.ok(first.checks.every(check=>check.retained));checks+=2;await noUnsafe();

 // Missing ordinary language facts are questions, never inferred from a degree.
 const languageContent=`<section><h2>语言能力</h2>${portal('language','语言类型',['中文','英语'])}${sd('fluency','掌握程度',['一般','熟练','精通'])}${aria('speaking','听说',['基础','流利'])}${portal('writing','读写',['基础','良好'])}</section>`;
 await load(languageContent);const unknown=await session!.inspect();assert.equal(unknown.fields.filter(field=>field.candidates.length).length,0);
 const unknownResult=await session!.verify(true),labels=['语言类型','掌握程度','听说','读写'];
 const questions=labels.map(label=>{const question=unknownResult.remaining.find(field=>field.label===label)?.question;assert.ok(question,'Missing question: '+label);return question;});
 assert.equal((await readEvents()).selected.length,0);assert.ok(unknownResult.remaining.filter(field=>labels.includes(field.label)).every(field=>field.reasonCode==='missing-data'));checks+=3;
 let file=await openDatabaseFile({directory:join(directory,'answers')});await file.transact(db=>writeDocument(db,'profile','current',profile,new Date().toISOString()));let assets=createApplicationAssetsStore(file);
 const answers=['英语','熟练','流利','良好'];
 for(let index=0;index<questions.length;index++){
  let state=await assets.saveAnswer({questionPattern:questions[index]!.key,answer:answers[index]!,contextLabel:questions[index]!.context,scope:{kind:'general'},risk:'ordinary',demo:false},null);
  const saved=state.answers.find(answer=>answer.questionPattern===questions[index]!.key)!;assert.equal(saved.confirmedRevision,null);
  // Saving a draft is insufficient. The control must remain non-actionable.
  session!.close();session=new UniversalFormSession(page,profile,async()=>profile,()=>1,new AbortController().signal,true,{answers:state.answers});
  assert.ok(!(await session!.inspect()).fields.some(field=>field.label===labels[index]&&field.candidates.length));
  state=await assets.confirmAnswer(saved.id,saved.revision,profile.version);const confirmed=state.answers.find(answer=>answer.id===saved.id)!;assert.equal(confirmed.confirmedRevision,confirmed.revision);assert.equal(confirmed.confirmedProfileVersion,profile.version);checks+=4;
 }
 await file.close();file=await openDatabaseFile({directory:join(directory,'answers')});assets=createApplicationAssetsStore(file);const persisted=await assets.getState();assert.equal(persisted.answers.length,4);checks++;
 session!.close();session=new UniversalFormSession(page,profile,async()=>profile,()=>1,new AbortController().signal,true,{answers:persisted.answers});
 for(const label of labels){const x=await session.inspect(),field=x.fields.find(field=>field.label===label);assert.ok(field);assert.equal(field.candidates.length,1);const result=await session.fillGroup(x.observation,[{target:field.ref,fact:field.candidates[0]!}]);assert.equal(result.verified,1,JSON.stringify(result));checks+=2;}
 await noMenus();assert.equal((await session.verify()).verified,4);checks++;await noUnsafe();
 // Close/reopen the page and session, keeping only the actual persisted answer
 // store. The same question reuses the answer without another confirmation.
 await load(languageContent,persisted.answers);for(const label of labels){const x=await session!.inspect(),field=x.fields.find(field=>field.label===label);assert.ok(field);assert.equal(field.candidates.length,1);checks++;}await file.close();

 // A failed match may leave the field incomplete; it must not strand an open
 // menu or forbid unrelated confirmed writes. No substitute option is allowed.
 await load(`<fieldset><legend>教育经历</legend>${sd('unmatched-school','学校名称',['只有另一个虚构学校'])}${aria('next-degree','学历',['本科','硕士'])}</fieldset><label>邮箱<input id="next-email" type="email"></label>`);
 let x=await session!.inspect(),school=x.fields.find(field=>field.label==='学校名称')!;
 let failed=false;try{const result=await session!.fillGroup(x.observation,[{target:school.ref,fact:fact('school','education-1').ref}]);failed=result.failures.length>0;}catch{failed=true;}
 assert.equal(failed,true);assert.equal((await readEvents()).selected.length,0);assert.equal(await page.locator('#unmatched-school').inputValue(),'','Rejected query is not a committed school');checks+=3;await noMenus();
 await fill('邮箱','email','contact');assert.equal((await session!.inspect()).fields.some(field=>field.label==='学历'&&field.candidates.length>0),false,'Two unbound educations cannot lend a degree to an anonymous row after school selection failed');await noMenus();assert.equal(await page.locator('#next-email').inputValue(),profile.email);checks++;await noUnsafe();

 // A framework may replace the actual input/button after a selection. Stable
 // field identity plus a committed value should retain proof across that redraw.
 await load(`<fieldset><legend>教育经历</legend><label>学校名称<input id="rerender-school"></label>${portal('redrawn-degree','学历',['本科','硕士'],true)}<label>专业名称<input id="rerender-major"></label></fieldset>`);
 await fill('学校名称','school','education-1');await fill('学历','degree','education-1');assert.equal(await page.locator('#redrawn-degree').getAttribute('data-recreated'),'yes');checks++;
 await fill('专业名称','major','education-1');assert.equal((await session!.verify()).verified,3);checks++;await noMenus();await noUnsafe();

 // The record identity anchor itself may be recreated. A unique explicit
 // stable ID plus the same surrounding record must preserve that binding.
 await load(`<fieldset><legend>教育经历</legend>${sd('redrawn-school','学校名称',['虚构甲大学','虚构乙大学'],'Choose',true)}${aria('retained-degree','学历',['本科','硕士'])}<label>专业名称<input id="anchor-major"></label></fieldset>`);
 await fill('学校名称','school','education-1');assert.equal(await page.locator('#redrawn-school').getAttribute('data-recreated'),'yes');checks++;
 await fill('学历','degree','education-1');await fill('专业名称','major','education-1');assert.equal((await session!.verify()).verified,3);checks++;await noMenus();await noUnsafe();

 // Year selection may clear placeholders and auto-select a default month. The
 // host must then continue with the confirmed month, rather than treating that
 // normal widget transition as an unrelated page failure.
 await load(`<fieldset><legend>教育经历</legend><label>学校名称<input id="dated-school"></label><div><div>就读时间 / Education period</div><div class="month-range-select"><span>${sd('start-year','','2024 2025 2026'.split(' '),'年 / Year')}${sd('start-month','','1 6 9'.split(' '),'月 / Month')}</span><span>-</span><span>${sd('end-year','','2025 2026 2027'.split(' '),'年 / Year')}${sd('end-month','','1 6 9'.split(' '),'月 / Month')}</span></div></div></fieldset>`);
 await page.locator('#start-year,#end-year').evaluateAll(inputs=>{for(const input of inputs)input.addEventListener('change',()=>{const month=document.getElementById(input.id==='start-year'?'start-month':'end-month') as HTMLInputElement;const marker=month.closest('.widget')!.querySelector('[class*="Input-display-value-"]') as HTMLElement;marker.textContent='1';marker.hidden=false;month.placeholder='';});});
 await fill('学校名称','school','education-1');
 for(const [part,kind] of [['开始时间','startDate'],['结束时间','endDate']] as const)for(const unit of ['年','月']){
  x=await session!.inspect();const value=fact(kind,'education-1'),field=x.fields.find(field=>field.label.endsWith(part+' · '+unit)&&field.candidates.includes(value.ref));assert.ok(field,JSON.stringify(x));
  const result=await session!.fillGroup(x.observation,[{target:field.ref,fact:value.ref}]);
  const diagnostic=result.verified===1?undefined:await page.evaluate(new Function(OWNED_SELECT_HELPERS+`return Array.from(document.querySelectorAll('.month-range-select input')).map(e=>({id:e.id,placeholder:e.getAttribute('placeholder'),scope:selectScope(e)?.outerHTML,arrow:selectArrow(selectScope(e)),label:selectLabel(e)?.outerHTML}));`) as ()=>unknown);
  assert.equal(result.verified,1,JSON.stringify({result,diagnostic,fields:(await page.evaluate(READ_UNIVERSAL_FORM) as any).fields.map(({label,group,identity,datePart,value}:any)=>({label,group,identity,datePart,value}))}));checks++;
 }
 assert.equal((await session!.verify()).verified,5);checks++;await noMenus();await noUnsafe();

 // An incorrect model action on a checkbox must reject before any write and
 // must not poison a later correct action or an unrelated text field.
 await load(`<fieldset><legend>实习经历</legend><label>公司名称<input id="company"></label><label>至今<input type="checkbox" id="current"></label><label>职位名称<input id="role"></label></fieldset>`);
 await fill('公司名称','organization','internship-1');x=await session!.inspect();const present=x.fields.find(field=>field.label==='至今');assert.ok(present);const currentFact=fact('endDate','internship-1');
 await assert.rejects(session!.act({observation:x.observation,action:'open',target:present.ref,fact:currentFact.ref}));assert.equal(await page.locator('#current').isChecked(),false);assert.equal((await readEvents()).checkbox,0);checks+=3;
 await fill('至今','endDate','internship-1');await fill('职位名称','role','internship-1');assert.equal((await readEvents()).checkbox,1);assert.equal((await session!.verify()).verified,3);checks+=2;await noUnsafe();

 // Adding another education record must preserve the first record and the
 // filled internship. A repeated label is not permission to copy record one.
 const education=(n:number)=>`<fieldset class="education-item"><legend>教育经历</legend>${sd('school-'+n,'学校名称',['虚构甲大学','虚构乙大学'])}${portal('degree-'+n,'学历',['本科','硕士'])}</fieldset>`;
 await load(`<section><h2>教育经历</h2>${education(1)}<button type="button" id="add-education">添加教育经历</button></section><fieldset><legend>实习经历</legend><label>公司名称<input id="retained-company"></label><label>职位名称<input id="retained-role"></label></fieldset>`);
 await page.locator('#add-education').evaluate((button,content)=>{button.addEventListener('click',()=>{button.insertAdjacentHTML('beforebegin',content);(globalThis as any).wire();});},education(2));
 await fill('学校名称','school','education-1');await fill('学历','degree','education-1');await fill('公司名称','organization','internship-1');await fill('职位名称','role','internship-1');
 x=await session!.inspect();const add=x.actions.find(action=>action.label==='添加教育经历');assert.ok(add);await session!.act({observation:x.observation,action:'add',target:add.ref});assert.equal((await session!.verify()).verified,4);checks++;
 await fill('学校名称','school','education-2');await fill('学历','degree','education-2');
 assert.equal(await page.locator('#school-1').evaluate(e=>e.closest('.widget')!.querySelector('[class*="Input-display-value-"]')!.textContent),'虚构甲大学');assert.equal(await page.locator('#school-2').evaluate(e=>e.closest('.widget')!.querySelector('[class*="Input-display-value-"]')!.textContent),'虚构乙大学');
 assert.equal(await page.locator('#degree-1').getAttribute('aria-valuetext'),'硕士');assert.equal(await page.locator('#degree-2').getAttribute('aria-valuetext'),'本科');assert.equal((await session!.verify()).verified,6);checks+=5;await noMenus();await noUnsafe();
 const snapshot:any=await page.evaluate(READ_UNIVERSAL_FORM);assert.equal(new Set(snapshot.fields.filter((field:any)=>field.label==='学校名称').map((field:any)=>field.group)).size,2);checks++;

 // Novel professional captions can be interpreted semantically by the model,
 // but mapping is not a way to invent data or bypass typed/sensitive controls.
 await load(`<fieldset><legend>教育经历</legend><label>学校名称<input id="map-school" value="虚构甲大学"></label><label>Study concentration<input id="concentration"></label><label>Routing address<input id="map-email" type="email" value="keep@example.invalid"></label><label>Direct dial<input id="map-phone" type="tel" value="KEEP"></label><label>Program day<input id="map-date" type="date" value="2026-01-01"></label><label>Program cycle<input id="map-month" type="month" value="2026-01"></label><label>Extra artifact<input id="map-file" type="file"></label><label>身份证号码<input id="map-sensitive" value="INVALID-KEEP"></label><label>开始时间<input id="known-start" type="month"></label></fieldset>`);
 x=await session!.inspect();let novel=x.page.fields.find(field=>field.label==='Study concentration');assert.ok(novel);assert.equal(novel.candidates.length,0);checks++;
 await assert.rejects(session!.mapField({observation:x.observation,target:novel.ref,fact:fact('fullName','contact').ref}));checks++;
 x=await session!.inspect();novel=x.page.fields.find(field=>field.label==='Study concentration')!;
 await assert.rejects(session!.mapField({observation:x.observation,target:novel.ref,fact:fact('major','education-2').ref}),/RECORD_BINDING_CONFLICT/);checks++;
 x=await session!.inspect();novel=x.page.fields.find(field=>field.label==='Study concentration')!;const mapped=await session!.mapField({observation:x.observation,target:novel.ref,fact:fact('major','education-1').ref});assert.equal(mapped.mapped,true);assert.equal(await page.locator('#concentration').inputValue(),'');checks+=2;
 await fill('Study concentration','major','education-1');assert.equal(await page.locator('#concentration').inputValue(),'人工智能');checks++;
 for(const label of ['Routing address','Direct dial','Program day','Program cycle','Extra artifact','开始时间']){x=await session!.inspect();const field=x.page.fields.find(field=>field.label===label);assert.ok(field);await assert.rejects(session!.mapField({observation:x.observation,target:field.ref,fact:fact('major','education-1').ref}),label+' must not accept professional semantic mapping');checks++;}
 for(const id of ['map-sensitive','upload','consent']){x=await session!.inspect();const raw:any=await page.evaluate(READ_UNIVERSAL_FORM);const index=await page.locator('#'+id).evaluate((e,selector)=>Array.from(document.querySelectorAll(selector)).filter(node=>!node.parentElement?.closest('[role="combobox"]')).indexOf(e),'input,textarea,select,[role="combobox"]');assert.ok(raw.fields.some((field:any)=>field.index===index));await assert.rejects(session!.mapField({observation:x.observation,target:'field-'+index,fact:fact('major','education-1').ref}));checks++;}
 assert.equal(await page.locator('#map-email').inputValue(),'keep@example.invalid');assert.equal(await page.locator('#map-phone').inputValue(),'KEEP');assert.equal(await page.locator('#map-date').inputValue(),'2026-01-01');assert.equal(await page.locator('#map-month').inputValue(),'2026-01');assert.equal(await page.locator('#map-file').inputValue(),'');assert.equal(await page.locator('#map-sensitive').inputValue(),'INVALID-KEEP');assert.equal(await page.locator('#known-start').inputValue(),'');checks+=7;await noUnsafe();
 session!.close();
 // Custom option creation is a different, explicit two-step widget flow. A
 // generic Add button is insufficient permission to invent a selected option.
 const createFixture=async(entryLabel:string)=>{
  await page.setContent(pageHTML(`<fieldset><legend>教育经历</legend>${sd('custom-school','学校名称',[])}</fieldset>`));
  await page.locator('#custom-school').evaluate((node,entryLabel)=>{
   const input=node as HTMLInputElement,root=input.closest('.widget')!,menu=root.querySelector('.choice-menu') as HTMLElement;
   const close=()=>{menu.hidden=true;};
   const open=()=>{
    menu.replaceChildren();const entry=document.createElement('button');entry.type='button';entry.textContent=entryLabel;
    entry.onclick=()=>{(globalThis as any).events.entryClicks=((globalThis as any).events.entryClicks??0)+1;menu.replaceChildren();
     const text=document.createElement('input');text.type='text';text.setAttribute('aria-label','完整名称');
     const add=document.createElement('button');add.type='button';add.textContent='Add';add.disabled=true;text.oninput=()=>{add.disabled=!text.value.trim();};
     add.onclick=()=>{const value=text.value;const marker=root.querySelector('[class*="Input-display-value-"]') as HTMLElement;marker.textContent=value;marker.hidden=false;input.value='';(globalThis as any).events.selected.push({id:input.id,value});close();};menu.append(text,add);
    };menu.append(entry);menu.hidden=false;
   };
   input.onclick=open;input.oninput=open;input.onblur=event=>{if(!event.relatedTarget||!root.contains(event.relatedTarget as Node)){close();if((root.querySelector('[class*="Input-display-value-"]') as HTMLElement).hidden)input.value='';}};
   root.addEventListener('keydown',event=>{if((event as KeyboardEvent).key==='Escape')close();});
  },entryLabel);
 };
 const schoolFact={kind:'school',value:profile.career!.educations[0]!.school};
 await createFixture('Add full name');let controller=await createOwnedSelectController(page.locator('#custom-school'),async()=>{});
 let opened=await controller.open(schoolFact.value);assert.equal(opened.options.length,0);assert.equal(opened.canCreate?.label,'Add full name');checks+=2;
 const created=await controller.create(schoolFact);assert.equal(created.committed,true);assert.equal(created.value,schoolFact.value);assert.equal((await readEvents()).selected.length,1);checks+=3;await controller.dispose();await noMenus();await noUnsafe();
 await createFixture('添加专业全称');await page.locator('#custom-school').evaluate(node=>(node as HTMLInputElement).required=true);controller=await createOwnedSelectController(page.locator('#custom-school'),async()=>{});const majorFact={kind:'major',value:'统计学与数据科学'};opened=await controller.open(majorFact.value);assert.equal(opened.canCreate?.label,'添加专业全称');await controller.create(majorFact);await controller.dispose();const fullNameRead:any=await page.evaluate(READ_UNIVERSAL_FORM);const fullNameField=fullNameRead.fields.find((field:any)=>field.value===majorFact.value);assert.ok(fullNameField);assert.equal(fullNameField.invalid,false);assert.equal(await page.locator('#custom-school').inputValue(),'');checks+=4;await noMenus();await noUnsafe();
 await createFixture('Add');controller=await createOwnedSelectController(page.locator('#custom-school'),async()=>{});opened=await controller.open(schoolFact.value);assert.equal(opened.canCreate,undefined);await assert.rejects(controller.create(schoolFact),/EXPLICIT_CREATE_OPTION_REQUIRED/);assert.equal((await page.evaluate('window.events.entryClicks'))??0,0);assert.equal((await readEvents()).selected.length,0);checks+=4;await controller.dispose();await noMenus();
 await createFixture('Add full name');controller=await createOwnedSelectController(page.locator('#custom-school'),async()=>{});await controller.open('未经确认的另一个名称');await assert.rejects(controller.create(schoolFact),/CREATE_QUERY_FACT_MISMATCH/);assert.equal((await page.evaluate('window.events.entryClicks'))??0,0);checks+=2;await controller.dispose();await noMenus();await noUnsafe();

 // A user-authorized closest major stays a review draft and preserves the
 // canonical full name in the source education record.
 const fallbackProfile=structuredClone(profile);fallbackProfile.career!.educations=fallbackProfile.career!.educations.slice(1);fallbackProfile.career!.educations[0]!.major='统计学与数据科学';fallbackProfile.career!.primaryEducationId=fallbackProfile.career!.educations[0]!.id;
 await load(`<fieldset><legend>教育经历</legend><label>学校名称<input value="虚构乙大学"></label><label>专业名称<select id="fallback-major"><option value="">请选择</option><option value="stats">统计学</option></select></label></fieldset>`);session!.close();session=new UniversalFormSession(page,fallbackProfile,async()=>fallbackProfile,()=>1,new AbortController().signal,true,{answers:[]},undefined,undefined,undefined,{version:1,confirmedAt:'2026-10-22',profileVersion:1,encryptionAvailable:true,value:{resumeVersionId:null,autoUploadResume:false,educations:[{recordId:fallbackProfile.career!.educations[0]!.id,sourceRevision:1,major:'统计学与数据科学',category:'',fallbackMajor:'统计学',awardDate:''}],hometown:'',politicalStatus:'',interviewPreference:'',acceptTransfer:'ask',recruitmentSource:'',recruitmentSourceFallback:'',awards:'unknown',companyAnswers:[]}});
 x=await session.inspect();const majorTarget=x.fields.find(field=>field.label==='专业名称')!,majorSource=session.facts.find(fact=>fact.kind==='major')!;const closest=await session.act({observation:x.observation,action:'fill',target:majorTarget.ref,fact:majorSource.ref});assert.equal(closest.verified,false);assert.equal((closest as any).draftWritten,true);assert.equal(await page.locator('#fallback-major').inputValue(),'stats');assert.equal(majorSource.value,'统计学与数据科学');assert.equal((await session.verify()).pendingReview,1);checks+=5;

 // A retained editable ARIA query is not a committed value. Native-value proof
 // requires a change from the actual option click, not mousedown/blur noise.
 const bareAria=async(mode:'query-only'|'pre-click-change'|'option-change')=>{
  await page.setContent(pageHTML(`<div class="widget"><div>学校名称</div><input id="bare-school" role="combobox" aria-label="学校名称" aria-controls="bare-options" aria-expanded="false" autocomplete="off"><div id="bare-options" role="listbox" hidden></div></div>`));
  await page.locator('#bare-school').evaluate((node,{mode,value})=>{
   const input=node as HTMLInputElement,menu=document.getElementById('bare-options')!;
   const close=()=>{menu.hidden=true;input.setAttribute('aria-expanded','false');};
   const render=()=>{menu.replaceChildren();const option=document.createElement('div');option.setAttribute('role','option');option.textContent=value;
    option.onmousedown=event=>{event.preventDefault();if(mode==='pre-click-change')input.blur();};
    option.onclick=()=>{(globalThis as any).events.selected.push({id:input.id,value});if(mode==='option-change'){input.value=value;input.dispatchEvent(new Event('change',{bubbles:true}));}close();};
    menu.append(option);menu.hidden=false;input.setAttribute('aria-expanded','true');
   };input.onclick=render;input.oninput=render;input.onkeydown=event=>{if(event.key==='Escape')close();};
   input.onblur=()=>{if(mode==='pre-click-change')input.dispatchEvent(new Event('change',{bubbles:true}));};
   input.addEventListener('change',()=>{(globalThis as any).events.changes=((globalThis as any).events.changes??0)+1;});
  },{mode,value:schoolFact.value});
 };
 for(const mode of ['query-only','pre-click-change'] as const){await bareAria(mode);controller=await createOwnedSelectController(page.locator('#bare-school'),async()=>{});opened=await controller.open(schoolFact.value);const option=opened.options.find(option=>option.label===schoolFact.value);assert.ok(option);await assert.rejects(controller.choose(option.ref,schoolFact),/OWNED_SELECTION_NOT_COMMITTED/);assert.equal(await page.locator('#bare-school').inputValue(),'','Failed selection restores the originally blank input; a search query is not a committed school');assert.equal((await readEvents()).selected.length,1);if(mode==='pre-click-change')assert.ok(Number(await page.evaluate('window.events.changes'))>0);checks+=4;await controller.dispose();await noMenus();await noUnsafe();}
 await bareAria('option-change');controller=await createOwnedSelectController(page.locator('#bare-school'),async()=>{});opened=await controller.open(schoolFact.value);const nativeChoice=opened.options.find(option=>option.label===schoolFact.value);assert.ok(nativeChoice);const nativeCommit=await controller.choose(nativeChoice.ref,schoolFact);assert.equal(nativeCommit.committed,true);assert.equal(nativeCommit.source,'selected-native-value');assert.equal(nativeCommit.value,schoolFact.value);checks+=4;await controller.dispose();await noMenus();await noUnsafe();

 // Some selectors use a button, then place their searchable input in a bound
 // portal. Search remains within that exact popup; ordinary custom-name inputs
 // and unrelated page search boxes must never be borrowed.
 const searchPortal=async(mode:'unique'|'multiple'|'outside-only'|'plain-create')=>{
  const queries=mode==='unique'?'<input id="popup-search" role="searchbox" aria-label="Search options">':mode==='multiple'?'<input id="popup-search" role="searchbox"><input id="popup-search-two" type="search">':mode==='plain-create'?'<input id="popup-create-name" type="text" aria-label="Full name">':'';
  await page.setContent(pageHTML(`<div class="widget"><div>学校名称</div><button type="button" id="search-trigger" role="combobox" aria-label="学校名称" aria-controls="search-portal" aria-expanded="false" aria-valuetext="">Choose</button></div><div id="search-portal" role="listbox" hidden>${queries}<div id="searched-options"></div></div><label>Unrelated page search<input id="outside-search" role="searchbox" value="KEEP OUTSIDE"></label>`));
  await page.locator('#search-trigger').evaluate((node,{mode,value})=>{
   const trigger=node as HTMLButtonElement,menu=document.getElementById('search-portal')!,rows=document.getElementById('searched-options')!;
   const query=menu.querySelector('input') as HTMLInputElement|null;
   const close=()=>{menu.hidden=true;trigger.setAttribute('aria-expanded','false');};
   const render=()=>{rows.replaceChildren();if(mode==='unique'&&query?.value!==value)return;const option=document.createElement('div');option.setAttribute('role','option');option.textContent=value;option.onmousedown=event=>event.preventDefault();option.onclick=()=>{trigger.setAttribute('aria-valuetext',value);trigger.textContent=value;(globalThis as any).events.selected.push({id:trigger.id,value});close();};rows.append(option);};
   trigger.onclick=()=>{menu.hidden=false;trigger.setAttribute('aria-expanded','true');render();if(query)query.focus();};
   for(const input of menu.querySelectorAll('input'))input.addEventListener('input',()=>{(globalThis as any).events.searchInputs=((globalThis as any).events.searchInputs??0)+1;render();});
   trigger.onkeydown=event=>{if(event.key==='Escape')close();};menu.addEventListener('keydown',event=>{if((event as KeyboardEvent).key==='Escape')close();});
  },{mode,value:schoolFact.value});
 };
 await searchPortal('unique');controller=await createOwnedSelectController(page.locator('#search-trigger'),async()=>{});opened=await controller.open(schoolFact.value);assert.equal(await page.locator('#popup-search').inputValue(),schoolFact.value);const searched=opened.options.find(option=>option.label===schoolFact.value);assert.ok(searched);const searchCommit=await controller.choose(searched.ref,schoolFact);assert.equal(searchCommit.committed,true);assert.equal(searchCommit.value,schoolFact.value);assert.equal(await page.locator('#outside-search').inputValue(),'KEEP OUTSIDE');checks+=5;await controller.dispose();await noMenus();await noUnsafe();
 for(const mode of ['multiple','outside-only','plain-create'] as const){await searchPortal(mode);controller=await createOwnedSelectController(page.locator('#search-trigger'),async()=>{});await controller.open();await assert.rejects(controller.query(schoolFact.value),/SEARCH|AMBIGUOUS/);assert.equal(await page.locator('#outside-search').inputValue(),'KEEP OUTSIDE');assert.equal((await page.evaluate('window.events.searchInputs'))??0,0);assert.equal((await readEvents()).selected.length,0);for(const input of await page.locator('#search-portal input').all())assert.equal(await input.inputValue(),'');checks+=5;await controller.dispose();await noMenus();await noUnsafe();}
 await attached.close();
 const result={genericControls:true,ok:true,checks,realEmployer:false,paidRequests:0,controlFamilies:['sd','aria-local','aria-controls-portal'],confirmedMemoryReuse:true,failedSelectionDoesNotBlock:true,dynamicRerenderRetained:true,anchorRerenderRetained:true,checkboxRecovery:true,twoEducationsRemainDistinct:true,semanticMappingGuarded:true,explicitCustomOptionCreation:true,bareAriaQueryNotCommitted:true,portalSearchScoped:true,unsafeActions:0};
 await writeFile(join(directory,'report.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result));view.webContents.close();window.destroy();app.exit(0);
}catch(error){console.error(error);window.destroy();app.exit(1);}
