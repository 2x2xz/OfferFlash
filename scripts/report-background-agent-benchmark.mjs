import{readFile,writeFile,mkdir}from'node:fs/promises';import{createHash}from'node:crypto';
const path=process.argv[2];if(!path)throw Error('Provide actual Agent benchmark progress.json');
const rawBytes=await readFile(path),r=JSON.parse(rawBytes),base='.backups/background-agent-bench-20261019/formal-v1';
const frozen=JSON.parse(await readFile(base+'/frozen-protocol.json','utf8'));
const sha=x=>createHash('sha256').update(x).digest('hex');
const sourceChecks=await Promise.all(Object.entries(frozen.files).map(async([file,hash])=>({file,match:sha(await readFile(base+'/frozen-source/'+file))===hash})));
const sourceAtEnd=JSON.parse(await readFile(base+'/source-end-check.json','utf8'));
const annotationReview=JSON.parse(await readFile(base+'/annotation-review.json','utf8'));
const otelIndex=JSON.parse(await readFile('docs/release/background-agent-otel-index.json','utf8'));
const followupRaw=JSON.parse(await readFile('.backups/background-agent-bench-20261019/followup-v1/real-site-qa-49rEOK/agent-benchmark/progress.json','utf8'));
const followup={scope:'post-benchmark guard repair, separate 3-site panel with reviewed legal-name alias; not main-score replacement',
 modelRequests:followupRaw.modelAttempts.length,tokens:followupRaw.modelAttempts.reduce((n,a)=>n+(a.usage?.totalTokens??0),0),
 companies:followupRaw.caseCount,results:followupRaw.arms.flatMap(a=>a.results.map(x=>({company:x.company,completed:x.status==='completed',gold:x.gold,forbiddenWrites:x.forbiddenWriteCount,rejectedMappings:x.rejectedMappings,failure:x.failure})))};
const allPhases=JSON.parse(await readFile('.backups/background-agent-bench-20261019/usage-all-phases.json','utf8'));
const q=(values,p)=>{const a=values.filter(Number.isFinite).sort((a,b)=>a-b);return a.length?a[Math.max(0,Math.ceil(a.length*p)-1)]:null;};
const sumUsage=attempts=>{const known=attempts.filter(a=>a.usage),counts={input:0,output:0,cacheRead:0,cacheWrite:0,totalTokens:0};for(const a of known)for(const k of Object.keys(counts))counts[k]+=a.usage[k];return {known:counts,missingAttempts:attempts.length-known.length,complete:known.length===attempts.length,totalTokens:known.length===attempts.length?counts.totalTokens:null};};
const overlap=attempts=>{const events=attempts.filter(a=>a.stopReason!=='running').flatMap(a=>[[Date.parse(a.startedAt),1],[Date.parse(a.startedAt)+a.durationMs,-1]]).sort((a,b)=>a[0]-b[0]||a[1]-b[1]);let active=0,peak=0;for(const[,delta]of events){active+=delta;peak=Math.max(peak,active);}return peak;};
const arms=r.arms.map(a=>{const ids=new Set(a.results.map(x=>x.taskId).filter(Boolean)),attempts=r.modelAttempts.filter(x=>ids.has(x.taskId));
 const success=a.results.filter(x=>x.status==='completed').length,wrongWrites=a.results.reduce((n,x)=>n+x.forbiddenWriteCount,0);
 const gold=a.results.reduce((s,x)=>{for(const k of Object.keys(s))s[k]+=x.gold[k]??0;return s;},{eligible:0,correct:0,empty:0,wrong:0,unresolved:0,initialNonempty:0});
 const failures={};for(const x of a.results)if(x.failure)failures[x.failure]=(failures[x.failure]??0)+1;
 return{id:a.id,status:a.status,concurrency:a.concurrency,plannedTasks:r.caseCount,attemptedTasks:a.results.length,completedTasks:success,
  incompleteTasks:a.results.length-success,unrunTasks:r.caseCount-a.results.length,completionRate:success/r.caseCount,
  wallSeconds:a.wallMs==null?null:a.wallMs/1000,taskP50Seconds:q(a.results.map(x=>x.durationMs),.5)/1000,taskP95Seconds:q(a.results.map(x=>x.durationMs),.95)/1000,
  queueP50Seconds:q(a.results.map(x=>x.queueLatencyMs),.5)/1000,queueP95Seconds:q(a.results.map(x=>x.queueLatencyMs),.95)/1000,
  tasksPerMinute:a.wallMs?a.results.length/(a.wallMs/60000):null,successfulTasksPerMinute:a.wallMs?success/(a.wallMs/60000):null,
  peakActivePages:a.peakActivePages,peakOverlappingModelCalls:overlap(attempts),modelRequests:attempts.length,http200:attempts.filter(x=>x.httpStatus===200).length,
  usage:sumUsage(attempts),gold,forbiddenWriteAttempts:wrongWrites,rejectedMappings:a.results.reduce((n,x)=>n+x.rejectedMappings,0),
  jobsWithForbiddenWrites:a.results.filter(x=>x.forbiddenWriteCount>0).length,failureCounts:failures,
  rows:a.results.map(x=>({company:x.company,url:x.url,status:x.status,failure:x.failure,seconds:x.durationMs/1000,
    gold:x.gold,forbiddenWriteCount:x.forbiddenWriteCount,rejectedMappings:x.rejectedMappings,tools:x.toolNames,taskId:x.taskId?sha(x.taskId).slice(0,16):null,
    modelRequests:attempts.filter(t=>t.taskId===x.taskId).length,usage:sumUsage(attempts.filter(t=>t.taskId===x.taskId))}))};});
