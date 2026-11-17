# 0.2.5 验证与发布记录

## 本地合流阶段（截至提交 `d559d5b`）

日期：2026-11-17。工作分支：`codex/reconcile-installed-0.2.5`。本轮将本机安装版差异接回正式 0.2.4 基线，尚未远端发布。

## 来源与备份

- 公开源码基线：`bf1d6138b09f507d9deb28893fe5e7474c135763`，正式 0.2.4。
- 本机工作目录：`D:/Documents/git/Mathsemble`。开始梳理时仍在旧 0.1.15 / `5f2d8819352d8701151e2b947b0d2e5aad6c32cc`，不能把该旧检出的测试结果当作当前发布状态。
- 安装差异来源：`D:/Documents/Markdown/.obsidian/plugins/Mathsemble`。合流前 manifest 标记 0.2.4，但 `main.js` SHA-256 为 `81394853e9d774be87568a9fd9dc82c5b4eeb992dcd4f727d32c7ff6513f0964`，`styles.css` 为 `dd2d782963a572ec50c08471364ec4a8040ae775bb5aaf042c46e809b7aceb8a`，与正式包不同。
- 库外备份目录：`D:/Documents/Mathsemble-QA/20261117-version-reconciliation/`。其中 `installed-before/` 与 `installed-before.sha256.json` 保留原安装三件套及摘要，`repository-before.bundle` 保留原仓库，`docs-before/` 保留文档修改前副本。

新增文档不重新解释历史测试结果，也不修改私人题卡或教学正文。生产模板仍由相邻内容库维护。

## 需要验证的增量

1. 仅 `-` Callout 按版本过滤，`+` 和无标记共享；`answer-` 基线、其他类型显式选择、祖先隐藏优先、完整原块测量与留白不重复。
2. 方案 v1／v2／v3 读取、旧解析设置转换、v3 保存与重开、来源冲突检查及输出设置回写隔离。
3. 阅读答案开关、文本／MathJax 交互、各视图隔离、换文件重置、滚动与卸载清理。
4. 试听普通文档与生成讲义的字段优先级、显式留空、表格与页脚版式，以及既有分页／导出回归。
5. 可编辑模块、打印 CSS、`src/plugin.js` 与 `main.js` 的一致性；同版本安装三件套可追溯。

## 本轮结果

| 项目 | 状态与证据 |
| --- | --- |
| 自动化与干净构建 | PASSED：`npm ci`、设置实际 Chrome 且 `CI=true` 的 `npm run prepublish-check`；592 项通过、0 失败、0 跳过。独立目录不带 `main.js`，仅从源码构建并执行 `verify`，生成 JS／CSS 与工作目录逐字节一致 |
| 构建与安装摘要 | PASSED：`src/plugin.js` 与 `main.js` 一致；四个 assembly 模块与生成段、打印 CSS 与生成字面量一致。下表三件套与本机安装副本逐文件 SHA-256 相同 |
| 本地安装 | PASSED（磁盘文件）：已同步为 0.2.5，保留安装目录名 `Mathsemble` 与插件 ID `mathsemble`。更新当前安装说明，原候选 0.2.4 说明保留在库外快照；未重载应用，磁盘同步不证明运行中 Obsidian 已加载新版本号 |
| 真实 Obsidian | Windows Obsidian 1.15.1 已启动，但截图先后发生 FrameArrived timeout 与 window capture timeout；随后用户按 Escape 停止 Computer Use。已停止 UI 操作，本轮操作／视觉／原生 PDF 验收未完成，不记为通过 |
| 远端 CI、标签与 Release | 本轮未执行；正式 0.2.4 的历史成功结果保留原范围 |

完整宿主检查见 [0.2.5 宿主验收清单](OBSIDIAN_HOST_ACCEPTANCE.md)。本轮自动化、安装字节、应用内加载、真实 PDF 和课堂效果须分别记录。

## 可复核证据

运行环境为 Windows、Node `v26.13.1`、npm `11.20.0`、Chrome `157.0.8103.79`。浏览器路径为 `C:/Program Files/Google/Chrome/Application/chrome.exe`；默认使用仓库内版本化模板和固定 MathJax 资源，未设置生产模板目录。全量检查耗时约 537 秒，包含真实 Chromium／MathJax 4 回归；涉及 Obsidian API 的浏览器夹具仍是模拟宿主，不记为原生 Obsidian 验收。

本轮新增 13 项测试，覆盖旧方案显式开关迁移、v3 往返及恶意属性拒绝、Callout 标记与嵌套输出、阅读开关的视图隔离／虚拟区域／模式切换／卸载。旧断言按新契约适配，保留来源、答案泄漏、溢出与留白安全检查。独立代码及测试复核未发现阻断问题。

QA 目录中的 `prepublish-check.log` 保存最终全量结果，`clean-build.log` 保存无预构建产物的独立构建结果，`installed-0.2.5.sha256.json` 保存安装比对。早期适配日志保留其当时的失败结果，不改写为通过。`Mathsemble-0.2.5-install.zip` 仅包含三个运行文件。

| 文件 | SHA-256 |
| --- | --- |
| `main.js` | `81394853e9d774be87568a9fd9dc82c5b4eeb992dcd4f727d32c7ff6513f0964` |
| `manifest.json` | `8ae1ad86a9ce9976cc141aac3d992e57bee76ffb5d656a70c6d0ae369772c6af` |
| `styles.css` | `dd2d782963a572ec50c08471364ec4a8040ae775bb5aaf042c46e809b7aceb8a` |

摘要同时保存于 [版本摘要](../release/SHA256SUMS_0.2.5.txt)。JS 与 CSS 保持合流前安装版的原字节；版本差异已回到可维护源码中，不再依赖从安装目录恢复构建。相邻模板目录 README 仅同步插件版本、命令名和文档入口，未改数学正文或模板内容。

## 正式发布阶段（2026-11-17）

本地合流完成后，用户明确授权推送 GitHub、合并 main 并发布 0.2.5，取代此前“仅本地合流、不远端发布”的任务范围。本次发布沿用上文已验证的运行代码和样式，更新现行文档与正式版本说明；上文“尚未远端发布”和“远端未执行”只描述提交 `d559d5b` 的本地阶段，不描述后续远端状态。

本地完整检查仍为 **592 项通过、0 失败、0 跳过**。真实 Obsidian 操作、视觉与原生 PDF 验收仍未完成；此次明确发布授权不改写该事实，也不把应用启动、磁盘安装或 GitHub 发布成功当作宿主验收通过。

远端执行结果按实际目标提交读取，不在准备文档时预填成功：

- [0.2.5 Release](https://github.com/sunsimilarsun/Mathsemble/releases/tag/0.2.5)：正式标签、对应提交和三个独立安装资产。
- [Build and test](https://github.com/sunsimilarsun/Mathsemble/actions/workflows/ci.yml)：目标提交的 Linux／Windows 干净构建与回归结果。
- [Publish GitHub release assets](https://github.com/sunsimilarsun/Mathsemble/actions/workflows/release.yml)：版本及说明文件检查、资产生成和来源证明。

正式安装文件应与 [版本摘要](../release/SHA256SUMS_0.2.5.txt) 一致。发布说明与摘要更新不改变上文记录的运行文件哈希；社区目录审核状态另按实际审核结果记录。
