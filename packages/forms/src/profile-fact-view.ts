import type {Profile} from '../../shared/src/contracts.js';
import type {ApplicationFact} from './application-facts.js';
import {isHighImpactQuestion} from '../../domain/src/application-assets.js';

/** Professional context is read on demand. Contacts, DOB, credentials and raw
 * source documents remain private host values, never model-readable facts. */
export function professionalFact(fact:ApplicationFact):boolean {
  if(fact.record==='contact'||['birthDate','fullName','fullNameEn','email','phone'].includes(fact.kind))return false;
  return fact.kind!=='answer'||!isHighImpactQuestion(fact.label);
}
export function profileFactView(profile:Profile,facts:ApplicationFact[],refs?:string[]) {
  const equivalents=(fact:ApplicationFact)=>{
    if(!['selfAssessment','listeningSpeaking','readingWriting','proficiency'].includes(fact.kind))return undefined;
    return ({'精通':['Proficient','Expert'],'熟练':['Proficient','Skilled'],'流利':['Fluent'],'良好':['Good'],'一般':['Average'],'基础':['Basic'],'入门':['Beginner','Elementary']} as Record<string,string[]>)[fact.value.trim()];
  };
  const redact=(text:string)=>{
    let safe=text;
    for(const value of [profile.fullName,profile.fullNameEn,profile.email,profile.phone,profile.birthDate])if(value?.trim()&&value.trim().length>=3)safe=safe.split(value.trim()).join('[本机私人资料]');
    return safe.replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi,'[本机联系方式]').replace(/\bsk-(?:ws-|proj-|ant-)?[a-z\d._-]{20,}/gi,'[凭据已移除]');
  };
  const selected=facts.filter(fact=>(!refs||refs.includes(fact.ref))&&professionalFact(fact));
  return{profileVersion:profile.version,facts:selected.map(fact=>({ref:fact.ref,record:fact.record,kind:fact.kind,label:redact(fact.label),value:redact(fact.value).slice(0,1200),truncated:fact.value.length>1200,
    ...(fact.sourceRecordId?{sourceRecordId:fact.sourceRecordId}:{}),...(fact.sourceRevision?{sourceRevision:fact.sourceRevision}:{}),...(equivalents(fact)?{displayEquivalents:equivalents(fact),equivalenceSource:'host-wording-hint-not-additional-user-facts'}:{}),source:'user-confirmed'})),
    privateFactRefs:facts.filter(fact=>!professionalFact(fact)).map(fact=>({ref:fact.ref,record:fact.record,kind:fact.kind,label:fact.label,valueOmitted:true})),rawResumeDocumentIncluded:false};
}
