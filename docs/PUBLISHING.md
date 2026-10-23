# Mathsemble 0.1.9 · Obsidian Community 提交指引

更新：2026-10-23。官方步骤：https://docs.obsidian.md/Plugins/Releasing/Submit%20your%20plugin

## 已完成

- [x] GitHub 公开仓库： https://github.com/sunsimilarsun/Mathsemble
- [x] `LICENSE`：版权持有人已批准 MIT。
- [x] 源码与构建：`src/plugin.js`、`main.js`、`styles.css`、`manifest.json`、`package.json`、lockfile、构建脚本、19 项 Node 回归测试及 GitHub Actions 均已提交。
- [x] `0.1.9` Git 标签与正式 GitHub Release：https://github.com/sunsimilarsun/Mathsemble/releases/tag/0.1.9
- [x] Release 包含三个独立文件：`main.js`（220195 字节）、`manifest.json`（279 字节）、`styles.css`（24825 字节）；三个文件的 GitHub SHA-256 摘要均与构建清单一致。
- [x] CI 与首次发布工作流通过。插件 ID 仍为 `math-teaching-workbench`；`isDesktopOnly: true`。

## 尚待用户提交社区审核（本轮未操作）

1. 登录 https://community.obsidian.md，并连接拥有此仓库权限的 GitHub 账号。
2. 在 **Plugins → Add a plugin** 提交 `https://github.com/sunsimilarsun/Mathsemble`。
3. 按社区自动扫描和审核反馈处理问题。获审核通过之前，不要宣称已在社区插件目录上架。

现行提交流程使用 Obsidian Community 网站，不是旧版向 `obsidianmd/obsidian-releases` 提交 PR 的流程。

## 发布注意事项

- `manifest.json`、`package.json`、tag 与 Release 应始终使用一致的三段式版本。
- 每次 Release 分别上传三个独立文件，不得只提供 ZIP。
- 完整的 Windows/macOS 原生 Obsidian PDF 视觉验收不属于 14 项 Node 自动测试结果；用户报告已做手动测试且未发现问题。
- 不上传私有题库、学生数据、个人文档、密钥。
- 打印可能请求 Markdown 引用的远程 HTTP(S) 图像或字体，并暂时在库外系统临时目录生成打印 HTML；详见 [PRIVACY.md](PRIVACY.md)。
