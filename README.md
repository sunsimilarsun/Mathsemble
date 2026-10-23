# Mathsemble｜数课工坊

Mathsemble 是一款 **local-first 的 Obsidian 桌面端数学教学插件**，用于将 Markdown 题卡、讲义或题目集合转成可预览、可打印的 A4 学生版／教师版。当前优先确保 **一份 Markdown 源码、两份教学输出、数学公式与答题留白可核验**。

> **当前状态（2026-10-23）**：本地实验安装包为 **v0.1.9**（局部渲染警告、经确认可继续 PDF／打印）。已有代码级与局部浏览器测试记录，但**尚未完成真实 Obsidian 中整份长讲义、双版本 PDF 的最终视觉／分页验收**。GitHub 仓库目前仅发布文档，**尚未提交完整源代码，也没有可供安装的 GitHub Release**。本文“已实现”仅指已在当前本地安装包中看到相应实现，不等于正式稳定发布。

- [详细功能需求与验收标准](docs/REQUIREMENTS.md)
- [版本路线图与风险清单](docs/ROADMAP.md)

## 1. 核心使用场景

1. **讲义**：打开一份普通 Markdown，通过命令面板执行“长 Markdown 文档预览、PDF 与打印（实验）”，切换原文、讲义学生版、讲义教师版。
2. **题卡**：对当前题卡执行“预览并导出当前数学题卡（P0）”，导出学生卷／教师卷。
3. **组卷**：在题卡所在文件夹执行“当前文件夹组卷并预览 A4 试卷”，按题型或主知识点分组。当前限制：文件夹不超过 200 个 Markdown 文件、单次组卷最多 100 题。
4. **打印与诊断**：预览窗口提供“保存 PDF”“打印…”“保存并打印…”“保存 HTML 备用”“复制渲染错误详情”“复制留白核验”等操作。

> 目前只提供 **桌面版 Obsidian** 插件（`manifest.json` 中 `isDesktopOnly: true`，`minAppVersion: 1.5.0`）。插件 ID 为 `math-teaching-workbench`，**不得在没有迁移设计时更名**。

## 2. 简单而统一的 Markdown 规则

### Callout 双版本规则

**只看 `[!类型]` 后是否紧跟 `+` 或 `-`；不根据 `answer`、`scaffold`、`note` 等类型分配显隐权限。**

| 写法 | 教师版 | 学生版 |
| --- | --- | --- |
| `> [!answer]- 答案与解析` | 显示完整内容 | 替换为对应高度的空白 |
| `> [!scaffold]+ 过程提示` | 显示完整内容 | 替换为对应高度的空白 |
| `> [!任意类型]+/- 标题`（任选 `+` 或 `-`） | 显示完整内容 | 替换为对应高度的空白 |
| `> [!任意类型] 标题` | 显示完整内容 | 显示完整内容 |

这里的 `+/-` 是 **Mathsemble 导出的教师专用标记**；原始 Obsidian 阅读视图仍按 Obsidian 的折叠语义运行。导出预览和测量层会临时展开 Callout，**不改写源文件**。

学生留白以 **教师版完整渲染后的对应 Callout 外部高度** 为依据；默认比例 **100%**、最小留白 **0 cm**。预览中可选比例 50/75/90/100/110/125/150%，最小高度 0/2/4 cm。长留白允许跨页拆分；不可为省纸压缩或删掉必要答题空间。**允许 PDF 最后一页为空白，不能仅据此判定导出失败。**

### 答案槽

| Markdown | 识别类型 | 学生版 | 教师版 |
| --- | --- | --- | --- |
| `(==B==)`、`（==BC==）` | 选择（含多选） | 隐藏答案、没有填空下划线 | 显示答案 |
| `==$\frac{1}{2}$==`、`==42==` | 填空 | 保留填写横线／空槽 | 显示参考答案 |

判断只取决于**答案槽外层是否紧贴中文或英文圆括号**，不看内容，也不依赖 `question_type`。输入 LaTeX 时使用普通反斜杠；不要在已有数学环境中不当嵌套 `$`、`==` 或 `\text{...}`。对于复杂行内 TeX，应先核验渲染结果。

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

**暂不能通过 GitHub Releases 安装。** 如果你已取得可信的本地 v0.1.9 直接安装包：

1. 备份现有插件目录及需要打印的 Markdown。
2. 解压 ZIP 内 `main.js`、`manifest.json`、`styles.css`。
3. 覆盖 Obsidian 库目录下的 `.obsidian/plugins/math-teaching-workbench/` 对应文件。
4. 重新加载插件／重启 Obsidian；打开 Markdown 文件，在命令面板运行对应的预览命令。
5. 预览并确认学生／教师双版，PDF 默认写入库内 `ExamExports/` 目录（需有写入权限）。

**重要**：本 README 随本地安装包配套更新时属于说明文档；GitHub 仓库当前不保证其与未来源码构建完全一致。

## 5. 当前实现边界

**本地包已有相关代码路径**：Markdown 与 MathJax 渲染、题卡预览、长讲义双版本、Callout 教师专用等高留白、选择／填空槽、文件夹分组组卷、基础元信息审计、A4 分页、PDF／系统打印、HTML 备用、局部渲染警告与确认。

**尚未作为稳定交付验收**：Obsidian 宿主全流程、复杂主题 CSS、超长讲义的真实打印分页、不同字体／系统下的等高留白、TikZ／图片与长公式的兼容性。

