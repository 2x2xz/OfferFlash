import {useRef,useState} from 'react';
import {Upload,CheckCircle2} from 'lucide-react';
import {Button,ErrorMessage} from './components.js';import {useWorkspace} from './context.js';import {errorText} from './helpers.js';
import type {ResumeVersion} from '../../../packages/shared/src/application-assets.js';import type {ResumeUploadInspection,ResumeUploadReceipt} from '../../../packages/shared/src/resume-upload.js';
import './ResumeFirst.css';
/** User chooses the exact local file and current destination; no model sees file bytes. */
export function ResumeFirst({locked,onBusy,onRepair}:{locked:boolean;onBusy(value:boolean):void;onRepair():Promise<void>}){
 const {api,browser,state,notify}=useWorkspace();const [inspection,setInspection]=useState<ResumeUploadInspection>(),[versions,setVersions]=useState<ResumeVersion[]>([]),[versionId,setVersionId]=useState(''),[targetId,setTargetId]=useState(''),[receipt,setReceipt]=useState<ResumeUploadReceipt>(),[error,setError]=useState(''),[working,setWorking]=useState(false);const inFlight=useRef(false),loaded=useRef(false);
 const context=useRef({url:browser.url,tab:browser.activeTabId,revision:browser.documentRevision,version:state.profile.version});context.current={url:browser.url,tab:browser.activeTabId,revision:browser.documentRevision,version:state.profile.version};
 if(!api.inspectResumeUpload||!api.uploadApplicationResume||!browser.url.startsWith('https:'))return null;
 async function run(work:()=>Promise<void>){if(locked||inFlight.current)return;inFlight.current=true;setWorking(true);onBusy(true);setError('');try{await work();}catch(error){setError(errorText(error));}finally{inFlight.current=false;setWorking(false);onBusy(false);}}
 async function load(){await run(async()=>{const before={...context.current},assets=await api.applicationAssets(),page=await api.inspectResumeUpload!();if(JSON.stringify(before)!==JSON.stringify(context.current))throw Error('页面已变化，请重新打开上传栏。');const available=assets.resumeVersions.filter(version=>!version.demo);setVersions(available);if(available.length===1)setVersionId(available[0]!.id);setInspection(page);const recommended=page.targets.filter(target=>target.recommended);setTargetId(recommended.length===1?recommended[0]!.id:'');loaded.current=true;});}
 async function importFile(){await run(async()=>{const imported=await api.importResumeVersion({label:'申请简历',directions:[],demo:false});if(imported.cancelled||!imported.state)return;const next=imported.state.resumeVersions.filter(version=>!version.demo);const fresh=next.filter(version=>!versions.some(old=>old.id===version.id));setVersions(next);if(fresh.length===1)setVersionId(fresh[0]!.id);});}
 async function upload(){await run(async()=>{if(!inspection||!versionId||!targetId)throw Error('请先选择简历与上传入口。');const result=await api.uploadApplicationResume!({resumeVersionId:versionId,profileVersion:state.profile.version,page:inspection,targetId});setReceipt(result);notify('文件已交给网页，请核对网站的解析及覆盖提示。');});}
 return <details className="resume-first" data-testid="resume-first" onToggle={event=>{if(event.currentTarget.open&&!loaded.current&&!inFlight.current)void load();}}>
  <summary><Upload size={15}/><strong>用网页的上传入口提交简历，再核对解析结果</strong><span>有简历上传栏时可用</span></summary>
  <div className="resume-first-body"><ErrorMessage message={error}/>
   {!inspection?<p>{working?'正在查找本页上传入口…':'展开后读取本页真实上传入口。'}</p>:!inspection.targets.length?<p>本页尚未找到可操作的简历文件栏；请先在网站展开上传区域，或直接核对现有表单。<Button variant="ghost" disabled={locked||working} onClick={()=>void load()}>重新查找入口</Button></p>:<>
    <div className="resume-first-inputs"><label>本机简历<select data-testid="upload-resume-version" disabled={locked||working} value={versionId} onChange={event=>{setVersionId(event.target.value);setReceipt(undefined);}}><option value="">请选择这次要上传的简历</option>{versions.map(version=><option key={version.id} value={version.id}>{version.label} · {version.fileName}</option>)}</select></label><Button variant="secondary" disabled={locked||working} onClick={()=>void importFile()}>选择并保存简历</Button>
    <label>网页上传栏<select data-testid="upload-resume-target" disabled={locked||working} value={targetId} onChange={event=>setTargetId(event.target.value)}><option value="">请选择对应的简历上传栏</option>{inspection.targets.map(target=><option key={target.id} value={target.id}>{target.label}{target.accept?' · '+target.accept:''}</option>)}</select></label></div>
    <p>上传到 <strong>{new URL(inspection.url).host}</strong>。网站可能据此覆盖已有表单；出现覆盖选择时由你在网站决定。文件直接交给网站，不发送给填写模型。</p>
    {!receipt&&<Button data-testid="upload-resume-confirm" disabled={locked||working||!versionId||!targetId} busy={working} onClick={()=>void upload()}>上传 {versions.find(version=>version.id===versionId)?.fileName??'所选简历'} 到 {new URL(inspection.url).host}</Button>}
   </>}
   {receipt&&<div className="resume-first-receipt"><CheckCircle2 size={16}/><div><strong>{receipt.fileName}</strong><p>{receipt.message}</p><Button data-testid="resume-repair" disabled={locked||working} onClick={()=>void onRepair()}>网站解析完成，核对并修正</Button></div></div>}
  </div>
 </details>;
}
