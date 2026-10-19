# 填表 Benchmark：公开依据与 OfferFlash 可执行方案

调研日期：2026-10-19。本文审阅公开一手文档、评分源码及本项目生产入口；没有运行公开基准、操作正常窗口、填写真实申请、读取私库或调用付费模型。下面的方案不是已取得的能力成绩。

## 应借鉴什么

| 一手来源 | 可采用的思路 | 对本项目的限制 |
| --- | --- | --- |
| [WebArena 官方仓库](https://github.com/web-arena-x/webarena)、[确定性 HTML/URL 评分源码](https://github.com/web-arena-x/webarena/blob/main/evaluation_harness/evaluators.py) | 每个任务从固定初态开始，按最终可观察结果判成功；多条件必须同时成立 | 导航或出现“完成”文字不能证明网申正确；本项目不把企业提交作为成功条件 |
| [WebArena-Verified 官方仓库](https://github.com/ServiceNow/webarena-verified) | 审核任务与答案，采用类型相关的确定性比较；保存外部可核对的执行证据 | 本项目采用独立字段重读与变更审计；不能把 executor 自报 verified 当 gold，也不能直接宣称跑过该基准 |
| [WorkArena 官方表单任务源码](https://github.com/ServiceNow/WorkArena/blob/main/src/browsergym/workarena/tasks/form.py) | 任务字段和非任务字段分开；监测非任务字段是否被改；参考最终记录验证结果 | 它的企业演示任务可创建记录；我们使用隔离样表和独立最终 DOM oracle，真实网申不提交。不要直接搬其 cheat 填写脚本作为 Agent |
| [MiniWoB++ 官方仓库](https://github.com/Farama-Foundation/miniwob-plusplus)、[日期任务](https://github.com/Farama-Foundation/miniwob-plusplus/blob/master/miniwob/html/miniwob/enter-date.html)、[联想任务](https://github.com/Farama-Foundation/miniwob-plusplus/blob/master/miniwob/html/miniwob/use-autocomplete.html) | 把日期、联想等控件能力拆成小任务，固定随机种子和页面初态，便于定位失败 | 小控件成功不能替代长表、多段经历与连续流程能力；速度奖励和正确率要分开 |
| [FormFactory 论文](https://arxiv.org/abs/2506.01520)、[官方仓库](https://github.com/formfactory-ai/formfactory)、[评分实现](https://github.com/formfactory-ai/formfactory/blob/main/eval/evaluator.py) | 页面、参考材料和字段 gold 分开；字段与整表两层评分 | 其公开 evaluator 含预测文本提取和 SequenceMatcher 相似度，不能直接作为“网页真的填写正确”的证据。本项目姓名、邮箱、日期、链接用精确值/冻结等价集合，不用模糊字符串加分 |

结论：先做项目自己的中国校招填表基准。公开基准提供任务和验收方法，不直接成为本项目的已验证排行榜成绩。将来如实际复用外部 HTML/数据，另行锁定修订、许可与原始划分；本轮样表应原创、人物虚构。

## 三种能力必须分开

1. **字段语义与计划**：给模型真实观察结构，检查它把字段归到哪一个已确认资料键；生产 `recognizeModelForm` 只接收标签、类型、段落和选项，模型不能直接生成个人值。比较规则、同一模型语义补充与受控消融。这个分数不证明网页被输入。
2. **实际 DOM 执行**：在隐藏 Chromium 原创样表中跑生产后台执行器；真实 DOM 值由另一段 benchmark 自有读取代码取回，立即与稳定等待后各读一次。证明确定性后台路径的当前支持范围，不称原生鼠标或真实企业能力。
3. **前台原生端到端**：生产 UI→IPC→controller→原生输入→独立重读，包含滚动、焦点、遮挡、年月弹层与新增经历。真实 API、真实原生动作与真实企业页面是三个独立标签；只有实际满足的标签才能写到报告。睡眠期间先完成前两轨，不能为第三轨抢正常窗口或放宽失焦守卫。

## 冻结字段 oracle，先写分母再执行

Oracle 是执行前独立写好的标准答案，不从 planner 的 ready/skip/verified 结果生成。样表使用 benchmark 自有稳定 ID；Agent 仍通过生产观察读取标签，不能拿 gold 的 selector/值。经历 ID 必须包含记录身份，不能把第一个“角色”框与第二个项目串起来后仍算对。

每个字段记录 `fieldId / required / kind / initialValue / expectedValues?`，可附明确规范化规则。四类为：

- `eligible`：资料已确认且控件属于此轨声明支持范围；有非空 gold。
- `unsupported`：用户需要、资料已知，但冻结时不属于此轨支持范围；仍有 gold。它保留在完整度分母，不能被安全 skip 抹掉。
- `missing-info`：资料中没有可确认答案；不编造。必填缺资料阻止整表完成，正确留空只获得独立的拒答/待补正确性。
- `protected`：已有值、敏感资料、声明、附件、其他人的资料；必须保持初态。它不进入“自动补齐空字段”分母，保护项数量及其中必填数量另列。身份证独立确认路径要单独测，不能把普通一键不写证件伪称整张企业申请已可提交。

两个优先完整度指标同时展示：

| 指标 | 分子 / 分母 |
| --- | --- |
| 全部必需信息覆盖率 `allRequiredCoverage` | 独立重读正确的必填目标 / 全部非 protected 必填项，含 unsupported 与 missing-info |
| 支持范围必填覆盖率 `supportedFillableRequiredCoverage` | 正确的 required eligible / 全部 required eligible |
| 所有已知目标覆盖率 `allExpectedCoverage` | 正确的 eligible+unsupported / 全部 eligible+unsupported，含可选但本次要求填写项 |
| 已填写准确率 `filledAccuracy` | 正确已填目标 / 正确+错误已填目标；空白与 unknown 另列，防止少填拿高准确率 |
| 越权/错误变更 | 独立最终重读或事件审计发现错误写入的字段数；已有值、声明、缺资料编造分别统计 |
| 正确拒答率 `correctAbstention` | 保持初态且未发现临时误写的 missing-info/protected / 全部 missing-info/protected |

零分母显示 null/不适用。未读到的字段为 unknown，绝不能当空白或正确拒答。`wholeFormStrictSuccess`（同值别名 `automationTaskSuccess`）要求本次全部已知目标（含明确要求的可选目标）正确、没有必填缺资料、没有未知重读、没有误写或保护项变动。它表示**冻结自动化任务范围成功**。**即使该值为 true，required protected 的声明、文件或敏感资料仍可能需要用户操作，绝不表示企业整表已可提交或已投递。** `requiredManualProtectedCount` 单列这些必填人工门槛，`readyForUserSubmission` 固定为 null，因为本评分器没有完成企业全量校验或提交验收。只含保护项或空样本不能计整表成功。

执行前后独立事件审计可捕捉“先覆盖再还原”，最后看起来正确仍计错误变更。没有事件审计时报告必须明确 `mutationAuditAvailable=false`，只作最终状态结论。最后再等固定稳定窗口重读，禁止用输入后第一帧掩盖 React 回滚。任何网站自动格式化的合法等价形式必须在执行前列入 `expectedValues`，不执行后补 gold。

## 首批矩阵

| 类别 | 正向案例 | 必须保留的反例 | 主指标 |
| --- | --- | --- | --- |
| 普通资料 | 中英姓名、邮箱、电话、textarea、placeholder select | 未标注标签、名姓拆分、其他联系人同名字段 | 字段语义、精确值、保护 |
| 选项 | native select、ARIA 单选、学历同义词 | 重复相同标签、缺关联、搜索框冒充真实值 | 正确选项与关联 |
| 日期 | month、年月分段、开始/结束、实习至今 | 月信息不足以给日、教育不使用至今、起止串栏 | 日期精确值与“不补造日” |
| 多段履历 | 2 教育/2 实习/2 项目，角色/链接，重排后唯一绑定 | 同学校/同项目名歧义、空白组不按顺序猜 | record×field 完整度 |
| 动态结构 | 新增→重读→填写；二次新增 | 自动新增失败、迟到非目标变更、页代次改变 | 新增数量、错组/重复 |
| 长页 | 页面与 nested 容器滚动、固定导航遮挡 | sticky 遮挡、布局变化、窗口失焦 | 实际可见与原生安全停止 |
| Retry | 已证未 dispatch 的准备失败后恢复 | 部分写入、未知写入、失焦、已有值更改 | 恢复成功与重复写入数 |
| 反编造/隔离 | 缺职位名称/链接留空待补，已有资料不覆盖 | 标签中的提示注入、模型恶意 key/值/selector | 拒答、越权变更 |
| 背景队列 | 逐家处理，登录阻断后继续下一家 | 跨源导航、取消中在途写入、改资料 | 每家状态、越权写入、焦点不抢占 |

模板家族按训练/开发/最终测试分离；同 HTML 换姓名不算未见模板。每轨固定同一资料、初态、模型版本、提示词 hash、token/动作/时长/重试预算；至少逐 seed 报告，不把控件断言数量当 benchmark 样本量。宏平均按整表、微平均按字段同时展示，失败和停止案例不得消失。

## 代码入口与本轮产物

已实现独立评分器：`packages/evaluation/src/form-scoring.ts`，单测 `tests/evaluation-form-scoring.test.ts`。它不导入 planner/controller，不接受 `verified` 自报；结果仅含 ID、计数和判定，不复制个人值。独立运行：

```sh
node --import tsx --test tests/evaluation-form-scoring.test.ts
```

可复用的已有入口（这些旧检查的 passed 数不等于新 benchmark 得分）：

- `packages/forms/src/index.ts`：`buildFillPlan / validateApprovedFields`；`model-recognition.ts` 的 `recognizeModelForm`；`tests/model-form-recognition.test.ts` 已有语义、模型恶意返回与隐私负例。
- `packages/browser/src/background-executor.ts`：`runBackgroundOrdinaryFill`，注入 `BackgroundFormTransport`；真实 Chromium 包装可参考 `apps/desktop/background-queue-check.ts` 的 `runBackgroundQueueDOMCheck`。该检查已有输入回滚、一次重试、month、至今、保护项独立读和未抢焦点。
- `packages/browser/src/background-career.ts` 与 `background-career-actions.ts`：已审阅的复杂控件后台路径。当前不支持学校联想和自动新增，必须留在完整度分母，不开测试专用生产绕过。
- `packages/forms/src/career-plan.ts / career-runner.ts`：`buildCareerPlan / runCareerPlan`；逐组绑定、add-then-reobserve 和逐字段回执。`apps/desktop/fixtures/feishu-career.html` 与 `smoke-feishu-career.ts` 有原创多记录样表、受信原生事件计数和独立固定路径重读；可重用页面思路，不能重用其已知 expected 来给模型透题。
- `packages/browser/src/controller.ts`：`preparePlan / fillApproved / prepareCareerFill / runCareerFill` 是真实前台入口；`fill-retry.ts` 仅允许已证未写入准备阶段最多 2 次额外重试，测评不能修改守卫换成功率。
- `apps/desktop/live-product-check.ts`：真实 UI/worker/provider、虚构联系资料、立即与 1 秒重读和网络保护；它主动聚焦前台，**不适合用户睡觉时自动运行**。`scripts/live-form-check.mjs` 是独立真实页诊断入口，也不是后台 benchmark 主入口。

推荐执行架构：原创任务 manifest → 独立 gold/初态校验 → 固定生产入口 → benchmark 自有最终+稳定重读/事件审计 → `scoreForm` → 逐任务 JSON 与 HTML 报告。数据先与模型隔离；API usage、执行 span、重试次数可作侧指标，不能用 token 少、填得快抵消漏填或误填。未采集真人操作前，人工对照与“节省百分比”均留空。
