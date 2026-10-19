import type {FieldObservation} from '../../shared/src/contracts.js';

/** A normal full-name fact cannot answer a conditional or alternative identity question.
 * This intentionally does not reject an unconditional legal/full-name label. */
export function conditionalNameReview(field: Pick<FieldObservation,'label'|'section'>): string | null {
 const label=field.label.normalize('NFKC');
 const context=label+' '+(field.section??'').normalize('NFKC');
 if(!/姓名|名字|称呼|曾用名|别名|原名|\bname\b|\bnames\b/i.test(label))return null;
 if(/\bif\s+(?:different|applicable|yes|any)\b|\bonly\s+if\b|\b(?:different|other|previous|former|alternate|alternative|maiden)\s+(?:(?:legal|full)\s+)?names?\b|\bnames?\s+(?:used|previously)\b|如.{0,12}(?:不同|适用|有)|若.{0,12}(?:不同|适用|有)|如果|曾用名|曾用姓名|其他姓名|其它姓名|别名|原名/i.test(context))
   return '此题需要单独确认是否适用及对应姓名；现有完整姓名不能代替，请补充确认或按网站要求手动处理。';
 return null;
}
