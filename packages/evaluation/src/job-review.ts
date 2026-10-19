/** Offline review collection. Neither a checkbox nor this validator authenticates independent human judgment. */
export interface JobReviewItem {
  id: string; url: string; company: string; title: string; city: string;
  description: string; requirements: string; contentHash: string;
}
export interface JobReviewSnapshot { snapshotHash: string; profileSnapshotHash?: string | null; items: JobReviewItem[]; }
export interface ReviewedJobLabel {
  id: string; contentHash: string; relevance: 0 | 1 | 2 | 3 | null;
  eligibility: 'eligible' | 'ineligible' | 'unknown' | null;
  rationale: string; reviewedAt: string | null; humanOperated: boolean;
}
export interface ReviewedJobLabels {
  schemaVersion: 1; kind: 'offerflash-job-review'; snapshotHash: string; profileSnapshotHash: string | null; reviewer: string;
  reviewedAt: string | null; humanOperated: boolean; items: ReviewedJobLabel[];
}
export interface ReviewedLabelValidation {
  valid: boolean; errors: string[]; reviewedCount: number; unreviewedCount: number;
  allItemsConfirmed: boolean; humanOperationVerified: false; requiresIndependentVerification: true;
  data: ReviewedJobLabels | null;
}
const digest = (value: unknown): value is string => typeof value === 'string' && /^[a-f0-9]{64}$/u.test(value);
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const exactKeys = (value: Record<string, unknown>, expected: readonly string[]) => Object.keys(value).length === expected.length && expected.every(key => Object.hasOwn(value, key));
const alias = (value: unknown): value is string => typeof value === 'string' && /^[A-Za-z][A-Za-z0-9_-]{0,47}$/u.test(value);
const timestamp = (value: unknown): value is string => typeof value === 'string' && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;

function validateSnapshot(snapshot: JobReviewSnapshot): void {
  if (!object(snapshot) || !digest(snapshot.snapshotHash) || (snapshot.profileSnapshotHash != null && !digest(snapshot.profileSnapshotHash))
    || !Array.isArray(snapshot.items) || snapshot.items.length > 1000) throw new Error('Invalid job review snapshot');
  const ids = new Set<string>(); let characters = 0;
  for (const item of snapshot.items) {
    if (!object(item) || typeof item.id !== 'string' || !item.id.trim() || item.id.length > 200 || /[\u0000-\u001f\u007f]/u.test(item.id)
      || ids.has(item.id) || !digest(item.contentHash)) throw new Error('Invalid or duplicate job review identity');
    ids.add(item.id);
    for (const key of ['url', 'company', 'title', 'city', 'description', 'requirements'] as const) {
      if (typeof item[key] !== 'string' || item[key].length > (key === 'description' || key === 'requirements' ? 200_000 : 3000)) throw new Error('Invalid job review text');
      characters += item[key].length;
    }
  }
  if (characters > 8_000_000) throw new Error('Job review snapshot is too large');
}

/** Syntax checks cannot establish that a public hostname is an authentic employer source. */
export function safeJobReviewSourceURL(value: string): string | null {
  try {
    const url = new URL(value), host = url.hostname.toLowerCase();
    if (url.protocol !== 'https:' || url.username || url.password || !host.includes('.') || /[:\[\]]/u.test(host)
      || /^[\d.]+$/u.test(host) || /(?:^|\.)(?:localhost|local|invalid|test|example)$/u.test(host)) return null;
    return url.href;
  } catch { return null; }
}

/**
 * Checks integrity and record consistency only. Real human operation, CV provenance and reviewer
 * independence require separate review; never promote this result to an authenticated gold label.
 */
