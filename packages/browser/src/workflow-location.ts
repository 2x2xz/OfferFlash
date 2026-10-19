import type { ApplicationWorkflowIssue, FieldObservation, FormObservation, Profile } from '../../shared/src/contracts.js';
import type { CareerFormObservation, CareerPageGroup } from '../../forms/src/career-plan.js';
import { matchProfileKey, matchSelectOption } from '../../forms/src/index.js';
import { FieldLocationError } from './field-location.js';

const text = (value: unknown) => typeof value === 'string' ? value.normalize('NFKC').trim().replace(/\s+/gu,' ') : '';
const labelled = (label: string) => !!text(label) && !/^(?:unknown|undefined|null|需要核对的(?:填写项|项目)|未命名(?:字段|输入框|控件)?|无标签)$/iu.test(text(label));
const stale = () => new FieldLocationError('stale','字段结构已变化，请点“重新读取提示”后再定位。');
const ambiguous = () => new FieldLocationError('ambiguous','当前页面有多个可能的对应位置，请重新读取并核对这条经历，不按序号猜。');

/** Restored issues are read-only hints. Old numeric indices alone never establish a target. */
export function workflowOrdinaryTarget(issue: ApplicationWorkflowIssue, current: FormObservation, profile: Profile): FieldObservation {
  if (issue.scope!=='field' || issue.collection) throw ambiguous();
  if (issue.fieldId && issue.fieldSignature) {
    const found=current.fields.filter(field=>field.id===issue.fieldId&&field.signature===issue.fieldSignature&&(!issue.fieldType||field.type===issue.fieldType));
    if(found.length!==1)throw stale(); return found[0]!;
  }
  const found=current.fields.filter(field=>(!issue.fieldType||field.type===issue.fieldType)
    && (!labelled(issue.label)||text(field.label)===text(issue.label))
    && (!issue.profileField||(() => {
      const key=matchProfileKey(field);
      return key===issue.profileField || !!key && ['fullName','school','major'].includes(key) && `${key}En`===issue.profileField
        && /[a-z]/iu.test(field.label) && !/[\u3400-\u9fff]/u.test(field.label);
    })())
    && (labelled(issue.label)||!!issue.profileField));
  if(found.length!==1)throw ambiguous();return found[0]!;
}

function groupCandidates(group: CareerPageGroup, issue: ApplicationWorkflowIssue, profile: Profile): string[] {
  const records=(profile.career?.[group.collection]??[]).filter(record=>record.confirmation==='confirmed'&&record.confirmedRevision===record.revision&&!!record.confirmedAt);
  let evidence=group.fields.filter(field=>text(field.value)&&field.key!==issue.profileField);
  if(!evidence.length)evidence=group.fields.filter(field=>text(field.value));
  if(!evidence.length) return [];
  return records.filter(record=>evidence.every(field=>{
    if(field.key==='endDate'&&text(field.value)==='至今')return field.type==='feishu-month'&&('current'in record&&record.current===true||'ongoing'in record&&record.ongoing===true)&&!record.endDate;
    const value=text((record as unknown as Record<string,unknown>)[field.key]);
    if(!value)return false;
    return text(field.value)===value||field.key==='degree'&&matchSelectOption(value,field.options??[{label:field.value,value:field.value}],'degree')?.value===field.value;
  })).map(record=>record.id);
}
/** Unique current record correspondence is required even when an old group index still exists. */
export function workflowCareerTarget(issue: ApplicationWorkflowIssue, current: CareerFormObservation, profile: Profile): {groupId:string;fieldId:string;fieldKey:string} {
  if(issue.scope!=='field'||!issue.collection||!issue.recordId)throw ambiguous();
  const groups=current.groups.filter(group=>group.collection===issue.collection);
  // A stale certified identity fails closed. Legacy numeric IDs without a
  // signature are ignored until current facts establish a unique record.
  if(issue.groupId&&issue.groupSignature) {
    const original=groups.filter(group=>group.id===issue.groupId);
    if(original.length!==1||original[0]!.signature!==issue.groupSignature)throw stale();
  }
  const found=groups.filter(group=>{
    const candidates=groupCandidates(group,issue,profile);
    return candidates.length===1&&candidates[0]===issue.recordId;
  });
  if(found.length!==1)throw ambiguous();const group=found[0]!;
  if(issue.groupId&&issue.groupSignature&&group.id!==issue.groupId)throw stale();
  if(issue.groupSignature&&group.signature!==issue.groupSignature)throw stale();
  if(!issue.profileField&&!(issue.fieldId&&issue.fieldSignature))throw ambiguous();
  const fields=group.fields.filter(field=>(!issue.fieldId||!issue.fieldSignature||field.id===issue.fieldId)&&(!issue.profileField||field.key===issue.profileField)
    &&(!issue.fieldType||field.type===issue.fieldType));
  if(fields.length!==1)throw ambiguous();const field=fields[0]!;
  if(issue.fieldSignature&&field.signature!==issue.fieldSignature)throw stale();
  return {groupId:group.id,fieldId:field.id,fieldKey:field.key};
}
