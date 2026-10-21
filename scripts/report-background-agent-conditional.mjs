/** Compare immutable v0.12.1 results with the same gold/protocol on conditional-v3. */
import {readFile,writeFile} from 'node:fs/promises';
import {dirname,join} from 'node:path';
import {createHash} from 'node:crypto';
const path=process.argv[2];if(!path)throw Error('Completed conditional progress.json required');
const bytes=await readFile(path),r=JSON.parse(bytes);
const base='.backups/background-agent-bench-20261019/conditional-formal-v3';
const protocol=JSON.parse(await readFile(join(base,'frozen-protocol.json'),'utf8'));
const old=JSON.parse(await readFile('docs/background-agent-recovery-validation.json','utf8'));
const diagnostics=JSON.parse(await readFile('docs/background-agent-conditional-diagnostics.json','utf8'));
const independentAudit=JSON.parse(await readFile('docs/background-agent-conditional-audit.json','utf8'));
if(!independentAudit.passed||independentAudit.rowsChecked!==60)throw Error('Independent audit required');
const hash=b=>createHash('sha256').update(b).digest('hex');
const resumeHash=hash(await readFile('.backups/real-site-qa-20261019/fictional-resume.txt'));
if(resumeHash!==protocol.profileSHA256)throw Error('Profile bytes changed');
if(r.status!=='completed'||r.caseCount!==20||r.caseSHA256!==old.caseSHA256||!protocol.scorerUnchanged||!protocol.originalGoldUnchanged)throw Error('Unchanged completed paired protocol required');
const checks=await Promise.all(Object.entries(protocol.files).map(async([file,sha])=>({file,frozen:hash(await readFile(join(base,'frozen-source',file)))===sha,current:hash(await readFile(file))===sha})));
if(checks.some(c=>!c.frozen||!c.current))throw Error('Measured source changed');
await writeFile(join(base,'source-end-check.json'),JSON.stringify({passed:true,checks},null,2));
const quantile=(values,p)=>{const a=values.filter(Number.isFinite).sort((a,b)=>a-b);return a[Math.max(0,Math.ceil(a.length*p)-1)]??null;};
const usage=attempts=>{let missingAttempts=0;const known={input:0,output:0,cacheRead:0,cacheWrite:0,totalTokens:0};for(const a of attempts){if(!a.usage){missingAttempts++;continue;}for(const k of Object.keys(known))known[k]+=a.usage[k];}return {known,missingAttempts,complete:missingAttempts===0,totalTokens:missingAttempts?null:known.totalTokens};};
const overlap=attempts=>{const es=attempts.flatMap(a=>[[Date.parse(a.startedAt),1],[Date.parse(a.startedAt)+a.durationMs,-1]]).sort((a,b)=>a[0]-b[0]||a[1]-b[1]);let n=0,peak=0;for(const[,d]of es){n+=d;peak=Math.max(n,peak);}return peak;};
const arms=[];
for(const a of r.arms){const ids=new Set(a.results.map(x=>x.taskId)),attempts=r.modelAttempts.filter(x=>ids.has(x.taskId)),failureCounts={};
 for(const x of a.results)if(x.failure)failureCounts[x.failure]=(failureCounts[x.failure]??0)+1;
 let finalReadContinuations=0;for(let i=0;i<a.results.length;i++){const d=JSON.parse(await readFile(join(dirname(path),a.id+'-'+i+'.private.json'),'utf8'));finalReadContinuations+=d.audit?.agent?.finalReadContinuations??0;}
 const previous=old.arms.find(x=>x.id===a.id),completed=a.results.filter(x=>x.status==='completed').length;
 const gold={eligible:0,correct:0,empty:0,wrong:0,unresolved:0,initialNonempty:0};for(const x of a.results)for(const k of Object.keys(gold))gold[k]+=x.gold[k]??0;
 arms.push({id:a.id,concurrency:a.concurrency,plannedTasks:r.caseCount,attemptedTasks:a.results.length,modelStartedTasks:a.results.filter(x=>x.taskId&&attempts.some(t=>t.taskId===x.taskId)).length,completedTasks:completed,completionRate:completed/r.caseCount,
  previousCompleted:previous.completedTasks,previousCompletionRate:previous.completionRate,improvementPercentagePoints:100*(completed/r.caseCount-previous.completionRate),
  wallSeconds:a.wallMs/1000,previousWallSeconds:previous.wallSeconds,taskP50Seconds:quantile(a.results.map(x=>x.durationMs),.5)/1000,taskP95Seconds:quantile(a.results.map(x=>x.durationMs),.95)/1000,
  queueP50Seconds:quantile(a.results.map(x=>x.queueLatencyMs),.5)/1000,queueP95Seconds:quantile(a.results.map(x=>x.queueLatencyMs),.95)/1000,
  tasksPerMinute:a.results.length/(a.wallMs/60000),successfulTasksPerMinute:completed/(a.wallMs/60000),peakActivePages:a.peakActivePages,peakOverlappingModelCalls:overlap(attempts),
  modelRequests:attempts.length,http200:attempts.filter(x=>x.httpStatus===200).length,usage:usage(attempts),previousTokens:previous.usage.totalTokens,
  failureCounts,previousFailureCounts:previous.failureCounts,gold,forbiddenWriteAttempts:a.results.reduce((n,x)=>n+x.forbiddenWriteCount,0),rejectedMappings:a.results.reduce((n,x)=>n+x.rejectedMappings,0),finalReadContinuations,
  rows:a.results.map(x=>({company:x.company,url:x.url,status:x.status,failure:x.failure,seconds:x.durationMs/1000,gold:x.gold,forbiddenWriteCount:x.forbiddenWriteCount,
   rejectedMappings:x.rejectedMappings,tools:x.toolNames,taskId:x.taskId?hash(x.taskId).slice(0,16):null,modelRequests:attempts.filter(t=>t.taskId===x.taskId).length,
   previousStatus:previous.rows.find(y=>y.url===x.url)?.status,previousFailure:previous.rows.find(y=>y.url===x.url)?.failure}))});}
