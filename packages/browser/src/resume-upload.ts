import type {Page} from 'playwright-core';
import {formStateDigest} from './form-attempt-memory.js';
import type {ResumeUploadInspection,ResumeUploadTarget} from '../../shared/src/resume-upload.js';
/** Fixed main-frame inspection. It neither clicks an upload button nor sends files. */
export const READ_RESUME_INPUTS=()=>Array.from(document.querySelectorAll<HTMLInputElement>('input[type="file"]')).map((input,index)=>{
 const own=Array.from(input.labels??[]).map(label=>label.innerText).join(' ')||input.getAttribute('aria-label')||input.getAttribute('title')||'';
 let near='',scope:HTMLElement|null=null;for(let parent=input.parentElement,depth=0;parent&&depth<5;parent=parent.parentElement,depth++){const text=(parent.innerText||'').replace(/\s+/g,' ').trim();if(text.length<=350&&/简历|resume|\bcv\b/i.test(text)){near=text;scope=parent;break;}}
 const hasAttachment=!!input.files?.length||!!scope&&Array.from(scope.querySelectorAll('a,button,[role="button"]')).some(node=>/\.(?:pdf|docx?)\b/i.test((node as HTMLElement).innerText||node.getAttribute('download')||''));
 return{index,id:input.id,name:input.name,label:(own||near||'文件附件').replace(/\s+/g,' ').trim().slice(0,160),accept:input.accept,disabled:input.disabled,hasAttachment};
});
/** Only status and a digest leave the browser, never the observed input values. */
export async function resumeParseStatus(page:Page){return page.evaluate(async()=>{const visible=(node:Element)=>!!(node as HTMLElement).getClientRects().length&&getComputedStyle(node).visibility!=='hidden';const dialogs=Array.from(document.querySelectorAll('[role="dialog"],.ant-modal,.el-dialog')).filter(visible).map(node=>(node as HTMLElement).innerText||'');const body=document.body?.innerText??'';const values=Array.from(document.querySelectorAll('input:not([type="file"]):not([type="password"]),textarea,select')).map(node=>({value:(node as HTMLInputElement).value,checked:(node as HTMLInputElement).checked}));const bytes=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(values)));return{parsing:/(?:正在|简历)(?:上传|解析|识别)(?:中|…|\.\.\.)|上传中\s*\d*%?|解析中|parsing resume|uploading/i.test(body),needsOverwriteChoice:dialogs.some(text=>/覆盖|替换|overwrite|replace/i.test(text)&&/简历|表单|resume|form/i.test(text)),formDigest:Array.from(new Uint8Array(bytes),item=>item.toString(16).padStart(2,'0')).join('')};});}

export async function inspectResumeInputs(page:Page):Promise<{targets:ResumeUploadTarget[];bindings:Map<string,number>}>{
 const raw=await page.evaluate(READ_RESUME_INPUTS),bindings=new Map<string,number>();
 const targets=raw.filter(input=>!input.disabled&&!/照片|头像|证件|护照|成绩单|证书|photo|avatar|transcript|passport|certificate/i.test(input.label)).map(input=>{const {hasAttachment,...identity}=input;const id=formStateDigest(identity);bindings.set(id,input.index);return{id,label:input.label,accept:input.accept,hasAttachment,recommended:/简历|resume|\bcv\b/i.test(input.label)&&!/照片|头像|证件|成绩单|photo|avatar|transcript|passport/i.test(input.label)};});
 return{targets,bindings};
}
export function resumeFileAccepted(accept:string,fileName:string):boolean{
 const extension=fileName.toLowerCase().endsWith('.pdf')?'.pdf':fileName.toLowerCase().endsWith('.docx')?'.docx':'';
 if(!extension)return false;if(!accept.trim())return true;
 const mime=extension==='.pdf'?'application/pdf':'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
 return accept.toLowerCase().split(',').map(item=>item.trim()).some(item=>[extension,mime,'application/*','*/*'].includes(item));
}
export async function selectResumeFile(page:Page,inspection:ResumeUploadInspection,targetId:string,file:{name:string;mimeType:string;buffer:Buffer},guard:()=>Promise<void>,beforeSelect:()=>void=()=>{}){
 await guard();const current=await inspectResumeInputs(page),target=current.targets.find(target=>target.id===targetId);
 if(!target||!inspection.targets.some(target=>target.id===targetId))throw Error('上传入口已经变化，请重新选择。');
 if(target.hasAttachment)throw Error('网页已有简历附件，保留现有文件，未重复上传。');
 if(!resumeFileAccepted(target.accept,file.name))throw Error('此上传入口不接受这份简历的格式，请在网页核对。');
 const index=current.bindings.get(target.id)!;const input=await page.locator('css:light=input[type="file"]').nth(index).elementHandle();if(!input)throw Error('上传入口已消失。');
 try{await guard();if(!await input.evaluate(element=>element.isConnected&&element instanceof HTMLInputElement&&element.type==='file'&&!element.disabled))throw Error('上传入口已变化。');
   // Host-selected bytes only. No model/renderer filesystem path, arbitrary
   // upload endpoint, submit click, or overwrite-dialog acceptance is accepted.
   beforeSelect();await input.setInputFiles(file,{timeout:5000});await guard();
 }finally{await input.dispose();}
}