const summary={date:'2026-10-19',status:r.status,scope:r.scope,taskDefinition:r.taskDefinition,completionDefinition:r.primaryCompletion,
 wholeApplicationCompletion:r.wholeApplicationCompletion,companies:r.caseCount,plannedAgentTasks:r.caseCount*4,caseSHA256:r.caseSHA256,
 actualModel:true,model:r.model,modelRequests:r.modelAttempts.length,http200:r.modelAttempts.filter(a=>a.httpStatus===200).length,
 usage:sumUsage(r.modelAttempts),sourceFrozen:sourceChecks.every(x=>x.match)&&sourceAtEnd.passed,sourceChecks,baselineArtifactSHA256:r.baseline.sha256,
 measuredVersion:'frozen-rc1',annotationReview,
 trajectory:otelIndex,
 followup,allPhases,
 baselineDefinition:r.baselineMeaning,budgets:r.perTaskBudget,failureDataRetained:true,normalUserDataUsed:false,submitted:false,uploads:false,
 arms,rawEvidenceSHA256:sha(rawBytes),billingCost:null,
 limitations:['Fixed 20-company product regression panel, not 100-company model coverage or a public held-out ranking',
  'Completion is an ordinary draft task with actual Agent tool chain, independent contact gold and no-guess checks; not whole-form/server acceptance',
  'Single fixed-order trial, browser/network/provider-cache variability; no human speed baseline',
  'Native input, screenshot vision, repeated career controls and final submission are outside this run',
  'Model/API failures retain unknown usage; SDK zero prices are not billing evidence']};
