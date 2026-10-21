import{readFile,writeFile,mkdir}from'node:fs/promises';import{resolve,join}from'node:path';import{createHash}from'node:crypto';
import{loadFrozenDataset}from'../packages/evaluation/src/protocol.js';import{scoreRecommendations}from'../packages/evaluation/src/recommendation-scoring.js';import{matchJob}from'../packages/domain/src/matching.js';
const path=resolve(process.argv[2]??'');const report=JSON.parse(await readFile(path,'utf8'));if(report.status!=='completed'||report.attempts.length!==36)throw Error('Completed fixed 36-request run required');
const dataset=await loadFrozenDataset('benchmarks/offerflash-v1'),hash=(b:Uint8Array|string)=>createHash('sha256').update(b).digest('hex');if(report.dataHash!==dataset.digest)throw Error('Data drift');
const root=path.slice(0,path.lastIndexOf('/'));const sourceChecks=[];for(const[p,h]of Object.entries(report.sourceHashes)){const saved=await readFile(join(root,'frozen-source',p));sourceChecks.push({path:p,archiveMatches:hash(saved)===h,currentMatches:hash(await readFile(p))===h});}
if(sourceChecks.some(x=>!x.archiveMatches||!x.currentMatches))throw Error('Source drift');
for(const source of report.sourceEvidence)for(const f of source.files){if(hash(await readFile(join(root,'external-snapshots',source.engine,f.file)))!==f.sha256)throw Error('External Skill snapshot drift');}
let rowsRecomputed=0;for(const row of report.rows){const entries=dataset.matching.jobs.filter((e:any)=>e.split===row.split),qrels=dataset.matching.qrels.filter((q:any)=>q.personaId===row.personaId&&entries.some((e:any)=>e.id===q.jobId));const score=scoreRecommendations(row.ranking,qrels,5);if(JSON.stringify(score)!==JSON.stringify(row.score))throw Error('Score mismatch');rowsRecomputed++;}
// Separate post-hoc system variant. The existing hard gate is unchanged and never sees qrels.
const posthoc=[];for(const row of report.rows.filter((r:any)=>report.engines.includes(r.engine))){const persona=dataset.matching.personas.find((p:any)=>p.id===row.personaId),entries=dataset.matching.jobs.filter((j:any)=>j.split===row.split);
 const profile={...persona.profile,acceptedRecruitmentTypes:persona.evaluationPreferences.acceptedRecruitmentTypes};const ranking=row.ranking.filter((id:string)=>matchJob(profile,entries.find((e:any)=>e.id===id).job,new Date(dataset.protocol.asOf)).eligible!=='unsuitable');
 const qrels=dataset.matching.qrels.filter((q:any)=>q.personaId===row.personaId&&entries.some((e:any)=>e.id===q.jobId));posthoc.push({...row,engine:row.engine+'+existing-hard-gate',ranking,score:scoreRecommendations(ranking,qrels,5),posthoc:true});}
const fractions=(rows:any[])=>{const total=(key:string)=>rows.reduce((n,r)=>n+r.score[key],0),returned=total('returnedCount'),suitable=total('confirmedSuitableCount'),unknown=total('suitabilityUnknownCount'),knownGold=total('knownSuitableGoldCount'),assessed=total('eligibilityAssessedCount');
 return {queries:rows.length,returned,suitable,unsuitable:total('confirmedUnsuitableCount'),unknown,emptySlots:rows.length*5-returned,slots:rows.length*5,knownSuitableGold:knownGold,
  precisionLower:returned?suitable/returned:null,precisionUpper:returned?(suitable+unknown)/returned:null,slotLower:suitable/(rows.length*5),slotUpper:(suitable+unknown)/(rows.length*5),knownRecall:knownGold?suitable/knownGold:null,
  violations:total('eligibilityViolationCount'),assessed,eligibilityUnknown:total('eligibilityUnknownCount'),formatFailures:rows.filter(r=>r.errorCode).length};};
