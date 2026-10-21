import {readFile,writeFile} from 'node:fs/promises';
const input=process.argv[2];if(!input)throw new Error('Provide a completed independent audit');
const a=JSON.parse(await readFile(input,'utf8'));if(a.status==='running'||a.fixedFieldCount!==130)throw new Error('Requires final fixed-denominator audit');
const intermediate=JSON.parse(await readFile('.backups/real-site-qa-20261019/polish2-final-audit-r2.json','utf8'));
const sources=JSON.parse(await readFile('.backups/real-site-qa-20261019/polish4-source-manifest.json','utf8'));
const validation={date:'2026-10-19',scope:a.scope,attemptedOriginalURLs:100,actualForms:a.companies,
  baseline:a.baseline,final:{fixedFieldCount:130,observedFields:a.current.eligible,correct:a.current.correct,empty:a.current.empty,
    wrong:a.current.wrong,unresolved:a.current.unresolved,unobservedFields:a.unobservedFields,pairedBaselineCorrect:a.pairedBaselineCorrect},
  phone:a.phone,executorVerifiedIncludingPhone:a.executorVerified,appSeconds:a.appSeconds,import:a.import,
  intermediateFailure:{actualForms:intermediate.companies,observedFields:intermediate.current.eligible,correct:intermediate.current.correct,
    empty:intermediate.current.empty,phone:intermediate.phone,artifactSHA256:intermediate.artifactSHA256},
  validation:{focusedTests:87,typecheck:'passed',build:'passed',fixedSkillRegistry:'passed',sourceModules:sources},
  artifactSHA256:a.artifactSHA256,realModelRequests:0,skillInvocationsInBatch:0,submissions:0,uploads:0,
  normalUserDataUsed:false,normalAppRestarted:false,systemKeychainUsed:false,
  limitations:['Fixed name/email fields only; not whole-form accuracy','Phone facts newly imported and scored separately',
    'Final value match is separate from full executor verification','Only production background rules queue, no model/foreground E2E',
    'Custom dropdowns, repeated career groups, uploads and server acceptance not established by this run'],
  rows:a.rows.map(({company,url,provider,baselineCorrect,eligible,correct,empty,wrong,unresolved,verified,message})=>({company,url,provider,baselineCorrect,eligible,correct,empty,wrong,unresolved,verified,message}))};
await writeFile('docs/real-site-polish-validation.json',JSON.stringify(validation,null,2)+'\n');
const md=`# OfferFlash 官网表单打磨回归

2026-10-19。相同100个原始申请网址、虚构资料、正式App的后台规则队列。没有模型请求、Skill调用、申请提交或附件上传。普通资料库、登录和当前App未替换。

| 指标 | 原100家结果 | 本轮 |
|---|---:|---:|
| 实际进入表单 | 100 | ${a.companies}（其余网址单列加载失败） |
| 固定姓名/邮箱字段分母 | 130 | 130 |
| 最终值匹配 | 83 | ${a.current.correct} |
| 仍空白 | 47 | ${a.current.empty} |
| 错误非空值 | 0 | ${a.current.wrong} |
| 无法对应字段 / 未观察 | 0 / 0 | ${a.current.unresolved} / ${a.unobservedFields} |

本轮成功进入页面覆盖${a.current.eligible}个旧字段；仅在这个交集比较，原值匹配${a.pairedBaselineCorrect}/${a.current.eligible}，本轮${a.current.correct}/${a.current.eligible}。固定130分母保留，加载失败没有被删除来提高比例。**这只衡量明确全名/邮箱的最终值，不是整表准确率。**

电话新增单独统计：原始明确空白电话${a.phone.eligible}个，最终值一致${a.phone.correct}、空白${a.phone.empty}、错误非空${a.phone.wrong}、无法唯一对应${a.phone.unresolved}。执行器完整核实总数${a.executorVerified}（含电话），与旧81项的口径不同，不能直接比较。执行器停止后值一致也不能补算核实回执。

App运行${a.appSeconds}秒；准备、构建及外部控制工具等待不计入。没有人工计时基线，不计算提速倍数。

修复了明确国际电话导入、生成计划前的导航/控件稳定等待、固定原因的失败提示与缺资料提醒。输入开始后的原值、页面代次、保护控件和资料版本检查保留；未知/部分写入不盲目重试。第一轮仅加控件等待的回归仍只有77/128匹配，原始失败、包与统计保留，没有覆盖成成功。

App自有Skill包括申请事项整理、岗位比较、简历导入核对。它们供模型按需读取流程；本轮后台规则队列不调用Skill或模型，没有使用第三方fill-job-forms。自定义下拉、复杂经历新增、前台模型链路仍需单独验证。缺少的姓/名、资格答案等不猜填。

[实现与范围](../modules/real-site-polish.md) · [验证JSON](../real-site-polish-validation.json) · [上一轮100家报告](real-site-batch-dashboard.html)

| 企业 | 旧值匹配 | 新值匹配 | 空白 | 无法对应 | 执行器核实（含电话） |
|---|---:|---:|---:|---:|---:|
`+a.rows.map(r=>`|${r.company.replaceAll('|','/')}|${r.baselineCorrect}/${r.eligible}|${r.correct}/${r.eligible}|${r.empty}|${r.unresolved}|${r.verified}|`).join('\n')+'\n';
await writeFile('docs/release/real-site-polish-results.md',md);
console.log(JSON.stringify({validation:'docs/real-site-polish-validation.json',report:'docs/release/real-site-polish-results.md'}));
