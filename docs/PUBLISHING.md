# Mathsemble 发布指引

当前版本为 0.2.3，以用户验收通过的外观 v8 为基线，发布代码与候选 v4 一致。变更由 [PR #21](https://github.com/sunsimilarsun/Mathsemble/pull/21) 集成，本地及 Linux／Windows 检查见[验证记录](TESTING_RELEASE_0.2.3.md)；安装文件由精确标签 `0.2.3` 的发布工作流生成，下载见 [Release](https://github.com/sunsimilarsun/Mathsemble/releases/tag/0.2.3)。社区目录提交与 GitHub Release 分开，本轮不提交社区目录。

## 本地与 CI 门槛

1. 在目标提交上执行 `npm ci` 和带 Chrome／Chromium 的 `npm run prepublish-check`；测试不得跳过浏览器场景。
2. 核对 `src/plugin.js` 与构建后的 `main.js`，打印 CSS 与 `styles.css` 保持一致；Linux 与 Windows CI 均应通过。
3. 完成 [Obsidian 宿主验收](OBSIDIAN_HOST_ACCEPTANCE.md)，保存真实讲义双版本 PDF、截图和问题记录。
4. 核对 MIT 许可证、隐私披露及安装文件。不要提交私人题库、学生档案、个人文档或凭据。

## 正式 Release

1. 确定发布版本，同步 `manifest.json`、`package.json` 和 `package-lock.json`，编写 `docs/RELEASE_NOTES_<version>.md`。
2. 提交经过验证的源码和生成文件后，再创建匹配版本的 Git 标签。
3. 发布工作流校验版本与说明文件，并分别上传 `main.js`、`manifest.json`、`styles.css` 三份安装资产。已有同名 Release 会被拒绝覆盖。
4. 核对下载资产、摘要与构建来源证明。ZIP 不能替代三个独立安装文件。

## 社区目录

社区提交应按 [Obsidian 官方发布指引](https://docs.obsidian.md/Plugins/Releasing/Submit%20your%20plugin)核对当前步骤。只有实际审核结果能确认上架；本地构建通过不代表社区审核通过。

插件 ID 保持 `mathsemble`，桌面限定保持 `isDesktopOnly: true`。打印可能请求远程图片／字体并在库外临时写入 HTML，详见 [隐私说明](PRIVACY.md)。
