<div align="center">

<img src="apps/desktop/assets/icon.png" width="104" alt="OfferFlash" />

# OfferFlash ⚡

**简历只想写一次，网申不想再填十遍。**

一个围绕求职申请打造的 **AI-Native 桌面 Agent**：找岗位、整理履历、填写网页、检查结果，并记住你愿意复用的信息。

**Agent Stack** · Pi SDK · 12 Tools · 3 Skills · Human-in-the-loop · Scoped Memory

**App Stack** · Electron · React · TypeScript · BrowserController · SQLite · OpenTelemetry

[**下载 macOS 预览版 ↗**](https://github.com/2x2xz/OfferFlash/releases/tag/v0.24.0-preview.1) · [观看官网演示](#真实网页演示) · [技术架构](docs/architecture.md)

<sub>macOS · Apple Silicon · v0.24.0-preview.1</sub>

</div>

---

## 不只是自动填表，而是一套可以继续使用的求职工作台

求职最麻烦的，不是填好某一家公司的申请，而是换一个网站又要重新开始：上传简历、录入经历、查找岗位、核对表单，最后还得记住投到了哪一步。

OfferFlash 把这些事情放在同一个桌面工作区。**确认过的履历可以反复使用；Agent 能处理的交给它执行，拿不准的先问你，填写完再一起核对。**

## 真实网页演示

**01 / 在招聘官网填写履历**

左边是 Agent 工作区，右边是实际招聘网页。OfferFlash 可以读取页面、匹配已确认的资料，填写教育、实习和项目经历，并检查实际写入的内容。

<p align="center">
  <img src="docs/screenshots/offerflash-workspace-autofill.gif" alt="OfferFlash 在招聘官网填写教育、实习和项目经历" width="100%" />
</p>

<p align="center"><sub>官网操作节选 · 4× 播放 · 虚构履历 · 未提交申请</sub></p>

**02 / 缺什么就问，填完还能直接定位**

填写中遇到缺失信息，Agent 可以直接在对话区提问，收到回答后继续当前任务。完成后，待处理项会集中显示；点击「定位」，网页就会滚动到对应字段，方便直接检查。

<p align="center">
  <img src="docs/screenshots/offerflash-actionable-review.gif" alt="OfferFlash 从待处理卡片定位到网页字段" width="100%" />
</p>

<p align="center"><sub>官网原速操作节选 · 定位只会滚动和高亮，不会修改字段</sub></p>

[查看演示与字段核对记录 →](docs/model-workspace-demo.md)

## 让 Agent 真正帮上忙的几个设计

<table>
  <tr>
    <td width="50%" valign="top">
      <strong>📄 一份履历，多次复用</strong><br/><br/>
      导入 PDF、DOCX 或 TXT 简历，整理并确认教育、实习与项目经历。申请新岗位时，从已有资料出发，不必重新整理。
    </td>
    <td width="50%" valign="top">
      <strong>⚡ 网页操作可检查</strong><br/><br/>
      Agent 负责理解表单，BrowserController 负责实际操作。执行前核对页面和字段状态，填写后读回结果；不确定的内容保留给用户处理。
    </td>
  </tr>
  <tr>
    <td valign="top">
      <strong>💬 填写中随时问你</strong><br/><br/>
      资料不够时直接提问，回答后继续原任务，不必从头开始。未完成和需要核对的字段可以一键定位。
    </td>
    <td valign="top">
      <strong>🧠 问过的，下次不必再问</strong><br/><br/>
      普通答案经用户主动保存、确认后进入本地答案库。通用信息可以跨申请复用，公司或岗位专属答案则限定使用范围，避免填错地方。
    </td>
  </tr>
</table>

### 一个工作区，管理从找岗位到申请跟进

<table>
  <tr>
    <td width="33%" align="center">
      <img src="docs/screenshots/showcase/offerflash-home.png" alt="OfferFlash 申请总览" /><br/>
      <sub>申请总览</sub>
    </td>
    <td width="33%" align="center">
      <img src="docs/screenshots/showcase/offerflash-apply.png" alt="OfferFlash Agent 与浏览器工作区" /><br/>
      <sub>Agent + 招聘网页</sub>
    </td>
    <td width="33%" align="center">
      <img src="docs/screenshots/showcase/offerflash-profile.png" alt="OfferFlash 履历管理" /><br/>
      <sub>履历资料</sub>
    </td>
  </tr>
</table>

<sub>界面截图采用示例资料。岗位发现与进度管理支持已接入的招聘来源。</sub>

## Agent 是怎么工作的？

**用户意图 → Agent 规划与工具调用 → 网页观察 → 受控执行 → 结果读回 / 向用户确认**

| 技术模块 | 在 OfferFlash 中负责什么 |
|---|---|
| **Pi SDK · Agent Harness** | 管理模型会话与工具执行；通过 **12 个结构化工具、3 个按需加载的 Skills** 连接岗位、资料与申请操作 |
| **Tool Calling · Human-in-the-loop** | 遇到缺失或模糊信息时提问，等待确认后继续当前任务；用户保留关键操作的决定权 |
| **Persistent & Scoped Memory** | 使用本地答案库保存经过确认的普通回答，按通用或具体申请范围检索复用；临时回答不会自动变为长期记忆 |
| **BrowserController · Guardrails** | 观察真实 DOM，核对页面状态、字段原值与目标位置，由受控执行器写入，再独立读回确认 |
| **SQLite · OpenTelemetry** | 保存履历与申请状态，并记录可用于调试和评测的执行阶段、耗时与工具行为 |

模型负责判断，应用负责执行和核验。**Agent 不需要直接拥有浏览器或本地数据的全部权限**，也不以模型声称“已完成”代替实际页面结果。

[查看完整架构与模块入口 →](docs/architecture.md)

## 用实际结果验证，而不是只展示 Demo

<table>
  <tr>
    <td width="50%" align="center">
      <h3>34 项</h3>
      <strong>官网履历字段核对一致</strong><br/>
      <sub>单站实际演示：同一窗口续填后的指定字段读回</sub>
    </td>
    <td width="50%" align="center">
      <h3>93.3%</h3>
      <strong>普通草稿任务严格完成</strong><br/>
      <sub>历史 v0.15.0 回归：20 家官网 × 3 组并发，56/60</sub>
    </td>
  </tr>
</table>

岗位推荐也经过独立对比：在 **150 条真实岗位快照、6 份虚构履历、18 次查询**上，关键词召回加模型重排的职责相关比例为 **58/80（72.5%）**，高于同批次测试的纯语义与混合检索方案。

这里的数字各有明确范围：34 项是单站目标字段核对，93.3% 是普通草稿任务完成率，72.5% 是职责相关性，不能视为所有招聘网站的整表成功率或“确认可投递率”。

[官网演示验证](docs/model-workspace-demo.md) · [历史任务评测](docs/demo-metrics.md) · [岗位匹配实验](docs/release/qualification-retrieval-v2.md)

## 从填一次表，到持续复用的求职 Agent

OfferFlash 的长期方向不是把一次网申自动点击完，而是让**已经确认的资料、处理过的问题和可验证的操作能力，成为下一次申请的起点**。

项目正在围绕三个方面持续迭代：支持更多招聘页面与复杂控件；让确认过的答案更容易管理和安全复用；通过真实场景、失败轨迹和回归测试提高执行可靠性。每次更新都优先解决实际使用中遇到的问题，而不是增加一串用不到的功能。

[查看当前预览版更新记录 →](docs/release/offerflash-0.24.0-preview.1.md)

## 立即体验

**macOS · Apple Silicon**：[下载 OfferFlash v0.24.0-preview.1](https://github.com/2x2xz/OfferFlash/releases/tag/v0.24.0-preview.1)

从源码运行需要 Node.js 22.19 或更新版本：

~~~bash
npm ci
npm start
~~~

在线 Agent 功能需要配置自己的模型 API Key。OfferFlash 辅助完成申请草稿，登录、验证码、附件上传和最终提交仍由用户操作。

---

<p align="center">
  <a href="docs/architecture.md">Architecture</a> ·
  <a href="docs/model-workspace-demo.md">Demo</a> ·
  <a href="docs/demo-metrics.md">Evaluation</a> ·
  <a href="docs/privacy.md">Privacy</a> ·
  <a href="THIRD_PARTY_NOTICES.md">Third-party notices</a>
</p>
