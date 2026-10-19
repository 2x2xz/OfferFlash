import { createHash, randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { buildFillPlan, fieldSignature, pageSignature, isVerifiedValue,matchProfileKey } from '../../forms/src/index.js';
import type { FieldObservation, FormObservation, Profile,ProfileInput } from '../../shared/src/contracts.js';
import { BackgroundFillError, type BackgroundDraftResult } from '../../domain/src/application-queue.js';
import { backgroundSnapshot, type BackgroundWriteRequest } from './background-scripts.js';

export interface BackgroundFormTransport {
  read(): Promise<unknown>;
  /** Must atomically compare expectedSnapshot inside the fixed page script before setting one value. */
  write(input: BackgroundWriteRequest): Promise<{status: 'written'|'stale'|'unsupported'|'nonempty'}>;
  getProfile(): Promise<Profile>;
  getURL(): string;
  getGeneration(): number;
  /** Optional read-only clock wait makes deterministic fake transports fast. */
  settle?(ms: number): Promise<void>;
  /** Optional QA metadata only; no values or private URL contents. */
  onGuardStop?(reason:'cancelled'|'url'|'generation'|'profile',planned:boolean):void;
  interruptPending?():void;
}
const allowed = new Set(['text', 'email', 'tel', 'textarea', 'select','month']);
function object(value: unknown): Record<string, any> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('后台网页观察无效。');
  return value as Record<string, any>;
}
export function backgroundFormObservation(raw: unknown, generation: number): FormObservation {
  const source = object(raw);
  if (typeof source.url !== 'string' || !Array.isArray(source.fields) || source.fields.length > 300) throw new Error('后台网页观察无效。');
  const fields = source.fields.map((entry: unknown): FieldObservation => {
    const field = object(entry);
    if (!Number.isInteger(field.index) || field.index < 0 || field.index >= 300 || typeof field.label !== 'string'
      || typeof field.type !== 'string' || typeof field.value !== 'string' || field.value.length > 2000
      || typeof field.identity !== 'string' || !Array.isArray(field.options)) throw new Error('后台字段身份无效。');
    const next: FieldObservation = { id: `field-${field.index}`, index: field.index, label: field.label, type: field.type,
      value: field.value, required: field.required === true, editable: field.editable === true,
      options: field.options, bounds: field.bounds, signature: '', section: typeof field.section === 'string' ? field.section : '',
      ...(typeof field.checked === 'boolean' ? {checked: field.checked} : {}) };
    next.signature = createHash('sha256').update(`${fieldSignature(next)}|${field.identity.slice(0, 500)}`).digest('hex'); return next;
  });
  if (new Set(fields.map(field => field.index)).size !== fields.length) throw new Error('后台字段索引重复。');
  return { id: randomUUID(), url: source.url, title: typeof source.title === 'string' ? source.title : '',
    fields, observedAt: new Date().toISOString(), signature: createHash('sha256').update(`${generation}:${pageSignature(fields)}`).digest('hex') };
}
function expectedAfter(raw: unknown, index: number, value: string): string {
  const next = structuredClone(object(raw));
  const field = next.fields.find((entry: Record<string, unknown>) => entry.index === index);
  if (!field) throw new Error('目标字段已消失。'); field.value = value; return backgroundSnapshot(next);
}

/** Only a stable reindex is recoverable: same ordered fields, exact metadata and
 * values, exact protected state, and unique explicit DOM id/name on moved fields.
 * New/removed fields, option/value/identity changes are not a new authorization. */
export function reconcileBackgroundReindex(before: unknown, after: unknown, index: number, value: string): boolean {
  const expected=JSON.parse(expectedAfter(before,index,value)),fresh=JSON.parse(backgroundSnapshot(after));
  if(object(after).loginRequired||object(after).truncated||object(after).oversizedValue)return false;
  const strip=(snapshot:any)=>({...snapshot,fields:snapshot.fields.map(({index,...field}:any)=>field)});
  if(JSON.stringify(strip(expected))!==JSON.stringify(strip(fresh)))return false;
  if(new Set(fresh.fields.map((f:any)=>f.index)).size!==fresh.fields.length)return false;
  return expected.fields.every((field:any,i:number)=>{
    if(field.index===fresh.fields[i].index)return true;
    const [id,name]=field.identity.split('|');
    return !!(id||name)&&fresh.fields.filter((candidate:any)=>candidate.identity===field.identity).length===1;
  });
}