await writeFile('docs/background-agent-benchmark-validation.json',JSON.stringify(summary,null,2)+'\n');
const num=(n,d=2)=>Number.isFinite(n)?n.toFixed(d):'未知',pct=x=>(100*x).toFixed(1)+'%';
const labels={'baseline-c1':'初版模型Agent · 并发1','improved-c1':'新版模型Agent · 并发1','improved-c3':'新版模型Agent · 并发3','improved-c5':'新版模型Agent · 并发5'};
const md=`# 后台模型Agent：真实API版本与并发对照

2026-10-19，状态：${r.status}。${r.caseCount}家真实官网、四组共${r.caseCount*4}个计划任务，使用同一份虚构资料与百炼qwen-flash。提交0、上传0，普通资料库未用于测评。

**这次实际运行Pi Agent决策与工具调用，不是规则重放或只请求一次字段映射。** 任务为读取确认资料键、观察网页、模型决定字段映射并调用填写工具、最后独立读回。任务完成还要求固定联系事实正确、未向缺资料字段写入、执行器无未解决故障。附件/声明/其它缺资料可留待用户；不声称整份申请可提交。

| 组别 | 完成率 | 组耗时秒 | 单任务P50/P95秒 | 任务/分钟 | 实测活跃页峰值 | API请求/HTTP200 | token |
|---|---:|---:|---:|---:|---:|---:|---:|
`+arms.map(a=>`|${labels[a.id]}|${a.completedTasks}/${a.plannedTasks}（${pct(a.completionRate)}）|${num(a.wallSeconds)}|${num(a.taskP50Seconds)}/${num(a.taskP95Seconds)}|${num(a.tasksPerMinute)}|${a.peakActivePages}|${a.modelRequests}/${a.http200}|${a.usage.totalTokens??'未知'}|`).join('\n')+`

累计实际模型请求${summary.modelRequests}次，其中HTTP200为${summary.http200}次；已知token ${summary.usage.known.totalTokens}，未知usage请求${summary.usage.missingAttempts}次。费用未读账单，不使用SDK占位零价格。连接检查和两次试运行不计入上述任务/用量，单独留存。

## 质量与失败

| 组别 | 已知联系字段值正确 | 漏填/错误/无法对应 | 向缺资料字段违规写入次数 | 宿主拦截错误映射 | 失败原因 |
|---|---:|---:|---:|---:|---|
`+arms.map(a=>`|${labels[a.id]}|${a.gold.correct}/${a.gold.eligible}|${a.gold.empty}/${a.gold.wrong}/${a.gold.unresolved}|${a.forbiddenWriteAttempts}|${a.rejectedMappings}|${Object.entries(a.failureCounts).map(([k,v])=>k+' '+v).join('；')||'无'}|`).join('\n')+`

不能只看联系字段正确：初版模型会把公司、链接、薪资错映射成教育键，负向检查会使这些任务失败；新版语义拦截拒绝无关映射。写入后字段值正确但页面/控件变化导致执行器未核实，仍记未完成，保留原始失败。

## 方法与边界

主表保留预先冻结口径的原始成绩。其中ShieldAI的“full legal name”被自动负向规则保守标记，而资料中已有全名，属于需要单独裁定的一项，不据此改高主表。若认定该别名允许使用全名，每组最多增加1个成功任务；这是事后敏感性分析，不是重写原始gold。

正式实验结束后又补强了经理姓名、姓名读音和偏好姓名的拦截，单独3站真实API回归另存，不追加进本表。主表衡量冻结RC1，交付版本含后续补强，未重新跑完整四组。

补强回归：Palantir、ShieldAI、GitLab，3并发；${followup.modelRequests}次HTTP200、${followup.tokens}token，9/9已知字段值一致、违规写入0。这组对法律全名别名单独明确了已知事实，采用独立补充标签，不拿3/3替换主表成绩。

本次所有阶段实际共${allPhases.total.requests}次API、${allPhases.total.knownTokens}token，包含连接检查、两次试运行、正式实验和后续回归；正式主表仍只计402次/638761token。

baseline是新建后台模型Agent的最初原型，修复前已冻结13个源码依赖与独立bundle，不冒充旧版原本不存在的后台模型功能。两组同用户任务/模型/系统提示/工具名/预算；新版增加稳定准备、字段语义拦截及取消/恢复状态处理。并发3/5使用同一新版代码。每任务最多6次API、10次工具、90秒；没有模型失败后偷偷规则填写。

每组使用独立内存浏览器分区，每个岗位独立Pi会话和页面。每批5个岗位、按原顺序处理；活跃页和模型请求重叠峰值实测，不由配置推断。组wall包含固定独立审计开销，单任务服务耗时包含页面加载/模型/执行，不包含外部最终审计。固定顺序单次试验，缓存与网络有影响；不声称统计显著性或人工提速倍数。

源码/编译物冻结核对：${summary.sourceFrozen?'通过':'未通过，需调查'}。来源池100家公司，这轮取每个ATS原顺序前10家，是20家公司回归面板，不对外声称100家公司模型通过率。原始页面、Pi会话和失败保留于本机隔离目录，不上传个人资料、Cookie或凭据。

[实现与固定协议](../modules/background-model-agent.md) · [交互报告](background-agent-benchmark.html) · [验证JSON](../background-agent-benchmark-validation.json)

实际轨迹：${otelIndex.traces} traces / ${otelIndex.spans} spans，其中模型${otelIndex.modelSpans}、工具${otelIndex.toolSpans}，缺失父节点${otelIndex.missingParents}。由真实SDK事件与模型请求区间导出，不补造字段级输入跨度。[OTLP JSON](background-agent-otel.json)。
`;
await writeFile('docs/release/background-agent-benchmark.md',md);
const safe=JSON.stringify(summary).replaceAll('<','\\u003c');
const html=`<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>OfferFlash · 真实后台模型Agent对照</title><style>*{box-sizing:border-box}body{background:#101723;color:#dce7f7;margin:0;font:15px/1.65 system-ui}main{max-width:1250px;margin:auto;padding:32px 24px}h1{font-size:30px}h2{font-size:20px}.muted{color:#a4b7d0}.cards{display:grid;grid-template-columns:repeat(4,1fr);gap:14px}.card,section{background:#182536;border:1px solid #344963;border-radius:10px;padding:18px;margin:16px 0}.card b{display:block;font:700 28px monospace;color:#aad5fc;margin:8px 0}.badge{display:inline-block;background:#294366;color:#c5e2ff;padding:5px 12px;border-radius:4px}.warning{background:#352c20;border:1px solid #7c6038;color:#f5d39d;padding:15px 18px;border-radius:8px;margin:18px 0}table{border-collapse:collapse;width:100%;font-size:13px}td,th{padding:11px 9px;text-align:left;border-bottom:1px solid #344963}th{background:#263a53;position:sticky;top:0}.scroll{overflow:auto;max-height:560px}.num{font-family:monospace}a{color:#9ccfff}input,select{font:inherit;border:1px solid #526f93;background:#101b2a;color:#e4efff;padding:10px;border-radius:5px;margin:8px 8px 14px 0}.columns{display:grid;grid-template-columns:1fr 1fr;gap:18px}.bar{height:18px;background:#0c1522;margin:7px 0 16px}.fill{height:100%;background:#82bdf1}.failure{color:#f0be83}li{margin:7px 0}@media(max-width:800px){.cards,.columns{grid-template-columns:1fr 1fr}main{padding:22px 12px}}</style><main><span class="badge">真实API · Pi工具调用 · 后台运行 · 不提交</span><h1>后台模型Agent：版本与并发对照</h1><p class="muted">2026-10-19 · 同20家公司 · 4组80任务 · qwen-flash · 状态 ${r.status}</p><div class="cards"><div class="card">实际模型请求<b>${summary.modelRequests}</b><span class="muted">HTTP200 ${summary.http200}次</span></div><div class="card">真实token<b>${summary.usage.totalTokens??'未知'}</b><span class="muted">usage未知 ${summary.usage.missingAttempts}次</span></div><div class="card">公司 / 任务<b>20 / 80</b><span class="muted">不把重复实验算作不同公司</span></div><div class="card">提交 / 上传<b>0 / 0</b><span class="muted">虚构资料、独立浏览器分区</span></div></div><div class="warning">完成率针对受限普通资料草稿任务，要求实际工具链、已知联系字段正确、没有向缺资料字段写入，并且执行器没有未解决故障。附件、其它问题及服务器接受不在本轮；这不是整表可提交率。</div><section><h2>完成率、速度与成本用量</h2><div class="scroll"><table><thead><tr><th>组别</th><th>完成任务</th><th>组耗时秒</th><th>服务P50 / P95秒</th><th>任务 / 分钟</th><th>实际活跃页 / 模型重叠峰值</th><th>API / token</th></tr></thead><tbody>${arms.map(a=>`<tr><td>${labels[a.id]}</td><td class="num">${a.completedTasks}/${a.plannedTasks} · ${pct(a.completionRate)}</td><td class="num">${num(a.wallSeconds)}</td><td class="num">${num(a.taskP50Seconds)} / ${num(a.taskP95Seconds)}</td><td class="num">${num(a.tasksPerMinute)}</td><td class="num">${a.peakActivePages} / ${a.peakOverlappingModelCalls}</td><td class="num">${a.modelRequests} / ${a.usage.totalTokens??'未知'}</td></tr>`).join('')}</tbody></table></div></section><div class="columns"><section><h2>任务完成率</h2>${arms.map(a=>`<div>${labels[a.id]} · ${pct(a.completionRate)}</div><div class="bar"><div class="fill" style="width:${100*a.completionRate}%"></div></div>`).join('')}</section><section><h2>这次模型实际做了什么</h2><ol><li>调用工具读取确认资料的可用键</li><li>观察真实网页标签、类型、区块和选项</li><li>自己选择映射并调用受控填写工具</li><li>独立重读，报告真实核实、缺资料和失败</li></ol><p class="muted">没有模型调用或遗漏执行工具就不能通过。模型失败不回退规则。baseline是冻结的初版模型Agent原型。</p></section></div><section><h2>逐个任务与失败原因</h2><select id="arm" aria-label="选择实验组">${arms.map(a=>`<option value="${a.id}">${labels[a.id]}</option>`).join('')}</select><input id="search" aria-label="搜索公司" placeholder="搜索公司…"><div class="scroll"><table><thead><tr><th>公司</th><th>任务</th><th>已知联系字段</th><th>违规写入 / 拦截映射</th><th>服务秒</th><th>API / token</th><th>失败原因</th></tr></thead><tbody id="rows"></tbody></table></div></section><section><h2>实验边界</h2><ul><li>两边同用户任务、模型、提示、工具名和预算，baseline bundle与正式源码已冻结核对：${summary.sourceFrozen?'通过':'未通过'}</li><li>20家回归面板，单轮固定顺序，网络与服务缓存影响尚未消除</li><li>费用未读账单，不使用SDK占位零价格；没有真人计时基线</li><li>原型联系人正确但误写其他字段的试运行另存纠错，未并入正式成绩</li><li>原始Pi会话、完整页面观察和失败保留本机；未读取普通资料或钥匙串</li></ul><a href="background-agent-benchmark.md">完整方法与结果</a> · <a href="../background-agent-benchmark-validation.json">验证JSON</a></section></main><script>const data=${safe};const esc=x=>String(x??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));function render(){const a=data.arms.find(a=>a.id===document.getElementById('arm').value),q=document.getElementById('search').value.trim().toLowerCase();document.getElementById('rows').innerHTML=(a?.rows??[]).filter(r=>r.company.toLowerCase().includes(q)).map(r=>'<tr><td>'+esc(r.company)+'</td><td>'+esc(r.status)+'</td><td class="num">'+r.gold.correct+'/'+r.gold.eligible+'</td><td class="num">'+r.forbiddenWriteCount+' / '+r.rejectedMappings+'</td><td class="num">'+r.seconds.toFixed(2)+'</td><td class="num">'+r.modelRequests+' / '+(r.usage.totalTokens??'未知')+'</td><td class="failure">'+esc(r.failure??'无')+'</td></tr>').join('');}document.getElementById('arm').addEventListener('change',render);document.getElementById('search').addEventListener('input',render);render();</script></html>`;
const note=`<div class="warning">主表为冻结RC1的原始自动口径。ShieldAI的法律全名题有一项保守标记待裁定，主表未改高。交付版本随后补强了经理姓名/姓名变体守卫，另做3站15请求回归，未重跑全部四组；该补充不替代主表。任务/分钟含失败，成功任务/分钟依次为${arms.map(a=>num(a.successfulTasksPerMinute)).join('、')}。</div>`;
await writeFile('docs/release/background-agent-benchmark.html',html.replace('<section><h2>实验边界</h2>',note+'<section><h2>实验边界</h2>'));
console.log(JSON.stringify({status:summary.status,companies:summary.companies,modelRequests:summary.modelRequests,usage:summary.usage,sourceFrozen:summary.sourceFrozen,arms:arms.map(({rows,...a})=>a)},null,2));
