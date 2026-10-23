# Mathsemble v0.1.9 发布前审计（2026-10-23）

**状态：发布候选，尚未提交 Obsidian Community 审核。**

| 范围 | 审计结果 |
| --- | --- |
| Markdown 原文、学生、教师版 | 本地代码实现；用户反馈手动测试未发现问题 |
| `[!类型]+/-` 教师专用学生等高留白 | 实现；高一期中讲义 36 个对应 36 个留白槽的转换回归通过 |
| 无标记 Callout 双版共用 | 实现，Node 回归通过 |
| `(==B==)` 选择与 `==答案==` 填空 | 实现，Node 回归通过 |
| MathJax、图片的局部失败警告 | 已有代码路径；部分失败须确认，版心溢出/留白异常仍阻断 |
| 题卡及文件夹组卷 | 代码存在，题量上限：200 Markdown 文件/次、100 题/卷 |
| 数学 Callout 配色 | 阅读和实时预览的 Chromium 模拟测试通过；普通 `example` 不单独着色 |
| 源代码、GitHub CI、正式 Release | 仓库尚未提交完整工程；待导入发布准备包 |
| 法律授权 | 版权持有人已批准 MIT，根目录 LICENSE 已提交（2026-10-23） |
| Obsidian 正式上架 | **未提交、未获审核通过** |

## 审计中特别发现

1. PDF/HTML 导出时可能访问正文引用的外部 HTTP(S) 图片或字体资源；需要在 README 披露。
2. 插件使用操作系统临时目录保存短暂的打印 HTML，并在 finally 中删除；可读取被引用的本地 file:// 图像和字体，同样需要披露。
3. 使用 Node.js/Electron 的实现必须保持 `isDesktopOnly: true`。
4. 用户手动测试通过不能代替 GitHub Release 构建校验和社区自动扫描。
5. 现有单文件 JavaScript 含重复的模块包装；发布前不建议进行高风险大规模重构。已经制作无语义改变的源码基线、构建脚本、Node 回归测试和 CI 模板，随独立工程 ZIP 交付，等待上传至 GitHub。

## 推荐发布门槛

- [ ] 将完整 `src/main.js`、`main.js`、`styles.css`、`package.json`、lockfile、测试和工作流上传到 GitHub
- [ ] 版权持有人确定许可协议，提交项目根目录的 `LICENSE`
- [ ] GitHub CI 完整通过且构建产物与源码可核对
- [ ] 在 GitHub 发布与 manifest 一致的 `0.1.9` tag 与 Release，附加独立 `main.js`、`manifest.json`、`styles.css`
- [ ] 使用 https://community.obsidian.md 中的插件提交入口，由持有人登录并绑定 GitHub；根据审核报告修复问题

官方流程：https://docs.obsidian.md/Plugins/Releasing/Submit%20your%20plugin
