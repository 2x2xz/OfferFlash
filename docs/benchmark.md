# OfferFlashBench：怎么判断 Agent 做得好不好

先看两件事：推荐给你的岗位是否适合，以及网申是否真正填完整、填正确。RAG 命中和运行速度用来解释结果，不能替代这两个主指标。

先打开[能力体检看板](benchmark-dashboard.html)，再查看[逐项结果与限制](benchmark-results.md)。

## 当前有哪几组实验

| 实验 | 输入与标准答案 | 真正执行了什么 |
|---|---|---|
| 岗位推荐 | 6份虚构CV、36个原创岗位、216条明确标注；dev/test各18岗位 | 现有应用推荐流程、关键词、BM25、真实千问 Flash 分别返回最多5条 |
| 完整排序诊断 | 同一组数据，要求输出全部18个候选ID | 单独检查语义排序和输出协议；不与最多5条推荐混分 |
| 普通表单 | 16种原创样表、76个字段；资料、初态、答案分离 | 后台DOM执行48轮、原生规则16轮、真实模型映射的原生回放8轮；计划诊断另列 |
| 已适配履历扩展 | 两段教育、实习、项目与明确日期；另有至今、缺资料样本 | 生产原生执行器实际新增经历、选学历/年月/至今，再用独立代码读网页 |
| 检索 | 18条文档、22个查询，确认版本与申请范围分开 | 持久化BM25词法库，含过期资料、别的申请答案和无答案场景 |
| Pi工具协议 | 原有11个固定业务场景、虚构业务库 | 真实Pi会话与真实模型调用；检查实际用工具、调用顺序和参数 |
| 官网证据 | 腾讯、MiniMax、面壁的匿名公开接口 | 有界采集与离线响应重放；完整JD只在本地，尚无真人相关性gold |

这是**项目自有的合成诊断集**，不是公开排行榜。标签由项目编写者在执行前固定，没有独立人工标注；模板家族ID隔离不证明从未见过的语义泛化。真实模型的随机性、服务端权重版本和小样本限制仍在。没有读取普通应用数据库，没有提交企业申请。

## 岗位：语义与资格分开