export function validateReviewedLabels(value: unknown, snapshot: JobReviewSnapshot): ReviewedLabelValidation {
  const errors: string[] = [];
  const itemCount = object(snapshot) && Array.isArray(snapshot.items) ? snapshot.items.length : 0;
  const result = (data: ReviewedJobLabels | null, reviewedCount = 0): ReviewedLabelValidation => ({
    valid: errors.length === 0, errors, reviewedCount, unreviewedCount: itemCount - reviewedCount,
    allItemsConfirmed: errors.length === 0 && itemCount > 0 && reviewedCount === itemCount,
    humanOperationVerified: false, requiresIndependentVerification: true, data,
  });
  try { validateSnapshot(snapshot); } catch { errors.push('invalid-snapshot'); return result(null); }
  if (!object(value) || !exactKeys(value, ['schemaVersion', 'kind', 'snapshotHash', 'profileSnapshotHash', 'reviewer', 'reviewedAt', 'humanOperated', 'items'])
    || value.schemaVersion !== 1 || value.kind !== 'offerflash-job-review' || value.snapshotHash !== snapshot.snapshotHash
    || value.profileSnapshotHash !== (snapshot.profileSnapshotHash ?? null)
    || !Array.isArray(value.items) || value.items.length !== snapshot.items.length || typeof value.humanOperated !== 'boolean') {
    errors.push('invalid-review-envelope'); return result(null);
  }
  if (typeof value.reviewer !== 'string' || (value.reviewer !== '' && !alias(value.reviewer))) errors.push('invalid-anonymous-reviewer');
  const expected = new Map(snapshot.items.map(item => [item.id, item.contentHash])), seen = new Set<string>();
  let confirmed = 0; const dates: string[] = [];
  for (const row of value.items) {
    if (!object(row) || !exactKeys(row, ['id', 'contentHash', 'relevance', 'eligibility', 'rationale', 'reviewedAt', 'humanOperated'])
      || typeof row.id !== 'string' || seen.has(row.id) || !expected.has(row.id) || row.contentHash !== expected.get(row.id)
      || typeof row.humanOperated !== 'boolean') { errors.push('invalid-review-item-binding'); continue; }
    seen.add(row.id);
    if (row.humanOperated) {
      if (![0, 1, 2, 3].includes(row.relevance as number) || !['eligible', 'ineligible', 'unknown'].includes(row.eligibility as string)
        || typeof row.rationale !== 'string' || !row.rationale.trim() || row.rationale.length > 4000 || !timestamp(row.reviewedAt) || !alias(value.reviewer)) {
        errors.push('invalid-confirmed-label'); continue;
      }
      confirmed++; dates.push(row.reviewedAt);
    } else if (row.relevance !== null || row.eligibility !== null || row.rationale !== '' || row.reviewedAt !== null) errors.push('unconfirmed-label-must-be-null');
  }
  if (seen.size !== expected.size) errors.push('incomplete-review-item-set');
  const last = dates.sort().at(-1) ?? null;
  if (value.humanOperated !== (confirmed > 0) || value.reviewedAt !== last) errors.push('inconsistent-review-confirmation');
  if (errors.length) return result(null);
  // Return a detached DTO, never a reference that can later acquire a CV or hidden fields.
  return result(JSON.parse(JSON.stringify(value)) as ReviewedJobLabels, confirmed);
}

const safeJson = (value: unknown): string => JSON.stringify(value).replace(/[<>&\u2028\u2029]/gu,
  character => ({ '<': '\\u003c', '>': '\\u003e', '&': '\\u0026', '\u2028': '\\u2028', '\u2029': '\\u2029' })[character]!);

