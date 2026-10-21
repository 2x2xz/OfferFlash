import type {ApplicationFact} from './application-facts.js';
import {matchExistingRecord,type RecordField} from './record-binding.js';

export interface CoverageField extends RecordField {group:string;}
export type RecordCoverageState='matched'|'empty'|'missing'|'ambiguous'|'not-exposed'|'addition-unverified';
export interface RecordCoverage {
 record:string;sourceRecordId?:string;sourceRevision?:number;kind:string;
 state:RecordCoverageState;group?:string;groups:string[];
}
export const structuredRecordKind=(record:string)=>/^(education|internship|project|publication|language|software|award)-\d+$/.exec(record)?.[1];
export const sectionMatchesRecord=(kind:string,section:string)=>{
 // Work and internship are separate destinations even when both ask for a company.
 if(kind==='internship'&&/工作经历|work\s+experience|employment/i.test(section)&&!/实习|internship/i.test(section))return false;
 return new RegExp(({education:'教育|学历|education',internship:'实习|internship',project:'项目|project',publication:'论文|出版|publication',language:'语言|外语|language',software:'软件|工具|software|tools',award:'荣誉|获奖|奖项|award|honou?r'} as Record<string,string>)[kind]??'(?!)','i').test(section);
};

/** Full source inventory, including empty or currently unexposed website sections.
 * Values stay in the host. The projection carries only IDs and record states.
 * DOM order never identifies a nonempty record. */
export function recordCoverage(facts:readonly ApplicationFact[],fields:readonly CoverageField[],exposedKinds:ReadonlySet<string>,bindings:ReadonlyMap<string,string>,pendingAdds:ReadonlySet<string>=new Set()):RecordCoverage[]{
 const records=[...new Set(facts.filter(f=>structuredRecordKind(f.record)).map(f=>f.record))];
 const groups=[...new Set(fields.filter(f=>f.group!=='contact').map(f=>f.group))];
 const matches=new Map(groups.map(group=>[group,matchExistingRecord(fields.filter(f=>f.group===group),facts)]));
 return records.map(record=>{
  const kind=structuredRecordKind(record)!,source=facts.find(f=>f.record===record&&f.sourceRecordId);
  const relevant=groups.filter(group=>fields.some(f=>f.group===group&&sectionMatchesRecord(kind,f.section)));
  const assigned=relevant.filter(group=>bindings.get(group)===record||matches.get(group)===record);
  const empty=relevant.filter(group=>!bindings.has(group)&&!matches.get(group)&&fields.filter(f=>f.group===group).every(f=>['checkbox','radio'].includes(f.type)||!f.value.trim()));
  const ambiguous=relevant.filter(group=>!bindings.has(group)&&!matches.get(group)&&!empty.includes(group));
  const state:RecordCoverageState=assigned.length>1?'ambiguous':assigned.length===1?'matched':pendingAdds.has(kind)?'addition-unverified':ambiguous.length?'ambiguous':empty.length?'empty':exposedKinds.has(kind)||relevant.length?'missing':'not-exposed';
  return {record,...(source?{sourceRecordId:source.sourceRecordId,sourceRevision:source.sourceRevision}:{}),kind,state,group:assigned.length===1?assigned[0]:undefined,groups:assigned.length?assigned:ambiguous.length?ambiguous:empty};
 });
}