nDCG衡量合适的语义结果是否排在前面，Precision/Recall/MRR分别衡量前K条、覆盖与首个相关结果。这些做法可参考 [ConFit](https://github.com/jasonyux/ConFit)、[BEIR](https://github.com/beir-cellar/beir)。它们不能单独判断国内地点、毕业时间、学历、招聘类型和截止日期。

因此我们另外标注资格。相关性0–3分，2以上算语义相关；**明确符合资格且语义相关**才算“确认合适”。资格未知不当作不合适，也不当作通过。

最多推荐5条时，同时报告：

- 确认合适、确认不合适、适合性未知各多少条，实际返回几条。
- 确认合适下界 = 确认合适数 / 每份CV的5个推荐槽位。
- 可能合适上界 =（确认合适数 + 适合性未知数）/ 5。没有返回的槽位不会假装命中。
- 已知合适子集召回，以及已核对资格中的违例率；每项保留分母和未知数量。

`deriveApplyFlow` 的实际排除与排序逻辑单独调用。裸规则排名包括低位不适合岗位，不能把其Top-K违例直接当作APP已展示的推荐违规。虚构数据的demo显示标志只在隔离回放输入里关闭，正常资料库没有改变。

最多5条推荐协议是在完整18-ID诊断后新增的补充实验，两个协议的结果都保留；不能把输出格式任务改变后的分数说成“同一任务提升”。模型还看得到额外的明确求职偏好，而旧Profile类型不能表达全部偏好，因此这是产品管线诊断，不是纯模型架构的公平竞赛。

## 表单：填对少数项不等于完成

借鉴 [WebArena](https://github.com/web-arena-x/webarena) 与 [WorkArena](https://github.com/ServiceNow/WorkArena) 的最终状态核对方式，标准答案留在宿主，网页和模型看不到oracle。执行后读取实际控件，检查非目标字段及事件；不使用执行器自报verified来给自己打分。

主指标是 **全部普通必填覆盖率**：正确的必填项 / 所有非保护必填项，包含缺资料和不支持控件。另一项是 **已填准确率**：实际填入的值中有多少正确。这两个数字必须并排看。

`eligible`是冻结的普通已知目标范围，包含后台可填的毕业month；前台不支持该控件时仍记能力缺口。多段教育、日期、下拉等不会因被skip就从完整度分母消失。声明、文件、身份证等人工门槛单列，普通任务成功不表示企业整表可提交。

网页主动清空输入、延迟回滚、修改其他字段分别注入。环境造成的保护项状态变化与Agent直接误写分开保留；安全停止也会降低该轮完成度，不能笼统归因成模型乱填。已适配履历扩展没有独立全过程值变更审计，所以只报告最终值正确与可信动作，不能声称排除了全部瞬时误写。

## RAG和效率

RAG轨目前是本地持久化的BM25词法基线，中文采用字/双字片段，支持来源、具体经历、资料修订和申请范围过滤。它不是embedding或向量库，也尚未接到普通应用的自动填写。hit@1/3/5与Recall/MRR/nDCG检查取回的证据ID；命中资料不代表填进了正确位置。

用量来自真实SDK返回的usage，未用字符数估token；Pi的非缓存input、缓存读写与output不重复相加。没有用价格表估费用。模型请求延迟、含页面加载/核对的填写耗时分别记录；原生映射回放不会重复计一次模型调用。请求数少于20时不报P50/P95。不同任务/引擎按组比较，失败和partial耗时不隐藏。

补充推荐12次调用保存聚合usage，缺逐请求usage档案；主实验与Pi轨可逐请求/轨迹重算。

OpenTelemetry使用项目已有真实SDK和本地exporter，父/子span时间按并集处理，不把容器和子节点重复求和。没有真人同起点、同目标并完成复核的配对样本，**不计算“比人工快多少”**。

## 自己运行

```sh
npm ci
npm run bench -- --output=.backups/my-run --repeats=3
# 加 --native 在独立虚构窗口测试原生输入；失焦照常停止。
# 加 --live --key-stdin 使用真实模型，Key不回显、不落盘。

npm run bench:career -- --output=.backups/my-career
npm run bench:recommendations -- --key-stdin --output=.backups/my-shortlist
npm run bench:agent-live -- --key-stdin --mode=live --provider=custom --model=qwen-flash --base-url=https://dashscope.aliyuncs.com/compatible-mode/v1 --output=.backups/my-agent/report.json --usage-output=.backups/my-agent/usage.json
```

基础诊断默认最多20次模型请求，推荐补充最多12次；工具协议按11场景、每场景12次工具体调用/45秒限制运行。API是你配置的付费服务，使用自己的专用Key。CLI不读取正常应用凭据。

退出0表示该组诊断证据产出完整，**不表示能力全通过**；性能失败、规则回退、格式不符、缺资料都在报告内。主实验数据与执行源码/bundle的hash在实验前后核对。补充推荐首轮仅校验明确列出的六个源码/锁文件，不声称全部依赖图冻结；另已对保存的48行推荐评分离线重算，全部一致。后续脚本扩大依赖hash与逐请求usage存档，不回填历史。原始完整排序与原始结果不覆盖，事后策略分析单独声明。

## 用真实官网岗位评阅自己的CV

```sh
npm run bench:collect -- --output=.backups/public-job-review
npm run bench:review -- --evidence=.backups/public-job-review --resume=/path/to/your-resume.pdf
```

得到本地 `job-review.private.html`：右边看完整官网JD，左边可临时对照CV；标签初始为空，不预填模型分数。逐条人工确认后下载JSON，再运行：

```sh
npm run bench:score-review -- --source=.backups/public-job-review/review-source.private.json --labels=/path/to/review.json --ranking=.backups/public-job-review/personal-cv-candidates.private.json --output=.backups/public-job-review/scored.json
```

标签绑定岗位快照、每个JD正文hash及简历hash，防止换CV后继续沿用旧分数。未评保持unknown，未标齐不凭空给Recall/nDCG。界面勾选不认证操作者身份，也不等于双人独立裁决。CV不导出、不联网、不写正常应用；完整JD、个人候选事实和人工标签留在被忽略的本机目录。

已有实验目录可离线导出标准OTLP JSON与可视化时间线（不再次调用模型）：

```sh
npm run bench:otel -- --base=.backups/my-run --career=.backups/my-career --output=.backups/my-observability
```

本轮保留原始目录时，还可运行 `npm run bench:verify` 离线复核保存评分、索引、冻结源码与跨度，不调用模型。`npm run bench:summary` 可重建汇总HTML。

导出为 `otel-otlp.json` 和 `trajectory.html`，可以直接在本地打开；轨迹保留真实跨度与父子关系。补充的Pi工具协议只有真实流用量，不捏造其工具OTel树。完整度/正确率为主指标，Token和速度为辅助。测评脚本只启动独立窗口；正常应用与网页草稿保留。

完整研究记录见源码的 `docs/research/benchmark-*-survey.md`。本轮结果见 [诊断结果与限制](benchmark-results.md)。

## v0.11.1 同集修复复测

最新[修复对比](benchmark-repair.html)保留原数据和评分器，前台规则19/25、真实模型响应重放19/25，后台3轮54/75；只表示同集回归，不表示未见网站泛化。month采用有焦点/完整快照守卫的隔离原子YYYY-MM写入，其余前台动作仍使用原生输入。3项缺资料、2个无可靠绑定的下拉和1个网站回滚字段不从分母删除。

可先用真实字段识别，再在不重复花费的情况下重放相同输入的响应：

```sh
npm run bench -- --native --live --key-stdin --live-scope=forms --output=.backups/live-fields
npm run bench -- --native --replay-form-mappings=.backups/live-fields/live-form-mappings.json --output=.backups/replayed-fields
```

重放需原始报告有真实调用与完整usage证据，每个输入hash必须一致；本轮请求数仍为0，不能重复计API用量。招聘类型偏好在个人资料明确保存后生效，旧资料不自动改成“仅校招”。学历否定替代与强制毕业窗口已修正；模型排序不替代主进程硬资格筛选。
