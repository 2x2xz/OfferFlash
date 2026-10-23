import type {UniversalResult} from '../../browser/src/universal-form.js';
export interface ApplicationReviewTarget {label:string;section:string;key?:string;}
export interface ApplicationReviewRow extends ApplicationReviewTarget {id:string;reason:string;kind:'action'|'optional'|'declaration'|'review';disposition?:'none'|'skip';}
export function applicationReviewRows(result:UniversalResult):ApplicationReviewRow[]{
 const rows:ApplicationReviewRow[]=(result.remaining??[]).map((f,index)=>({id:'remaining-'+index,label:f.label,section:f.section,key:f.question?.key,reason:f.reason,...(['user-none','user-skipped'].includes(f.reasonCode??'')?{disposition:f.reasonCode==='user-none'?'none' as const:'skip' as const}:{}),kind:['user-none','user-skipped'].includes(f.reasonCode??'')?'optional':/推荐码|内推码|referral.*code/i.test(f.label)?'optional':/声明|已知悉|确认.*真实|同意|consent/i.test(f.label)?'declaration':'action'}));
 for(const [index,draft]of(result.drafts??[]).entries())if(draft.retained&&draft.needsReview&&!rows.some(row=>row.label===draft.label&&row.section===draft.section))rows.push({id:'draft-'+index,label:draft.label,section:draft.section,key:draft.question?.key,reason:'这项是根据已确认资料准备的草稿，请核对官网中的实际内容。',kind:'review'});
 return rows;
}
/** Read only an existing committed city selection, never infer a district or write a path. */
export function confirmedCitySelection(label:string,expected:string,actual:string):boolean{
 if(!/^(?:当前所在城市|现居住城市|意向工作城市|工作意向城市)$/.test(label.trim()))return false;
 const city=(s:string)=>s.trim().replace(/市$/,'');if(!/^[\u4e00-\u9fff]{2,8}$/.test(expected.trim()))return false;
 const parts=actual.trim().split(/[\s/／>›]+/);if(parts.length===1)return city(parts[0]!)===city(expected);
 return parts.length<=3&&parts.length>=2&&/市$/.test(parts[1]!)&&city(parts[1]!)===city(expected);
}