**尚未实现为完整产品**：题库搜索与题篮、知识点条目（KnowledgeItem）编排、题族关系驱动的组讲义、源代码与自动测试／构建发布流水线、正式上架 Obsidian 社区插件目录。

## 6. 项目与隐私

- 仓库：<https://github.com/sunsimilarsun/Mathsemble>
- 当前版本号（本地实验包）：`0.1.9`
- 作者：`sunsimilarsun`
- 原则：本地优先；禁止提交私人题库、学生档案、含个人信息的 PDF、API Key 和任何访问凭证。

完整的 P0/P1/P2 需求、验收用例、风险及发布门槛见 [功能需求](docs/REQUIREMENTS.md) 和 [路线图](docs/ROADMAP.md)。


## v0.1.9 学生填空宽度修复（2026-10-23）

实验安装包的学生版填空线不再使用固定的全角空格或固定 2.2em/2.8em 宽度。普通文本、独立数学公式均按答案的临时排版尺寸设置宽度；已有数学公式内部的填空采用 MathJax 宽度校准后的 `\underline{\hspace{...}}`。最小宽度为 **3em**，长答案按实际排版扩展；学生版 HTML/PDF 不保留测量用的答案文本。`(==答案==)` 选择槽无横线，以及 `[!类型]+/-` 教师专用学生等高留白规则不变。

该项已有 Node 转换测试及 Chromium 字体/MathJax 几何测试，**真实 Obsidian 各主题及完整 PDF 尚待验收**。正式源码与 GitHub Release 仍未提交。


## v0.1.9 数学讲义 Callout 主题（2026-10-23）

本地实验包新增八类数学教学 Callout 配色（仅外观）：`definition` 定义绿 `#2EA44F`、`theorem` 定理蓝 `#2F81F7`、`method` 方法紫 `#9B59B6`、`conclusion` 结论青 `#00A896`、`attention` 注意黄 `#F1C40F`、`thinking` 思考灰蓝 `#636E72`、`answer` 答案深橙 `#E67E22`、`scaffold` 脚手架淡紫 `#8F70B5`。原 `solution` 为 `answer` 配色兼容别名；例题直接使用普通 Markdown 标题和题干，插件不给 `example` 赋专门配色。

打印采用透明背景、细左彩边与彩色标题，正文及 `strong` 不整段染色。阅读视图保留 Obsidian 图标，打印版为一致排版隐藏图标。作用于 Mathsemble A4 预览/PDF/HTML，以及 **所有普通 Obsidian Markdown 阅读视图和实时预览**（无需 YAML、题卡识别或异步加类）。仅指定的八类 Callout 与历史 `solution` 兼容类型受影响；不全局修改 `mark`、`strong`、`example` 等普通样式。

颜色与导出逻辑严格分离：带 `+/-` 的任意 Callout 教师版完整显示、学生版等高留白；无 `+/-` 两版显示。选择/填空语法及填空宽度不变。Chromium 11 类 Callout 测试中外部高度差 0px；完整 Obsidian PDF 验收仍待完成。已启用旧版同类 CSS 片段时建议停用避免重复。黑白/彩色主题切换列入后续规划。


## v0.1.9 普通阅读视图主题修复（2026-10-23）

修复上一版 Callout 配色依赖 `mwb-math-material`、`mwb-answer-note` 等识别类导致普通笔记不生效的问题。现直接覆盖 Obsidian **阅读视图、实时预览**和 Mathsemble A4 预览/打印。只有八类核心 Callout 加旧版 `solution` 受到配色影响；`example` 保持普通外观。无 YAML 亦可应用，且不改写 `mark`、`strong`，不改变 `[!类型]+/-` 教师专用学生等高留白及答案槽语义。已经通过无 YAML 普通阅读、实时预览、打印 DOM 的 Chromium 模拟测试及 36 个留白槽回归；真实 Obsidian 宿主及长 PDF 仍待验收。

## 发布准备状态与隐私披露（2026-10-23）

用户已报告 v0.1.9 手动测试未发现明显问题；该版本**还不是** GitHub 正式 Release 或 Obsidian Community 已审核版本。源码导入、独立构建校验与网站提交仍在准备中；版权持有人已于 2026-10-23 确认采用 MIT。参见 [发布审计](docs/RELEASE_AUDIT.md) 和 [提交指引](docs/PUBLISHING.md)。

**网络和文件系统说明：** 导出 PDF/HTML 时，插件可能为了内联用户文档中的远程 HTTP(S) 图片／字体而发起请求。PDF 转换会在操作系统临时目录写入临时 HTML 并尝试清理；可能读取被引用的 `file://` 本地图像／字体，最终 PDF/HTML 默认存入库内 `ExamExports/`。当前代码未实现遥测/账户数据上传。请勿在保密讲义中引用不受信任的远程资源。


## 开源许可证

Mathsemble 采用 [MIT License](LICENSE)（Copyright © 2026 sunsimilarsun）。许可允许在保留版权与许可声明的前提下使用、修改及再分发；使用者需遵守独立第三方代码的许可条件。

## Network access and files outside the vault

Mathsemble is local-first and has no built-in analytics, telemetry or account service. When exporting a document that references remote HTTP(S) images or fonts, the plugin may request those resources; those servers can see the normal requests.

The plugin may read explicitly referenced `file://` image and font resources **outside the vault**. To generate PDF output it temporarily writes print-ready HTML to the operating system's temporary directory and removes it after the printing process. Exported PDF/HTML is saved to the vault's `ExamExports/` folder. Review linked resources before exporting sensitive documents. See [Privacy details](docs/PRIVACY.md).
