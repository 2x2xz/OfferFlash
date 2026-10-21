import {factFitsField, optionMatchesFact, displayedFactMatches, type ApplicationFact} from './application-facts.js';

export interface RecordField {label:string;type:string;section:string;value:string;}
const clean=(s:string)=>s.normalize('NFKC').toLowerCase().replace(/[\s‐‑–—-]/gu,'').trim();
// A short parsed title and its full source title may share the same explicit title head.
const titleHead=(s:string)=>clean(s.split(/[|｜\n]/u)[0]!);
export function inferRecordSection(fields:readonly Pick<RecordField,'label'>[]):string {
  const kinds=new Set<string>();
  for(const {label} of fields){
    if(/学校名称|学校|院校|university|institution|^school\s*\*?$/i.test(label))kinds.add('教育经历');
    // Company alone cannot distinguish employment from internship.
    if(/实习单位|实习公司|internship.company|internship.employer/i.test(label))kinds.add('实习经历');
    if(/项目名称|project.name|project.title/i.test(label))kinds.add('项目经历');
    if(/语种|语言类型|语言名称|language.name/i.test(label))kinds.add('语言能力');
    if(/软件名称|工具名称|software.name|tool.name/i.test(label))kinds.add('软件与工具');
    if(/荣誉名称|奖项名称|award.name|honou?r.name/i.test(label))kinds.add('所获荣誉');
  }
  return kinds.size===1?[...kinds][0]!:'';
}
/** Identity comes before dates. Shared dates and mixed descriptions must not select a record. */
export function matchExistingRecord(fields:readonly RecordField[],facts:readonly ApplicationFact[]):string|undefined {
  const nonempty=fields.filter(f=>!['checkbox','radio'].includes(f.type)&&f.value.trim());
  if(!nonempty.length)return undefined;
  const primary=['school','schoolEn','organization','name','title','url','language','softwareName','awardName'];
  const identityFields=fields.filter(f=>facts.some(a=>primary.includes(a.kind)&&factFitsField(a,f)));
  // This usually means the chosen DOM container spans multiple records.
  if(identityFields.some(f=>identityFields.filter(o=>o!==f&&o.label===f.label).length))return undefined;
  const records=[...new Set(facts.filter(f=>f.record!=='contact').map(f=>f.record))];
  const strong=records.filter(record=>facts.filter(a=>a.record===record&&primary.includes(a.kind)).some(a=>nonempty.some(f=>
    factFitsField(a,f)&&(a.kind==='name'||a.kind==='title'?titleHead(f.value)===titleHead(a.value):clean(f.value)===clean(a.value)||displayedFactMatches(a,f.value)))));
  if(strong.length===1)return strong[0];
  if(strong.length>1){
    const roleMatched=strong.filter(record=>facts.some(fact=>fact.record===record&&fact.kind==='role'&&nonempty.some(field=>factFitsField(fact,field)&&clean(field.value)===clean(fact.value))));
    if(roleMatched.length===1)return roleMatched[0];
  }
  // A partially filled education may contain only its major after an earlier
  // failed school selector. A unique exact major is discriminative; shared
  // dates/degree and row order are not. Never ignore a conflicting identity.
  if(!strong.length&&identityFields.every(field=>!field.value.trim())){
    const majorFields=nonempty.filter(field=>facts.some(fact=>fact.kind==='major'&&factFitsField(fact,field)));
    if(majorFields.length===1){
      const byMajor=records.filter(record=>facts.some(fact=>fact.record===record&&fact.kind==='major'&&factFitsField(fact,majorFields[0]!)&&displayedFactMatches(fact,majorFields[0]!.value)));
      if(byMajor.length===1)return byMajor[0];
    }
  }
  // Some application templates expose only a long description and dates,
  // with no project/company name field. A unique explicit title or long exact
  // source prefix identifies that record; common dates and roles never do.
  if(!strong.length&&identityFields.every(field=>!field.value.trim())){
    const prose=nonempty.filter(field=>field.type==='textarea'&&/描述|职责|description|responsibilit/i.test(field.label));
    if(!prose.some(field=>prose.some(other=>other!==field&&other.label===field.label))){
      const text=(value:string)=>clean(value).replace(/[\p{P}\p{S}]/gu,'');
      const identified=records.filter(record=>facts.some(fact=>fact.record===record&&fact.kind==='description'&&text(fact.value).length>=100&&prose.some(field=>factFitsField(fact,field)&&text(field.value).includes(text(fact.value).slice(0,120)))));
      if(identified.length===1)return identified[0];
    }
  }
  // Only education may corroborate a malformed school using degree + major/date.
  // Dates alone cannot identify a project or an internship.
  const candidates=(strong.length?strong:records).filter(record=>record.startsWith('education-'));
  const weak=candidates.map(record=>({record,kinds:new Set(facts.filter(a=>a.record===record&&['startDate','endDate','degree','major'].includes(a.kind)&&nonempty.some(f=>factFitsField(a,f)&&optionMatchesFact(f.value,a.value))).map(a=>a.kind))}));
  const matches=weak.filter(item=>item.kinds.size>=2);
  return matches.length===1?matches[0]!.record:undefined;
}
