import {useEffect,useRef,useState} from 'react';
import type {AgentQuestionRequest,AgentQuestionResponse} from '../../../packages/shared/src/agent-questions.js';
import {Button,ErrorMessage} from './components.js';
import {errorText} from './helpers.js';
import './AgentQuestionPrompt.css';
/** A live human turn, displayed above the composer until the running tool resumes. */
export function AgentQuestionPrompt({request,onReply,onStop}:{request:AgentQuestionRequest;onReply(value:AgentQuestionResponse):Promise<void>;onStop():Promise<void>}){
 const [index,setIndex]=useState(0),[drafts,setDrafts]=useState<Record<string,{optionId?:string;text?:string}>>({}),[other,setOther]=useState<Record<string,boolean>>({}),[busy,setBusy]=useState(false),[error,setError]=useState('');const flight=useRef(false),root=useRef<HTMLElement>(null);
 const question=request.questions[index]!,draft=drafts[question.id]??{},valid=(id:string)=>!!drafts[id]?.optionId||!!drafts[id]?.text?.trim();
 useEffect(()=>{const element=root.current?.querySelector<HTMLElement>('textarea,button[aria-pressed]');element?.focus();},[index]);
 function edit(value:{optionId?:string;text?:string}){setDrafts(old=>({...old,[question.id]:value}));setError('');}
 async function submit(disposition:'answered'|'skipped'){
  if(flight.current||disposition==='answered'&&!request.questions.every(q=>valid(q.id)))return;flight.current=true;setBusy(true);setError('');
  try{await onReply({requestId:request.id,disposition,answers:disposition==='skipped'?[]:request.questions.map(q=>({questionId:q.id,...drafts[q.id]}))});}
  catch(error){setError(errorText(error));}finally{flight.current=false;setBusy(false);}
 }
 return <section ref={root} className="agent-question-prompt" role="region" aria-label="Agent 正在等待你的回答" data-testid="agent-question-prompt" aria-busy={busy}>
  <header><span className="agent-question-live-dot" aria-hidden="true"/><strong>需要你回答</strong><span className="agent-question-step">{request.questions.length>1?`${index+1} / ${request.questions.length}`:'当前问题'}</span></header>
  <div className="agent-question-content"><h3>{question.prompt}</h3><ErrorMessage message={error}/>
   {!!question.options?.length&&<div className="agent-question-options" role="group" aria-label={question.prompt}>{question.options.map(option=><button type="button" key={option.id} disabled={busy} aria-pressed={!other[question.id]&&draft.optionId===option.id} onClick={()=>{setOther(old=>({...old,[question.id]:false}));edit({optionId:option.id});}}><span className="agent-question-radio" aria-hidden="true"/><span><strong>{option.label}</strong>{option.description&&<small>{option.description}</small>}</span></button>)}<button type="button" disabled={busy} aria-pressed={!!other[question.id]} className="agent-question-other" onClick={()=>{setOther(old=>({...old,[question.id]:true}));edit({text:other[question.id]?draft.text:''});}}><span className="agent-question-radio" aria-hidden="true"/><span>补充或其他回答</span></button></div>}
   {(!question.options?.length||other[question.id])&&<textarea autoFocus disabled={busy} aria-label={question.prompt+'的回答'} rows={2} maxLength={2000} value={draft.text??''} onChange={event=>edit({text:event.target.value})} placeholder="写下你的回答…"/>}
  </div>
  <footer><button type="button" className="agent-question-skip" disabled={busy} onClick={()=>void submit('skipped')}>暂时跳过</button><div>{index>0&&<Button variant="ghost" disabled={busy} onClick={()=>setIndex(value=>value-1)}>上一题</Button>}{index<request.questions.length-1?<Button disabled={busy||!valid(question.id)} onClick={()=>setIndex(value=>value+1)}>下一题</Button>:<Button busy={busy} disabled={!request.questions.every(q=>valid(q.id))} onClick={()=>void submit('answered')}>确认回答</Button>}</div></footer>
  <div className="agent-question-footnote"><span>回答后 Agent 会自动继续</span><button type="button" disabled={busy} onClick={()=>void onStop()}>停止任务</button></div>
 </section>;
}
