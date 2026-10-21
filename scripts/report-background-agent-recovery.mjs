/** Compare immutable RC1 results with the same gold/protocol on recovery-v2. */
import {readFile,writeFile} from 'node:fs/promises';
import {dirname,join} from 'node:path';
import {createHash} from 'node:crypto';
const path=process.argv[2];if(!path)throw Error('Completed recovery progress.json required');
const bytes=await readFile(path),r=JSON.parse(bytes);
const base='.backups/background-agent-bench-20261019/recovery-formal-v2';
const protocol=JSON.parse(await readFile(join(base,'frozen-protocol.json'),'utf8'));
const old=JSON.parse(await readFile('docs/background-agent-benchmark-validation.json','utf8'));
const independentAudit=JSON.parse(await readFile('docs/background-agent-recovery-audit.json','utf8'));
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
 arms.push({id:a.id,concurrency:a.concurrency,plannedTasks:r.caseCount,attemptedTasks:a.results.length,completedTasks:completed,completionRate:completed/r.caseCount,
  previousCompleted:previous.completedTasks,previousCompletionRate:previous.completionRate,improvementPercentagePoints:100*(completed/r.caseCount-previous.completionRate),
  wallSeconds:a.wallMs/1000,previousWallSeconds:previous.wallSeconds,taskP50Seconds:quantile(a.results.map(x=>x.durationMs),.5)/1000,taskP95Seconds:quantile(a.results.map(x=>x.durationMs),.95)/1000,
  queueP50Seconds:quantile(a.results.map(x=>x.queueLatencyMs),.5)/1000,queueP95Seconds:quantile(a.results.map(x=>x.queueLatencyMs),.95)/1000,
  tasksPerMinute:a.results.length/(a.wallMs/60000),successfulTasksPerMinute:completed/(a.wallMs/60000),peakActivePages:a.peakActivePages,peakOverlappingModelCalls:overlap(attempts),
  modelRequests:attempts.length,http200:attempts.filter(x=>x.httpStatus===200).length,usage:usage(attempts),previousTokens:previous.usage.totalTokens,
  failureCounts,previousFailureCounts:previous.failureCounts,gold,forbiddenWriteAttempts:a.results.reduce((n,x)=>n+x.forbiddenWriteCount,0),rejectedMappings:a.results.reduce((n,x)=>n+x.rejectedMappings,0),finalReadContinuations,
  rows:a.results.map(x=>({company:x.company,url:x.url,status:x.status,failure:x.failure,seconds:x.durationMs/1000,gold:x.gold,forbiddenWriteCount:x.forbiddenWriteCount,
   rejectedMappings:x.rejectedMappings,tools:x.toolNames,taskId:x.taskId?hash(x.taskId).slice(0,16):null,modelRequests:attempts.filter(t=>t.taskId===x.taskId).length,
   previousStatus:previous.rows.find(y=>y.url===x.url)?.status,previousFailure:previous.rows.find(y=>y.url===x.url)?.failure}))});}
const pilot=JSON.parse(await readFile('.backups/background-agent-bench-20261019/recovery-pilot/instances/real-site-qa-u6svGF/agent-benchmark/progress.json','utf8'));
const {possibleAdditionalSuccessPerArm:priorSensitivity,...annotationReview}=old.annotationReview;
const summary={date:'2026-10-19',version:'recovery-v2',status:r.status,companies:r.caseCount,plannedTasks:60,caseSHA256:r.caseSHA256,sourceFrozen:true,sourceFileCount:checks.length,independentAudit,
 scorerUnchanged:true,originalGoldUnchanged:true,profileSHA256:resumeHash,model:r.model,budgets:r.perTaskBudget,modelRequests:r.modelAttempts.length,http200:r.modelAttempts.filter(a=>a.httpStatus===200).length,usage:usage(r.modelAttempts),
 baselineRerun:false,baselineDefinition:old.baselineDefinition,baselineCompletedTasks:old.arms[0].completedTasks,
 submitted:false,uploads:false,normalUserDataUsed:false,billingCost:null,rawEvidenceSHA256:hash(bytes),pilot:{requests:pilot.modelAttempts.length,usage:usage(pilot.modelAttempts),tasks:2,excludedFromFormal:true},
 finalReadContinuations:arms.reduce((n,a)=>n+a.finalReadContinuations,0),annotationReview:{...annotationReview,scope:'Prior RC1 annotation review retained; no blanket +1 applied to current arms'},
 limitations:['Same 20-company ordinary-draft regression panel, not whole-form/server acceptance or 100-company model coverage','Original conservative legal-name negative annotation retained unchanged','One sequentially ordered run; provider/network/cache variation; no causal significance or human speedup claim','Post-write recovery accepts only index changes with exact ordered field metadata/values/protected state; other rerenders still stop'],arms};
