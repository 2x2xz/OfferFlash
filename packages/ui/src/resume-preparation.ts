import type {ResumeUploadInspection,ResumeUploadReceipt,ResumeUploadRequest} from '../../shared/src/resume-upload.js';
import type {ApplicationSetupState} from '../../shared/src/application-setup.js';
/** One explicit click uses the saved file preference. Never selects an overwrite answer. */
export async function prepareApplicationResume(options:{setup:ApplicationSetupState;profileVersion:number;inspect():Promise<ResumeUploadInspection>;upload(input:ResumeUploadRequest):Promise<ResumeUploadReceipt>;current(page:ResumeUploadInspection):boolean;cancelled():boolean;progress(message:string):void;wait?():Promise<void>;now?():number}){
 const {setup}=options;if(!setup.value.autoUploadResume||!setup.value.resumeVersionId)return;
 const before=await options.inspect();const check=(page:ResumeUploadInspection)=>{if(options.cancelled()||!options.current(page)||page.url!==before.url||page.tabId!==before.tabId||page.documentRevision!==before.documentRevision)throw Error('页面或资料已变化，已停止准备简历。');};check(before);
 if(before.needsOverwriteChoice)throw Error('网站正在询问是否覆盖表单，请在网页选择，再点自动填写继续。');
 const targets=before.targets.filter(target=>target.recommended);
 const attached=targets.some(target=>target.hasAttachment);
 if(attached&&!before.parsing){options.progress('网页已有简历附件，正在核对表单。');return;}
 if(!targets.length&&!before.parsing)return;
 if(targets.length!==1&&!attached&&!before.parsing)throw Error('发现多个简历入口，请先在网页选择要上传的位置。');
 if(!attached&&!before.parsing){options.progress('正在把所选简历交给申请页…');await options.upload({resumeVersionId:setup.value.resumeVersionId,profileVersion:options.profileVersion,page:before,targetId:targets[0]!.id});check(before);}
 options.progress('正在等待网站解析简历…');const now=options.now??Date.now,start=now(),wait=options.wait??(()=>new Promise(resolve=>setTimeout(resolve,700)));let stableSince=start,last='';
 while(now()-start<18000){await wait();const page=await options.inspect();check(page);
  if(page.needsOverwriteChoice)throw Error('网站正在询问是否覆盖表单，请在网页选择，再点自动填写继续。');
  if(page.parsing||!page.formDigest||page.formDigest!==last){last=page.formDigest??'';stableSince=now();continue;}
  if(now()-start>=2800&&now()-stableSince>=2100){options.progress('网站解析已稳定，正在核对并修正表单。');return;}
 }
 throw Error('网站仍在解析简历，已保留当前页面。解析结束后再点自动填写，不会重复上传。');
}
