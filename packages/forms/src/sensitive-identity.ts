import type { FieldObservation } from '../../shared/src/contracts.js';
import type { IdentityDocumentKind } from '../../shared/src/sensitive-identity.js';
const aliases:Record<IdentityDocumentKind,readonly string[]>={
  'national-id':['身份证号','身份证号码','居民身份证号码','公民身份号码','nationalidnumber','nationalid','identitycardnumber'],
  passport:['护照号','护照号码','passportnumber','passportno'],
};
const normalize=(value:string)=>value.normalize('NFKC').toLowerCase().replace(/[\s:：*✱∗.]/gu,'');
/** Explicitly named own-document fields only. Generic numbers, other people and existing values are never guessed. */
export function identityDocumentFieldKind(field:Pick<FieldObservation,'label'|'section'|'type'>):IdentityDocumentKind|undefined {
  if(!['text','tel'].includes(field.type)||/家属|家庭|父母|父亲|母亲|配偶|子女|紧急|推荐人|证明人|联系人|担保|parent|spouse|child|emergency|reference|guarantor/iu.test(`${field.section??''} ${field.label}`))return;
  const label=normalize(field.label);return (Object.keys(aliases) as IdentityDocumentKind[]).find(kind=>aliases[kind].includes(label));
}
export function ownEmptyIdentityFields(fields:readonly FieldObservation[],kind:IdentityDocumentKind):FieldObservation[]{
  return fields.filter(field=>field.editable&&!field.value.trim()&&identityDocumentFieldKind(field)===kind);
}
