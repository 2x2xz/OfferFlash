import {useEffect,useRef,useState} from 'react';
import {ArrowLeft, ArrowRight, Check, CheckCircle2, BookmarkCheck} from 'lucide-react';
import type {UniversalResult} from '../../../packages/browser/src/universal-form.js';
import type {QuestionDecision,ConfirmedAnswerInput} from '../../../packages/shared/src/application-assets.js';
import {savedApplicationAnswer} from '../../../packages/ui/src/companion.js';
import {questionDecisionApplies} from '../../../packages/shared/src/question-decisions.js';
import {answerForReview,answerForSave} from '../../../packages/ui/src/answer-review.js';
import {useWorkspace} from './context.js';
import {Button,ErrorMessage} from './components.js';
import {PixelArrow} from './PixelGuide.js';
import {errorText} from './helpers.js';

/** Explicit user confirmation writes the local answer bank; no page input occurs until Continue. */
export function UniversalQuestions({result,locked,onBusy,onContinue,onAnsweredChange}:{result:UniversalResult;locked:boolean;onBusy(value:boolean):void;onContinue():Promise<void>;onAnsweredChange?(keys:string[]):void}) {
 const {api,state,browser,notify}=useWorkspace();
 const [drafts,setDrafts]=useState<Record<string,string>>({}),[error,setError]=useState(''),[saving,setSaving]=useState(false);
 const [remembered,setRemembered]=useState<string[]>([]),[reuse,setReuse]=useState<Record<string,boolean>>({});
 const [decisions,setDecisions]=useState<QuestionDecision[]>([]);
 const [index,setIndex]=useState(0),[saved,setSaved]=useState<Set<string>>(()=>new Set()),[skipped,setSkipped]=useState<Set<string>>(()=>new Set());
 const inFlight=useRef(false),alive=useRef(true),root=useRef<HTMLElement>(null);
 const report=useRef(onAnsweredChange);report.current=onAnsweredChange;
 useEffect(()=>{report.current?.([...saved,...suppressed.map(q=>q.key)]);},[saved,decisions]);
 useEffect(()=>{alive.current=true;return()=>{alive.current=false;};},[]);
 const context=useRef({url:browser.url,version:state.profile.version});context.current={url:browser.url,version:state.profile.version};
 const allQuestions=[...new Map((result.remaining??[]).filter(item=>['missing-data','user-none','user-skipped'].includes(item.reasonCode??'')&&item.question).map(item=>[item.question!.key,item.question!])).values()];
 const suppressed=allQuestions.filter(q=>decisions.some(item=>questionDecisionApplies(item,q.key,browser.url,state.profile.version)));
 const questions=allQuestions.filter(q=>!suppressed.includes(q));
 const signature=JSON.stringify(allQuestions.map(q=>[q.key,q.options]));
 useEffect(()=>{setDrafts({});setRemembered([]);setReuse({});setError('');setIndex(0);setSaved(new Set());setSkipped(new Set());},[browser.url,state.profile.version,signature]);
 // A profile revision may require review again, but never make the person retype
 // an exact previously confirmed answer. Saving still requires an explicit click.
 useEffect(()=>{
  let cancelled=false;const version=state.profile.version;
  void api.applicationAssets().then(assets=>{
   if(cancelled||assets.profileVersion!==version)return;setDecisions(assets.questionDecisions??[]);
   const prior:Record<string,string>={},priorReuse:Record<string,boolean>={};
   for(const question of questions){
    if(question.recordUnresolved)continue;
    const match=answerForReview(assets.answers,question);
    if(match&&(!question.options?.length||question.options.includes(match.answer))){prior[question.key]=match.answer;priorReuse[question.key]=match.questionPattern===question.reusableKey;}
   }
   setRemembered(Object.keys(prior));setReuse(current=>({...priorReuse,...current}));setDrafts(current=>({...prior,...current}));
  }).catch(()=>{});
  return()=>{cancelled=true;};
 },[api,browser.url,state.profile.version,signature]);
 const q=questions[index],done=index>=questions.length;
 useEffect(()=>{const element=root.current;if(element?.getClientRects().length){element.scrollIntoView({block:'nearest'});(element.querySelector<HTMLElement>('textarea,select,.answer-options button') ?? element.querySelector<HTMLElement>('h3'))?.focus();}},[index,signature]);
 if(!allQuestions.length)return null;
 function change(value:string) { if(!q)return;setDrafts(current=>({...current,[q.key]:value}));setSaved(current=>{const next=new Set(current);next.delete(q.key);return next;}); }
 async function continueFilling(){
  if(locked||inFlight.current)return;
  try{await onContinue();}catch(e){if(alive.current)setError('回答已保存在本机。继续填写未完成：'+errorText(e));}
 }
 async function decide(disposition:'skip'|'none'|'ask',question=q){
  if(!question||locked||inFlight.current)return;inFlight.current=true;setSaving(true);onBusy(true);setError('');
  try{if(!api.setQuestionDecision)throw Error('此版本尚不支持记住跳过，请更新应用。');const assets=await api.setQuestionDecision({url:browser.url,key:question.key,prompt:question.prompt,disposition,profileVersion:state.profile.version});
   if(alive.current){setDecisions(assets.questionDecisions??[]);if(disposition==='ask')setIndex(0);notify(disposition==='none'?'已记为无此项，不再追问；没有替你猜写网页。':disposition==='skip'?'此申请已跳过，不再追问。':'已恢复此问题。');}
  }catch(error){if(alive.current)setError(errorText(error));}finally{inFlight.current=false;if(alive.current)setSaving(false);onBusy(false);}
 }
 async function remember(){
  if(!q||locked||inFlight.current||!drafts[q.key]?.trim())return;
  const start={...context.current},current=()=>alive.current&&context.current.url===start.url&&context.current.version===start.version;
  inFlight.current=true;setSaving(true);onBusy(true);setError('');
  try{
   const before=await api.applicationAssets();if(!current()||before.profileVersion!==start.version)throw Error('网页或个人资料已变化，请重新核对。');
   const prior=answerForSave(before.answers,q,reuse[q.key]===true),request:ConfirmedAnswerInput={...(prior?{id:prior.id}:{}),questionPattern:reuse[q.key]&&q.reusableKey?q.reusableKey:q.key,contextLabel:reuse[q.key]?'你已确认这是长期个人信息，相同问题可复用':q.context,answer:drafts[q.key]!.trim(),scope:{kind:'general'},demo:false,risk:'ordinary'};
   const after=await api.saveAnswer(request,prior?.revision??null),stored=savedApplicationAnswer(before.answers,after.answers,request);
   if(!stored||!current())throw Error('未能核对本次保存的回答，没有自动确认。');
   const confirmed=await api.confirmAnswer(stored.id,stored.revision,start.version),answer=confirmed.answers.find(a=>a.id===stored.id);
   if(!current()||!answer||answer.confirmedRevision!==answer.revision||answer.confirmedProfileVersion!==start.version)throw Error('回答已保存，但尚未核对确认状态。');
   setSaved(old=>new Set(old).add(q.key));setSkipped(old=>{const next=new Set(old);next.delete(q.key);return next;});
   setIndex(value=>value+1);notify('已确认并记住这个回答。');
  }catch(e){if(alive.current)setError(errorText(e));}finally{inFlight.current=false;if(alive.current)setSaving(false);onBusy(false);}
 }
 return <section ref={root} className="answer-guide" data-testid="universal-missing-questions" aria-label="补充资料引导" aria-busy={saving}>
  <header className="answer-guide-header"><h2>补充资料</h2><span>{done?'已查看全部':`${index+1} / ${questions.length}`}</span></header>
  <div className="answer-progress-label" aria-live="polite"><span>{done?'可继续填写':'不确定可跳过'}</span><span>已保存 {saved.size} 项</span></div>
  <div className="answer-progress" role="progressbar" aria-label="本轮问题查看进度" aria-valuemin={0} aria-valuemax={questions.length} aria-valuenow={Math.min(index,questions.length)}><span style={{width:`${Math.min(index,questions.length)/questions.length*100}%`}}/></div>
  <ErrorMessage message={error}/>
  {!done&&q?<><div className="answer-question"><h3 tabIndex={-1} id="active-answer-question">{q.prompt}</h3><p id="active-answer-context" className={q.reusableKey?'answer-context-hidden':undefined}>{q.context==='仅复用于当前申请的相同问题'?'仅当前申请':q.context}</p>{remembered.includes(q.key)&&<div className="answer-existing-note" data-testid="remembered-answer-review"><BookmarkCheck size={16}/><span>已有本机回答，请核对。</span></div>}
   {q.options?.length ? q.options.length<=6?<div className="answer-options" role="group" aria-labelledby="active-answer-question">{q.options.map(option=><button type="button" key={option} data-testid="universal-answer-choice" disabled={locked||saving} aria-pressed={drafts[q.key]===option} onClick={()=>change(option)}><span>{option}</span>{drafts[q.key]===option&&<Check size={17}/>}</button>)}</div>:<select aria-labelledby="active-answer-question" aria-describedby="active-answer-context" data-testid="universal-answer-choice" disabled={locked||saving} value={drafts[q.key]??''} onChange={e=>change(e.target.value)}><option value="">请选择你的实际情况</option>{q.options.map(option=><option key={option} value={option}>{option}</option>)}</select>:<textarea aria-labelledby="active-answer-question" aria-describedby="active-answer-context" data-testid="universal-answer-input" disabled={locked||saving} value={drafts[q.key]??''} maxLength={20000} rows={3} placeholder="填写实际情况" onChange={e=>change(e.target.value)}/>}
   {q.reusableKey&&<fieldset className="answer-reuse-scope"><legend>适用范围</legend><label><input type="radio" name="answer-reuse" checked={!reuse[q.key]} disabled={locked||saving} onChange={()=>setReuse(current=>({...current,[q.key]:false}))}/><span>仅当前申请</span></label><label><input type="radio" name="answer-reuse" data-testid="answer-reuse-personal" checked={reuse[q.key]===true} disabled={locked||saving} onChange={()=>setReuse(current=>({...current,[q.key]:true}))}/><span>长期个人信息，可跨申请复用</span></label></fieldset>}
   </div>
   <Button className="answer-confirm" data-testid="universal-answer-remember" busy={saving} disabled={locked||!drafts[q.key]?.trim()} onClick={()=>void remember()}>确认并保存<span className="answer-next-cue"><PixelArrow direction="right"/></span></Button>
   <Button variant="secondary" data-testid="universal-answer-none" disabled={locked||saving} onClick={()=>void decide('none')}>无 / 不适用</Button><p className="small muted">记录为无此项；若网站仍要求填写，请在网页选择其对应选项。</p>
   <div className="answer-guide-navigation"><Button variant="ghost" disabled={locked||saving||index===0} onClick={()=>{setError('');setIndex(value=>value-1);}}><ArrowLeft size={14}/>上一题</Button><Button variant="ghost" disabled={locked||saving} data-testid="universal-answer-skip" onClick={()=>void decide('skip')}>本次跳过（此申请不再问）</Button></div>
  </>:<div className="answer-guide-complete"><CheckCircle2 size={32}/><h3>已保存 {saved.size} 项</h3><p>{skipped.size?`${skipped.size} 项已跳过，可稍后填写。`:'可以继续填写网页。'}</p><Button className="answer-confirm" data-testid="universal-answer-continue" disabled={locked||saving||!saved.size} onClick={()=>void continueFilling()}>继续填写<ArrowRight size={16}/></Button><Button variant="ghost" disabled={locked||saving} onClick={()=>setIndex(0)}>检查回答</Button></div>}
  {suppressed.length>0&&<details data-testid="question-decisions"><summary>已处理、不再追问 · {suppressed.length} 项</summary>{suppressed.map(question=><div key={question.key} className="row"><span>{question.prompt} · {decisions.find(item=>questionDecisionApplies(item,question.key,browser.url,state.profile.version))?.disposition==='none'?'无 / 不适用':'已跳过'}</span><Button variant="ghost" disabled={locked||saving} onClick={()=>void decide('ask',question)}>恢复询问</Button></div>)}</details>}
  <footer className="answer-guide-footer">答案保存在本机，可在个人资料中修改。</footer>
 </section>;
}
