# 0.1.14 开发候选：阅读视图、YAML 与打印 CSS 构建

日期：2026-10-26；基线：`371449764ea4925b238deda22597135749b1e25e`（0.1.13）。本轮不创建正式 Release。

## 已处理

1. **YAML 结束边界**：两份 `objectiveTypeFromFrontmatter` 与 `frontmatterSubset` 统一接受 `...`，不再把结束标记后的正文键值当元信息。保持 Obsidian metadataCache 优先；正文仍由原有 stripFrontmatter 保留。
2. **阅读视图根节点漏扫**：渲染回调的根节点本身是段落、列表项或标题时也扫描；父子块分开处理，避免跨段落拼接和重复包裹。打印 DOM 不执行交互装饰。
3. **公式填空样式**：`?{$...$}` 的生成 mark 主动标记 `mwb-reading-answer-math`；规则直接绑定 Mathsemble 自己生成的 mark，不依赖异步添加的祖先类。文字/公式填空默认隐藏、聚焦显示，显示时保留下划线；选择题始终无线。未改动普通 Markdown 高亮。
4. **同行旧式横线**：链接、图片、URL、wiki 链接和注释只保护对应区间；其余位置的 `______` 仍转换。保留转义、数学、代码、链接目的地、引用定义和分隔线；对未闭合链接保守保持字面量。
5. **打印 CSS 单一来源**：`styles.css` 是唯一编辑来源。构建通过 `scripts/print-css.mjs` 更新源码中生成的 `typographyCss` 镜像，再生成逐字节相同的 main.js。缺文件、重复/缺失边界、损坏绑定均报错，不用旧 bundle 兜底。单独执行 verify 也能发现样式漂移。
6. **有限的代码清理**：删除四份未调用的旧 `formatAnswer` / `isChoiceAnswerSlot` 及关联无用辅助代码；四处横线转换入口共用一个实现。没有进行整包 IIFE 重构，也没有声称所有重复模块已经消除。

## 开发流程

修改打印 CSS 后执行 `npm run build`，提交 `styles.css`、生成镜像发生变化的 `src/plugin.js` 和 `main.js`。只改 UI 边界之后的样式不会改变内嵌打印 CSS。不要手工维护第二份 CSS。

`npm run prepublish-check` 包含干净构建、重复构建、CSS-only 更新、UI-only 更新、缺文件/非法边界、独立 verify 过期检测及全量回归。安装仍只需 main.js、styles.css、manifest.json，不新增运行时依赖。

## 本轮明确未完成

- `$x=?{2}$` 等**公式内部答案槽**：A4 学生/教师导出保持现有支持；原生 Reading View 与 Live Preview 的组件适配仍待 Obsidian 宿主验证。本轮不强制覆盖原生数学组件、不改写用户公式。诊断命令新增这类槽的数量与支持范围提示。
- `?{$x=2$}` 隐藏整个等式，与 `$x=?{2}$` 仅隐藏数值的语义不同，不能互相替代来回避问题。
- 含转义答案标记的混合阅读区块仍沿用保守跳过策略。复杂 HTML、任意扩展 Markdown 的来源映射未宣称全面支持。
- SVG 仓库原始资源回退、递归子文件夹组卷和剩余 IIFE 去重不在本轮范围。

## 验证

本地 `CHROME_PATH=/usr/bin/chromium npm run prepublish-check`：**131 项通过、0 失败、0 跳过**。保留原有 106 项，新增 25 项（包括 13 个真实浏览器子场景）。浏览器子场景总数为 44：31 个既有分页/测量/UI 场景及13个阅读样式/DOM场景。

新增阅读测试在真实 Chromium 中使用实际插件 CSS 和当前装饰器，验证不同祖先结构、原生高亮、代码保护、选择题无线、根段落识别、聚焦前后几何及下划线。公式 DOM 为受控 SVG/MathJax 形状，不是完整 Obsidian MathJax 渲染器；不能代替实际桌面宿主与用户讲义验收。

本轮不改变学生留白总高度、answer/solution 输出选项或 A4 分页器。仍允许合理的空白尾页，不为省纸删减作答区域。