const pilot=JSON.parse(await readFile('.backups/background-agent-bench-20261019/conditional-pilot/instances/real-site-qa-rUtoZa/agent-benchmark/progress.json','utf8'));
const {possibleAdditionalSuccessPerArm:priorSensitivity,...annotationReview}=old.annotationReview;
const followupRaw=JSON.parse(await readFile('.backups/background-agent-bench-20261019/conditional-load-followup/instances/real-site-qa-agQWLp/agent-benchmark/progress.json','utf8'));
const followup={scope:'Separate repeat of original first five companies at concurrency 5; no main-score replacement',tasks:5,completed:followupRaw.arms[0].results.filter(x=>x.status==='completed').length,modelRequests:followupRaw.modelAttempts.length,usage:usage(followupRaw.modelAttempts),peakActivePages:followupRaw.arms[0].peakActivePages,rows:followupRaw.arms[0].results.map(x=>({company:x.company,status:x.status,failure:x.failure,gold:x.gold}))};
const summary={date:'2026-10-19',version:'conditional-v3',status:r.status,companies:r.caseCount,plannedTasks:60,caseSHA256:r.caseSHA256,sourceFrozen:true,sourceFileCount:checks.length,independentAudit,diagnostics,followup,modelStartedTasks:arms.reduce((n,a)=>n+a.modelStartedTasks,0),
 scorerUnchanged:true,originalGoldUnchanged:true,profileSHA256:resumeHash,model:r.model,budgets:r.perTaskBudget,modelRequests:r.modelAttempts.length,http200:r.modelAttempts.filter(a=>a.httpStatus===200).length,usage:usage(r.modelAttempts),
 baselineRerun:false,baselineDefinition:old.baselineDefinition,baselineCompletedTasks:old.baselineCompletedTasks,
 submitted:false,uploads:false,normalUserDataUsed:false,billingCost:null,rawEvidenceSHA256:hash(bytes),pilot:{requests:pilot.modelAttempts.length,usage:usage(pilot.modelAttempts),tasks:2,excludedFromFormal:true},
 finalReadContinuations:arms.reduce((n,a)=>n+a.finalReadContinuations,0),annotationReview:{...annotationReview,scope:'Prior RC1 annotation review retained; no blanket +1 applied to current arms'},
 limitations:['Same 20-company ordinary-draft regression panel, not whole-form/server acceptance or 100-company model coverage','Original conservative legal-name negative annotation retained unchanged','One sequentially ordered run; provider/network/cache variation; no causal significance or human speedup claim','Conditional and alternative name answers require separate confirmed facts; duplicate groups all abstain, not first/last choice'],arms};
