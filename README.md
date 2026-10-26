# Mathsemble — Math Handouts for Obsidian

Mathsemble is a **desktop-only Obsidian plugin** for creating mathematics handouts, question cards, and A4 student/teacher PDF exports from Markdown notes. It works locally with your Obsidian vault and MathJax.

**Current release:** [Mathsemble 0.1.10 on GitHub](https://github.com/sunsimilarsun/Mathsemble/releases/tag/0.1.10). **Source version:** `0.1.15` (development only; not a GitHub Release). The release retains `(==B==)` / `==42==` answers; development source uses `!{B}` / `?{42}`. Do not combine the two installations or treat a development manifest as a published release. The plugin has not yet been confirmed as approved for the Obsidian Community directory. Visual results should be checked before printing mathematics materials.

## 0.1.15 development: strict question boundaries

Use a top-level `##### 例1`, `##### 变式1`, `##### 练习1`, `##### 检测1`, or `##### 第1题` for each handout question. The next H1–H5 ends it; H6 headings and interleaved subquestions/answers remain inside. Short questions stay on one page; long questions start a fresh page, without shortening student writing space. Existing H3 labels are not automatically rewritten or treated as complete questions. See [Markdown 规范](docs/MARKDOWN_SPEC.md), [五级题目模板](templates/讲义_五级题目标题.md), and [implementation and acceptance](docs/STRICT_H5_PAGINATION.md). This is a development build, not a new Release.

## Installation

1. Download the three separate assets **`main.js`**, **`manifest.json`**, and **`styles.css`** from the [latest GitHub Release](https://github.com/sunsimilarsun/Mathsemble/releases/latest).
2. Create the folder `<your-vault>/.obsidian/plugins/math-teaching-workbench/`.
3. Put all three downloaded files in that folder, keeping their filenames unchanged.
4. Restart Obsidian (or reload the plugin), open **Settings → Community plugins**, and enable **Mathsemble**. Desktop Obsidian is required.

When the Community directory approves the plugin, installation from its Community plugins page can replace these manual steps.

## Usage

1. Open a Markdown handout and use the Obsidian command palette (`Ctrl+P` on Windows, `Cmd+P` on macOS).
2. Run the command named **长 Markdown 文档预览、PDF 与打印（实验）** (long Markdown preview, PDF and print). Switch between **Original**, **Student** and **Teacher** editions.
3. Use **预览并导出当前数学题卡（P0）** for an individual question card, or **当前文件夹组卷并预览 A4 试卷** to assemble an exam from question cards in the current folder.
4. Check the preview; choose **Save PDF**, **Print** or **Save HTML**. By default, exported files are saved in the vault's `ExamExports/` folder.

A callout with `+` or `-` immediately after its type, for example `> [!answer]- Solution`, appears in the teacher edition while reserving the corresponding measured writing space in the student edition. Unmarked callouts appear in both versions. On the development branch, `!{B}` is a choice-answer slot with no student underline, `?{42}` is a fill-in slot with an underline, and `==important==` remains ordinary Markdown highlighting. The published v0.1.10 still uses the legacy syntax.

## Privacy and permissions

Mathsemble does not implement telemetry. **Network access** may occur when printing remote images or fonts referenced by a note. Its desktop PDF exporter uses Node.js/Electron, writes temporary HTML **outside the vault** to the OS temporary directory, then attempts cleanup; it can also read explicitly referenced `file://` image/font resources. Clipboard writing only occurs after a user clicks a copy action. The folder-assembly command scans Markdown file metadata to identify question cards. More: [Privacy and security](docs/PRIVACY.md).

## Development and verification

```sh
npm ci
npm run check
npm run prepublish-check
```

The tracked source is `src/plugin.js`, deliberately named differently from the generated root `main.js`. `npm run build` must regenerate `main.js` from this source even after deleting every existing `main.js`; it never relies on a prebuilt bundle. Printing CSS is authored only in `styles.css`. Build synchronizes its export prefix into the generated literal in `src/plugin.js`, then copies that complete source into `main.js`. Commit both outputs after a CSS change; `verify` also rejects a stale CSS mirror without building. CI tests scanner-style clean builds and byte-for-byte output identity.

## New typed answer syntax (development main branch; not in published v0.1.10)

- Fill: `?{42}` or `?{$\frac{1}{2}$}`; student gets a measured underline.
- Choice: `!{B}` or `!{ACD}`; no student underline. Add optional outer parentheses `（!{B}）`.
- Native Obsidian highlight: `==important content==`, always ordinary highlight.

**Migration note:** Older `==42==` and `(==B==)` are no longer concealed by Mathsemble.
Do not automatically rewrite all highlights: some are emphasis rather than answers.
Reading View deliberately skips a section containing escaped typed markers until a source-map-aware solution is ready.
## 中文说明

---

# Mathsemble｜数课工坊

Mathsemble 是一款 **local-first 的 Obsidian 桌面端数学教学插件**，用于将 Markdown 题卡、讲义或题目集合转成可预览、可打印的 A4 学生版／教师版。当前优先确保 **一份 Markdown 源码、两份教学输出、数学公式与答题留白可核验**。

> **当前状态（2026-10-23 发布记录）**：本地实验安装包为 **v0.1.10**（局部渲染警告、经确认可继续 PDF／打印）。已有代码级与局部浏览器测试记录，但**尚未完成真实 Obsidian 中整份长讲义、双版本 PDF 的最终视觉／分页验收**。GitHub 已提交 MIT 许可的完整 v0.1.10 源码、测试及构建工作流，**正式 [0.1.10 GitHub Release](https://github.com/sunsimilarsun/Mathsemble/releases/tag/0.1.10) 已发布**，三个独立安装文件的 SHA-256 已核对一致。Obsidian Community 目录**尚未提交审核或上架**；用户报告手动测试未发现问题，但跨主题、跨系统的完整 PDF 视觉验收尚未独立完成。

- [详细功能需求与验收标准](docs/REQUIREMENTS.md)
- [版本路线图与风险清单](docs/ROADMAP.md)

## 1. 核心使用场景

1. **讲义**：打开一份普通 Markdown，通过命令面板执行“长 Markdown 文档预览、PDF 与打印（实验）”，切换原文、讲义学生版、讲义教师版。
2. **题卡**：对当前题卡执行“预览并导出当前数学题卡（P0）”，导出学生卷／教师卷。
3. **组卷**：在题卡所在文件夹执行“当前文件夹组卷并预览 A4 试卷”，按题型或主知识点分组。当前限制：文件夹不超过 200 个 Markdown 文件、单次组卷最多 100 题。
4. **打印与诊断**：预览窗口提供“保存 PDF”“打印…”“保存并打印…”“保存 HTML 备用”“复制渲染错误详情”“复制留白核验”等操作。

> 目前只提供 **桌面版 Obsidian** 插件（`manifest.json` 中 `isDesktopOnly: true`，`minAppVersion: 1.5.0`）。插件 ID 为 `math-teaching-workbench`，**不得在没有迁移设计时更名**。

## 2. 简单而统一的 Markdown 规则

### A4 分页预览与导出后打开（v0.1.11 开发版）

预览弹窗现在直接复用 PDF 使用的 DOM 分页算法，显示独立的 A4 纸张、页间距和页码（包括学生答题留白跨页）。导出前几何测量和诊断仍使用保留的原始渲染节点；PDF 导出在隔离窗口中重新排版核验，故最终 PDF 页数可能随系统字体及图片加载存在差异。分页预览无法完成时回退连续阅读视图，并在状态区显示原因。

点击“保存 PDF”成功写入 `ExamExports/` 后出现“打开已保存 PDF”，由用户主动点击，使用操作系统默认 PDF 阅读器打开当前弹窗最后一次成功保存的 PDF；文件已移动、被删除或系统未关联 PDF 阅读器时显示错误。仅“打印…”未保存文件时，不新增打开按钮。以上修改不改变学生留白高度或允许末尾空白页的规则。

### Callout 双版本规则

**`+/-` 控制教师专用与双版共用；`solution` 是唯一具有单独学生留白和教师显隐选项的例外。** `answer` 表示完整答案/作答步骤，`solution` 表示可选的解题思路。

| 写法 | 教师版 | 学生版 |
| --- | --- | --- |
| `> [!answer]- 完整答案` | 始终显示 | 按教师解答高度留白 |
| `> [!solution]- 解题思路` | 默认显示，可关闭 | 默认隐藏、不留白；可勾选留白 |
| `> [!scaffold]+ 过程提示` | 显示 | 替换为对应高度的空白 |
| `> [!其他类型]+/- 标题` | 显示 | 替换为对应高度的空白 |
| `> [!任意类型] 标题` | 默认显示（`solution` 可关闭） | 直接显示，不生成留白 |

这里的 `+/-` 是 **Mathsemble 导出的教师专用标记**；原始 Obsidian 阅读视图仍按 Obsidian 的折叠语义运行。导出预览和测量层会临时展开 Callout，**不改写源文件**。

学生版新增“solution 留白”复选框（默认关），教师版新增“显示 solution”复选框（默认开）。无 `+/-` 的 `solution` 仍对学生可见，应使用 `[!solution]-` / `[!solution]+` 隐藏。学生留白以 **完整教师内容渲染后的对应 Callout 外部高度** 为依据；默认比例 **100%**、最小留白 **0 cm**。预览中可选比例 50/75/90/100/110/125/150%，最小高度 0/2/4 cm。长留白允许跨页拆分；不可为省纸压缩或删掉必要答题空间。**允许 PDF 最后一页为空白，不能仅据此判定导出失败。**

### 答案槽（当前 `main` 开发分支，尚未正式发布）

| Markdown | 类型 | 学生版 | 教师版 |
| --- | --- | --- | --- |
| `?{42}` | 填空 | 按答案实际排版宽度生成横线（最小 3em） | 显示答案 42 |
| `?{$\\frac{1}{2}$}` | 数学填空 | 按公式测量宽度生成横线 | 显示对应公式 |
| `!{B}`、`（!{ACD}）` | 单选／多选 | 隐藏选项、无横线 | 显示选项 |
| `==重要内容==` | Obsidian 原生高亮 | 正常高亮 | 正常高亮 |

选择／填空由标记本身决定，**不依赖外部中英文圆括号或 YAML 题型**。嵌套 LaTeX 花括号按平衡结构解析；普通高亮不再隐藏。

**迁移注意**：已发布的 v0.1.10 仍按旧语法 `(==B==)` / `==42==` 识别答案。当前开发分支中的 `==...==` 只表示高亮，旧题目必须逐个确认后迁移；插件绝不自动重写现有 Markdown 文件。详见 [新答案语法与迁移规范](docs/ANSWER_SYNTAX.md)。

### YAML 与数据元信息

- **普通讲义导出、答案槽识别**：不需要靠 YAML 的 `question_type` 判断选择或填空。
- **题库／文件夹组卷、题型与知识点分类、元信息审计**：仍可使用 YAML。`question_type`、`object_type`、`knowledge_nodes`、`role` 等有各自用途，但不覆盖答案槽显隐语法。
- **缺失元信息**：应产生审计提示，不应自动补造 ID、来源或关联关系；参见需求文档。

## 3. 渲染失败处理

- **正常**：直接生成 PDF／打印。
- **局部可恢复异常**：如个别 MathJax 语法错误、图片加载失败、TikZ 未生成，显示错误概要与风险；用户**明确勾选同意导出不完整内容**后，可以继续保存 PDF、打印或保存并打印。输出可能存在不可读公式或缺图，**不得称为内容完整**。
- **结构或安全失败**：如真正的版心越界／裁切、题目块丢失、答题留白高度异常、无法生成有效页面，应停止导出，不能通过勾选绕过。

渲染诊断应优先指出公式序号、所属 Callout、附近文字和具体 MathJax 错误。当前本地包的定位信息仍有误差，精确映射到 Markdown 行号属于后续任务。

## 4. 本地安装与使用

**可以通过 [GitHub Releases 0.1.10](https://github.com/sunsimilarsun/Mathsemble/releases/tag/0.1.10) 下载** `main.js`、`manifest.json`、`styles.css` 三个独立文件；社区插件目录尚不能一键安装。

1. 备份现有插件目录及需要打印的 Markdown。
2. 解压 ZIP 内 `main.js`、`manifest.json`、`styles.css`。
3. 覆盖 Obsidian 库目录下的 `.obsidian/plugins/math-teaching-workbench/` 对应文件。
4. 重新加载插件／重启 Obsidian；打开 Markdown 文件，在命令面板运行对应的预览命令。
5. 预览并确认学生／教师双版，PDF 默认写入库内 `ExamExports/` 目录（需有写入权限）。

**重要**：官方 GitHub 0.1.10 Release 中的三个安装文件与仓库构建基线及 SHA-256 校验一致；今后版本更新应在 GitHub Actions 中重复此项检查。

## 5. 当前实现边界

**本地包已有相关代码路径**：Markdown 与 MathJax 渲染、题卡预览、长讲义双版本、Callout 教师专用等高留白、选择／填空槽、文件夹分组组卷、基础元信息审计、A4 分页、PDF／系统打印、HTML 备用、局部渲染警告与确认。

**尚未作为稳定交付验收**：Obsidian 宿主全流程、复杂主题 CSS、超长讲义的真实打印分页、不同字体／系统下的等高留白、TikZ／图片与长公式的兼容性。

**尚未实现为完整产品**：题库搜索与题篮、知识点条目（KnowledgeItem）编排、题族关系驱动的组讲义；**尚未完成** Obsidian 社区插件目录审核上架。源码、MIT 许可、自动化测试与 GitHub Release 已提交。

## 6. 项目与隐私

- 仓库：<https://github.com/sunsimilarsun/Mathsemble>
- 当前已发布版本：`0.1.10`（开发分支尚未发布）
- 作者：`sunsimilarsun`
- 原则：本地优先；禁止提交私人题库、学生档案、含个人信息的 PDF、API Key 和任何访问凭证。

完整的 P0/P1/P2 需求、验收用例、风险及发布门槛见 [功能需求](docs/REQUIREMENTS.md) 和 [路线图](docs/ROADMAP.md)。


## v0.1.10 学生填空宽度修复（2026-10-23）

实验安装包的学生版填空线不再使用固定的全角空格或固定 2.2em/2.8em 宽度。普通文本、独立数学公式均按答案的临时排版尺寸设置宽度；已有数学公式内部的填空采用 MathJax 宽度校准后的 `\underline{\hspace{...}}`。最小宽度为 **3em**，长答案按实际排版扩展；学生版 HTML/PDF 不保留测量用的答案文本。`(==答案==)` 选择槽无横线，以及 `[!类型]+/-` 教师专用学生等高留白规则不变。

该项已有 Node 转换测试及 Chromium 字体/MathJax 几何测试，**真实 Obsidian 各主题及完整 PDF 尚待验收**。源码及 GitHub Release 0.1.10 已提交；真实 Obsidian 各主题与长 PDF 的后续验收仍可继续补充。


## v0.1.10 数学讲义 Callout 主题（2026-10-23）

本地实验包新增八类数学教学 Callout 配色（仅外观）：`definition` 定义绿 `#2EA44F`、`theorem` 定理蓝 `#2F81F7`、`method` 方法紫 `#9B59B6`、`conclusion` 结论青 `#00A896`、`attention` 注意黄 `#F1C40F`、`thinking` 思考灰蓝 `#636E72`、`answer` 答案深橙 `#E67E22`、`scaffold` 脚手架淡紫 `#8F70B5`。原 `solution` 为 `answer` 配色兼容别名；例题直接使用普通 Markdown 标题和题干，插件不给 `example` 赋专门配色。

打印在白色纸张上采用**四周同色边框**（左 2px，上/右/下 1px）与彩色标题，正文及 `strong` 不整段染色。`answer` 保留橙色 `#e67e22`，`solution` 改为淡蓝灰色 `#8794ad`（标题 `#53637e`）；其余教学 Callout 也采用各自主题色的四周边框。阅读视图保留 Obsidian 图标，打印版为一致排版隐藏图标。作用于 Mathsemble A4 预览/PDF/HTML，以及 **所有普通 Obsidian Markdown 阅读视图和实时预览**（无需 YAML、题卡识别或异步加类）。仅指定的八类 Callout 与历史 `solution` 兼容类型受影响；不全局修改 `mark`、`strong`、`example` 等普通样式。

颜色与导出逻辑严格分离：该段描述的是旧版本，当前开发版的 `solution` 已增加独立留白及教师显隐选项。选择/填空语法及填空宽度不变。Chromium 11 类 Callout 测试中外部高度差 0px；完整 Obsidian PDF 验收仍待完成。已启用旧版同类 CSS 片段时建议停用避免重复。黑白/彩色主题切换列入后续规划。


## v0.1.10 普通阅读视图主题修复（2026-10-23）

修复上一版 Callout 配色依赖 `mwb-math-material`、`mwb-answer-note` 等识别类导致普通笔记不生效的问题。现直接覆盖 Obsidian **阅读视图、实时预览**和 Mathsemble A4 预览/打印。只有八类核心 Callout 加旧版 `solution` 受到配色影响；`example` 保持普通外观。无 YAML 亦可应用，且不改写 `mark`、`strong`，不改变 `[!类型]+/-` 教师专用学生等高留白及答案槽语义。已经通过无 YAML 普通阅读、实时预览、打印 DOM 的 Chromium 模拟测试及 36 个留白槽回归；真实 Obsidian 宿主及长 PDF 仍待验收。

## 发布准备状态与隐私披露（2026-10-23）

用户已报告 v0.1.10 手动测试未发现明显问题；该版本已完成 GitHub 正式 Release、完整源码入库和 MIT 授权；**Obsidian Community 目录提交与审核仍未完成**。版权持有人已于 2026-10-23 确认采用 MIT。参见 [发布审计](docs/RELEASE_AUDIT.md) 和 [提交指引](docs/PUBLISHING.md)。

**网络和文件系统说明：** 导出 PDF/HTML 时，插件可能为了内联用户文档中的远程 HTTP(S) 图片／字体而发起请求。PDF 转换会在操作系统临时目录写入临时 HTML 并尝试清理；可能读取被引用的 `file://` 本地图像／字体，最终 PDF/HTML 默认存入库内 `ExamExports/`。当前代码未实现遥测/账户数据上传。请勿在保密讲义中引用不受信任的远程资源。


## 开源许可证

Mathsemble 采用 [MIT License](LICENSE)（Copyright © 2026 sunsimilarsun）。许可允许在保留版权与许可声明的前提下使用、修改及再分发；使用者需遵守独立第三方代码的许可条件。

## Network access and files outside the vault

Mathsemble is local-first and has no built-in analytics, telemetry or account service. When exporting a document that references remote HTTP(S) images or fonts, the plugin may request those resources; those servers can see the normal requests.

The plugin may read explicitly referenced `file://` image and font resources **outside the vault**. To generate PDF output it temporarily writes print-ready HTML to the operating system's temporary directory and removes it after the printing process. Exported PDF/HTML is saved to the vault's `ExamExports/` folder. Review linked resources before exporting sensitive documents. See [Privacy details](docs/PRIVACY.md).

## 2026-10-26 · v0.1.11 开发分支说明（尚未发布）

- `manifest.json`、`package.json` 和锁文件的开发版本同步为 `0.1.11`；公开 GitHub Release 仍为 `0.1.10`。未经真实 Obsidian 验收和发布流程，不得把 `0.1.11` 视为已发行安装包。
- 开发版选择答案统一写成 `!{B}`，填空写成 `?{答案}`，`==内容==` 一律是 Markdown 高亮。旧版文件需人工迁移，程序不自动重写笔记。
- 长讲义实时预览使用 CodeMirror 视图级答案槽索引。普通正文编辑采用安全的索引偏移更新；编辑答案槽、公式或 Markdown 结构时重新扫描；选区和滚动仅刷新可视区域的答案装饰，避免重复扫描整份源文档。
- 这项性能改动专门针对实时预览的反复扫描，并**不**代表长讲义 PDF 分页或真实 Obsidian 宿主性能已完成验收。

## 2026-10-26 · answer/solution 输出选项（开发版）

- 推荐 `[!answer]-` 写完整作答步骤，`[!solution]-` 写思路或方法总结。
- 学生版默认隐藏所有标记为教师专用的 `solution` 且不留白；勾选“solution 留白”才按完整教师渲染高度生成对应空间。
- 教师版默认显示 `solution`；关闭“显示 solution”后只隐藏 `solution`，不影响 `answer`。无 `+/-` 的 `solution` 也受到教师版隐藏选项控制，但学生版按原有共享规则正常显示。
- 学生留白测量使用完整教师内容，独立于教师版是否隐藏 `solution`；原文模式始终不变，源 Markdown 不被改写。
- 此功能仅属于尚未正式发布的 v0.1.11 开发代码，公开 v0.1.10 Release 行为不变。

## 2026-10-26 · 0.1.12 开发候选：题干与答案成组分页

短题（含 answer）优先整组同页；长答案绑定题干与首个完整步骤后按段落或列表项续页；学生版绑定首段真实留白且不减少总高度。单文件讲义识别明确题标与相邻答案，文件夹组卷沿用既有题目容器。预览与 PDF 共用规则。详见 [分组规则、边界及验证](docs/GROUP_PAGINATION.md)。0.1.12 尚未发布正式 Release；公开 0.1.10 安装包不变。

## 2026-10-26 · 0.1.13 开发候选：审核缺陷修复

按显式引用层级投影嵌套 Callout；学生版移除教师子树且避免重复留白。留白测量校验完整 Callout 树的数量、类型与父子关系，建立稳定源码标识；默认不为 solution 留白时，从测量投影排除相应教师专用 solution。修复冒号引导长列表、增量编辑形成新答案槽、缩进／引用代码保护及标题变更后分页预览刷新。详见 [七项审核修复与验证边界](docs/AUDIT_FIX_0.1.13.md)。开发安装包不等同正式 Release；公开 0.1.10 Release 不变。

## 2026-10-26 · 0.1.14 开发候选：阅读视图、YAML 与构建维护

修复 `...` 后备元信息边界、阅读视图根段落漏扫、外层公式答案 `?{$...$}` 的显隐样式与永久下划线；固定填空横线可以与链接、图片及注释处于同一行。`styles.css` 是打印 CSS 的唯一编辑来源，构建自动同步内嵌镜像及安装 bundle；删除已经无调用的旧答案格式代码。见 [具体范围、验证与剩余限制](docs/READING_BUILD_FIX_0.1.14.md)。

**尚未完成：** `$x=?{2}$` 等公式内部槽仍支持 A4 学生/教师导出，但 Obsidian 原生 Reading View/Live Preview 的组件适配未在本轮宣称修复。外层 `?{$x=2$}` 隐藏的是整个等式，不能代替仅隐藏数值的原语义。原生模式中应使用诊断命令检查支持范围；正式分发学生材料前仍须检查 A4 输出。
