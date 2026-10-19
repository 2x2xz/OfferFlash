# 自动填写动图

README 的演示使用真实岗位信息和虚构人物资料。岗位来自 [面壁智能官网](https://modelbest.jobs.feishu.cn/campus/m/position/7550158206165944639/detail)，公开接口于2026-10-19返回 HTTP 200，岗位名称为“语言大模型算法研究员”。岗位内容后续可能变化，以官网为准。

录制对象是项目自有的本地演示表单，不是企业申请页。执行链调用 `runBackgroundOrdinaryFill`、`backgroundWriteScript` 和 `FieldCompanion`，实际填入8个普通字段并重读核对；没有访问真实申请、调用模型或操作桌面输入。人物“林小闪”、学校和联系方式为虚构，邮箱使用保留的 `.invalid` 域名。

画面按真实时间采集，GIF仅做尺寸、帧率和颜色压缩，没有倍速或手动推进动画。它展示自动填表与动画流程，不证明任意企业页面都能以同样速度完成；也没有人工对照。

## 重新录制

需要已有的 npm 依赖、Electron 图形环境和本机 FFmpeg。不会退出正常应用或读取其资料目录。

```sh
node scripts/record-autofill-demo.mjs --output=.backups/demo-recording
ffmpeg -f concat -safe 0 -i .backups/demo-recording/frames.ffconcat \
  -filter_complex 'fps=20,scale=1280:-1:flags=lanczos,split[a][b];[a]palettegen=stats_mode=diff:max_colors=192[p];[b][p]paletteuse=dither=bayer:bayer_scale=3:diff_mode=rectangle' \
  -loop 0 -y docs/screenshots/offerflash-autofill-demo.gif
```

输出目录中有原始帧、帧时间和 `recording-report.json`。记录包含实际写入数、核实数、输入/提交事件数和使用模块。独立会话与原始帧留在被 Git 忽略的 `.backups/` 中；共享前仍需检查成片。
