# Mathsemble 发布指引

版本号以仓库根目录的 `manifest.json` 为准，公开安装包见 [GitHub 最新正式版](https://github.com/sunsimilarsun/Mathsemble/releases/latest)。

安装与发布均使用同一版本的 `main.js`、`manifest.json`、`styles.css`。升级前备份被替换的插件目录、启用清单及方案。0.6.0 可读取 v1 至 v4 方案，使用分值或片段后须保留旧版可读的副本。[0.6.0 升级说明](RELEASE_NOTES_0.6.0.md)

## 本地与 CI 门槛

1. 在目标提交上执行 `npm ci` 和带 Chrome／Chromium 的 `npm run prepublish-check`；测试不得跳过浏览器场景。
2. 核对 `src/plugin.js` 与构建后的 `main.js`，打印 CSS 与 `styles.css` 保持一致；Linux 与 Windows CI 均应通过。
3. 按 [P0／P1 实施验收](research/question-banks-2026-11-17/IMPLEMENTATION_ACCEPTANCE.md)记录原生操作、双版 PDF、截图和已知边界。各阶段按构建摘要区分，不以自动化或发布成功替代跨平台、实体打印或课堂验收。
4. 核对 MIT 许可证、隐私披露及安装文件。不要提交私人题库、学生档案、个人文档或凭据。

## 正式 Release

1. 确定发布版本，同步 `manifest.json`、`package.json` 和 `package-lock.json`，编写 `docs/RELEASE_NOTES_<version>.md`。
2. 提交经过验证的源码和生成文件后，再创建匹配版本的 Git 标签。
3. 发布工作流校验版本与说明文件，并分别上传 `main.js`、`manifest.json`、`styles.css` 三份安装资产。已有同名 Release 会被拒绝覆盖。
4. 核对下载资产、摘要与构建来源证明。ZIP 不能替代三个独立安装文件。

## 社区目录

社区提交应按 [Obsidian 官方发布指引](https://docs.obsidian.md/Plugins/Releasing/Submit%20your%20plugin)核对当前步骤。只有实际审核结果能确认上架；本地构建通过不代表社区审核通过。

插件 ID 保持 `mathsemble`，桌面限定保持 `isDesktopOnly: true`。打印可能请求远程图片／字体并在库外临时写入 HTML，详见 [隐私说明](PRIVACY.md)。
