# 验证范围

`npm run check` 包含类型检查、行为测试、固定 Skill 检查和源文件发布检查。原生输入与 UI 还需 Electron 图形环境，独立隐藏验收使用原创样表、虚构资料和隔离目录，不能替代真实企业验收。

```sh
npm run build
node_modules/.bin/electron apps/desktop/main.cjs --smoke-test --smoke-field-companion-only
node_modules/.bin/electron apps/desktop/main.cjs --smoke-test --smoke-workspace-only
node_modules/.bin/electron apps/desktop/main.cjs --smoke-test --smoke-profile-only
```

- 原生焦点、遮挡和页面变更守卫保留。失焦可能中止前台输入；不能把有限后台 DOM 适配描述为通用后台控制。
- 真实飞书旧版页面已做过经用户授权的普通资料恢复与字段定位检查；不表示任意飞书租户、控件或整表都能完成，也不证明企业已接收申请。
- 长尾电光在独立 Chromium 中检查实际路径、宽幅尾流、五股电弧和三个残影的 Web Animations、减少动态、指针穿透及观察结果不变。
- 证件使用无效演示号码和注入加密器验证存储、版本、撤销、过期与目的地检查。没有向真实企业发送身份证或护照号。
- 不把规则填写时间当作模型推理时间；模型未返回 usage 时显示未知。没有合格的同场景人工样本就不宣称节省百分比。

构建记录和验证结果按实际站点、字段及平台分别统计，具体口径见相应评测说明。
