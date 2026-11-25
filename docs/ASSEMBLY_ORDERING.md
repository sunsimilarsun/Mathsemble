# 预览编排：右侧排序目录

“预览编排”右侧提供紧凑目录。正文保持完整预览，目录只显示题号、标题、角色、分区内容数和来源异常。

- 点击目录项定位正文；在正文点击或编辑时同步目录选中项。
- 拖动手柄，按插入线放到目标前方或后方；列表边缘可滚动。拖动分区时，插入线和实际位置都吸附到分区边界。
- 使用上下箭头或 `Alt + ↑ / ↓` 微调，也可在底部输入目标位置。
- 分区标题及其下方内容整体移动；题目和知识单项移动。目标“第几项”包含题目、知识和分区标题，“第几分区”只计算分区。
- 目录独立滚动，可用工具栏按钮收起。窄面板初次打开默认收起，展开后从右侧覆盖显示；`Esc` 收起。

排序只调整当前方案的 `entries` 顺序。原题正文、题目身份、来源指纹、本次标题/角色、可选分值和片段选择保持不变；保存方案和生成讲义继续使用同一顺序。不增加题卡或方案必填字段。

## 产品参考与取舍

以下为官方公开文档参考，没有登录这些产品进行运行验收：

| 参考 | 借鉴到本次实现的交互 |
| --- | --- |
| [出卷网帮助](https://www.chujuan.cn/help/article?id=55)、[二一组卷编辑页说明](https://zujuan.21cnjy.com/help/notice?id=42) | 侧栏题号排序、点击定位正文、整大题移动；Mathsemble 对应为题目和整分区。 |
| [PowerPoint 缩略图窗格](https://support.microsoft.com/en-us/powerpoint/show-or-hide-slide-thumbnails) | 独立目录同时承担导航与排序，可收起以扩大正文。 |
| [Canva 页面管理](https://www.canva.com/help/manage-pages/) | 拖动与上下箭头并存，以标题辨认内容。 |
| [菁优网排序案例](https://www.jyeoo.com/Paper/PaperOrderExample) | 自由混排与自定义分类；Mathsemble 保留题目、知识和分区的现有顺序，不按题型自动分组。 |

目录不额外渲染一份公式、图片和长题干，便于一次看到更多内容，也避免重复排版开销。

## 验证入口

- `tests/assembly-ordering-sidebar.test.cjs`：真实 Chromium 的目录交互、定位、键盘、前后插入、整区移动、边界指示、窄面板、陈旧操作保护、保存/生成顺序和 P2 可选信息。
- 原有 `assembly-arrangement-preview`、`assembly-section-move`、`assembly-inline-preview`、`assembly-ui-layout` 回归保留。
- 本机安装与原生验收记录：`docs/TESTING_ORDERING_SIDEBAR.md`。
