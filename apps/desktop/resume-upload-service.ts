import {constants} from 'node:fs';import {open,lstat} from 'node:fs/promises';import {join,basename} from 'node:path';import {createHash} from 'node:crypto';
import type {BrowserController} from '../../packages/browser/src/controller.js';import type {DomainStore} from '../../packages/domain/src/store.js';
import type {ResumeUploadInspection,ResumeUploadRequest,ResumeUploadReceipt} from '../../packages/shared/src/resume-upload.js';
import {inspectResumeInputs,selectResumeFile,resumeParseStatus} from '../../packages/browser/src/resume-upload.js';import {attachPlaywrightView} from '../../packages/browser/src/playwright-view.js';
export function createResumeUploadService(options:{browser:BrowserController;store:DomainStore;stateDirectory:string;assertIdle():void;withLock<T>(work:()=>Promise<T>):Promise<T>}){
 const selected=new Map<string,string>();
 const pageState=():ResumeUploadInspection=>{const state=options.browser.getState(),url=new URL(state.url);if(url.protocol!=='https:'||url.username||url.password||state.loading)throw Error('请先打开已加载的HTTPS申请表。');return{url:url.href,tabId:state.activeTabId,documentRevision:state.documentRevision??0,targets:[]};};
 const samePage=(a:ResumeUploadInspection,b:ResumeUploadInspection)=>a.url===b.url&&a.tabId===b.tabId&&a.documentRevision===b.documentRevision;
 const inspect=async()=>{options.assertIdle();return options.withLock(async()=>{const before=pageState();const attached=await attachPlaywrightView(options.browser.view.webContents);try{const targets=(await inspectResumeInputs(attached.page)).targets,status=await resumeParseStatus(attached.page);if(!samePage(before,pageState()))throw Error('页面变化，未继续。');return{...before,targets,...status};}finally{await attached.close();}});};
 return{inspect,
 async upload(input:ResumeUploadRequest):Promise<ResumeUploadReceipt>{
  options.assertIdle();if(!input||typeof input.resumeVersionId!=='string'||!Number.isSafeInteger(input.profileVersion)||typeof input.targetId!=='string'||!input.page||!Array.isArray(input.page.targets)||input.force!==undefined&&typeof input.force!=='boolean')throw Error('请选择已保存的简历与当前上传入口。');
  return options.withLock(async()=>{const before=pageState();if(!samePage(before,input.page))throw Error('页面已经变化，请重新核对上传目标。');const profile=await options.store.getProfile();if(profile.version!==input.profileVersion)throw Error('资料已变化，请重新核对。');
   const version=(await options.store.assets.getState()).resumeVersions.find(version=>version.id===input.resumeVersionId&&!version.demo);if(!version||!/^[-a-zA-Z0-9]{10,80}$/.test(version.fileId))throw Error('请选择有效的本机简历版本。');
   const key=JSON.stringify([before.tabId,before.documentRevision,before.url,input.targetId]),last=selected.get(key);
   if(last===version.sha256&&!input.force)return{status:'already-selected',fileName:version.fileName,destination:new URL(before.url).host,message:'本页已选择过这份简历，未重复上传。请先处理网站提示，再核对表单。'};
   const directory=join(options.stateDirectory,'resume-versions'),directoryStat=await lstat(directory);if(directoryStat.isSymbolicLink()||!directoryStat.isDirectory())throw Error('简历存储目录无法核实。');
   const handle=await open(join(directory,version.fileId),constants.O_RDONLY|constants.O_NOFOLLOW);let buffer:Buffer;
   try{const stat=await handle.stat();if(!stat.isFile()||stat.size!==version.sizeBytes||stat.size>20*1024*1024)throw Error('简历文件发生变化。');buffer=await handle.readFile();}finally{await handle.close();}
   if(createHash('sha256').update(buffer).digest('hex')!==version.sha256||basename(version.fileName)!==version.fileName)throw Error('简历文件未通过完整性核对。');
   if(!(/\.pdf$/i.test(version.fileName)&&buffer.subarray(0,5).toString()==='%PDF-'||/\.docx$/i.test(version.fileName)&&buffer.subarray(0,2).toString()==='PK'))throw Error('简历格式无法核实。');
   const guard=async()=>{if(!samePage(before,pageState())||(await options.store.getProfile()).version!==profile.version)throw Error('页面或资料已变化，停止上传。');};
   await options.browser.withUniversalContents(async contents=>{const attached=await attachPlaywrightView(contents);try{await selectResumeFile(attached.page,input.page,input.targetId,{name:version.fileName,mimeType:/\.pdf$/i.test(version.fileName)?'application/pdf':'application/vnd.openxmlformats-officedocument.wordprocessingml.document',buffer},guard,()=>selected.set(key,version.sha256));}finally{await attached.close();}});
   selected.set(key,version.sha256);while(selected.size>40)selected.delete(selected.keys().next().value!);
   return{status:'selected',fileName:version.fileName,destination:new URL(before.url).host,message:'文件已交给网页；网站是否收到及解析成功，以网站提示为准。如出现覆盖选择，请先自行选择，完成后核对并修正表单。'};
  });
 }
 };
}
