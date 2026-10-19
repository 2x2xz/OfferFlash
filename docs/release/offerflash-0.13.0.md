# OfferFlash v0.13.0

申请空间新增“按简历匹配”，聊天找岗也调用同一服务。模型比较已确认职业经历和本轮至多20个库内岗位，保留0–5条，再用原规则排除明确资格冲突。结果不自动加入待申请或提交；资料/岗位发生变化需重新匹配。

同一合成Test池：原规则12/26，普通模型＋硬筛12/19；证据提示实验11/22，未采用。12/19来自作者编写的小型虚构配对GT，未经过独立人工复核，不能当成真实求职准确率。[完整结果与边界](model-job-matching.md) · [算法和GT](../modules/model-job-matching.md)。

本地安装包：`release/offerflash-0.13.0-r2/OfferFlash-darwin-arm64/OfferFlash.app`；压缩包：`release/offerflash-0.13.0-r2/OfferFlash-0.13.0-mac-arm64.zip`。首候选漏拷preload已拒绝，修正后的包通过14项岗位匹配和44项后台隔离检查；其中模型为脚本响应，真实API质量测试另走生产共享helper。不是企业表单现场验收。

正常bundle ID和原资料目录兼容，没有复制私人库或测试简历到普通目录，正常窗口未退出/重启；未推送原开发历史。需要切换时先保存网页草稿。macOS arm64，尚未签名或公证。
