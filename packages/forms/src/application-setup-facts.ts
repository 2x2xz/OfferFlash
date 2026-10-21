import type {ApplicationSetupState} from '../../shared/src/application-setup.js';import type {Profile} from '../../shared/src/contracts.js';import type {ApplicationFact} from './application-facts.js';
/** Host only. Contact-record guidance is excluded by profileFactView before model requests. */
export function appendApplicationSetupFacts(facts:ApplicationFact[],setup:ApplicationSetupState|undefined,profile:Profile,url:string,title:string){
 if(!setup?.confirmedAt)return;const value=setup.value;
 const add=(kind:string,label:string,text:string)=>{if(text.trim())facts.push({ref:'fact-'+facts.length,record:'contact',kind,label,value:text,sourceRecordId:'application-setup',sourceRevision:setup.version});};
 add('applicationHometown','本人确认籍贯',value.hometown);add('applicationPolitics','本人确认政治面貌',value.politicalStatus);
 add('applicationTransfer','本人确认是否接受岗位调剂',value.acceptTransfer==='yes'?'是':value.acceptTransfer==='no'?'否':'');
 add('applicationSource','本人确认招聘信息来源',value.recruitmentSource);add('applicationSourceDetail','本人确认具体来源',value.recruitmentSource);
 add('applicationInterview','本人确认面试方式偏好',value.interviewPreference);
 const companies=value.companyAnswers.filter(item=>item.hasRelatives!=='ask'&&new URL(url).origin===item.origin&&item.company.length>=2&&title.includes(item.company));const company=companies.length===1?companies[0]:undefined;if(company)add('applicationRelatives','本人确认当前公司亲属情况',company.hasRelatives==='yes'?'是':'否');
 for(const policy of value.educations){const record=profile.career?.educations.find(record=>record.id===policy.recordId&&record.revision===policy.sourceRevision&&record.major===policy.major&&record.confirmedRevision===record.revision);if(!record)continue;
  const source=facts.find(fact=>fact.sourceRecordId===record.id);if(!source)continue;
  if(policy.category&&!facts.some(fact=>fact.record===source.record&&fact.kind==='majorCategory'))facts.push({ref:'fact-'+facts.length,record:source.record,kind:'majorCategory',label:'本人确认专业类型',value:policy.category,sourceRecordId:record.id,sourceRevision:record.revision});
  if(policy.awardDate){const date=facts.find(fact=>fact.record==='summary'&&fact.kind==='endDate'&&fact.sourceRecordId===record.id&&fact.sourceRevision===record.revision);if(date)date.value=policy.awardDate;}
 }
}