await writeFile('docs/background-agent-conditional-validation.json',JSON.stringify(summary,null,2)+'\n');
const f=n=>Number.isFinite(n)?n.toFixed(2):'未知',pct=n=>(n*100).toFixed(0)+'%';
const md=`# 条件姓名与模型预算修复：同面板真实API复测

2026-10-19。原20家官网 × 1/3/5并发，共60个计划任务，实际${summary.modelStartedTasks}个进入模型Agent；未能进入的仍计失败。正式${summary.modelRequests}次API、${summary.http200}次HTTP200、${summary.usage.totalTokens??'usage不完整'} token。两站预检另计${summary.pilot.requests}请求、${summary.pilot.usage.totalTokens}token，不加入主表。

| 并发 | v0.12.1通过 | 本轮通过 | 本轮组耗时秒 | 单任务P50/P95秒 | API | token |
|---|---:|---:|---:|---:|---:|---:|
${arms.map(a=>`| ${a.concurrency} | ${a.previousCompleted}/20（${pct(a.previousCompletionRate)}） | ${a.completedTasks}/20（${pct(a.completionRate)}） | ${f(a.wallSeconds)} | ${f(a.taskP50Seconds)}/${f(a.taskP95Seconds)} | ${a.modelRequests} | ${a.usage.totalTokens??'未知'} |`).join('\n')}

**评分源码、20个精确URL、50个联系字段正向事实、276个负向标签、虚构履历字节、模型、主系统提示，以及每任务6请求/10工具/90秒预算都保持不变。** 源码/编译物${checks.length}项SHA在运行结束复核一致。旧版18/20的原始成绩未改；初版baseline沿用更早不可变记录，没有重复消耗API。

修复包含：普通姓名不再代答“如与上述不同／曾用名”等需要额外确认的问题；规则路径与模型映射都拦截，并显示字段名与补充确认提示。同字段出现重复或冲突映射时，整组映射都拒绝，不挑第一个/最后一个，不转用规则猜填。其余模型实际提出并分别通过语义、资料及页面检查的映射继续执行。未知编号、类型/用途冲突也单独拒绝；意外程序错误不会被吞掉。执行工具成功返回后只允许最终只读核对，缺资料列出待补字段，不把提醒当作已填好。

${arms.map(a=>`并发${a.concurrency}：联系字段${a.gold.correct}/${a.gold.eligible}正确；原负向清单写入${a.forbiddenWriteAttempts}次；失败${JSON.stringify(a.failureCounts)}；实测页面/模型请求峰值${a.peakActivePages}/${a.peakOverlappingModelCalls}。`).join('\n\n')}

本轮条件姓名栏${diagnostics.conditionalBlank}/${diagnostics.conditionalFields}保持空白，条件姓名写入${diagnostics.conditionalWrites}次；发现并隔离冲突字段${diagnostics.conflictReviews}项，冲突字段写入${diagnostics.conflictWrites}次；模型预算耗尽${diagnostics.budgetFailures}次。另有5并发的一次页面加载或读取失败，约15秒且未进入模型任务，原分母和失败保留，不能认定具体网络原因。原5家批次另做一次同代码5并发补测，${followup.completed}/5通过、${followup.modelRequests}请求、${followup.usage.totalTokens}token；不回填原分数，也不据此声称已定位或修复加载根因。

法律全名题的原保守负向标记继续计入失败：一般完整姓名事实可以回答没有额外条件的完整/法律姓名题，本轮不会为了得分把它一并封禁。哪些残余失败属于这一标记，要看逐站表，不能不经核查统一加分。缺少资料和条件是否适用仍须用户确认，不写入虚构答案。

[独立核算](../background-agent-conditional-audit.json)独立重算60行，并检查通过任务均有实际模型写后核对事件和原请求预算。完成率只指受限普通草稿任务，不是整份申请可提交性；复杂履历、附件和声明不在本轮范围。模型与工具轨迹来自实际事件，宿主没有代做后伪造Agent成功。网络限制HTTPS GET/HEAD，提交、上传和自动保存写请求均拦截。单轮结果有网络/缓存波动，费用未知，不计算人工提速或显著性。

[交互对照](background-agent-conditional.html) · [真实调用时间线](background-agent-conditional-trajectory.html) · [OTLP](background-agent-conditional-otel.json) · [保留的v0.12.1结果](background-agent-recovery.md)。普通窗口/私库/账号/Keychain未用于测评，未自动重启当前应用。
`;
await writeFile('docs/release/background-agent-conditional.md',md);
const payload=JSON.stringify(summary).replace(/</g,'\\u003c');
const html=`<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>OfferFlash · 真实 Agent 修复对照</title><style>*{box-sizing:border-box}body{background:#101724;color:#e4ecfa;font:15px system-ui;margin:0}main{max-width:1120px;margin:auto;padding:32px 20px}h1{font-size:26px}p,.muted{color:#a5b7ce;line-height:1.7}a{color:#8acaff}.grid{display:grid;grid-template-columns:repeat(3,1fr);gap:16px}.card,section{background:#192438;border:1px solid #344158;padding:20px;border-radius:14px;margin:18px 0}.big{font-size:34px;font-weight:700;color:#7de0c8}.bar{height:16px;background:#27344a;margin:8px 0;overflow:hidden;border-radius:4px}.bar i{height:100%;display:block;background:#718ab4}.bar.new i{background:#63d4ba}table{width:100%;border-collapse:collapse}th,td{text-align:left;padding:10px;border-bottom:1px solid #33425b}select{background:#25334a;color:white;padding:10px;border-radius:6px}.table{overflow:auto}.bad{color:#ffb689}@media(max-width:700px){.grid{grid-template-columns:1fr}}</style><main><h1>条件姓名与预算 · 真实模型 Agent 复测</h1><p>同一 20 家官网、同一评分与请求预算。填表由真实 Pi Agent 决策；未提交申请。完成率是普通草稿任务，整份申请可提交性未测。</p><div class="grid" id="cards"></div><section><h2>耗时与模型消耗</h2><div class="table"><table><thead><tr><th>并发</th><th>组耗时</th><th>任务 P50/P95</th><th>API / token</th><th>页面/请求峰值</th></tr></thead><tbody id="metrics"></tbody></table></div><p id="total"></p></section><section><h2>逐站结果与失败原因</h2><select id="arm"></select><div class="table"><table><thead><tr><th>公司</th><th>上轮</th><th>本轮</th><th>联系字段</th><th>失败原因</th></tr></thead><tbody id="rows"></tbody></table></div></section><p>保留全部原始失败与法律全名保守标记，不修改历史。条件姓名须单独确认；冲突字段全部留空，其它有效模型映射继续，不猜填。单轮网络和缓存影响耗时，费用未知。</p><p><a href="background-agent-conditional-trajectory.html">真实模型与工具时间线</a> · <a href="background-agent-conditional.md">方法与限制</a> · <a href="background-agent-recovery.html">上轮完整结果</a></p></main><script>const d=${payload};const esc=x=>String(x??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));document.getElementById('cards').innerHTML=d.arms.map(a=>'<div class="card"><h2>'+a.concurrency+' 并发</h2><div class="big">'+a.completedTasks+'/20 · '+Math.round(a.completionRate*100)+'%</div><p>提升 '+a.improvementPercentagePoints.toFixed(0)+' 个百分点</p>上轮<div class="bar"><i style="width:'+(a.previousCompletionRate*100)+'%"></i></div>本轮<div class="bar new"><i style="width:'+(a.completionRate*100)+'%"></i></div></div>').join('');document.getElementById('metrics').innerHTML=d.arms.map(a=>'<tr><td>'+a.concurrency+'</td><td>'+a.wallSeconds.toFixed(2)+'s</td><td>'+a.taskP50Seconds.toFixed(2)+' / '+a.taskP95Seconds.toFixed(2)+'s</td><td>'+a.modelRequests+' / '+(a.usage.totalTokens??'未知')+'</td><td>'+a.peakActivePages+' / '+a.peakOverlappingModelCalls+'</td></tr>').join('');document.getElementById('total').textContent='正式 '+d.modelRequests+' 请求 · '+d.usage.totalTokens+' token；预检另计 '+d.pilot.requests+' 请求。只读流程提醒实际触发 '+d.finalReadContinuations+' 次。';document.getElementById('arm').innerHTML=d.arms.map(a=>'<option value="'+a.id+'">'+a.concurrency+' 并发</option>').join('');function render(){const a=d.arms.find(a=>a.id===document.getElementById('arm').value);document.getElementById('rows').innerHTML=a.rows.map(r=>'<tr><td>'+esc(r.company)+'</td><td>'+esc(r.previousStatus)+'</td><td>'+esc(r.status)+'</td><td>'+r.gold.correct+'/'+r.gold.eligible+'</td><td class="bad">'+esc(r.failure??'—')+'</td></tr>').join('');}document.getElementById('arm').onchange=render;render();</script></html>`;
await writeFile('docs/release/background-agent-conditional.html',html);
console.log(JSON.stringify({requests:summary.modelRequests,tokens:summary.usage.totalTokens,arms:arms.map(a=>({id:a.id,completed:a.completedTasks,wall:a.wallSeconds,failures:a.failureCounts}))}));
