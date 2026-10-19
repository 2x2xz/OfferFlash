# OfferFlash 检索与遥测评测

核对日期：2026-10-19。本轮是可运行的离线检索基线和现有遥测统计口径审阅，未接入生产资料读取或自动填写，没有读取正常私库、调用模型、访问真实企业申请或提交申请。

## 先测什么

岗位匹配与整表填写是主任务。检索测试用来解释失败发生在哪里：是没有找到正确的项目资料，还是找到了资料却选错字段、没有写入或写错了。hit 很高不能证明整表正确，更不能证明岗位适合本人。

建议分开冻结三个检索集合：公开岗位 JD、虚构确认履历事实、虚构申请答案。每个问题有 query ID、候选库 hash、相关证据 document ID、0–3 级相关性和标注来源。不要把岗位匹配程序自身的输出作为相关性 gold；不要把完整目标答案复制进 query，导致词法基线轻易命中。

[BEIR 原论文](https://arxiv.org/abs/2104.08663)使用多个领域来检查检索方法的泛化，官方[评测接口](https://github.com/beir-cellar/beir)提供 nDCG、Recall、Precision、MAP 和 MRR。本项目借鉴其候选库、查询、qrels、run 的分离方式；目前没有下载 BEIR 数据，也不声称自有招聘集合是公开标准榜单或 BEIR 成绩。

## 已实现的检索库

`packages/evaluation/src/retrieval.ts` 提供 `LocalRetrievalIndex`。它是项目拥有的、本地可持久化的词法检索库，使用 BM25（k1=1.2、b=0.75），没有 embedding 或向量数据库。中文采用字与相邻双字片段，英文采用小写词；NFKC 统一全半角。同义改写、简称和跨语言查询属于这个基线的能力限制，后续可以用同一 gold 对比 embedding 或 reranker，不能把今天的结果写成语义检索能力。

每条文档保留 `id/sourceId/entityId/kind/title/text/scope`。普通私有事实另外保留 `profileVersion/recordVersion/confirmedVersion`。检索前先过滤，再计算词频和排名：

- 私有事实要求宿主提供当前资料版本，以及对应实体当前修订号，且文档的确认修订等于当前修订。
- 申请限定答案还要求精确 `applicationId`。只有明确设成 profile 范围的普通资料才允许跨申请检索。
- `sourceIds/entityIds/kinds` 支持进一步限定来源、具体经历和材料类别；不允许越权文档改变允许集合的排序分数。
- 相同分数按 document ID 排序。库的 SHA-256 由按 ID 排序的严格文档投影计算，输入顺序改变不会改变 hash；重复 ID 直接报错。
- JSON 文件使用原子替换、文件权限 0600、直接文件/父目录 symlink 拒绝与载入 hash 校验。它不是证件保险库，也不提供加密；当前基准只放原创虚构资料和可公开岗位，不放密钥、登录态、证件号码或真实用户简历。

接口示例（虚构数据）：

```ts
const index = new LocalRetrievalIndex([{ id: 'project-a-role', sourceId: 'fictional-resume',
  entityId: 'project-a', kind: 'confirmed-fact', title: '项目角色', text: 'RAG 项目主要开发者',
  scope: { type: 'profile' }, profileVersion: 4, recordVersion: 2, confirmedVersion: 2 }]);
await index.save('/tmp/offerflash-benchmark/index.json');
const restored = await LocalRetrievalIndex.load('/tmp/offerflash-benchmark/index.json');
const hits = restored.search('RAG 项目角色', { k: 5,
  context: { profileVersion: 4, entityVersions: { 'project-a': 2 }, applicationId: 'application-a' } });
```

生产 Agent、资料 store、11 个领域工具和填表执行器没有在本轮改成 RAG 驱动。调用者必须从受控的确认事实构造文档，不能把任意网页正文当作宿主指令，也不能直接把命中项变成字段写入授权。若以后接入生产，仍须在写入前复核原事实版本、字段归属和当前网页，保留原有用户确认。

## 指标与缺失值

指标依据 [ir-measures 的指标说明](https://ir-measur.es/en/latest/measures.html)，实现固定了相关阈值与 nDCG 变体，避免只写一个模糊的 hit。

| 输出 | 本项目的精确定义 |
| --- | --- |
| `hitAtK` | 前 k 条至少有一条 grade≥1，取 1，否则 0；对应 Success@k |
| `recallAtK` | 前 k 条不同相关 ID 数 / gold 中所有 grade≥1 的不同 ID 数 |
| `reciprocalRankAtK` | 前 k 条首个相关项名次的倒数，否则 0；跨查询均值才叫 MRR@k |
| `ndcgAtK` | DCG/理想 DCG，gain=2^grade−1，折扣=log2(rank+1)，grade 固定 0–3 |
| `judgedReturnedFraction` | 实际返回前 k 条中已有人工判断的比例；不拿它代替检索质量 |

`qrels=null/undefined` 返回 `missing-gold`；提供空集合或所有 grade=0 返回 `no-relevant-gold`。两种情况下质量指标都是 null，汇总显示各自排除数，不算作 0 或 100%。存在相关 gold 但系统没有返回任何项则为真实 0 分。返回未标注项按 0 gain 计算并显示判断覆盖率；不把未标注当成经过人工认定不相关。重复排名 ID、重复 gold ID、非法 grade 或混合 k 的均值直接失败，避免人为抬高分数。

对无答案问题另报“正确拒答/越范围泄漏”任务结果，不能因为相关集为空而自动奖励检索系统。实体过滤及修订过滤也必须有负例：相邻两个项目名字相似、旧项目角色修改、同题答案仅适用于另一家企业。

可重复验证：

```sh
node --import tsx --test tests/evaluation-retrieval.test.ts
npm run typecheck
```

专项测试包含手算分数、空/missing gold、全部漏检、重复、排序稳定、重载、损坏 hash、symlink，以及资料版本/实体/申请范围隔离。单测通过只证明实现契约，不是生产 RAG 质量分数。

## OpenTelemetry 用于效率统计

已有生产 `packages/telemetry/src/store.ts` 使用真实 OTel SDK，保留动作名、时长、计数和 usage，过滤资料值、URL、提示词与异常原文。`packages/ui/src/telemetry.ts` 组织阶段显示；`comparison.ts` 只接受同场景、相同目标字段、同空白起点且人工复核完成的配对记录。

[OTel GenAI 属性定义](https://opentelemetry.io/docs/specs/semconv/registry/attributes/gen-ai/)规定标准 input token 数包含缓存输入；GenAI 约定目前已迁至[独立官方仓库](https://github.com/open-telemetry/semantic-conventions-genai)，发布报告应记录所用语义版本，不能假设所有属性稳定不变。

当前 Pi SDK 1.1.0 的 `dist/api/openai-completions.js` 在 `parseChunkUsage` 中把 raw prompt tokens 拆成 `input/cacheRead/cacheWrite`，`openai-responses-shared.js` 同样从输入总量中减缓存。因此现有宿主映射 `gen_ai.usage.input_tokens = input + cacheRead + cacheWrite` 是对应当前 SDK 的正确映射；不能看到标准要求包含缓存就再把缓存叠加一次。直接使用供应商 raw usage 时，必须走对应解析而不是套用 Pi 拆分假设。`totalTokens` 以已核对的供应商/SDK usage 为准；没有 usage 就保留 unknown。faux 的估算不能当付费模型实测。

建议每条 benchmark run 记录以下量，各自有样本数和测量范围：

- 识别、检索、计划、执行、独立重读的毫秒数；有重叠的 span 求区间并集，不将父跨度与子跨度累加成执行时间。
- 真正模型调用数、输入（含缓存）/输出/缓存分项、供应商/模型和 usage 缺失数。规则路径的模型调用与 token 为 0，无法证明模型更省。
- 单位正确核实字段的 token、完整表单耗时、重试/接管次数；分母来自独立最终 oracle，不来自模型自报成功。
- P50/P95、失败/中断/取消数和超时预算。少量样本的均值不能代表稳定性，不能删掉失败样本来美化成功耗时。
- 人工与 Agent 比较必须包含最终核对/修正时间。自动脚本不能当“纯人工”，尚未真实采集的人类基线显示未采集，不编造节省比例。

token 不是费用。费用需要供应商、模型版本、调用日期、是否缓存命中及当时单价；不能只拿总 token 乘一个统一价格。网络加载、登录和验证码是否纳入计时也要明确，不把内部执行时长写成完整求职耗时。
