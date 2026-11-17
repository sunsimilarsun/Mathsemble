# 标题映射与分隔线分页修复验收

日期：2026-11-17。基线：0.3.0 / `5efd9a8`；本次为本地修复，未发布新版本。

## 问题与修复

用户提供的长讲义在原文模式触发“存在无法映射的顶层标题”。原生 Obsidian 复现确认：源码规划器预计 16 个标题，实际渲染只有 10 个，额外 6 个标记落在普通段落内。正文中多行 `tags / level / reason` 后的 `---` 被错误当作 Setext 标题。讲义内容未改写，也未将 H3 自动改为 H5。

规划器现只将完整的单行段落识别为 Setext 标题，并将水平线从候选标题正文中排除。单行 `=== / ---`、H5 范围、六连字符换页，以及映射数量、唯一性、层级、顺序、先验证后移动检查全部保留。

实际导出还暴露了分隔线几何差异：宿主上下边距各 30px，独立导出各约 7.33px，学生预览 10 页而 PDF 9 页。现为打印副本统一 HR 边距和边框，不修改普通阅读视图的主题样式。

## 自动化

- [标题回归](../tests/strict-h5.test.cjs)与[合成夹具](../tests/fixtures/strict-h5-setext-sources.json)：六组正文元数据、三版映射、多行下划线、水平线后的单行 Setext、无 H5 时仍拒绝未知标题。原讲义未进入仓库。
- [分隔线分页回归](../tests/heading-rule-layout.test.cjs)：两个独立浏览器文档分别模拟宿主与导出；旧样式会复现页数差，修复后逐内容节点页分配相同，24 段 / 1800px 留白保持，普通阅读 HR 不变。
- 修复候选完整 `npm run check`：**822 通过，0 失败，0 跳过**；真实 Chrome、`CI=true`。源码构建与校验通过。
- 补丁合入存在并行 P2 改动的主工作区后，标题、分隔线、CSS 契约定向检查：**47 通过，0 失败，0 跳过**。822 项全测属于独立的 0.3.0 修复候选，不代表并行 P2 全部完成验收。

## 原生 Obsidian 验收

使用用户指定的原始讲义，实际加载修复插件，执行原生讲义预览、PDF 保存与原文 HTML 保存。最终安装的源码与 bundle SHA-256 为 `4784fb12cc9c8dedcea0df45d1bbebc2c9e99474802079fa0806117dbf2c0766`，样式为 `7749525ced27663757328d30e04aa31aee5aea53db68931853e649fc8935324d`。

| 模式 | 标题数 | A4 预览 | PDF | 跳过内容 |
|---|---:|---:|---:|---:|
| 原文 | 10 | 12 页 | 12 页 | 0 |
| 学生 | 10 | 9 页 | 9 页 | 0 |
| 教师 | 10 | 12 页 | 12 页 | 0 |

学生版 70 段书写留白完整，测量总高保持；答案 Callout 未进入学生 PDF。三版 PDF 的 10 个标题顺序、6 段元信息均保留，无内部映射 token。33 页已用 Poppler 渲染并检查；教师版 12 页与原文版逐页像素相同。原文 SHA-256 前后均为 `1dcdaa1758d93a53970623842308deefba77c42dbfd9b33e9cd60896f332a364`。

修复过程中一次宿主 Markdown 渲染超时被正常阻断，失败证据保留；未增加超时额度或关闭保护。完整测试结束后，以同一最终安装字节重试通过三版导出。不得将该次失败改写为成功。

证据保存在本机 `D:/Documents/Mathsemble-QA/20261117-heading-fix/`：`check-final.log`、`primary-integration-check.log`、`host-probe.json`、`candidate-probe.json`、`preview-style.json`、`print-style.json`、`native-export-final.json`、`native-export-timeout.json`、`pdf-check.json`、`pdf-pixel-check.json`、`final-renders/`。PDF 与原文 HTML 同时保存在用户库 `ExamExports/`；旧安装三件套保存在证据目录 `installed-before/`。

本次未改讲义数学内容和标题级别；因此它仍没有 H5 整题块保护。验收不含实体打印、macOS 或任意第三方主题。
