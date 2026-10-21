import type {ConfirmedAnswer} from '../../shared/src/application-assets.js';
import type {UniversalQuestion} from '../../forms/src/universal-answers.js';

type QuestionIdentity=Pick<UniversalQuestion,'key'|'legacyKeys'|'reusableKey'>;
function matching(answers:readonly ConfirmedAnswer[],question:QuestionIdentity){
 const exactKeys=[question.key,...(question.legacyKeys??[])];
 const relevant=answers.filter(answer=>answer.scope.kind==='general'&&!answer.demo&&(exactKeys.includes(answer.questionPattern)||answer.questionPattern===question.reusableKey));
 return {exact:relevant.filter(answer=>exactKeys.includes(answer.questionPattern)),general:relevant.filter(answer=>answer.questionPattern===question.reusableKey)};
}
/** Review may display a previously confirmed revision, but cannot confirm it. */
export function answerForReview(answers:readonly ConfirmedAnswer[],question:QuestionIdentity):ConfirmedAnswer|undefined{
 const confirmed=answers.filter(answer=>answer.risk==='ordinary'&&answer.confirmedRevision===answer.revision&&!!answer.confirmedAt&&!!answer.answer.trim());
 const {exact,general}=matching(confirmed,question),preferred=exact.length?exact:general;
 return preferred.length===1?preferred[0]:undefined;
}
/** An application-only answer must never replace a reusable answer's identity. */
export function answerForSave(answers:readonly ConfirmedAnswer[],question:QuestionIdentity,reuse:boolean):ConfirmedAnswer|undefined{
 const {exact,general}=matching(answers,question);
 if([...exact,...general].some(answer=>answer.risk!=='ordinary'))throw Error('这道题已有需逐题核对的回答，请先到个人资料核对。');
 if(exact.length>1||general.length>1)throw Error('这个适用范围内已有多个回答，请先到个人资料核对。');
 if(reuse&&question.reusableKey){
  if(exact.length&&general.length)throw Error('这道题已有当前申请和长期回答。请保留当前申请范围，或先到个人资料核对两个回答。');
  return general[0]??exact[0];
 }
 return exact[0];
}
