import type {FieldObservation,Profile,ProfileInput} from '../../shared/src/contracts.js';
/** Bind by an explicit credential in the section, never ordinal position or a model-supplied ID. */
export function resolveEducationField(field:FieldObservation,profile:Profile,key:keyof ProfileInput|undefined):{handled:boolean;value?:string;key?:keyof ProfileInput;reason?:string}{
 const section=field.section??'',label=field.label.normalize('NFKC').replace(/[\s:：*]/g,'');
 const levels=[[/本科|学士|\bbachelor(?:s|'s)?\b/i,'本科'],[/硕士|\bmaster(?:s|'s)?\b/i,'硕士'],[/博士|\bph\.?d\b|doctorate/i,'博士'],[/专科|大专|associate/i,'专科']] as const;
 const scoped=levels.filter(([regex])=>regex.test(section));
 const education=!!scoped.length||/教育|education|学历|学位/i.test(section);
 const start=/^(?:开始时间|开始年月|入学时间|入学年月|起始时间|startdate|startmonth)$/i.test(label);
 const end=/^(?:结束时间|结束年月|毕业时间|毕业年月|enddate|endmonth)$/i.test(label);
 const ordinary=['school','schoolEn','major','majorEn','degree','graduationMonth'].includes(key??'');
 if(!education||(!ordinary&&!start&&!end))return {handled:false};
 if(!scoped.length)return {handled:false};
 const records=(profile.career?.educations??[]).filter(r=>r.confirmation==='confirmed'&&r.confirmedRevision===r.revision&&!!r.confirmedAt&&scoped.length===1&&scoped[0]![0].test(r.degree));
 if(records.length!==1)return {handled:true,reason:'该教育区块没有唯一对应的已确认经历，请先选择记录。'};
 const record=records[0]!,english=/[a-z]/i.test(field.label)&&!/[\u3400-\u9fff]/u.test(field.label);
 const property=start?'startDate':end||key==='graduationMonth'?'endDate':key==='school'&&english&&record.schoolEn?'schoolEn':key==='major'&&english&&record.majorEn?'majorEn':key;
 if(!property||!['school','schoolEn','degree','major','majorEn','startDate','endDate'].includes(property))return {handled:true,reason:'此教育字段尚无可复用事实。'};
 let value=(record as unknown as Record<string,string>)[property]?.trim()??'';
 if((property==='startDate'||property==='endDate')&&field.type!=='date'&&/^\d{4}-\d{2}-\d{2}$/.test(value))value=value.slice(0,7);
 return {handled:true,value,key:start?undefined:ordinary?key:undefined,reason:`来自唯一对应的已确认${scoped[0]![1]}教育记录，修订${record.revision}；执行后核实。`};
}
