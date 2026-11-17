# Mathsemble 0.3.1

本补丁仅包含标题识别与打印分隔线修复，不含并行 P2 开发。

- 多行正文后的 --- 不再误判为 Setext 标题；保留单行 Setext 与全部严格映射检查。
- 统一打印副本分隔线几何，消除宿主预览与 PDF 页数差异。
- 新增 11 项回归，完整测试 822 项通过、无失败或跳过。
- 原始讲义在 Obsidian 中验证：原文12页、学生9页、教师12页，预览/PDF一致，源码不变。

沿用0.3.0的插件ID、v3方案及安装方式；替换main.js、manifest.json、styles.css前保留备份。

验收详情见[测试记录](TESTING_HEADING_MAPPING.md)。不包含实体打印或macOS验收。
