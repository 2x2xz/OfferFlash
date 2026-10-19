import {useEffect, useRef, useState} from 'react';
import type {IdentityDocumentKind, SensitiveIdentityState, SensitiveIdentityFillPreview} from '../../../packages/shared/src/sensitive-identity.js';
import {useWorkspace} from './context.js';
import {Button, ErrorMessage, Field} from './components.js';
import {errorText} from './helpers.js';

export function SensitiveIdentityPanel({disabled=false}:{disabled?:boolean}) {
 const {api}=useWorkspace();
 const [open,setOpen]=useState(false),[state,setState]=useState<SensitiveIdentityState>(),[kind,setKind]=useState<IdentityDocumentKind>('national-id');
 const [number,setNumber]=useState(''),[confirmed,setConfirmed]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState(''),[remove,setRemove]=useState(false);
 async function load(){setBusy(true);setError('');try{const next=await api.sensitiveIdentityState();setState(next);if(next.kind)setKind(next.kind);}catch(e){setError(errorText(e));}finally{setBusy(false);}}
 async function save(){if(!state)return;setBusy(true);setError('');try{setState(await api.saveSensitiveIdentity({kind,number,confirmed:true},state.version));setNumber('');setConfirmed(false);}catch(e){setError(errorText(e));}finally{setBusy(false);}}
 async function clear(){if(!state)return;setBusy(true);setError('');try{setState(await api.clearSensitiveIdentity(state.version));setNumber('');setConfirmed(false);setRemove(false);}catch(e){setError(errorText(e));}finally{setBusy(false);}}
 return <details className="card card-pad" data-testid="identity-profile" open={open} onToggle={event=>{const next=event.currentTarget.open;setOpen(next);if(next&&!state&&!busy)void load();if(!next){setNumber('');setConfirmed(false);setRemove(false);}}}>
  <summary>证件资料 · 独立加密</summary>
  {open&&<div className="stack"><p>可选。证件号码使用系统加密保存在本机，不进入普通资料导出、模型或轨迹。每次向网页填写时单独确认。</p><ErrorMessage message={error}/>
   <fieldset className="profile-fieldset" disabled={disabled||busy||!state?.encryptionAvailable}>
    {state?.configured&&<p role="status">已保存：{state.kind==='passport'?'护照':'身份证'} {state.maskedNumber}</p>}
    <Field label="证件类型"><select value={kind} onChange={e=>{setKind(e.target.value as IdentityDocumentKind);setConfirmed(false);}}><option value="national-id">身份证</option><option value="passport">护照</option></select></Field>
    <Field label={state?.configured?'输入新号码以替换':'证件号码'} hint="只填写自己的资料；已有完整号码不会回显"><input data-testid="identity-number" type="password" autoComplete="off" spellCheck={false} maxLength={80} value={number} onChange={e=>{setNumber(e.target.value);setConfirmed(false);}}/></Field>
    <label><input type="checkbox" checked={confirmed} onChange={e=>setConfirmed(e.target.checked)}/> 我已核对，这是我自己的证件信息</label>
    <div className="row"><Button data-testid="identity-save" disabled={!number.trim()||!confirmed} onClick={()=>void save()}>加密保存</Button>{state?.configured&&<Button variant="ghost" onClick={()=>setRemove(true)}>删除证件资料</Button>}</div>
    {remove&&<div><p>确认删除本机证件资料？网页中已经填写的内容不会被删除。</p><Button variant="secondary" onClick={()=>void clear()}>确认删除</Button><Button variant="ghost" onClick={()=>setRemove(false)}>保留</Button></div>}
   </fieldset>
   {state&&!state.encryptionAvailable&&<p role="status">系统加密不可用，证件保存已停用，不使用明文存储。</p>}
   {!state&&<Button variant="secondary" disabled={busy||disabled} onClick={()=>void load()}>重新读取状态</Button>}
  </div>}
 </details>;
}

export function SensitiveIdentityFillPanel({disabled,onBusyChange}:{disabled:boolean;onBusyChange:(value:boolean)=>void}) {
 const {api,browser,state}=useWorkspace();
 const [preview,setPreview]=useState<SensitiveIdentityFillPreview>(),[consent,setConsent]=useState(false),[busy,setBusy]=useState(false),[message,setMessage]=useState(''),[error,setError]=useState('');
 const pending=useRef<string|undefined>(undefined),mounted=useRef(true),active=useRef(false);
 const current=useRef({url:browser.url,version:state.profile.version});current.current={url:browser.url,version:state.profile.version};
 const cancel=()=>{const id=pending.current;pending.current=undefined;setPreview(undefined);setConsent(false);if(id)void api.cancelSensitiveIdentityFill(id).catch(()=>{});};
 useEffect(()=>{cancel();},[browser.url,state.profile.version]);
 useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;const id=pending.current;if(id)void api.cancelSensitiveIdentityFill(id).catch(()=>{});};},[api]);
 async function work(fill:boolean){
  if(active.current||disabled)return;active.current=true;setBusy(true);onBusyChange(true);setError('');setMessage('');const context={...current.current};
  try{if(fill){if(!preview||!consent)return;pending.current=undefined;setPreview(undefined);setConsent(false);const result=await api.fillSensitiveIdentity(preview.id);if(mounted.current)setMessage(result.message);}
   else{const next=await api.prepareSensitiveIdentityFill();if(!mounted.current||current.current.url!==context.url||current.current.version!==context.version){void api.cancelSensitiveIdentityFill(next.id).catch(()=>{});return;}pending.current=next.id;setPreview(next);setConsent(false);}}
  catch(e){if(mounted.current)setError(errorText(e));}finally{active.current=false;if(mounted.current)setBusy(false);onBusyChange(false);}
 }
 return <details className="browser-other-tools" data-testid="identity-fill"><summary onClick={e=>{if(disabled||busy)e.preventDefault();}}>证件号码 · 单独确认</summary><div className="stack"><p>普通“自动填写”跳过证件。仅对明确标注的空白身份证号或护照号框提供单次填写，不处理家属证件或含义不明的证件框。</p><ErrorMessage message={error}/>{message&&<p role="status">{message}</p>}
  {preview?<><p>目的地：<strong>{preview.destination}</strong></p><p>字段：{preview.fields.map(f=>f.label).join('、')}<br/>号码：{preview.maskedNumber}</p><label><input type="checkbox" disabled={disabled||busy} checked={consent} onChange={e=>setConsent(e.target.checked)}/> 仅向这个页面填写此证件号码</label><Button data-testid="identity-fill-confirm" disabled={disabled||busy||!consent||Date.now()>=Date.parse(preview.expiresAt)} onClick={()=>void work(true)}>确认填写此证件号码</Button><Button variant="ghost" disabled={disabled||busy} onClick={cancel}>取消</Button></>:<Button data-testid="identity-fill-preview" variant="secondary" disabled={disabled||busy} onClick={()=>void work(false)}>核对证件填写目的地</Button>}
 </div></details>;
}
