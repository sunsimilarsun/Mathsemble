# Mathsemble｜数课工坊

Mathsemble 是 Obsidian 桌面端数学教学插件，用一份 Markdown 制作讲义、题卡和试卷，预览并导出 A4 学生版／教师版 PDF、打印稿及 HTML。

**当前源码：0.1.15 开发版。** 仓库已有发布记录为 [0.1.10](https://github.com/sunsimilarsun/Mathsemble/releases/tag/0.1.10)，其答案语法与开发版不同。当前模板面向开发版；本轮优化没有创建新 Release。真实 Obsidian、跨主题和完整长讲义 PDF 验收仍须按[宿主验收清单](docs/OBSIDIAN_HOST_ACCEPTANCE.md)执行。

## 快速使用

1. 打开 Markdown，运行命令 **长 Markdown 文档预览、PDF 与打印（实验）**。
2. 在原文、学生版、教师版之间切换，核对题目范围、公式、图片和留白。
3. 选择保存 PDF、打印或保存 HTML；默认输出到库内 `ExamExports/`。保存 PDF 后可点击“打开已保存 PDF”。

单题卡使用 **预览并导出当前数学题卡（P0）**；题卡文件夹使用 **当前文件夹组卷并预览 A4 试卷**，支持按题型或主知识点分组。文件夹最多扫描 200 个 Markdown 文件，单次最多组卷 100 题。

## 书写规则与模板

**唯一现行书写规范：[Markdown 规范](docs/MARKDOWN_SPEC.md)。** 模板入口为[模板交付说明](templates/README_交付说明.md)，可从[五级题目讲义](templates/讲义_五级题目标题.md)开始。

```markdown
# 二次函数专题

## 典型例题

##### 例1 最小值

函数 $f(x)=x^2-2x$ 的最小值为 ?{-1}。

> [!solution]- 解析
> 因为 $f(x)=(x-1)^2-1$，且 $(x-1)^2\ge 0$，所以当 $x=1$ 时，最小值为 $-1$。

##### 方法总结

这里是独立的教学总结。
```

- 独立题目使用顶格 `##### 例1`、`变式1`、`练习1`、`检测1`、`题1` 或 `第1题`；下一个 H1–H5 结束当前题目。题内小标题使用 H6。
- 小问和对应答案可以交替排列。短题完整同页，长题新页起排后按段落／列表／留白续页；学生留白不压缩、不删除，允许合理的空白尾页。
- 顶格独立一行 `------`（恰好 6 个半角连字符）强制后文从新页开始，支持题内换页；其他长度的横线保持普通 Markdown 语义。代码、引用等字面内容不触发。
- 普通讲义不必写 YAML。题库组卷使用 `question_type`、`knowledge_nodes` 等正式字段；未知来源和结构关系保持未知，详见规范的元信息约定。
- 选择、填空、判断题用 `!{}`／`?{}` 标注答案，只写 `[!solution]- 解析`；计算、解答、证明等题的 `[!answer]-` 写标准解题步骤和结论，独立构成满分答案，`solution` 按需写补充说明。

| 写法 | 学生版 | 教师版 |
| --- | --- | --- |
| `?{42}`、`?{$\frac{1}{2}$}` | 隐藏答案，按测量宽度留横线 | 显示答案，保留横线 |
| `!{B}`、`（!{ACD}）` | 隐藏答案，无横线 | 显示选项 |
| `==重点==` | 普通高亮 | 普通高亮 |
| `[!answer]-`／`[!answer]+` | 隐藏标准解题步骤与结论，按实测高度留白 | 显示完整满分答案 |
| `[!solution]-`／`[!solution]+` | 默认隐藏解析或补充说明且不留白，可开启留白 | 默认显示，可关闭 |
| 其他 `[!type]+/-` | 隐藏并留白；嵌套教师块不重复计数 | 显示 |
| 无 `+/-` 的 Callout | 共享内容，直接显示 | 默认显示；`solution` 可关闭 |

无标记的 `[!answer]` 会在学生版显示。原生 Obsidian 中 `+/-` 仍保留折叠语义；导出只在临时副本中展开和转换。

已发布 0.1.10 使用旧答案语法 `(==B==)`／`==42==`。迁移到开发版时须逐项区分答案和强调，不要批量替换所有高亮；插件不会自动改写原文。详见[答案语法与迁移](docs/ANSWER_SYNTAX.md)。

## 安装

正式发布版可从 [GitHub Releases](https://github.com/sunsimilarsun/Mathsemble/releases) 下载三个独立文件：`main.js`、`manifest.json`、`styles.css`。

1. 将三个同版本文件放入 `<vault>/.obsidian/plugins/math-teaching-workbench/`。
2. 重启 Obsidian，在社区插件设置中启用 Mathsemble。
3. 开发版请先在独立测试库安装本地构建的三个文件，核对当前模板和双版本输出。

插件 ID 为 `math-teaching-workbench`，要求桌面版 Obsidian 1.5.0 及以上。社区目录审核／上架状态以实际审核结果为准。

## 导出诊断与支持边界

- 图片失败、局部数学渲染错误会显示警告；确认“允许不完整的 PDF”后可继续。相同问题复检保留确认，新增问题要求重新确认；不完整输出不能当作内容完整。
- 题目丢失、留白高度异常、版心越界或无法安全分页会阻断导出。
- `$x=?{2}$` 仅隐藏公式中的数值，`?{$x=2$}` 隐藏整个等式。公式内部槽保留 A4 导出支持，原生 Reading View／Live Preview 的全面适配尚未验收。
- Reading View 对混合转义答案标记的区块仍采用保守跳过策略。复杂 HTML、懒续行、第三方 Markdown 扩展、TikZ、跨主题样式需要真实宿主检查。
- 题库搜索、题篮、知识点编排和题族驱动的组卷尚未实现；见[功能矩阵](docs/FEATURE_MATRIX.md)与[路线图](docs/ROADMAP.md)。

## 开发与验证

```sh
npm ci
npm run check
npm run prepublish-check
```

`src/plugin.js` 是源码入口，`main.js` 是安装产物。`styles.css` 是打印 CSS 唯一编辑来源；构建同步其打印部分到源码中的生成字面量，再生成 `main.js`。构建统一使用 LF，CRLF 检出不应导致语义校验误报。修改后同时保留源码和构建产物。

浏览器回归需要 Chrome／Chromium。Linux 测试会查找常用安装路径；Windows PowerShell 可显式设置：

```powershell
$env:CHROME_PATH = 'C:\Program Files\Google\Chrome\Application\chrome.exe'
npm run prepublish-check
```

CI 配置覆盖 Linux 和 Windows；CI 缺少浏览器时应失败。本地未指定可用浏览器会跳过对应测试，不能据此声称完成布局验收。模板回归会检查题目边界、答案投影和元信息；数学正确性另需审校。自动化验证不能代替真实 Obsidian 和完整 PDF 验收。

## Network access and files outside the vault

Mathsemble is a desktop-only, local-first Obsidian plugin with no built-in telemetry or account service. Exporting notes that reference remote HTTP(S) images or fonts can make network requests. Explicit `file://` references can read resources **outside the vault**. The PDF exporter writes temporary HTML in the operating system's temporary directory and attempts cleanup. Exports are saved locally in `ExamExports/`; the plugin does not automatically share them. See [Privacy details](docs/PRIVACY.md).

导出读取文档引用的资源；使用保密讲义时需核对远程资源。源笔记只会在用户主动执行设置教学角色或转换当前题标命令时修改。项目采用 [MIT License](LICENSE)。

版本演进与历史验证记录见[变更索引](docs/CHANGELOG.md)；当前发布步骤见[发布指引](docs/PUBLISHING.md)。