// Owned static code: source text enters textContent only. The CV element is never read by exportReview.
const reviewScript = String.raw`
'use strict';
(function () {
 const snapshot = JSON.parse(document.getElementById('job-review-data').textContent);
 const reviewer = document.getElementById('reviewer-alias');
 const cv = document.getElementById('comparison-cv');
 const host = document.getElementById('job-cards');
 const count = document.getElementById('review-count');
 const message = document.getElementById('review-message');
 const preview = document.getElementById('export-preview');
 const profileBinding = document.getElementById('profile-binding');
 profileBinding.textContent=snapshot.profileSnapshotHash?'本轮简历哈希 · 末8位 '+snapshot.profileSnapshotHash.slice(-8)+'。请只针对对应的简历文件标注；更换简历须重新生成此页。临时文本框不会改变或验证绑定的文件摘要。':'未绑定简历哈希：这些标签不能跨CV复用。正式比较前须另外绑定同一份简历；本页不验证你临时对照的是哪份CV。';
 const states = [];
 function element(tag,text,className) { const node=document.createElement(tag); if(text!==undefined)node.textContent=String(text); if(className)node.className=className; return node; }
 function validAlias() { return /^[A-Za-z][A-Za-z0-9_-]{0,47}$/.test(reviewer.value.trim()); }
 function label(text,control) { const node=element('label',text); node.append(control); return node; }
 function choice(id,values) { const select=element('select');select.id=id; const empty=element('option','未评阅');empty.value='';select.append(empty);values.forEach(function(pair){const option=element('option',pair[1]);option.value=pair[0];select.append(option);});select.value='';return select; }
 function exportReview() {
  const items=states.map(function(state){return state.confirmed?Object.assign({},state.confirmed):{id:state.item.id,contentHash:state.item.contentHash,relevance:null,eligibility:null,rationale:'',reviewedAt:null,humanOperated:false};});
  const confirmed=items.filter(function(item){return item.humanOperated;});
  const dates=confirmed.map(function(item){return item.reviewedAt;}).sort();
  return {schemaVersion:1,kind:'offerflash-job-review',snapshotHash:snapshot.snapshotHash,profileSnapshotHash:snapshot.profileSnapshotHash,reviewer:validAlias()?reviewer.value.trim():'',reviewedAt:dates.length?dates[dates.length-1]:null,humanOperated:confirmed.length>0,items:items};
 }
 function refresh() { const value=exportReview();const n=value.items.filter(function(item){return item.humanOperated;}).length;count.textContent='已逐条确认 '+n+' / '+states.length+' · 未评 '+(states.length-n)+' 项保持 null · 本页不生成评分';preview.textContent=JSON.stringify(value,null,2); }
 function invalidate(state) { state.confirmed=null;state.check.checked=false;state.status.textContent='尚未确认；草稿选择不会作为已人工标注导出。'; }
 function resetConfirmations() { states.forEach(invalidate);message.textContent='对照材料或评阅别名已变更，请重新核对各条；原确认已撤销。';refresh(); }
 snapshot.items.forEach(function(item,index) {
  const card=element('article',undefined,'job-card');card.id='job-card-'+index;
  card.append(element('h2',(index+1)+'. '+item.title));card.append(element('p',item.company+' · '+item.city,'job-meta'));
  if(item.sourceURL){const link=element('a','手动打开 HTTPS 来源（会离开本地页）');link.href=item.sourceURL;link.target='_blank';link.rel='noopener noreferrer';link.referrerPolicy='no-referrer';card.append(link);}else card.append(element('p','来源链接未启用：仅允许无凭据的公开 HTTPS 地址。','notice'));
  const source=element('details');source.open=true;source.append(element('summary','完整职责与任职要求'));
  source.append(element('h3','岗位职责'));source.append(element('pre',item.description||'（原快照未提供）','source-text'));source.append(element('h3','任职要求'));source.append(element('pre',item.requirements||'（原快照未提供）','source-text'));card.append(source);
  const form=element('div',undefined,'review-fields');
  const relevance=choice('relevance-'+index,[['0','0 · 核心职责无关'],['1','1 · 局部能力或相邻方向'],['2','2 · 相关且有可迁移证据'],['3','3 · 直接覆盖核心职责']]);
  const eligibility=choice('eligibility-'+index,[['eligible','满足已核实资格'],['ineligible','明确不满足资格'],['unknown','资格未知 / 证据不足']]);
  form.append(label('语义相关性（资格单独判断）',relevance));form.append(label('资格判断',eligibility));
  const reason=element('textarea');reason.id='rationale-'+index;reason.rows=3;reason.maxLength=4000;reason.placeholder='指出CV能力与岗位要求的依据，以及资格未知或冲突；不要粘贴整份CV或个人联系方式。';form.append(label('判断理由（必填）',reason));
  const check=element('input');check.id='human-confirm-'+index;check.type='checkbox';check.checked=false;
  form.append(label(snapshot.profileSnapshotHash?'本人已对照本轮绑定的简历文件阅读该岗位，并独立作出以上判断；不是自动生成标签。':'本人已阅读该岗位并独立作出以上判断；不是自动生成标签。未绑定CV，标签不能跨CV复用。',check));
  const confirm=element('button','确认这一条');confirm.id='confirm-'+index;confirm.type='button';form.append(confirm);
  const status=element('p','尚未确认；草稿选择不会作为已人工标注导出。','notice');status.id='label-status-'+index;form.append(status);card.append(form);host.append(card);
  const state={item:item,relevance:relevance,eligibility:eligibility,reason:reason,check:check,status:status,confirmed:null};states.push(state);
  [relevance,eligibility,reason].forEach(function(control){control.addEventListener(control===reason?'input':'change',function(){invalidate(state);refresh();});});
  check.addEventListener('change',function(){if(!check.checked){invalidate(state);refresh();}});
  confirm.addEventListener('click',function(){
   if(!validAlias()){status.textContent='请先填写匿名评阅别名，例如 reviewer-A；不要写姓名、邮箱或电话。';return;}
   if(relevance.value===''||eligibility.value===''||!reason.value.trim()||reason.value.length>4000||!check.checked){status.textContent='请选择两类判断、写明理由，并明确勾选本人已阅读后再确认。';return;}
   state.confirmed={id:item.id,contentHash:item.contentHash,relevance:Number(relevance.value),eligibility:eligibility.value,rationale:reason.value.trim(),reviewedAt:new Date().toISOString(),humanOperated:true};
   status.textContent='已记录你的明确确认；仍需另行核实评阅者独立性，本页不能认证真实人工操作。';refresh();
  });
 });
 reviewer.addEventListener('input',resetConfirmations);cv.addEventListener('input',resetConfirmations);
 document.getElementById('clear-cv').addEventListener('click',function(){cv.value='';resetConfirmations();});
 document.getElementById('download-review').addEventListener('click',function(){const value=exportReview();const blob=new Blob([JSON.stringify(value,null,2)+'\n'],{type:'application/json;charset=utf-8'});const url=URL.createObjectURL(blob);const anchor=element('a');anchor.href=url;anchor.download='offerflash-review-'+snapshot.snapshotHash.slice(0,12)+'.json';anchor.click();setTimeout(function(){URL.revokeObjectURL(url);},1000);message.textContent='下载只包含已确认标签及快照摘要；未评为 null。CV文本未写入导出。确认声明不能代替独立人工复核。';});
 refresh();
}());
`;

