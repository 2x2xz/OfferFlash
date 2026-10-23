import {questionDecisionApplies} from '../../shared/src/question-decisions.js';
import {createHash} from 'node:crypto';
import {normalizeAnswerQuestion,isHighImpactQuestion} from '../../domain/src/application-assets.js';
import {answerBankFieldAllowed} from './answer-bank.js';
import type {QuestionDecision,ConfirmedAnswer} from '../../shared/src/application-assets.js';
import type {ApplicationFact} from './application-facts.js';
export interface UniversalAnswerContext {answers:ConfirmedAnswer[];decisions?:QuestionDecision[];applicationId?:string;demo?:boolean;}
export interface UniversalQuestion {key:string;prompt:string;context:string;options?:string[];recordUnresolved?:true;legacyKeys?:string[];reusableKey?:string;answerFormat?:'date'|'month';}
type QuestionField={label:string;section:string;type:string;editable:boolean;value:string;group?:string};
export {validQuestionDate} from '../../shared/src/calendar-date.js';
export function universalQuestion(field:QuestionField,url:string,record:string|undefined,facts:ApplicationFact[]):UniversalQuestion|undefined{
 if(!field.section&&/^keyword$/i.test(field.label))return;
 if(!answerBankFieldAllowed({...field,type:'text',value:''} as any)||!['text','textarea','select','combobox','date','month'].includes(field.type))return;
 const career=/教育|实习|项目|语言|软件|工具|荣誉|奖项|education|internship|employment|project|language|software|tools|awards?|honou?r/i.test(field.section);
 const unresolved=career&&!record;
 if(unresolved&&!/语言|软件|工具|荣誉|奖项|language|software|tools|awards?|honou?r/i.test(field.section))return; // Never share one GPA across unidentified education records.
 const identity=facts.find(f=>f.record===record&&f.sourceRecordId)?.sourceRecordId;
 const name=facts.find(f=>f.record===record&&['school','organization','name','language','softwareName','awardName'].includes(f.kind))?.value;
 const contextual=/公司|企业|岗位|职位|为什么|动机|职业规划|职业目标|company|employer|position|role|\bjob\b|why|motivation|career.?goals/i.test(field.label);
 const stableCaption=/^(?:所在地|location|意向工作城市|preferred work city|语言类型|language|掌握程度|proficiency|听说|listening and speaking|读写|reading and writing|请列出你常用的AI工具|兴趣爱好|爱好特长|爱好|特长|个人优势|自我评价|个人评价|职业技能|专业技能|技术技能|常用工具|掌握的工具|hobbies|interests|personal strengths|self.?assessment|technical skills)$/i;
 const aliases=field.label.replace(/^[*＊\s]+|[*＊:：\s]+$/g,'').split(/\s*\/\s*/u);
 const stable=!contextual&&aliases.length<=2&&aliases.every(alias=>stableCaption.test(alias));
 const context=unresolved?{url,unresolvedSection:field.section,group:field.group??'unbound'}:career?{recordId:identity??record,school:name}:stable?'ordinary-general':{url};
 const makeKey=(section:string,keyContext:unknown=context)=>'[OfferFlash:'+createHash('sha256').update(JSON.stringify({context:keyContext,section,question:normalizeAnswerQuestion(field.label)})).digest('hex').slice(0,32)+'] '+field.label;
 const key=makeKey(stable&&!career?'':field.section);
 const legacyKeys=[...new Set([makeKey(field.section),...(stable&&!career?[makeKey(field.section,{url})]:[])])].filter(value=>value!==key);
 const reusableKey=!career&&!stable&&!contextual?makeKey('','ordinary-general'):undefined;
 return{key,...(reusableKey?{reusableKey}:{}),...(legacyKeys.length?{legacyKeys}:{}),prompt:field.label,context:unresolved?'这条记录尚未关联个人资料，请先补充对应的语言、软件或荣誉；回答不会套用到其它记录。':career?name??field.section:stable?'相同问题可复用':'仅复用于当前申请的相同问题',...(unresolved?{recordUnresolved:true as const}:{})};
}
export function eligibleUniversalAnswers(context:UniversalAnswerContext,version:number):ConfirmedAnswer[]{
 return context.answers.filter(a=>a.demo===(context.demo??false)&&a.risk==='ordinary'&&!isHighImpactQuestion(a.questionPattern)&&a.confirmedRevision===a.revision&&a.confirmedProfileVersion===version&&!!a.confirmedAt&&!!a.answer.trim()&&(a.scope.kind==='general'||a.scope.applicationId===context.applicationId));
}
export function universalAnswerMatches(answer:ConfirmedAnswer,question:UniversalQuestion,field:QuestionField):boolean{
 if(question.recordUnresolved)return false;
 if([question.key,...(question.legacyKeys??[]),...(question.reusableKey?[question.reusableKey]:[])].some(key=>normalizeAnswerQuestion(answer.questionPattern)===normalizeAnswerQuestion(key)))return true;
 // Older manually confirmed general answers remain exact-question matches only
 // outside career records. Never let an unscoped GPA answer spill across degrees.
 return !/教育|实习|项目|语言|软件|工具|荣誉|奖项|education|internship|employment|project|language|software|tools|awards?|honou?r/i.test(field.section)&&normalizeAnswerQuestion(answer.questionPattern)===normalizeAnswerQuestion(field.label);
}

/** Decisions suppress a prompt, never create a personal fact or a fabricated value. */
export function universalQuestionDecision(context:UniversalAnswerContext,question:UniversalQuestion|undefined,url:string,version:number):QuestionDecision|undefined{
 if(!question)return;return context.decisions?.find(item=>questionDecisionApplies(item,question.key,url,version));
}