const groups=[];for(const split of ['dev','test'])for(const engine of [...new Set([...report.rows,...posthoc].map((r:any)=>r.engine))]){const rows=[...report.rows,...posthoc].filter(r=>r.split===split&&r.engine===engine);groups.push({engine,split,...fractions(rows)});}
const usageKeys=['input','output','cacheRead','cacheWrite','totalTokens'];const usage=(as:any[])=>{const known=Object.fromEntries(usageKeys.map(k=>[k,as.reduce((s,a)=>s+(a.usage?.[k]??0),0)]));return {known,missing:as.filter(a=>!a.usage).length,totalTokens:as.every(a=>a.usage)?known.totalTokens:null};};
const modelCosts=report.engines.map((engine:string)=>{const attempts=report.attempts.filter((a:any)=>a.engine===engine);return {engine,requests:attempts.length,http200:attempts.filter((a:any)=>a.httpStatus===200).length,...usage(attempts),summedRequestSeconds:attempts.reduce((s:number,a:any)=>s+a.durationMs,0)/1000};});
const evidence={schemaVersion:1,status:'completed',date:'2026-10-19',scope:'Pinned public Skill matching instructions executed by real qwen-flash on the original authored shortlist diagnostic; not full Skill workflow, live job sourcing, real-user accuracy or public benchmark',
 sourceEvidence:report.sourceEvidence,datasetHash:report.dataHash,shortlistProtocolHash:report.shortlistProtocolHash,budgetPerEngine:report.budgetPerEngine,scoringUnchanged:true,labelsUnchanged:true,rawPredictionsRetained:true,
 sourceChecks,independentRecomputation:{rows:rowsRecomputed,passed:true},requests:36,http200:report.attempts.filter((a:any)=>a.httpStatus===200).length,usage:usage(report.attempts),modelCosts,groups,
 posthocExistingGate:{newModelCalls:0,usesOriginalMatchJob:true,readsGold:false,originalPredictionsRewritten:false,preferenceNote:'Uses the same explicit recruitment preferences already provided to all model groups; rules with these preferences are reported separately'},
 limitations:['6 authored fictional CVs and 18 candidates per split; no independent human gold or real resume quality evidence','Closed-pool matching component only; browsing, intake, artifact generation and optional external scripts not run','CSV/natural-language deliverables adapted to original 0–5-ID JSON; Skill own point scores are not evaluation labels','All model arms receive the exact same minimized CV/JD input; rule legacy schema lacks some explicit evaluation preferences, with a matched-preference rule control included','One deterministic-temperature provider-alias run, not a statistical Skill ranking or frozen server weights','Higher returned precision can come from abstention; positive counts, known recall, fixed slots, unknowns and hard violations stay separate','Post-hoc filtering is a separate existing-system variant, not a new raw Skill model run'],
 productionRegistryChanged:false,thirdPartyScriptsExecuted:false,normalUserDataUsed:false,submissions:0,uploads:0,rawEvidenceSHA256:hash(await readFile(path))};