await writeFile('docs/background-agent-recovery-validation.json',JSON.stringify(summary,null,2)+'\n');
const f=n=>Number.isFinite(n)?n.toFixed(2):'未知',pct=n=>(n*100).toFixed(0)+'%';
const md=`# 后台模型 Agent 修复：同一真实 API 面板复测

2026-10-19。20 家官网 × 1/3/5 并发，共 60 次完整 Agent 任务。${summary.modelRequests} 次真实 API，${summary.http200} 次 HTTP200，${summary.usage.totalTokens??'usage 不完整'} token。预检另计 ${summary.pilot.requests} 请求，不加入正式成绩。

| 并发 | 上轮完成 | 本轮完成 | 提升百分点 | 本轮组耗时秒 | 单任务 P50/P95 秒 | API | token |
|---|---:|---:|---:|---:|---:|---:|---:|
${arms.map(a=>`| ${a.concurrency} | ${a.previousCompleted}/20 (${pct(a.previousCompletionRate)}) | ${a.completedTasks}/20 (${pct(a.completionRate)}) | ${f(a.improvementPercentagePoints)} | ${f(a.wallSeconds)} | ${f(a.taskP50Seconds)}/${f(a.taskP95Seconds)} | ${a.modelRequests} | ${a.usage.totalTokens??'未知'} |`).join('\n')}

保留原案例字节、50 个联系字段正向事实、276 个缺资料负向标签、评分源码、模型、主系统提示和每任务 6 请求/10 工具/90 秒预算。源码和编译物 ${checks.length} 项 SHA 在运行结束重新核对一致。初版 baseline 沿用上轮不可变的 5/20，没有重复消耗 API；本轮的直接对照是上轮 RC1 相同并发组。

电话填写后的控件编号变化是先前 9 个固定失败的共同特征。本轮只接受字段顺序、身份、标签、类型、选项、内容和受保护状态全部相同的稳定编号变化，移动控件还必须有唯一显式 id/name；重新绑定剩余字段后，每次写入仍比较完整即时快照。字段增删、其他值变化、附件/声明变化、导航、取消和资料变化均不能借此继续。

模型遗漏最终读回时，宿主最多向同一 Pi 会话追加一次只读流程提醒，仍受原预算约束；只有模型实际调用 read_fill_status 才算读回，不能由评测脚本代做。本轮实际触发 ${summary.finalReadContinuations} 次提醒。未遇到遗漏时不声称这轮单独测出了提醒的增益，流程由 SDK 合约测试另证。

${arms.map(a=>`并发 ${a.concurrency}：联系 gold ${a.gold.correct}/${a.gold.eligible}；违规写入 ${a.forbiddenWriteAttempts} 次；失败原因 ${JSON.stringify(a.failureCounts)}。实测页面/模型请求峰值 ${a.peakActivePages}/${a.peakOverlappingModelCalls}。`).join('\n\n')}

原负向 gold 对 ShieldAI 法律全名的保守标记继续保留，单列待裁定，不回改分数。完成率指普通草稿任务通过全部原判据，不代表整份申请、复杂履历或企业服务器已接受。网络只允许 HTTPS GET/HEAD，提交、上传、自动保存写请求均拦截；没有操作普通私库或账号，没有自动退出用户当前 App。单轮顺序固定，耗时也受网络与缓存影响，没有人工输入速度比较或显著性结论。

[独立核算](../background-agent-recovery-audit.json) · [交互对照](background-agent-recovery.html) · [真实调用时间线](background-agent-recovery-trajectory.html) · [OTLP](background-agent-recovery-otel.json) · [保留的上轮结果](background-agent-benchmark.md)。账单费用未知，不把 SDK 占位零价格当作免费。
`;
await writeFile('docs/release/background-agent-recovery.md',md);
const payload=JSON.stringify(summary).replace(/</g,'\\u003c');
const html=`<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>OfferFlash · 真实 Agent 修复对照</title><style>*{box-sizing:border-box}body{background:#101724;color:#e4ecfa;font:15px system-ui;margin:0}main{max-width:1120px;margin:auto;padding:32px 20px}h1{font-size:26px}p,.muted{color:#a5b7ce;line-height:1.7}a{color:#8acaff}.grid{display:grid;grid-template-columns:repeat(3,1fr);gap:16px}.card,section{background:#192438;border:1px solid #344158;padding:20px;border-radius:14px;margin:18px 0}.big{font-size:34px;font-weight:700;color:#7de0c8}.bar{height:16px;background:#27344a;margin:8px 0;overflow:hidden;border-radius:4px}.bar i{height:100%;display:block;background:#718ab4}.bar.new i{background:#63d4ba}table{width:100%;border-collapse:collapse}th,td{text-align:left;padding:10px;border-bottom:1px solid #33425b}select{background:#25334a;color:white;padding:10px;border-radius:6px}.table{overflow:auto}.bad{color:#ffb689}@media(max-width:700px){.grid{grid-template-columns:1fr}}</style><main><h1>写后恢复 · 真实模型 Agent 复测</h1><p>同一 20 家官网、同一评分与请求预算。填表由真实 Pi Agent 决策；未提交申请。完成率是普通草稿任务，整份申请可提交性未测。</p><div class="grid" id="cards"></div><section><h2>耗时与模型消耗</h2><div class="table"><table><thead><tr><th>并发</th><th>组耗时</th><th>任务 P50/P95</th><th>API / token</th><th>页面/请求峰值</th></tr></thead><tbody id="metrics"></tbody></table></div><p id="total"></p></section><section><h2>逐站结果与失败原因</h2><select id="arm"></select><div class="table"><table><thead><tr><th>公司</th><th>上轮</th><th>本轮</th><th>联系字段</th><th>失败原因</th></tr></thead><tbody id="rows"></tbody></table></div></section><p>保留全部原始失败与法律全名保守标记，不修改历史。只接受严格证明的控件编号变化；其他内容/身份变化继续停止。单轮网络和缓存影响耗时，费用未知。</p><p><a href="background-agent-recovery-trajectory.html">真实模型与工具时间线</a> · <a href="background-agent-recovery.md">方法与限制</a> · <a href="background-agent-benchmark.html">上轮完整结果</a></p></main><script>const d=${payload};const esc=x=>String(x??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));document.getElementById('cards').innerHTML=d.arms.map(a=>'<div class="card"><h2>'+a.concurrency+' 并发</h2><div class="big">'+a.completedTasks+'/20 · '+Math.round(a.completionRate*100)+'%</div><p>提升 '+a.improvementPercentagePoints.toFixed(0)+' 个百分点</p>上轮<div class="bar"><i style="width:'+(a.previousCompletionRate*100)+'%"></i></div>本轮<div class="bar new"><i style="width:'+(a.completionRate*100)+'%"></i></div></div>').join('');document.getElementById('metrics').innerHTML=d.arms.map(a=>'<tr><td>'+a.concurrency+'</td><td>'+a.wallSeconds.toFixed(2)+'s</td><td>'+a.taskP50Seconds.toFixed(2)+' / '+a.taskP95Seconds.toFixed(2)+'s</td><td>'+a.modelRequests+' / '+(a.usage.totalTokens??'未知')+'</td><td>'+a.peakActivePages+' / '+a.peakOverlappingModelCalls+'</td></tr>').join('');document.getElementById('total').textContent='正式 '+d.modelRequests+' 请求 · '+d.usage.totalTokens+' token；预检另计 '+d.pilot.requests+' 请求。只读流程提醒实际触发 '+d.finalReadContinuations+' 次。';document.getElementById('arm').innerHTML=d.arms.map(a=>'<option value="'+a.id+'">'+a.concurrency+' 并发</option>').join('');function render(){const a=d.arms.find(a=>a.id===document.getElementById('arm').value);document.getElementById('rows').innerHTML=a.rows.map(r=>'<tr><td>'+esc(r.company)+'</td><td>'+esc(r.previousStatus)+'</td><td>'+esc(r.status)+'</td><td>'+r.gold.correct+'/'+r.gold.eligible+'</td><td class="bad">'+esc(r.failure??'—')+'</td></tr>').join('');}document.getElementById('arm').onchange=render;render();</script></html>`;
await writeFile('docs/release/background-agent-recovery.html',html);
console.log(JSON.stringify({requests:summary.modelRequests,tokens:summary.usage.totalTokens,arms:arms.map(a=>({id:a.id,completed:a.completedTasks,wall:a.wallSeconds,failures:a.failureCounts}))}));