/** One local HTML file, no assets, network, persistence, auto file reads or model-generated labels. */
export function renderJobReviewHtml(snapshot: JobReviewSnapshot): string {
  validateSnapshot(snapshot);
  const data = { snapshotHash: snapshot.snapshotHash, profileSnapshotHash: snapshot.profileSnapshotHash ?? null, items: snapshot.items.map(item => ({
    id: item.id, contentHash: item.contentHash, company: item.company, title: item.title, city: item.city,
    description: item.description, requirements: item.requirements, sourceURL: safeJobReviewSourceURL(item.url),
  })) };
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src 'none'; connect-src 'none'; base-uri 'none'; form-action 'none'; object-src 'none'; frame-src 'none'">
<title>OfferFlash · 本地岗位盲评</title><style>
:root{color-scheme:dark;font-family:system-ui,-apple-system,sans-serif;background:#0b1120;color:#e0eafa;line-height:1.6}*{box-sizing:border-box}body{margin:0}main{max-width:1500px;padding:30px 24px;margin:auto}header{border-bottom:2px solid #78c9fa;padding-bottom:16px}h1{margin:0;font-size:28px}h2{font-size:20px;margin:0 0 8px}h3{font-size:15px;color:#abd9f7}p{margin:8px 0}.warning{padding:15px;border:1px solid #d79c49;background:#281f16;color:#ffdaa5}.layout{display:grid;grid-template-columns:minmax(270px,340px) minmax(0,1fr);gap:22px;margin-top:22px}.comparison{align-self:start;position:sticky;top:18px;border:1px solid #3b516c;padding:18px;background:#121e30}.job-card{border:1px solid #334c69;padding:22px;background:#101c2e;margin-bottom:20px}.job-meta,.notice{font-size:13px;color:#b7c8e0}.source-text{white-space:pre-wrap;overflow-wrap:anywhere;background:#0b1422;padding:12px;font:14px/1.65 system-ui;max-height:none;margin:6px 0}.review-fields{margin-top:18px;border-top:1px dashed #4f6783;padding-top:16px}label{display:block;font-size:14px;margin:12px 0}input:not([type=checkbox]),textarea,select{display:block;width:100%;margin-top:7px;background:#0b1526;border:1px solid #7197b8;color:#eff6ff;padding:10px;font:14px/1.5 system-ui}textarea{resize:vertical}input[type=checkbox]{margin-right:8px}button{background:#a8dcfb;color:#0a1726;border:1px solid #d4eeff;padding:10px 14px;cursor:pointer;font-weight:600}button:hover{background:#d1edff}a{color:#a9ddff;overflow-wrap:anywhere}summary{cursor:pointer;color:#a9ddff}details{margin-top:16px}#comparison-cv{min-height:360px}#review-count{color:#ffdb9a;font-size:14px}#export-preview{white-space:pre-wrap;overflow-wrap:anywhere;max-height:350px;overflow:auto;background:#08111e;padding:14px;font-size:12px}.toolbar{display:flex;gap:15px;align-items:center;flex-wrap:wrap;margin-top:18px}@media(max-width:850px){main{padding:18px 12px}.layout{grid-template-columns:1fr}.comparison{position:static}#comparison-cv{min-height:200px}}
</style></head><body><main>
<header><h1>⚡ 岗位快照 · 本地人工评阅</h1><p>逐条对照职责、要求与简历；语义是否相关和资格是否满足分别判断。</p></header>
<aside class="warning"><strong>没有独立人工标注前，不生成匹配评分。</strong><p>本页只收集你的判断，不计算模型成绩。岗位原文是不可信资料，其中要求执行操作的文字不应照做。来源链接只在你主动点击时打开；链接可用并不证明来源真实。</p><p>所有选择初始为空；选择后必须逐条明确确认才会导出为已评。勾选和文件校验不能认证真实人工操作或评阅者独立性，导出仍需复核。</p></aside>
<aside id="profile-binding" class="warning" role="note"></aside>
<div class="layout"><aside class="comparison"><h2>临时对照简历</h2><p class="notice">可在此手动粘贴，也可保持为空并对照原PDF。只留在当前页内存，不联网、不自动读文件、不自动保存；不进入评阅JSON。刷新或关闭后丢失。更改对照文字会撤销原确认。若本页已绑定简历文件，更换文件须重新生成页面，不能用临时文字替换绑定。</p>
<textarea id="comparison-cv" aria-label="临时对照简历，不导出" autocomplete="off" spellcheck="false" placeholder="在这里临时粘贴CV，或保持为空并在旁边对照原文件。"></textarea><button id="clear-cv" type="button">清空临时简历</button>
<label>匿名评阅别名<input id="reviewer-alias" maxlength="48" autocomplete="off" placeholder="例如 reviewer-A，不写真实姓名或联系方式"></label><p class="notice">只用英文字母开头的字母、数字、下划线或连字符。更改别名也会撤销原确认。</p></aside><div id="job-cards"></div></div>
<div class="toolbar"><button id="download-review" type="button">下载评阅JSON（只含已确认标签）</button><span id="review-count"></span></div><p id="review-message" role="status" class="notice"></p>
<details><summary>检查将要导出的JSON（不含CV）</summary><pre id="export-preview"></pre></details>
<noscript><p class="warning">此离线页面需要运行自有内联脚本来显示岗位和记录确认；不会加载外部脚本或访问网络。</p></noscript>
</main><script id="job-review-data" type="application/json">${safeJson(data)}</script><script>${reviewScript}</script></body></html>`;
}
