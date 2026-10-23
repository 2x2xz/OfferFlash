import {app,BrowserWindow,WebContentsView} from 'electron';
import {writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import assert from 'node:assert/strict';
import {attachPlaywrightView} from '../../packages/browser/src/playwright-view.js';
import {runUniversalFormAgent} from '../../packages/agent/src/universal-form-agent.js';
import {UniversalFormSession} from '../../packages/browser/src/universal-form.js';
import {READ_UNIVERSAL_FORM} from '../../packages/browser/src/universal-read.js';
import {overrideProfile as profile} from './override-profile.js';
const directory=process.env.OFFERFLASH_DUTY_REPAIR_DIR!;if(!directory)throw Error('ISOLATED_DIRECTORY_REQUIRED');
app.setPath('userData',join(directory,'user-data'));await app.whenReady();
const window=new BrowserWindow({show:false}),view=new WebContentsView({webPreferences:{partition:'duty-repair-isolated',sandbox:true,contextIsolation:true,nodeIntegration:false,backgroundThrottling:false}});
window.contentView.addChildView(view);view.setBounds({x:0,y:0,width:1000,height:900});
const escape=(s:string)=>s.replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('"','&quot;');
const project=(index:number,mode='normal')=>{
 const p=profile.career!.projects[index]!;
 return '<div class="form-record"><label>项目名称<input value="'+escape(p.name)+'"></label><label>职责'+(mode==='textarea'?'<textarea id="role'+index+'"></textarea>':'<input id="role'+index+'" value="'+(mode==='normal'?escape(p.description):'')+'">')+'</label>'+
  (mode==='no-description'?'':'<label>项目描述<textarea id="description'+index+'">'+escape(p.description)+'</textarea></label>')+
  (mode==='duplicate'?'<label>职责<input></label>':'')+(mode==='other-role'?'<label>项目角色<input></label>':'')+'</div>';
};
const html=(mode='normal')=>'<meta charset="utf-8"><form onsubmit="window.submits++;return false"><fieldset><legend>项目经历</legend>'+project(0)+project(1,mode)+'</fieldset><fieldset><legend>实习经历</legend><div class="form-record"><label>单位名称<input value="虚构研究中心"></label><label>职位名称<input value="算法实习生"></label><label>工作职责<textarea id="internship"></textarea></label></div></fieldset><label><input id="consent" type="checkbox">同意真实性声明</label><button type="submit">提交申请</button></form><script>window.submits=0</script>';
const report:any={kind:'original-flow-project-role-repair-contract',paidRequests:0,externalWebsiteRequests:0,cases:{}};
let bridge:Awaited<ReturnType<typeof attachPlaywrightView>>|undefined;
try{
 await view.webContents.loadURL('data:text/html;charset=utf-8,'+encodeURIComponent(html()));bridge=await attachPlaywrightView(view.webContents);const page=bridge.page;
 const read=async()=>page.evaluate(READ_UNIVERSAL_FORM) as Promise<{fields:Array<any>}>;
 for(const mode of ['normal','no-description','textarea','duplicate','other-role']){
  await page.goto('data:text/html;charset=utf-8,'+encodeURIComponent(html(mode)));
  const raw=await read(),duties=raw.fields.filter(field=>field.label==='职责');
  assert.equal(duties[0].responsibilityKind,'role');
  assert.ok(duties.slice(1).every(field=>field.responsibilityKind===(mode==='normal'?'role':'ambiguous')));
  const session=new UniversalFormSession(page,profile,async()=>profile,()=>1,new AbortController().signal,true);
  try{
   const observed=await session.inspect(),target=observed.page.fields.find(field=>field.ref==='field-'+duties[1].index)!;
   if(mode!=='normal'){assert.equal(target.candidates.length,0);assert.equal(target.canMap,false);assert.equal(target.canDraft,false);}
   if(mode==='normal'){
    const role=session.facts.find(f=>f.record==='project-2'&&f.kind==='role')!,description=session.facts.find(f=>f.record==='project-2'&&f.kind==='description')!;
    assert.deepEqual(target.candidates,[role.ref]);
    assert.throws(()=>(session as any).resolve(description.ref,(session as any).view.fields.find((f:any)=>f.index===duties[1].index)),/FACT_FIELD_MISMATCH/);
    assert.equal((session as any).draftTargetAllowed((session as any).view.fields.find((f:any)=>f.index===duties[1].index)),false);
   }
  }finally{session.close();}
  if(mode==='normal'){
   const result=await runUniversalFormAgent({page,profile,getProfile:async()=>profile,getGeneration:()=>1,signal:new AbortController().signal,contextId:'duty-repair-normal',directory:join(directory,'original-flow'),taskId:'original-flow'});
   for(let i=0;i<2;i++){assert.equal(await page.locator('#role'+i).inputValue(),profile.career!.projects[i]!.role);assert.equal(await page.locator('#description'+i).inputValue(),profile.career!.projects[i]!.description);}
   assert.equal(await page.locator('#internship').inputValue(),profile.career!.internships[0]!.description);
   assert.equal(result.modelRequests,0);report.cases.originalFlow={verified:result.verified,rolesCorrect:true,descriptionsPreserved:true,internshipContentCorrect:true,modelRequests:0};
  }
  assert.equal(await page.locator('#consent').isChecked(),false);assert.equal(await page.evaluate('window.submits'),0);
  report.cases[mode]={shortCaptionKinds:duties.map(field=>field.responsibilityKind),submitted:false};
 }
 report.ok=true;await writeFile(join(directory,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));
}catch(error){await writeFile(join(directory,'failure.json'),JSON.stringify({error:error instanceof Error?error.stack:String(error),report},null,2));throw error;}
finally{await bridge?.close();view.webContents.close();window.destroy();app.exit(report.ok?0:1);}
