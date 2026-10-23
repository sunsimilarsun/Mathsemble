# Mathsemble CSS 架构与回归约束

状态：2026-10-23 CSS 重构候选（独立分支，未进行 Obsidian 宿主视觉验收）。

## 三类样式

1. 插件 UI：`.mwb-modal` 作用域内的控件、状态、A4 纸张预览容器，优先使用 Obsidian 主题变量。
2. 教学排版：`.mwb-typography`；仅对已识别的数学排版正文生效。阅读视图/实时预览的九类具名教学 Callout 例外，必须兼容**普通无 YAML 的笔记**；不可泛化到所有 Callout 或全局 mark。
3. PDF：`.mwb-print-document`，嵌入 `src/plugin.js` 的导出样式必须与 `styles.css` 在 UI 边界之前的内容逐字一致。独立 HTML 保证黑字白纸，不继承 Obsidian 主题。

## 重要规则

- 不使用全局 `!important` 争抢主题优先级；对冲突组件精确限定所属容器。提高普通 CSS 选择器权重**不能覆盖**来自其他源的 `!important` 声明。
- 不修改 `mjx-container` 与 MathJax SVG 的几何尺寸或通用 SVG 高度。
- 教师版填空答案仍保留横线；选择题答案不出现横线。
- `.mwb-options-measuring` 必须压过选项列表的网格布局，确保测量阶段无换行；完成后恢复布局。
- `.callout.is-collapsed > .callout-content` 在导出与教师测量层必须展开；阅读视图保留原折叠语义。
- 学生答题留白以完整教师解答高度为依据，禁止为了减少页数强行压缩。最后一页空白允许存在。
- 分页器中由 JS 临时注入的 A4 `@page` 和分页规则是另一处独立打印覆盖逻辑，本次**未移除**其中用于分页的 `!important`，须在真实 PDF 跨页回归确认后另行处理。

## 构建验收

`npm run check` 与 `npm run prepublish-check`。新测试 `tests/css-contract.test.cjs` 检查外部 CSS 和内嵌 CSS 一致性、作用域边界和选择/填空/Callout 关键选择器。测试为静态合同检查，**不能代替视觉与分页验收**。

## 仍需的人工检查

- Obsidian 默认明/暗主题，以及至少一种有较强样式重写的第三方主题。
- 原文、讲义学生版、教师版三种状态；阅读视图、Live Preview 和数学公式混排。
- 一页、多页、跨页长解答；选项网格 1/2/4 列的宽度测量。
- 图片/TikZ/MathJax、Callout 折叠恢复；学生与教师等高留白，以及合法的最后空白页。
- 导出 HTML、A4 预览、PDF 的字体、边距、分页、答案槽宽度与本轮前进行视觉差异对比。

只有人工视觉、数学内容和分页全部通过后才能合并及发布。
