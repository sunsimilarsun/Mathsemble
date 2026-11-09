# Mathsemble｜数课工坊

Mathsemble 是 Obsidian 桌面端数学教学插件，用一份 Markdown 制作讲义、题卡和试卷，预览并导出 A4 学生版／教师版 PDF、打印稿及 HTML。

**当前源码：0.2.3 发布候选。** 本轮默认、双列和试听排版、课程信息、长公式换行及双版 PDF 导出已获用户测试验收通过，候选以验收的 v8 为基线。保留“知识点与组题工作区”的跨目录筛选、知识与题卡混编、排序分区及学生／教师输出。当前仍有既有自动化测试失败，尚未创建正式 GitHub Release。详见 [0.2.3 候选说明](docs/RELEASE_NOTES_0.2.3.md)。

## 知识点与组题

1. 在命令面板执行 **知识点与组题工作区**，或点击侧栏图标。
2. 设置题库和知识库目录（库内相对路径，每行一个），应用并扫描；模板、登记和输出目录默认不收录。
3. 搜索和筛选，预览题目或整篇知识笔记后加入编排。题卡知识标签可以关联到实际知识笔记；同名歧义保留提示。
4. 拖动编排项或使用移动按钮，添加分区，修改本次显示标题和例题／变式／训练角色。源笔记不改写。
5. 保存方案到 `Mathsemble/组题方案/`；重新扫描后显式更新已变化的引用。删除、重复 ID 或缺失来源不会被自动替换。
6. 生成 Markdown 到 `Mathsemble/讲义/`，或生成并进入现有 A4 预览，再导出学生／教师 PDF。每次生成保存一份当前内容快照，已有输出不自动改写。

知识正文按整篇加入，暂不提供小节截取、自动抽题或自动修改知识标签。Markdown 笔记嵌入需先展开为正文，否则阻止生成以避免学生投影遗漏；图片按原文件位置重新解析。

源码基线恢复与版本差异见 [0.2.0 开发基线](docs/BASELINE_0.2.0.md)。

本轮工程和宿主验证见 [外观测试记录](docs/TESTING_APPEARANCE_20261109.md)。知识属性历史验证见 [0.2.1 测试说明](docs/TESTING_0.2.1.md)，首版试用流程见 [0.2.0 测试说明](docs/TESTING_0.2.0.md)；各报告中的测试数字仅适用于当时的代码与环境。

## 快速使用

1. 打开 Markdown，运行命令 **长 Markdown 文档预览、PDF 与打印（实验）**。
2. 在原文、学生版、教师版之间切换，并通过工具栏的 **外观** 选择默认、双列或试听排版，核对题目范围、公式、图片和留白。
3. 选择保存 PDF、打印或保存 HTML；默认输出到库内 `ExamExports/`。保存 PDF 后可点击“打开已保存 PDF”。

单题卡使用 **预览并导出当前数学题卡（P0）**；题卡文件夹使用 **当前文件夹组卷并预览 A4 试卷**，支持按题型或主知识点分组。文件夹最多扫描 200 个 Markdown 文件，单次最多组卷 100 题。

### 排版外观

- **默认排版**：沿用 A4 单栏正文，新窗口默认使用此项。
- **双列排版**：同一张 A4 从左栏排到右栏，再续到下一页；公式、图片、选项和学生留白按实际栏宽重新测量。支持 MathJax 4 的宿主中，长公式会按栏宽在合适的运算符处自动换行，保持正常字号；原文不变。`------` 仍跳到下一张纸的左栏。过宽且无法拆分的公式或表格会提示溢出，可切换回默认排版。
- **试听排版**：首页显示课程信息表、灰色“内容”栏，讲义正文排在下方框内；续页保留正文框。长公式按正文框实际宽度自动换行，长解答可继续分页。教师读取 `author`，缺失或空白时默认“孙老师”；课题名称仅读取 `titile`（按此拼写），不读取 `课题名称` 或 `title`。其他项目读取当前文档属性：`学生`、`上课时间`、`subject`、`年级`、`教学目标`；兼容 `student`、`class_time`、`学科`、`grade`、`学习目标` 等字段。目标列表逐行显示；除教师外，缺失、空值或“待补”留空，不用文件名补题目。可在 **试听信息** 中手动调整。

双列与试听会先展开打印副本中的折叠解答，再按实际缩进测量公式。超宽的行内分段条件／表格公式会改为独立公式块，允许单元内部换行；短公式保持行内，普通阅读视图的折叠状态不变。