/** Separate, opt-in DOM path. It never weakens or calls the foreground native executor. */
export async function runBackgroundOrdinaryFill(transport: BackgroundFormTransport, approvedProfile: Profile,
  signal: AbortSignal, progress: (verified: number, pending: number,message?:string) => void, options?: {contactsOnly?:boolean;
    modelMappings?:ReadonlyMap<string,keyof ProfileInput>;expectedSnapshot?:string;expectedGeneration?:number;
    /** Evaluation-only ablation of preparation waits. All write guards remain. */
    stablePreparation?:boolean}): Promise<BackgroundDraftResult> {
  approvedProfile = structuredClone(approvedProfile);
  const url = transport.getURL(), generation = transport.getGeneration();
  let planned=false;
  const stop=(reason:'cancelled'|'url'|'generation'|'profile'):never=>{
    try{transport.onGuardStop?.(reason,planned);}catch{/* Diagnostics never change execution. */}
    throw new BackgroundFillError('context-changed');
  };
  const assertCurrent = async (): Promise<void> => {
    if(signal.aborted)stop('cancelled');if(transport.getURL()!==url)stop('url');if(transport.getGeneration()!==generation)stop('generation');
    if((await transport.getProfile()).version!==approvedProfile.version)stop('profile');
    if(signal.aborted)stop('cancelled');if(transport.getURL()!==url)stop('url');if(transport.getGeneration()!==generation)stop('generation');
  };
  const wait = (ms: number) => transport.settle ? transport.settle(ms) : delay(ms, undefined, {signal});
  await assertCurrent();
  if(options?.expectedGeneration!==undefined&&options.expectedGeneration!==generation)throw new BackgroundFillError('context-changed');
  let raw = await transport.read();
  // Read-only preparation, before any plan or input. Require three consecutive
  // identical nonempty snapshots, bounded to 1.2s of waits. Never rebaseline after
  // a write or extend an existing input authorization when the website changes.
  let stable = 0;
  for (let sample = 0; options?.stablePreparation!==false&&sample < 8; sample++) {
    await assertCurrent();
    if (object(raw).loginRequired === true) break;
    await wait(150);
    await assertCurrent();
    const fresh = await transport.read();
    await assertCurrent();
    stable = object(fresh).fields?.length && backgroundSnapshot(fresh) === backgroundSnapshot(raw) ? stable + 1 : 0;
    raw = fresh;
    if (stable >= 2) break;
    if (sample === 7) throw new BackgroundFillError('page-changing');
  }
  if (object(raw).loginRequired === true) return { verifiedCount: 0, pendingCount: 1, canReview: true, attention: 'login', message: '需要你先登录；不会读取或填写密码、验证码' };
  if(object(raw).truncated===true||object(raw).oversizedValue===true)return {verifiedCount:0,pendingCount:1,canReview:true,message:'此页超出后台可核对范围，请在前台处理'};
  if(options?.expectedSnapshot!==undefined&&backgroundSnapshot(raw)!==options.expectedSnapshot)throw new BackgroundFillError('page-changing');
  const initialRaw=structuredClone(raw);
  const original = backgroundFormObservation(raw, generation);
  const plan = buildFillPlan(original, approvedProfile,options?.modelMappings);
  planned=true;
  // A DOM month setter has an unambiguous YYYY-MM contract. Reuse confirmed
  // default-education mapping, without changing the foreground native planner.
  const monthObservation=structuredClone(original);
  for(const field of monthObservation.fields)if(field.type==='month'&&matchProfileKey(field)==='graduationMonth')field.type='text';
  const monthPlan=buildFillPlan(monthObservation,approvedProfile,options?.modelMappings);
  plan.items=plan.items.map(item=>{
    const field=original.fields.find(field=>field.id===item.fieldId),candidate=monthPlan.items.find(candidate=>candidate.fieldId===item.fieldId);
    return field?.type==='month'&&item.status==='review'&&candidate?.status==='ready'&&candidate.profileKey==='graduationMonth'
      &&/^\d{4}-(?:0[1-9]|1[0-2])$/.test(candidate.value)?candidate:item;
  });
  if(options?.modelMappings)plan.items=plan.items.map(item=>item.status==='ready'&&!options.modelMappings!.has(item.fieldId)
    ?{...item,status:'review',value:'',reason:'模型没有确认这个字段的对应关系，保持空白。'}:item);
  let verifiedCount = 0;
  const contactKeys=new Set(['fullName','fullNameEn','email','phone']);
  let pendingCount = options?.contactsOnly?0:plan.items.filter(item => item.status === 'review').length;
  const ready = plan.items.filter(item => item.status === 'ready'&&(!options?.contactsOnly||contactKeys.has(item.profileKey??'')));
  if (!original.fields.length) return { verifiedCount: 0, pendingCount: 1, canReview: true, message: '尚未进入可填写申请表，请打开草稿登录或进入申请页' };
  for (const item of ready) {
    // Binding follows the original explicit identity after a previously proved reindex.
    const sourceField=object(initialRaw).fields.find((candidate:any)=>candidate.index===original.fields.find(f=>f.id===item.fieldId)!.index);
    const matches=object(raw).fields.filter((candidate:any)=>candidate.identity===sourceField.identity&&candidate.label===sourceField.label&&candidate.type===sourceField.type&&candidate.section===sourceField.section);
    if(matches.length!==1)throw new BackgroundFillError('page-changing');
    const field=matches[0];
    if (!allowed.has(field.type)) { pendingCount++; continue; }
    let written = false;
    // At most two attempts. Retry requires proof that the first write left the entire snapshot unchanged.
    for (let attempt = 0; attempt < 2 && !written; attempt++) {
      await assertCurrent();
      if(attempt===1)progress(verifiedCount,pendingCount,'重新核对并重试当前字段');
      const before = backgroundSnapshot(raw);
      const fresh = await transport.read();
      await assertCurrent();
      if (backgroundSnapshot(fresh) !== before) throw new BackgroundFillError('page-changing');
      const result = await transport.write({url, index: field.index, value: item.value, expectedSnapshot: before});
      if (result.status !== 'written') { pendingCount++; break; }
      await wait(80); await assertCurrent();
      const after = await transport.read();
      const expected = expectedAfter(raw, field.index, item.value);
      if (backgroundSnapshot(after) === expected || options?.stablePreparation!==false&&reconcileBackgroundReindex(raw,after,field.index,item.value)) {
        await wait(180); await assertCurrent();
        const settled = await transport.read();
        if (backgroundSnapshot(settled) !== backgroundSnapshot(after)) throw new BackgroundFillError('value-not-retained');
        const rebound=object(settled).fields.find((candidate:any)=>candidate.identity===field.identity&&candidate.label===field.label&&candidate.type===field.type&&candidate.section===field.section);
        const actual = backgroundFormObservation(settled, generation).fields.find(candidate => candidate.index === rebound?.index);
        if (!actual || !isVerifiedValue(actual.value, item.value, field.type)) throw new BackgroundFillError('value-not-retained');
        if (object(settled).validity?.[actual.index]===false) throw new BackgroundFillError('validation');
        raw = settled; verifiedCount++; written = true;
      } else if (backgroundSnapshot(after) !== before || attempt === 1) {
        throw new BackgroundFillError('value-not-retained');
      }
    }
    progress(verifiedCount, pendingCount);
  }
  await assertCurrent();
  // Unsupported skip controls still require user review; never call an incomplete form completed.
  const manual = original.fields.filter(field => !allowed.has(field.type) && field.type !== 'hidden' && !field.value.trim());
  if(!options?.contactsOnly)pendingCount += manual.filter(field => !ready.some(item => item.fieldId === field.id)).length;
  const missingLabels:Record<string,string>={fullName:'姓名',fullNameEn:'英文姓名',email:'邮箱',phone:'电话',school:'学校',schoolEn:'学校英文名',degree:'学历',major:'专业',majorEn:'专业英文名',graduationMonth:'毕业月份'};
  const missing=[...new Set(plan.items.filter(item=>item.status==='review'&&item.reason==='个人资料中没有已确认值。')
    .map(item=>missingLabels[item.profileKey??'']).filter((label):label is string=>!!label))];
  return {verifiedCount, pendingCount, canReview: true,
    ...(missing.length?{attention:'info' as const}:{}),
    message: missing.length ? `已核对 ${verifiedCount} 项；请在个人资料补充并确认${missing.join('、')}，再继续填写。其余未支持项请检查；未提交。`
      : pendingCount ? `已核对 ${verifiedCount} 项，仍有 ${pendingCount} 项需你检查；未提交` : `已核对 ${verifiedCount} 项普通字段，请检查后自行提交`};
}
