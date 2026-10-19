import type { BenchmarkReport } from './contracts.js';

const escape = (value: unknown): string => String(value ?? '').replace(/[&<>"']/gu, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]!);
const safeJson = (value: unknown): string => JSON.stringify(value).replace(/[<>&\u2028\u2029]/gu,
  character => ({ '<': '\\u003c', '>': '\\u003e', '&': '\\u0026', '\u2028': '\\u2028', '\u2029': '\\u2029' })[character]!);

// Static owned script. Report strings enter DOM exclusively via textContent, never innerHTML or generated code.
const dashboardScript = String.raw`
'use strict';
(function () {
 const data = JSON.parse(document.getElementById('report-data').textContent);
 const allRows = data.matching.concat(data.forms, data.retrieval);
 const engines = Array.from(new Set(allRows.map(function(r){ return r.engine; }))).sort();
 const splits = Array.from(new Set(allRows.map(function(r){ return r.split; }))).sort();
 const engineSelect = document.getElementById('engine-filter');
 const splitSelect = document.getElementById('split-filter');
 function element(tag, text, className) { const node = document.createElement(tag); if(text !== undefined) node.textContent = String(text); if(className) node.className = className; return node; }
 function options(select, values, label) { select.append(element('option', label)); select.children[0].value = '0'; values.forEach(function(value,index){ const option=element('option',value); option.value=String(index+1); select.append(option); }); select.value='0'; }
 options(engineSelect,engines,'全部实际引擎'); options(splitSelect,splits,'全部已有 split');
 function selected(rows) { const engine=engines[Number(engineSelect.value)-1]; const split=splits[Number(splitSelect.value)-1]; return rows.filter(function(r){ return (engine===undefined||r.engine===engine)&&(split===undefined||r.split===split); }); }
 function fixed(value) { return typeof value==='number'&&Number.isFinite(value)?value.toFixed(3):'unknown'; }
 function percentage(value) { return typeof value==='number'&&Number.isFinite(value)?(value*100).toFixed(1)+'%':'unknown'; }
 function number(value) { return typeof value==='number'&&Number.isFinite(value)?String(value):'unknown'; }
 function groups(rows) { const result=new Map(); rows.forEach(function(r){ const key=JSON.stringify([r.engine,r.split]); if(!result.has(key)) result.set(key,[]); result.get(key).push(r); }); return Array.from(result.values()); }
 function metricAt(row,k) { return Object.values(row.metrics||{}).find(function(metric){return metric&&metric.k===k;}); }
 function mean(values) { const known=values.filter(function(value){return typeof value==='number'&&Number.isFinite(value);}); return {value:known.length?known.reduce(function(sum,value){return sum+value;},0)/known.length:null,n:known.length,unknown:values.length-known.length}; }
 function meanLabel(values) { const m=mean(values); return fixed(m.value)+' · n='+m.n+'/'+values.length+' · unknown='+m.unknown; }
 function ratio(rows,key) { let numerator=0,denominator=0,unknown=0; rows.forEach(function(row){ const ratio=row.score&&row.score[key]; if(ratio&&typeof ratio.numerator==='number'&&typeof ratio.denominator==='number'&&ratio.value!==null) {numerator+=ratio.numerator; denominator+=ratio.denominator;} else unknown++; }); return percentage(denominator?numerator/denominator:null)+' · '+numerator+'/'+denominator+' · unknown rows='+unknown; }
 function sum(rows,key) { return rows.reduce(function(total,row){return total+(typeof row.score[key]==='number'?row.score[key]:0);},0); }
 function table(host,headers,rows) { const wrap=element('div',undefined,'table-scroll'); const t=element('table'); const thead=element('thead'); const heading=element('tr'); headers.forEach(function(h){heading.append(element('th',h));}); thead.append(heading); t.append(thead); const body=element('tbody'); rows.forEach(function(row){const tr=element('tr');row.forEach(function(cell){tr.append(element('td',cell));});body.append(tr);});t.append(body);wrap.append(t);host.append(wrap); }
 function section(id,rows,empty) { const host=document.getElementById(id); host.replaceChildren(); if(!rows.length) host.append(element('p',empty,'empty')); return host; }
 function raw(host,title,value) { const detail=element('details'); detail.append(element('summary',title)); detail.append(element('pre',JSON.stringify(value,null,2)));host.append(detail); }
 function chart(host,label,value,note) { const row=element('div',undefined,'metric-bar'); const title=element('div',label+' · '+percentage(value)+' · '+note); const track=element('div',undefined,'track'); const bar=element('i'); bar.style.width=String(typeof value==='number'&&Number.isFinite(value)?Math.max(0,Math.min(100,value*100)):0)+'%';track.append(bar);row.append(title,track);host.append(row); }
 function renderMatching(rows) { const host=section('matching-results',rows,'未运行岗位排序评测：当前筛选没有样本。'); if(!rows.length)return;
  const summaries=groups(rows).map(function(group){ const failures=group.filter(function(row){return row.errorCode!==undefined;}).length; const metrics=group.map(function(row){return row.errorCode===undefined?metricAt(row,5):undefined;}); const violations=metrics.map(function(m){return m&&m.eligibilityViolationRate;}); const assessed=violations.reduce(function(sum,m){return sum+(m&&typeof m.denominator==='number'?m.denominator:0);},0); const violationCount=violations.reduce(function(sum,m){return sum+(m&&typeof m.numerator==='number'?m.numerator:0);},0); const unknownEligibility=metrics.reduce(function(sum,m){return sum+(m&&m.coverage?m.coverage.unknownEligibility:0);},0);
   return [group[0].engine,group[0].split,String(group.length),failures+'/'+group.length,meanLabel(metrics.map(function(m){return m&&m.ndcg?m.ndcg.value:null;})),meanLabel(metrics.map(function(m){return m&&m.precision?m.precision.value:null;})),percentage(assessed?violationCount/assessed:null)+' · '+violationCount+'/'+assessed+' · unknown资格='+unknownEligibility]; });
  table(host,['引擎','Split','样本 n','失败 / 无效（errorCode）','语义nDCG@5（资格独立）','P@5（宏平均）','已核对资格违例'],summaries);
  host.append(element('p','各引擎与 dev/test 独立汇总。API / 解析失败单列并从语义分数中排除，仍保留在样本分母和 unknown 数；unknown 不当作不相关。P@5 的每条查询分母固定为 5。语义相关性不代表符合资格，资格违例以已核对资格为分母。','caption'));
  raw(host,'岗位逐条结果 / 原始分母与未判断原因',rows);
 }
 function renderForms(rows) { const executed=rows.filter(function(row){return row.independentFinalRead===true;}); const planned=rows.filter(function(row){return row.independentFinalRead!==true;}); const host=section('form-results',executed,'未运行独立页面填写评测：识别/计划结果不计入实际填写覆盖。');
  groups(executed).forEach(function(group){ const title=element('h3',group[0].engine+' / '+group[0].split+' · 独立最终重读 n='+group.length);host.append(title);
   const required=group.reduce(function(sum,row){return sum+row.score.allRequiredCoverage.numerator;},0); const requiredTotal=group.reduce(function(sum,row){return sum+row.score.allRequiredCoverage.denominator;},0);
   chart(host,'全部普通必填覆盖',requiredTotal?required/requiredTotal:null,required+'/'+requiredTotal);
   table(host,['全部普通必填覆盖','普通必填目标覆盖','普通已知目标覆盖','实际填入准确率','保护项状态变更（含环境）','环境注入事件','unknown 字段'],[[ratio(group,'allRequiredCoverage'),ratio(group,'supportedFillableRequiredCoverage'),ratio(group,'supportedFillableCoverage'),ratio(group,'filledAccuracy'),String(sum(group,'protectedMutationCount')),String(group.reduce(function(n,row){return n+(row.environmentMutations||0);},0)),String(sum(group,'unknownCount'))]]);
   const audited=group.filter(function(row){return row.mutationAuditAvailable===true&&row.score.mutationAuditAvailable===true;});
   const strictAssessed=audited.filter(function(row){return typeof row.submissions==='number'&&Number.isInteger(row.submissions)&&row.submissions>=0;});
   const strict=strictAssessed.filter(function(row){return row.status==='succeeded'&&row.submissions===0&&(row.score.strictAutomationSuccess===true||(row.score.strictAutomationSuccess===undefined&&row.score.automationTaskSuccess===true));}).length;
   host.append(element('p','严格自动填写成功（strictAutomationSuccess）：'+strict+'/'+strictAssessed.length+'；缺独立变更审计或提交观测 unknown='+String(group.length-strictAssessed.length)+'。已核实最终值与全过程审计分别计证据。','important'));
   host.append(element('p','需要人工处理的必填声明/上传/证件：'+sum(group,'requiredManualProtectedCount')+'；缺资料普通必填：'+sum(group,'requiredMissingInfoCount')+'。普通必填覆盖的分母不含受保护项。普通目标按冻结 oracle eligible 定义，含后台已支持的毕业月；前台原生不支持该控件时仍记能力缺口。受控环境注入造成的保护项状态变化不等于 Agent 直接误写；按逐项记录审阅。本报告不表示企业允许提交或已收到申请。','caption'));
  });
  if(executed.length)raw(host,'实际填写逐项 oracle / unknown / 原始分母',executed);
  const planHost=section('planner-results',planned,'识别/计划诊断未运行。');if(planned.length){table(planHost,['引擎','Split','仅计划样本 n','证据范围'],groups(planned).map(function(group){return[group[0].engine,group[0].split,String(group.length),'没有独立最终页面重读，不是填写成功率'];}));raw(planHost,'查看识别/计划诊断',planned);}
 }
 function renderRetrieval(rows) { const host=section('retrieval-results',rows,'RAG 检索评测未运行。');if(!rows.length)return;
  table(host,['引擎','Split','查询 n','hit@1','hit@3','hit@5','无答案正确拒答'],groups(rows).map(function(group){const noAnswer=group.filter(function(r){return r.expectedNoAnswer;});return[group[0].engine,group[0].split,String(group.length),meanLabel(group.map(function(r){const m=metricAt(r,1);return m?m.hitAtK:null;})),meanLabel(group.map(function(r){const m=metricAt(r,3);return m?m.hitAtK:null;})),meanLabel(group.map(function(r){const m=metricAt(r,5);return m?m.hitAtK:null;})),String(noAnswer.filter(function(r){return r.correctNoAnswer===true;}).length)+'/'+String(noAnswer.filter(function(r){return r.correctNoAnswer!==null;}).length)+' · unknown='+String(noAnswer.filter(function(r){return r.correctNoAnswer===null;}).length)];}));
  host.append(element('p','这是词法 BM25 检索基线。命中正确资料不能代替填写正确率；空相关 gold 质量指标为 unknown，不奖励命中率。','caption'));raw(host,'检索逐查询与 Recall / MRR / nDCG 分母',rows);
 }
 function renderEfficiency() { const host=document.getElementById('efficiency-results');host.replaceChildren();let found=0;
  function visit(value,path,depth){if(!value||typeof value!=='object'||depth>6)return;if(value.requestStatistics&&typeof value.requestStatistics==='object'){found++;const stats=value.requestStatistics;const box=element('article',undefined,'efficiency-card');box.append(element('h3',path||'efficiency'));box.append(element('p','请求 attempts='+number(stats.attempts)+' · 真实模型='+number(stats.realAttempts)+' · scripted='+number(stats.scriptedAttempts)+' · usageComplete='+String(stats.usageComplete===true)));box.append(element('p','真实 total token：'+(stats.usageComplete===true&&stats.tokens?number(stats.tokens.totalTokens):'unknown')+'；input（含缓存）：'+number(stats.inputTokensIncludingCache)));const latency=value.allAttempts&&value.allAttempts.latency;if(latency)box.append(element('p','所有尝试 latency：n='+number(latency.samples)+' / missing='+number(latency.missingSamples)+'；mean='+fixed(latency.meanMs)+'ms；P50='+fixed(latency.p50Ms)+'ms；P95='+fixed(latency.p95Ms)+'ms'));box.append(element('p','独立 oracle 正确字段/秒（含失败耗时）：'+fixed(value.allAttemptCorrectFieldsPerSecond)));host.append(box);return;}Object.entries(value).forEach(function(pair){visit(pair[1],path?path+'.'+pair[0]:pair[0],depth+1);});}
  visit(data.efficiency,'',0);if(!found)host.append(element('p','尚无可汇总的实测效率记录。','empty'));host.append(element('p','效率与采集区展示完整 run 的原始分组，不随上方引擎 / split 筛选重算。P50/P95 至少 20 条实测样本；失败/partial 不从所有尝试耗时中删除。未采集真实纯人工配对，不能推断节省百分比。模型用量未知保留 unknown，脚本数字不当付费模型 token。','important'));raw(host,'完整效率 / 请求尝试 / 分位数样本数',data.efficiency);
 }
 function renderAcquisition(){const host=document.getElementById('acquisition-results');if(!data.acquisition.length){host.append(element('p','岗位采集完整度评测未运行。','empty'));return;}table(host,['场景','范围','ID recall','ID precision','详情事实','错误宣称完整','实际外网请求'],data.acquisition.map(function(row){return[row.id,row.scope,percentage(row.idRecall),percentage(row.idPrecision),row.correctDetailFields+'/'+row.expectedDetailFields,String(row.falseCompletenessClaim),String(row.externalRequests)];}));raw(host,'采集原始范围与停止原因',data.acquisition);}
 function render(){renderMatching(selected(data.matching));renderForms(selected(data.forms));renderRetrieval(selected(data.retrieval));const shown=selected(allRows).length;document.getElementById('filter-count').textContent='当前筛选：'+shown+'/'+allRows.length+' 条结果；筛选不改变原始数据。';}
 engineSelect.addEventListener('change',render);splitSelect.addEventListener('change',render);
 const limitations=document.getElementById('limitations');data.limitations.forEach(function(item){limitations.append(element('li',item));});
 const provenance=document.getElementById('provenance');provenance.append(element('p','Protocol '+data.protocol.id+' · asOf '+data.protocol.asOf+' · codeFrozen='+String(data.protocol.codeFrozen)));provenance.append(element('p','Live 请求 '+data.live.requestAttempts+' · 完成响应 '+data.live.completedResponses+' · '+data.live.provider+' / '+data.live.model+' · 状态 '+data.live.status));provenance.append(element('p','浏览器证据 run='+String(data.browserEvidence.run)+' · engines='+data.browserEvidence.engines.join(', ')+' · 外网请求='+number(data.browserEvidence.externalRequests)+' · 提交='+number(data.browserEvidence.submissions)));raw(provenance,'协议与来源 hash',{protocol:data.protocol,labelProvenance:data.labelProvenance,independentHumanGold:data.independentHumanGold});
 raw(document.getElementById('trace-results'),'展开原始轨迹（默认收起）',data.traces);render();renderEfficiency();renderAcquisition();
}());
`;

/** A self-contained report. No external assets, remote scripts, fonts, or network requests. */
export function renderBenchmarkHtml(report: BenchmarkReport): string {
  if (!report || report.schemaVersion !== 1 || ![report.matching, report.forms, report.retrieval, report.acquisition, report.traces, report.limitations].every(Array.isArray)) {
    throw new Error('Invalid benchmark report.');
  }
  return `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:; connect-src 'none'; base-uri 'none'; form-action 'none'">
<title>OfferFlash Benchmark · ${escape(report.id)}</title>
<style>
:root{color-scheme:dark;font-family:ui-sans-serif,system-ui,-apple-system,sans-serif;background:#0b1120;color:#dfe9ff;line-height:1.6}*{box-sizing:border-box}body{margin:0}main{max-width:1440px;margin:auto;padding:32px 24px 80px}header{border-bottom:2px solid #72c9fb;padding:10px 0 24px}.brand{color:#ffcb68;font:700 15px ui-monospace,monospace;letter-spacing:2px}h1{font-size:32px;line-height:1.25;margin:10px 0}h2{font-size:21px;margin:0 0 12px}h3{font-size:16px;color:#a9dfff}p{margin:8px 0}.caption{font-size:13px;color:#b0bfd8}.warning{padding:18px 20px;margin:20px 0;border:1px solid #edac52;border-left:5px solid #edac52;background:#251f18;color:#ffe1a6}.important{color:#ffd58a;font-size:14px}.filters{position:sticky;top:0;z-index:1;display:flex;gap:14px;align-items:center;flex-wrap:wrap;padding:14px;background:#101a2af2;border-bottom:1px solid #344964;backdrop-filter:blur(8px)}select{background:#142238;color:#e1efff;border:1px solid #6c91b5;border-radius:0;padding:8px;min-width:170px}section{margin-top:22px;padding:22px;border:1px solid #2f435f;background:#101a2a;box-shadow:3px 3px 0 #060b15}.table-scroll{overflow:auto}table{width:100%;border-collapse:collapse;font-size:13px;min-width:680px}th,td{text-align:left;vertical-align:top;border-bottom:1px solid #2d405a;padding:11px 10px}th{color:#9cccf4;font-weight:600}td:first-child{font-family:ui-monospace,monospace}details{margin-top:16px;border-top:1px dashed #39506e;padding-top:10px}summary{cursor:pointer;color:#9edbff}pre{white-space:pre-wrap;overflow-wrap:anywhere;max-height:550px;overflow:auto;background:#091220;padding:15px;color:#c0d1e8;font-size:12px}.empty{padding:18px;border:1px dashed #52647c;color:#bdcbe0}.metric-bar{margin:14px 0;color:#dcecff;font-size:14px}.track{margin-top:6px;height:12px;background:#203249;border:1px solid #45617d}.track i{display:block;height:100%;background:linear-gradient(90deg,#60bcec,#b1e4ff);transition:width .2s}.efficiency-card{border-left:3px solid #6bc4fc;padding:4px 15px;margin:12px 0;background:#142236}#filter-count{font-size:12px;color:#afc5de}li{margin:7px 0}a{color:#a5dfff}@media(max-width:760px){main{padding:18px 10px}section{padding:14px}h1{font-size:25px}.filters{position:static}}@media(prefers-reduced-motion:reduce){*{transition:none!important}}
</style></head><body><main>
<header><div class="brand">⚡ OFFERFLASH / BENCHMARK</div><h1>岗位匹配 × 表单填写能力报告</h1><p class="caption">Run ${escape(report.id)} · ${escape(Number.isFinite(Date.parse(report.createdAt)) ? new Intl.DateTimeFormat('zh-CN',{timeZone:'Asia/Shanghai',dateStyle:'medium',timeStyle:'medium'}).format(new Date(report.createdAt))+' 北京时间' : '时间未知')}</p></header>
<aside class="warning" role="note"><strong>原创合成诊断集，不是公开排行榜。</strong><p>没有独立人工标注 gold；受控样表和计划诊断不能代表真实企业网申成功率。未采集真实纯人工基线，不计算人工效率提升。本报告不表示已提交申请或企业已经接收。</p><p>表单主指标只统计有独立最终页面重读的执行结果；模型识别/计划诊断单独展示。限制与真实调用范围见下方。</p></aside>
<div class="filters"><label>引擎 <select id="engine-filter" aria-label="筛选实际引擎"></select></label><label>数据划分 <select id="split-filter" aria-label="筛选已有数据划分"></select></label><span id="filter-count"></span></div>
<section><h2>01 / 岗位排序与资格</h2><div id="matching-results"></div></section>
<section><h2>02 / 独立页面自动填写</h2><div id="form-results"></div></section>
<section><h2>识别 / 计划诊断（不计入填写成功率）</h2><div id="planner-results"></div></section>
<section><h2>03 / RAG 资料检索</h2><div id="retrieval-results"></div></section>
<section><h2>04 / Token 与实测耗时</h2><div id="efficiency-results"></div></section>
<section><h2>05 / 岗位采集覆盖</h2><div id="acquisition-results"></div></section>
<section><h2>证据与限制</h2><div id="provenance"></div><ul id="limitations"></ul></section>
<section><h2>原始轨迹</h2><div id="trace-results"></div></section>
<noscript><p class="warning">请在本地浏览器允许此报告的内联脚本以查看交互统计。原始 JSON 已包含在此 HTML 的 report-data 节点。</p></noscript>
</main><script id="report-data" type="application/json">${safeJson(report)}</script><script>${dashboardScript}</script></body></html>`;
}