外观与学生／教师版本独立选择，当前预览、保存 PDF、双版本 PDF 和保存 HTML 使用所选外观。外观及试听信息仅用于本次预览和输出，不写入 Markdown；重新打开预览时重新读取属性。“读取最新内容”更新未手动修改的信息，保留手动输入和主动清空的项目。双列及试听 HTML 保存为已分页的静态页面。

## 书写规则与模板

**唯一现行书写规范：[Markdown 规范](docs/MARKDOWN_SPEC.md)。** 本地配套模板维护在相邻 Markdown 内容库，入口为[模板清单](../../Markdown/数学教学/模板&规范/README.md)，可从[讲义最小示例](../../Markdown/数学教学/模板&规范/讲义【最小示例】.md)开始。模板不在本仓库内；更换设备时按实际内容库位置定位。

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

1. 将三个同版本文件放入 `<vault>/.obsidian/plugins/mathsemble/`。
2. 重启 Obsidian，在社区插件设置中启用 Mathsemble。
3. 开发版请先在独立测试库安装本地构建的三个文件，核对当前模板和双版本输出。

插件 ID 为 `mathsemble`，要求桌面版 Obsidian 1.5.0 及以上。社区目录审核／上架状态以实际审核结果为准。

## 导出诊断与支持边界

- 图片失败、局部数学渲染错误会显示警告；确认“允许不完整的 PDF”后可继续。相同问题复检保留确认，新增问题要求重新确认；不完整输出不能当作内容完整。
- 题目丢失、留白高度异常、版心越界或无法安全分页会阻断导出。
- `$x=?{2}$` 仅隐藏公式中的数值，`?{$x=2$}` 隐藏整个等式。公式内部槽保留 A4 导出支持，原生 Reading View／Live Preview 的全面适配尚未验收。
- Reading View 对混合转义答案标记的区块仍采用保守跳过策略。复杂 HTML、懒续行、第三方 Markdown 扩展、TikZ、跨主题样式需要真实宿主检查。
- 手动搜索、题篮及知识混编已加入；自动抽题和题族驱动组卷仍待后续开发，见[功能矩阵](docs/FEATURE_MATRIX.md)与[路线图](docs/ROADMAP.md)。

## 开发与验证

```sh
npm ci
npm run check
npm run prepublish-check
```

`src/plugin.js` 保留既有渲染源码；新组题模块维护在 `src/assembly-*.cjs`，构建将其同步到标记区，再生成 `main.js`。不要手改生成标记区。`styles/assembly.css` 维护组题界面样式。`styles.css` 是打印 CSS 唯一编辑来源；构建同步其打印部分到源码中的生成字面量，再生成 `main.js`。构建统一使用 LF，CRLF 检出不应导致语义校验误报。修改后同时保留源码和构建产物。

浏览器回归需要 Chrome／Chromium。Linux 测试会查找常用安装路径；Windows PowerShell 可显式设置：

```powershell
$env:CHROME_PATH = 'C:\Program Files\Google\Chrome\Application\chrome.exe'
npm run prepublish-check
```

CI 配置覆盖 Linux 和 Windows；CI 缺少浏览器时应失败。本地未指定可用浏览器会跳过对应测试，不能据此声称完成布局验收。模板回归会检查题目边界、答案投影和元信息；数学正确性另需审校。自动化验证不能代替真实 Obsidian 和完整 PDF 验收。

模板单独验收时，将 `MATHSEMBLE_TEMPLATE_DIR` 设为内容库中 `数学教学/模板&规范/` 的实际路径，再运行 `node --test tests/templates.test.cjs`；未设置时兼容读取仓库根的 `templates/`。运行包含模板回归的全量检查时也须提供该目录。

## Network access and files outside the vault

Mathsemble is a desktop-only, local-first Obsidian plugin with no built-in telemetry or account service. Exporting notes that reference remote HTTP(S) images or fonts can make network requests. Explicit `file://` references can read resources **outside the vault**. The PDF exporter writes temporary HTML in the operating system's temporary directory and attempts cleanup. Exports are saved locally in `ExamExports/`; the plugin does not automatically share them. See [Privacy details](docs/PRIVACY.md).

导出读取文档引用的资源；使用保密讲义时需核对远程资源。源笔记只会在用户主动执行设置教学角色或转换当前题标命令时修改。项目采用 [MIT License](LICENSE)。

版本演进与历史验证记录见[变更索引](docs/CHANGELOG.md)；当前发布步骤见[发布指引](docs/PUBLISHING.md)。