await mkdir('docs/release',{recursive:true});await writeFile('docs/public-job-skills-validation.json',JSON.stringify(evidence,null,2)+'\n');await writeFile(join(root,'posthoc-existing-gate.json'),JSON.stringify({newModelCalls:0,rows:posthoc},null,2),{mode:0o600});
const names:Record<string,string>={'rules-current':'现有规则','rules-explicit-preferences':'规则＋同样的明确偏好','plain-model':'普通模型','jobok-model':'模型＋JobOK','advisor-model':'模型＋Career Application Advisor'};const name=(e:string)=>names[e.replace('+existing-hard-gate','')]+(e.includes('+')?'＋已有硬筛':'');const pct=(v:number|null)=>v===null?'未知':(v*100).toFixed(1)+'%';
const test=groups.filter(g=>g.split==='test'),raw=test.filter(g=>!g.engine.includes('+')&&g.engine!=='rules-explicit-preferences'),gated=test.filter(g=>g.engine.includes('+'));
const table=(rs:any[])=>`| 方法 | 确认合适／返回 | 合适率下界 | 已知合适找回 | 硬资格违规 | 未知适配 |\n|---|---:|---:|---:|---:|---:|\n`+rs.map(r=>`| ${name(r.engine)} | ${r.suitable}/${r.returned} | ${pct(r.precisionLower)} | ${r.suitable}/${r.knownSuitableGold}（${pct(r.knownRecall)}） | ${r.violations}/${r.assessed} | ${r.unknown} |`).join('\n');
const md=`# 现成求职Skill：同模型、同简历岗位、同评分对照

2026-10-19。**本轮没有发现直接套Skill就能提升推荐。** JobOK与Career Application Advisor的原始模型结果都未超过现有规则；保留App已有硬条件筛选后，普通模型的组合结果最好。没有替换App匹配逻辑或安装外部Skill。

## 测了什么

固定原6份虚构CV、每个dev/test池18岗、原标签和scoreRecommendations；每份最多5条，允许少推或为空。真实百炼qwen-flash、temperature=0、每请求最多1000输出token/20秒/0重试；每个模型方法原12请求预算（6 dev＋6 test），合计36请求全部HTTP200，${evidence.usage.totalTokens}token。所有模型组使用逐字相同的CV/JD用户输入，Skill只改变系统任务说明。

这里测的是Skill的**岗位匹配说明由模型执行**：不安装、不运行其Python脚本，不做全网搜岗或简历改写；CSV/报告输出统一适配成原0–5 ID短名单。原Skill文件与相关匹配参考原文固定，没有按测试结果改写。普通模型控制组使用原补充协议提示；已核实当前规则仍12/26。

## Test原始结果

${table(raw)}

规则与匹配同样明确偏好的控制组均12/26，已知召回12/14；没有把额外偏好带来的差别当作Skill收益。Dev上JobOK为9/13，而Test为10/30，不能只挑Dev好看的结果宣传。所有36模型输出格式有效，但格式正确不代表岗位合适。

## 再加回App已有的硬条件筛选（单独统计）

下面只对本次已经生成的ID名单用现有matchJob过滤，不改原名单、标签或模型，不补满5条，没有新增API请求。相同显式招聘类型偏好用于这个过滤。它是事后组合诊断，不能当作Skill原生结果。

${table(gated)}

最佳组合为“普通模型＋已有硬筛”：12/19=63.2%，比规则12/26=46.2%高17.0个百分点，但确认合适条数仍是12、已知召回仍12/14；主要减少了不合适推荐，没有找回更多已知合适岗位。JobOK组合10/20、Advisor组合11/19，均漏掉更多正例，没有超过普通模型组合。不能把已有规则拦掉的资格错误归功于Skill。

固定30推荐槽位的合适下界，规则与普通模型组合均12/30=40%；JobOK为10/30、Advisor为11/30。Test总共14个已知合适配对，固定槽位已知理论上限14/30=46.7%，所以该指标不能叫“返回结果准确率”。未知适配和资格未知分别留在机器可读统计中，不按正确填满，也不直接当负例。

## 来源

- [JobOK](https://github.com/GresonKwan/JobOK)，MIT，固定提交c5da0c6a6c9936b640a202c78cdd6e64b2981ba6。读取SKILL及匹配rubric、intake和平台边界。其配套score_job_matches.py是关键词初筛，本轮只审阅，未运行。
- [Career Application Advisor](https://github.com/watermud-hr/career-application-advisor)，MIT，固定提交44b8477f8cd544ec153b33c43d222a5c16a1653a。读取SKILL、resume-review与privacy-and-safety。本轮未运行提取或生成脚本。

两者的原文、许可证、SHA及请求/响应保留在本地忽略备份，未加入生产注册表。没有使用fill-job-forms。外部说明不授予搜索、文件或申请操作权限；本轮真实简历、普通私库和Keychain未使用，0提交、0上传。

## 用量与解释边界

| 模型方法 | API | token | 各请求耗时合计秒 |
|---|---:|---:|---:|
${modelCosts.map((r:any)=>`| ${name(r.engine)} | ${r.requests} | ${r.totalTokens??'未知'} | ${r.summedRequestSeconds.toFixed(2)} |`).join('\n')}

原评分未动，60行基础结果（两个规则方法＋三个模型方法×12查询）逐项重算一致；外部文件、推理源码和数据SHA核对一致。原始失败及不合适推荐保留。该小型自建诊断已用于之前开发，不能声称独立人标、真实求职准确率、全网召回率或统计显著性。没有新模型权重冻结保证。下一步若要改善，应做通用证据匹配及独立新数据验证，不能继续用Test调提示再当未见测试成绩。

[机器可读结果](../public-job-skills-validation.json)。本轮只做对照，未替换现有App或发布新包。
`;
await writeFile('docs/release/public-job-skills.md',md);console.log(JSON.stringify({requests:evidence.requests,tokens:evidence.usage.totalTokens,rowsRecomputed,test:raw.map(g=>({engine:g.engine,suitable:g.suitable,returned:g.returned,precision:g.precisionLower})),gated:gated.map(g=>({engine:g.engine,suitable:g.suitable,returned:g.returned,precision:g.precisionLower}))}));
