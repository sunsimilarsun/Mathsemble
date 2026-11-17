# Mathsemble 0.2.5

发布日期：2026-11-17。[下载 0.2.5](https://github.com/sunsimilarsun/Mathsemble/releases/tag/0.2.5)。

本版增加按类型控制的 Callout 显隐与留白、阅读视图答案开关，并更新方案格式和试听标题兼容。继续支持题卡／知识选材、条件抽题、预览编排、临时 A4，以及学生版／教师版 PDF 和 HTML 导出。

## Callout 与答案显示

- 只有 `-` Callout 按学生／教师版本过滤；`+` 和无标记块都是共享内容。
- 未被祖先整块隐藏的 `answer-` 固定在学生版生成实测留白，在教师版显示。其他 `-` 类型分别选择学生留白与教师显示，默认两项均关闭。
- 外层隐藏包含全部后代，内层 `answer-` 不单独恢复。选中的外层留白测量完整原块，不受教师显示选择影响，也不重复累计后代。
- 阅读视图提供“显示／隐藏答案”按钮及命令，作用于当前视图；切换文件重置，不修改原文或 A4 设置。

**从正式 0.2.4 升级时须检查答案显示。** 旧版把 `+/-` 都当作教师块，本版的 `+` 会出现在学生版；需要隐藏的答案应逐项核对为 `-`。教师版需要显示 `solution-` 等内容时，在对应类型选项中开启。插件不会批量改写源笔记，详见 [Markdown 规范](https://github.com/sunsimilarsun/Mathsemble/blob/0.2.5/docs/MARKDOWN_SPEC.md)。

## 方案与试听兼容

- 方案读取 v1／v2／v3，显式保存写 v3。旧 `solutionSpaces`／`showSolution` 按原值映射到 `solution` 类型选择，读取本身不写文件。
- 正式 0.2.4 无法读取 v3。回退前保留升级前方案副本，不能通过只改 JSON 版本号丢弃新设置。
- 普通文档试听课题按 `title` → `课题名称` → `titile` 读取；生成的 `note_type: handout` 按 `titile` → `title` → `课题名称`。按字段是否存在决定优先级，显式空值不回退，保留独立课程标题。
- 调整试听课程表及页脚样式。教师缺省仍为“孙老师”，其他缺失信息不编造。

资源准备继续使用单项超时、总截止时间、取消及单次任务缓存；取消不会撤回已经保存的文件。

## 安装

要求桌面版 Obsidian 1.5.0 及以上，插件 ID 为 `mathsemble`。

1. 备份旧插件三件套和组题方案。
2. 从本 Release 下载 `main.js`、`manifest.json`、`styles.css`，一起放入 `<vault>/.obsidian/plugins/mathsemble/`，不要混用不同版本文件。
3. 重启 Obsidian 或重新加载插件，核对当前材料的答案显隐、试听标题与双版输出。v3 方案不能交给正式 0.2.4 读取；回退时使用升级前的方案备份。

## 验证边界

Windows 本地完整 `prepublish-check` **592 项通过，0 失败、0 跳过**，包含真实 Chromium／MathJax 回归；不带预构建 `main.js` 的独立源码构建通过，生成产物与本地安装文件逐项一致。

**本版真实 Obsidian 操作、视觉和原生 PDF 验收仍未完成。** 自动化检查和 GitHub 发布不能替代该范围。远端 Linux／Windows 检查和发布结果以目标提交的 [Actions](https://github.com/sunsimilarsun/Mathsemble/actions) 与本 Release 为准；详细来源和本地证据见 [0.2.5 验证记录](https://github.com/sunsimilarsun/Mathsemble/blob/0.2.5/docs/TESTING_0.2.5.md)。

本版基于正式 0.2.4（`bf1d6138`）接回额外安装改动，并将其纳入可维护源码、构建链和回归测试；旧安装包即使曾标为 0.2.4，也不能仅凭版本号认定与正式 0.2.4 字节及行为一致。
