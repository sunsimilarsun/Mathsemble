# Mathsemble 0.2.3

讲义现在可自由选择默认单栏、顺序双列和试听排版；预览、学生／教师 PDF、双版 PDF 与 HTML 使用同一外观。

## 功能与修复

- 试听首页上方显示课程信息和学习目标，下方框内放讲义正文。教师读取 `author`，缺失或空白时默认“孙老师”；课题仅读取 `titile`（用户指定拼写），缺失留空，不回退到 `title` 或 `课题名称`。可手动调整，源文刷新保留已填值。第 2、4 列等宽，均为 12%。
- 双列按左栏、右栏、下一页的顺序排版；独立六连字符继续表示下一张纸的左栏。
- 长公式按正文、Callout 和列表的实际宽度断行；先展开打印副本中的折叠解答，超宽行内公式也可分行。已换行仍越界时，计入显示容器内边距并核对实际左右边界，最多再排版两次，保持字号和数学内容。
- 修复混合文字／公式答案槽的公式警告，学生版测量和教师版采用相同处理。
- 修复长讲义双版 PDF 导出中的固定超时问题：集中测量、分批排版，采用有上限的内容量预算，保留取消、单次字体／样式等待上限和真实溢出保护。
- `type: 题卡` 不再与 `question_type` 误报冲突；真正的旧题型冲突仍会提示。
- 保留知识点与组题工作区的跨目录筛选、知识与题卡混编、排序分区、方案保存及学生／教师输出。
- 默认测试使用通用模板和固定版本的 MathJax／字体资源，不依赖个人内容库或 Obsidian 安装文件。

## 验证

发布代码与候选 v4 一致。本地完整 `prepublish-check` 及 Linux／Windows CI 各 434 项全部通过，零失败、零跳过；安装 ZIP 工作流通过，源码与生成文件一致。Obsidian 1.15.0 数学资源的长公式对照 27 项通过。

外观 v8 已获用户验收；此前 v7 在真实 Obsidian 中生成三种排版的学生／教师共六份 PDF，检查 A4 尺寸、页数、文本及学生留白。本轮发布准备未重复视觉或原生 PDF 验收。各版本证据及历史结果见[外观记录](https://github.com/sunsimilarsun/Mathsemble/blob/0.2.3/docs/TESTING_APPEARANCE_20261109.md)和[发布检查记录](https://github.com/sunsimilarsun/Mathsemble/blob/0.2.3/docs/TESTING_RELEASE_0.2.3.md)。

## 安装与升级

从本 Release 的 Assets 下载 `main.js`、`manifest.json`、`styles.css` 三份独立安装文件。关闭讲义预览并停用 Mathsemble，将三份文件同时覆盖至现有插件目录，再启用插件并重新打开预览。

当前插件 ID 为 `mathsemble`。已有目录名可能为 `Mathsemble` 或旧插件名称，请覆盖现有目录，避免并行安装两个副本。首次手动安装可将三份文件放在库内 `.obsidian/plugins/mathsemble/`。

本插件仅支持 Obsidian 桌面端。文件摘要见 [SHA256SUMS_0.2.3.txt](https://github.com/sunsimilarsun/Mathsemble/blob/0.2.3/release/SHA256SUMS_0.2.3.txt)。
