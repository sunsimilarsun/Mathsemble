# Mathsemble 名称与兼容标识

## 唯一产品名称

产品统一称为 **Mathsemble**，中文副名为“数课工坊”。代码、问题追踪、版本与规范的仓库是 `sunsimilarsun/Mathsemble`。不要将同名兼容 ID 指向的旧工作台项目视为本插件的开发基线。

| 用途 | 约定 |
| --- | --- |
| 显示名称、预览窗口及交付包名称 | Mathsemble |
| 主插件类 | `MathsemblePlugin` |
| 控制台日志前缀 | `[Mathsemble]` |
| PDF 临时目录前缀 | `mathsemble-pdf-` |
| npm 包名 | `mathsemble` |
| 兼容插件 ID | `math-teaching-workbench` |
| Obsidian 安装目录 | `.obsidian/plugins/math-teaching-workbench/` |

兼容插件 ID 与安装目录保留旧值是明确的兼容决定，不是产品名称，也不代表混用了旧仓库代码。本次不将插件 ID 改为 `mathsemble`，不引入第二个安装身份，不自动移动用户数据。未来变更 ID 必须另行评估安装、启用状态、命令及快捷键等迁移。

## 不属于本轮更名的标识

保留现有命令 ID、`mwb-` CSS 类、`data-mwb-*` 属性、内部函数前缀和 `ExamExports/` 输出目录，以免破坏已有引用。数学教学中的 teaching/role 等领域术语不作品牌替换。源笔记标题、题文、答案语法、学生／教师规则以及留白与分页策略均不更改。

历史版本记录与历史验收结论不回写。新的命名回归测试约束运行时代码不再引入旧产品名称，并检查兼容身份、产物同步及临时目录清理。

2026-11-03：本地候选已整合到 `fix/reliability-baseline-20261103` 分支，版本仍为 0.1.15，未创建 GitHub Release。当前构建哈希见 `release/SHA256SUMS.txt`；核验时同时记录提交号和文件哈希，不把同版本候选当作新的正式发布。整合与验收证据见 [可靠性基线记录](RELIABILITY_BASELINE_20261103.md)。
