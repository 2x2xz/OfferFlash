import {questionDecisionContextURL} from '../../shared/src/question-decisions.js';
import {createHash} from 'node:crypto';
import {readDocument,readDocuments,writeDocument,deleteDocument,type DatabaseFile} from './sqlite.js';
import {isHighImpactQuestion} from './application-assets.js';
import type {Profile} from '../../shared/src/contracts.js';
import type {QuestionDecision,QuestionDecisionInput} from '../../shared/src/application-assets.js';
const kind='application_question_decision';
export const questionDecisionURL=questionDecisionContextURL;
export function questionDecisionId(url:string,key:string){return createHash('sha256').update(JSON.stringify([url,key])).digest('hex');}
export function readQuestionDecisions(db:import('sql.js').Database):QuestionDecision[]{return readDocuments<QuestionDecision>(db,kind);}
export function createQuestionDecisionStore(file:DatabaseFile){return{
 async save(input:QuestionDecisionInput){
  if(!input||Object.keys(input).some(key=>!['url','key','prompt','disposition','profileVersion'].includes(key))||!['skip','none','ask'].includes(input.disposition)||typeof input.key!=='string'||!/^\[OfferFlash:[a-f0-9]{32}\] .{1,800}$/u.test(input.key)||typeof input.prompt!=='string'||input.prompt.length>800||isHighImpactQuestion(input.prompt)||isHighImpactQuestion(input.key)||!Number.isSafeInteger(input.profileVersion))throw Error('该问题不能通过普通资料引导记住。');
  const url=questionDecisionURL(input.url),id=questionDecisionId(url,input.key);
  return file.transact(db=>{const profile=readDocument<Profile>(db,'profile','current');if(profile?.version!==input.profileVersion)throw Error('资料已变化，请重新核对。');
   if(input.disposition==='ask'){deleteDocument(db,kind,id);return;}
   if(readQuestionDecisions(db).length>=2000&&!readDocument(db,kind,id))throw Error('已记住的问题达到上限，请先清理旧记录。');
   const decision:QuestionDecision={...input,url,id,updatedAt:new Date().toISOString()};writeDocument(db,kind,id,decision,decision.updatedAt);
  });
 }
};}
