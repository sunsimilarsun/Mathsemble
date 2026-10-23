# Mathsemble 提交 Obsidian Community 指引（2026-10-23）

官方指引： https://docs.obsidian.md/Plugins/Releasing/Submit%20your%20plugin

**现行规则**：通过 https://community.obsidian.md 提交，不再向 obsidian-releases 仓库创建旧式 PR。

1. 先将完整源码、构建脚本、测试、`manifest.json`、`README.md`、`LICENSE` 放入 `sunsimilarsun/Mathsemble` 默认分支；审计应通过。请勿上传私有题库、学生数据或敏感 PDF。
2. 版权持有人已确定 MIT。发布准备版 `package.json` 的 `license` 暂为 `UNLICENSED`，是为了阻止未经授权的法律授予。
3. 将根目录 manifest 与 package 版本保持为 `0.1.9`。在 GitHub 创建 tag **`0.1.9`**，不得添加 `v` 前缀；创建同版本 Release，分别上传 `main.js`、`manifest.json`、`styles.css`，不能仅上传 ZIP。
4. 登录 Obsidian Community 网站，关联拥有此仓库的 GitHub 账号，进入 **Plugins → Add a plugin** 提交 `https://github.com/sunsimilarsun/Mathsemble`。
5. 查看自动源码、许可、Manifest、构建与 Release 扫描结果，解决错误后发布最终条目。未获审核通过之前不能宣传为社区商店已上架。

发布后如需提升版本，应同步修改 manifest/package，发布新 tag 和新 Release。当前 GitHub 仓库原先仅有说明文档，必须先导入源代码与 CI 才能提交。


## 许可证决定（2026-10-23）

版权持有人已批准以 MIT License 发布。仓库根目录 [`LICENSE`](../LICENSE) 已提交，完整工程包中 `package.json` 和 `package-lock.json` 的许可证字段均同步为 `MIT`。**仍需把完整源码及构建配置提交到默认分支，CI 成功后再打 Release。**
