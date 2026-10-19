import type {Profile,CareerFillOutcome} from '../../packages/shared/src/contracts.js';
interface Field {label:string;type:string;value:string;required?:boolean;editable?:boolean;checked?:boolean;options?:Array<{value:string;label:string}>;}
interface RawGroup {id:string;kind:string;fields:Array<{property:string;side?:string;value:string}>;}
export function auditRealForm(fields:Field[],groups:RawGroup[],profile:Profile,outcome:CareerFillOutcome,visibleErrorCount:number){
 const problems:Array<{section:string;label:string;reason:string}>=[];let careerFieldsVerified=0;
 const keyMap:Record<string,string>={school:'school',degree:'degree',fieldOfStudy:'major',company:'organization',title:'role',desc:'description',name:'name',role:'role',link:'url'};
 for(const collection of ['educations','internships','projects'] as const){
  for(const record of profile.career?.[collection]??[]){
   const bindings=outcome.bindings.filter(b=>b.collection===collection&&b.recordId===record.id),group=bindings.length===1?groups.find(g=>g.id===bindings[0]!.groupId):undefined;
   if(!group){problems.push({section:collection,label:'经历组',reason:'missing-or-ambiguous-binding'});continue;}
   for(const field of group.fields){const key=field.property==='period'?(field.side==='start'?'startDate':field.side==='end'?'endDate':''):keyMap[field.property];const expected=key?(record as unknown as Record<string,unknown>)[key]:undefined;
    if(typeof expected!=='string'||!expected.trim()||field.value.trim()!==expected.trim())problems.push({section:collection,label:field.property==='period'?`period:${field.side}`:field.property,reason:'readback-does-not-match'});else careerFieldsVerified++;
   }
  }
 }
 const expectedGroups=(profile.career?.educations.length??0)+(profile.career?.internships.length??0)+(profile.career?.projects.length??0);
 if(groups.length!==expectedGroups)problems.push({section:'career',label:'经历总数',reason:'unexpected-group-count'});
 const unfilled=fields.filter(f=>{
  if(['hidden','button','submit','reset'].includes(f.type))return false;
  if(['checkbox','radio'].includes(f.type))return !f.checked;
  if(f.type==='file')return !f.value.trim();
  if(f.editable===false)return false;
  if(!f.value.trim()||/^(请选择|请选|选择|YYYY|MM|YYYY-MM|[-—\s]+)$/i.test(f.value.trim()))return true;
  if(f.type==='select'){const selected=f.options?.find(o=>o.value===f.value);return !!selected&&/^(请选择|请选|选择|select|choose)$/i.test(selected.label.trim());}
  return false;
 }).map(f=>({section:'ordinary',label:f.label||'未命名字段',type:f.type,required:f.required??null,reason:['checkbox','radio'].includes(f.type)?'choice-or-declaration-needs-user':f.type==='file'?'attachment-not-provided':'empty-information-field'}));
 const complete=outcome.status==='completed'&&outcome.pending.length===0&&problems.length===0&&unfilled.length===0&&visibleErrorCount===0;
 return {complete,careerFieldsVerified,expectedGroups,observedGroups:groups.length,problems,unfilled,visibleErrorCount};
}
