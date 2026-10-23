<div align="center">

<img src="apps/desktop/assets/icon.png" width="104" alt="OfferFlash" />

<h1>OfferFlash ⚡</h1>

<p><strong>简历只想写一次，网申不想再填十遍。</strong></p>

<p>一个帮助求职者整理简历、查找岗位、填写招聘网页和管理申请进度的桌面 Agent。</p>

<p>
  <a href="https://github.com/2x2xz/OfferFlash/releases/tag/v0.24.0-preview.1"><strong>下载 macOS 预览版 ↗</strong></a>
  &nbsp;·&nbsp;
  <a href="docs/model-workspace-demo.md">官网演示</a>
  &nbsp;·&nbsp;
  <a href="docs/architecture.md">技术设计</a>
</p>

<sub>macOS (Apple Silicon) · Electron · React · TypeScript · Pi SDK</sub>

</div>

---

## ⚡ 看看它怎么填写网申

左边是 OfferFlash 的 Agent 工作区，右边直接打开招聘网页。确认过的教育、实习和项目经历可以在不同表单中复用，填写后再检查网页里的实际结果。

<p align="center">
  <img src="docs/screenshots/offerflash-workspace-autofill.gif" alt="OfferFlash 在招聘官网填写教育、实习和项目经历" width="100%" />
</p>

<p align="center"><sub>招聘官网实际操作节选 · 4× 播放 · 示例履历 · 未提交申请</sub></p>

**填到一半缺资料怎么办？** Agent 可以直接在对话里询问，确认答案后继续当前任务，不需要从头操作。填写结束后，未完成或需要确认的字段会集中显示；点击「定位」，就能在右侧网页中找到对应位置。

<p align="center">
  <img src="docs/screenshots/offerflash-actionable-review.gif" alt="OfferFlash 从待处理卡片定位到招聘网页中的对应字段" width="100%" />
</p>

<p align="center"><sub>官网原速操作节选 · 点击「定位」只会滚动和高亮字段，不会修改内容</sub></p>

[查看完整演示说明与核对记录 →](docs/model-workspace-demo.md)

## 为什么做 OfferFlash？

求职时，同一份简历往往要填进不同公司的招聘系统。学校、实习、项目明明已经整理过，换一个网站却要重新录入；遇到日期选择器、下拉框或者多段经历，操作又各不相同。

OfferFlash 把这些步骤放进一个桌面工作区：**先确认资料，再由 Agent 辅助完成能确定的填写；缺少信息时询问用户，填写后把结果交还给用户核对。** 岗位搜索和投递记录也放在一起，方便接着处理。

## 主要功能

<table>
  <tr>
    <td width="50%" valign="top">
      <strong>📄 简历管理</strong><br/><br/>
      导入 PDF、DOCX 或 TXT 简历，整理教育、实习和项目经历，确认后可在申请中复用。
    </td>
    <td width="50%" valign="top">
      <strong>⚡ 网申辅助填写</strong><br/><br/>
      在内置浏览器中查看真实招聘表单，匹配已有资料，执行填写并读回核对。
    </td>
  </tr>
  <tr>
    <td valign="top">
      <strong>💬 填写中提问</strong><br/><br/>
      遇到缺失或不确定的信息，直接询问；用户确认后继续当前任务，待处理字段可以定位检查。
    </td>
    <td valign="top">
      <strong>📌 岗位与进度管理</strong><br/><br/>
      检索已接入来源的岗位，记录待申请、笔试、面试等状态；多个申请可以分别处理。
    </td>
  </tr>
</table>

### 工作台

<table>
  <tr>
    <td width="33%" align="center">
      <img src="docs/screenshots/showcase/offerflash-home.png" alt="OfferFlash 投递总览" /><br/>
      <sub>申请总览</sub>
    </td>
    <td width="33%" align="center">
      <img src="docs/screenshots/showcase/offerflash-apply.png" alt="OfferFlash 申请工作区" /><br/>
      <sub>Agent 与招聘网页</sub>
    </td>
    <td width="33%" align="center">
      <img src="docs/screenshots/showcase/offerflash-profile.png" alt="OfferFlash 个人资料" /><br/>
      <sub>履历资料</sub>
    </td>
  </tr>
</table>

<sub>工作台截图使用示例资料。</sub>

## 🛠️ 技术实现

**确认资料 → 读取网页 → 匹配字段 → 受控填写 → 读回检查**

OfferFlash 使用 **Pi SDK** 管理 Agent 会话，通过 **Electron + React** 提供桌面工作区。模型负责理解用户需求、判断资料与表单字段的对应关系；实际网页操作则交给 **BrowserController**，由执行器核对页面状态、字段原值和操作结果。

简历资料、岗位和申请记录保存在本机 SQLite。Agent 工具和 Skills 按任务调用，执行过程有权限和状态检查；信息不足时不会直接猜填。

[查看系统架构与工具设计 →](docs/architecture.md)

## 📊 实测结果

<table>
  <tr>
    <td width="50%" align="center">
      <h3>34 项</h3>
      <strong>官网履历字段回读一致</strong><br/>
      <sub>两段教育、两段实习、两个项目；同一窗口续填后完成核对</sub>
    </td>
    <td width="50%" align="center">
      <h3>56 / 60</h3>
      <strong>普通草稿任务严格完成</strong><br/>
      <sub>历史 v0.15.0 回归：20 家官网 × 3 组并发，93.3%</sub>
    </td>
  </tr>
</table>

在另一组岗位推荐实验中，使用 **150 条真实岗位快照、6 份示例履历和 18 次查询**，关键词召回加模型重排的职责相关比例为 **58/80（72.5%）**。

这些数字来自不同范围的测试：34 项是单站官网演示的指定字段核对结果；56/60 主要覆盖普通联系字段；岗位相关性也不等于资格审核通过率。详情见 [网申评测记录](docs/model-workspace-demo.md)、[历史测试数据](docs/demo-metrics.md) 和 [岗位推荐实验](docs/release/qualification-retrieval-v2.md)。

## 🚀 运行 OfferFlash

**macOS · Apple Silicon**：[下载 v0.24.0-preview.1 预览版](https://github.com/2x2xz/OfferFlash/releases/tag/v0.24.0-preview.1)

**从源码运行**需要 Node.js 22.19 或更新版本：

~~~bash
npm ci
npm start
~~~

使用在线 Agent 功能需要配置自己的模型 API Key。OfferFlash 用于辅助填写与核对，登录、验证码、附件上传和最终申请提交仍由用户完成。

---

<p align="center">
  <a href="docs/architecture.md">Architecture</a> ·
  <a href="docs/model-workspace-demo.md">Demo</a> ·
  <a href="docs/demo-metrics.md">Evaluation</a> ·
  <a href="docs/privacy.md">Privacy</a> ·
  <a href="THIRD_PARTY_NOTICES.md">Third-party notices</a> ·
  <a href="docs/release/offerflash-0.24.0-preview.1.md">Release notes</a>
</p>
