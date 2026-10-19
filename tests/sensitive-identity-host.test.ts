import test from 'node:test';
import assert from 'node:assert/strict';
import {SensitiveIdentityHost} from '../apps/desktop/sensitive-identity-host.js';
import type {SensitiveIdentityVault} from '../packages/domain/src/sensitive-identity.js';
import type {BrowserController} from '../packages/browser/src/controller.js';
import type {FillPlan,FormObservation,Profile} from '../packages/shared/src/contracts.js';
import {buildFillPlan} from '../packages/forms/src/index.js';
function fixture(){
 let url='https://jobs.example.invalid/application?secret=not-for-preview',version=1,now=0,writes=0;
 let fields:FormObservation['fields']=[{id:'id-box',index:0,label:'身份证号码',section:'基本信息',type:'text',value:'',editable:true,required:true,options:[],signature:'sig',bounds:{x:10,y:10,width:200,height:30}}];
 const identity={number:'DEMO-DOCUMENT-0001',kind:'national-id' as const,confirmedAt:new Date().toISOString()};
 const plans=new Map<string,FillPlan>();
 const profile={version:1,fullName:'演示人物',fullNameEn:'Demo Person',email:'demo@example.invalid',phone:'',school:'',degree:'',major:'',schoolEn:'',majorEn:'',graduationMonth:'',resumeText:'',skills:[],cities:[],targetRoles:[],updatedAt:''} satisfies Profile;
 const browser={getState:()=>({url}),discardPlan:(id:string)=>{plans.delete(id);},getPlan:(id:string)=>{const p=plans.get(id);if(!p)throw new Error();return p;},
  async preparePlan(resolver:any,options:any){assert.equal(options.rememberLocation,false);const obs:FormObservation={id:'obs',url,title:'Demo application',signature:'form-signature',fields,observedAt:''} as FormObservation;const plan=await resolver(obs,profile);plans.set(plan.id,plan);return plan;},
  async fillApproved(id:string,ids:string[]){assert.ok(plans.has(id));assert.deepEqual(ids,['id-box']);writes++;return {planId:id,verified:[{fieldId:'id-box'}],unresolved:[]};}
 } as unknown as Pick<BrowserController,'preparePlan'|'getPlan'|'getState'|'fillApproved'|'discardPlan'>;
 const vault={confirmed:async()=>({...identity,version})} as SensitiveIdentityVault;
 const host=new SensitiveIdentityHost(browser,vault,()=>now);
 return {host,plans,profile,get fields(){return fields;},set fields(v){fields=v;},get url(){return url;},set url(v){url=v;},set version(v:number){version=v;},set now(v:number){now=v;},get writes(){return writes;}};
}
test('preview redacts number/query, conceals executable plan ID and requires one-use exact nonce',async t=>{
 const f=fixture();t.after(()=>f.host.invalidate());const preview=await f.host.prepare();const planId=[...f.plans.keys()][0]!;
 assert.notEqual(preview.id,planId);assert.ok(!JSON.stringify(preview).includes('DEMO-DOCUMENT'));assert.ok(!preview.destination.includes('?'));assert.equal(preview.maskedNumber,'•••• •••• 0001');
 await assert.rejects(f.host.fill(planId));assert.equal(f.writes,0);const result=await f.host.fill(preview.id);assert.equal(result.status,'verified');assert.equal(f.writes,1);assert.equal(f.plans.size,0);await assert.rejects(f.host.fill(preview.id));assert.equal(f.writes,1);
});
test('navigation, identity revision, expiration, cancellation and replaced preview revoke authority',async t=>{
 for(const mode of ['navigation','version','expiration','cancel','replace']){const f=fixture();t.after(()=>f.host.invalidate());const preview=await f.host.prepare();
  if(mode==='navigation')f.url='https://another.example.invalid/application';if(mode==='version')f.version=2;if(mode==='expiration')f.now=120_000;if(mode==='cancel')f.host.cancel(preview.id);if(mode==='replace')await f.host.prepare();
  await assert.rejects(f.host.fill(preview.id));assert.equal(f.writes,0);
 }
});
test('ambiguous, existing, other-person and insecure document fields remain manual; normal plan skips identity',async t=>{
 for(const mode of ['duplicate','existing','other-person','http','generic']){const f=fixture();t.after(()=>f.host.invalidate());
  if(mode==='duplicate')f.fields=[...f.fields,{...f.fields[0]!,id:'second'}];if(mode==='existing')f.fields=[{...f.fields[0]!,value:'KEEP'}];if(mode==='other-person')f.fields=[{...f.fields[0]!,section:'紧急联系人'}];if(mode==='http')f.url='http://jobs.example.invalid/';if(mode==='generic')f.fields=[{...f.fields[0]!,label:'证件号码'}];
  await assert.rejects(f.host.prepare());assert.equal(f.writes,0);assert.equal(f.plans.size,0);
 }
 const f=fixture();const plan=buildFillPlan({id:'o',url:f.url,title:'Demo',signature:'s',fields:f.fields} as FormObservation,f.profile);assert.equal(plan.items[0]?.status,'skip');assert.equal(plan.items[0]?.value,'');
});
