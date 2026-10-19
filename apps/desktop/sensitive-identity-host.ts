import {randomUUID} from 'node:crypto';
import type {BrowserController} from '../../packages/browser/src/controller.js';
import {SensitiveIdentityVault} from '../../packages/domain/src/sensitive-identity.js';
import {buildFillPlan} from '../../packages/forms/src/index.js';
import {ownEmptyIdentityFields} from '../../packages/forms/src/sensitive-identity.js';
import type {SensitiveIdentityFillPreview,SensitiveIdentityFillResult} from '../../packages/shared/src/sensitive-identity.js';

type Browser=Pick<BrowserController,'preparePlan'|'getPlan'|'fillApproved'|'getState'|'discardPlan'>;
interface Pending {id:string;planId:string;url:string;identityVersion:number;expires:number;fieldId:string;}
/** The public preview nonce is different from the private executable plan ID. No document number leaves this host. */
export class SensitiveIdentityHost {
 private pending?:Pending;private timer?:ReturnType<typeof setTimeout>;
 constructor(private readonly browser:Browser,private readonly vault:SensitiveIdentityVault,private readonly now=Date.now){}
 private revoke(){if(this.timer)clearTimeout(this.timer);this.timer=undefined;if(this.pending)this.browser.discardPlan(this.pending.planId);this.pending=undefined;}
 cancel(id:string):void {if(typeof id!=='string'||this.pending?.id!==id)return;this.revoke();}
 invalidate():void {this.revoke();}
 async prepare():Promise<SensitiveIdentityFillPreview>{
  this.revoke();const identity=await this.vault.confirmed();const current=this.browser.getState();let url:URL;
  try{url=new URL(current.url);if(url.protocol!=='https:'||url.username||url.password)throw new Error();}catch{throw new Error('请在明确的 HTTPS 企业申请页单独核对证件填写。');}
  const plan=await this.browser.preparePlan(async(observation,profile)=>{
   if(observation.url!==current.url)throw new Error('申请页已变化，请重新核对目的地。');
   const fields=ownEmptyIdentityFields(observation.fields,identity.kind);
   if(fields.length!==1)throw new Error('没有唯一可明确对应的空白证件号码框，请在网页中手动处理；不会猜字段。');
   const field=fields[0]!;return {...buildFillPlan(observation,profile),items:[{fieldId:field.id,label:field.label,value:identity.number,currentValue:field.value,status:'ready',reason:'来自本机独立确认的证件资料；每次填写均须单独授权。'}]};
  },{rememberLocation:false});
  try{
   const latest=await this.vault.confirmed();if(latest.version!==identity.version||latest.number!==identity.number||this.browser.getState().url!==current.url)throw new Error('证件或页面已变化，请重新核对。');
   const id=randomUUID(),expires=this.now()+120_000;this.pending={id,planId:plan.id,url:plan.url,identityVersion:identity.version,expires,fieldId:plan.items[0]!.fieldId};
   this.timer=setTimeout(()=>this.revoke(),120_000);this.timer.unref?.();
   return {id,origin:url.origin,destination:url.origin+url.pathname,maskedNumber:`•••• •••• ${identity.number.slice(-4)}`,kind:identity.kind,
    fields:plan.items.map(item=>({fieldId:item.fieldId,label:item.label})),expiresAt:new Date(expires).toISOString()};
  }catch(error){this.browser.discardPlan(plan.id);throw error;}
 }
 async fill(id:string):Promise<SensitiveIdentityFillResult>{
  const pending=this.pending;
  if(!pending||typeof id!=='string'||pending.id!==id)throw new Error('证件填写确认已失效，请重新核对目的地。');
  this.pending=undefined;if(this.timer)clearTimeout(this.timer);this.timer=undefined;
  try{
   if(this.now()>=pending.expires||this.browser.getState().url!==pending.url)throw new Error();
   const identity=await this.vault.confirmed(),plan=this.browser.getPlan(pending.planId);
   if(identity.version!==pending.identityVersion||plan.url!==pending.url||plan.items.length!==1||plan.items[0]?.fieldId!==pending.fieldId||plan.items[0].value!==identity.number)throw new Error();
   const result=await this.browser.fillApproved(pending.planId,[pending.fieldId]);
   const verified=result.verified.length===1&&result.unresolved.length===0;
   return {status:verified?'verified':'needs-user',verifiedCount:result.verified.length,
    message:verified?'已填写并重读核实这一个证件号码，请自行核对网页；没有提交申请。':'证件号码未通过完整核对，请在网页检查已有内容；不自动重复填写。'};
  }catch{throw new Error('证件填写没有取得可靠结果，请核对当前网页后重新预览；已开始的网页输入不能撤销。');}
  finally{this.browser.discardPlan(pending.planId);}
 }
}
