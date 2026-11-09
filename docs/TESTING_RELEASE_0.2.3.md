# 0.2.3 发布检查修复

本轮在 `release/0.2.3-appearance` 隔离工作树中，接续候选 v2 的课程属性调整，清理完整发布检查的既有失败。用户负责视觉效果验收；先前 v8 的用户验收记录保留，本轮不重复视觉或原生 PDF 验收。

## 原失败分类

基线 `0.2.3-candidate-prepublish.log` 为 419 项：371 通过、47 失败、1 跳过。47 是测试报告中的失败记录数，包含子测试失败导致的父测试失败，并非 47 个产品缺陷。

| 分组 | 失败记录数 | 原因与处理 |
| --- | ---: | --- |
| audit-regressions | 8 | 更新共享投影调用位置的断言；使用真实 PreviewModal 实例，补全测量生命周期，保留禁用解析时的答案隔离和启用坏公式时的诊断。 |
| page-break-source | 2 | 按现有 H5 内容块行为更新预期；为 Markdown 渲染提供计时器、测量容器和所有权模型，校验发布及清理结果。 |
| strict-h5 | 11 | 对齐提交 `8d3cea5` 已实施的所有顶层 H5 独立成块规则；保留原 Markdown、投影与渲染 HTML 数据，增加块名称和顺序核验，同步书写规范。 |
| templates | 21 | 生产模板已迁出仓库，旧最小模板也已不存在。加入八份匿名化通用模板快照及独立编写的最小回归样例，记录来源与散列；默认测试不依赖个人内容库，仍可显式只读核验正式模板。 |
| tikz-export | 5 | 提取的测试片段缺少真实导出取消／期限依赖；补齐这些依赖和浏览器环境，保留实际字体、字形墨迹及源 DOM 不变检查。 |

修复测试过程中发现一项产品误报：现行题卡使用 `type: 题卡` 表示对象类型，旧代码却将其与 `question_type` 比较并报告题型冲突。现在只比较确属旧题型别名的 `type`；真正的旧题型冲突及非法正式枚举仍会报告，新增独立回归覆盖这些分支。

真实字体检查完整启用后，又确认一处实际公式越界：试听 Callout 的可用宽度为 615.515625 px，已换成两行的多项式仍宽 621.78125 px；npm 与 Obsidian 1.15.0 的 MathJax 4.1.3 均可复现。`containerWidth` 的 CSS 像素单位正确，但内部断点选择不保证最终 DOM 严格符合宽度。修复在字体稳定后批量读取宽度，仅将实际越界的已换行显示公式再次排版，断行目标减去实测超出量与原有 2.5 px 边界余量，最多两次。字号、scale、TeX 和全局 MathJax 选项不变，期限、取消和最终溢出守卫保留；该公式重新排版后宽 590.515625 px，字号仍为 14.74 px。

## 可重复运行的资源

- `mathjax` 与 `@mathjax/mathjax-tex-font` 固定为 4.1.3，仅作开发依赖，不进入插件安装包。
- 真实公式测试通过本地临时 HTTP 服务加载渲染器和字体；CSP、资源来源与本地请求结果共同检查意外外部 CDN 回退及缺失资源。
- 原来默认跳过的真实 MathJax 元信息安全分支纳入默认测试。`MATHSEMBLE_MATHJAX4_DIR` 仍可用于显式 Obsidian 资源对照。
- 测试夹具的 CommonJS shim 与真实 MathJax 加载器隔离；CHTML 样式使用当前完整样式表，核验实际字体已加载。
- 按 MathJax 4 的菜单设置关闭测试中不用的语音／辅助处理，避免菜单在启动后重新开启 Worker；不篡改浏览器 Worker 实现。浏览器 shim 补齐桌面宿主的 Buffer 字节转 Base64 功能，并检查 HTML 导出确实嵌入字体。
- CI 的删除构建产物步骤以及构建测试的临时检出复制均排除 `node_modules`，防止破坏或重复复制已安装的开发资源。

## 候选 v3 本地验证结果

环境：macOS、Node 22.13.1、npm 10.9.2、Chrome 157.0.8103.38，显式提供 `CHROME_PATH`。完整检查另设置 `CI=1`，缺少浏览器时必须失败。未设置个人模板或宿主数学资源覆盖路径。

| 检查 | 结果 |
| --- | --- |
| `npm ci` | 成功，锁文件安装可复现 |
| `npm run prepublish-check` | 433 项全部通过，0 失败、0 跳过；包含构建、自动化、源码一致性和发布资产检查 |
| 默认 npm 真实数学／元信息安全两套 | 49 项全部通过，0 跳过 |
| Obsidian 1.15.0 自带 MathJax 4.1.3 资源对照 | 49 项全部通过，0 跳过；不是原生应用导出验收 |
| 正式内容库模板只读对照 | 21 项全部通过，正式库未改写 |
| 独立只读复审、`git diff --check` | 通过 |

新增回归还验证纠正断行期间取消或父级期限耗尽后不写入晚到结果，以及持续超宽最多重排两次后仍由分页守卫阻断。测试中的字体已实际加载，HTML 内嵌字体数据已核验。

持久日志位于工作树上一层 `appearance-20261109/`：`npm-ci-portable-mathjax.log`、`0.2.3-candidate-v3-prepublish.log`、`portable-mathjax-tests.log`、`host-mathjax-tests.log`、`0.2.3-template-live-audit.log`。候选包为上一层 `dist/Mathsemble-0.2.3-candidate-v3.zip`，摘要登记在 `release/SHA256SUMS_0.2.3-candidate-v3.txt`。

## 候选 v4 跨平台验证

GitHub 重新授权后建立[草稿 PR #21](https://github.com/sunsimilarsun/Mathsemble/pull/21)。首轮 CI 暴露了显示 MathJax 容器内边距导致的实际越界：公式只比正文宽约 2 px，宽度断言允许，但容器的左侧 2 px 内边距使右侧越界约 4 px。源码现在读取实际容器 padding／border 并检查左右边界；保持原有字号、2.5 px 容差和最多两次纠正，不缩公式、不放宽分页守卫。

测试同时排除平台字体偶然性的影响：需触发长行内公式或取消场景时，显式构造确实溢出的容器；首遍测量仍必须匹配已展开列表宽度，后续纠正目标只能递减，字体重试须保持同一目标。新增用例直接验证“宽度看似合格，但内边距导致实际右边界越界”的情况，以及修复后预览／打印均可分页。

| 提交／检查 | 结果 |
| --- | --- |
| `4ede04b`，CI `42579555193` | Ubuntu 428 通过／5 失败，Windows 431 通过／2 失败，均 0 跳过；含父测试级联失败 |
| `7eb80fb`，CI `42581112324` | Windows 434 全通过；Ubuntu 432 通过／2 失败，仅首遍与纠正宽度断言及其父记录，0 跳过 |
| `81d7c54`，[CI `42581661383`](https://github.com/sunsimilarsun/Mathsemble/actions/runs/42581661383) | Ubuntu、Windows 各 434 全通过，0 失败、0 跳过；`npm ci`、清洁构建、`npm run check`、源码／产物无漂移均通过 |
| [安装 ZIP `42581661305`](https://github.com/sunsimilarsun/Mathsemble/actions/runs/42581661305) | 通过，三份安装资产验证成功 |
| macOS 本地完整 `prepublish-check` | 434 全通过，0 跳过；包含发布静态门槛 |
| 当前宿主数学资源长公式对照 | 27 全通过，0 跳过 |

两个远程平台核验的 `src/plugin.js`／`main.js` SHA-256 均为 `d19172d6e0d6c32baf9cfa929aa0dc0fa37b23dbef22439bb34c27d24cdb9290`。PR CI 执行 `npm run check`，不将它冒称为完整 `prepublish-check`；发布静态门槛由本地完整命令和正式标签工作流单独覆盖。

本轮日志仍在上一层 `appearance-20261109/`：各轮 `ci-<run>-linux.log`／`ci-<run>-windows.log`、`0.2.3-ci-fix-prepublish.log`、`0.2.3-v4-host-math-verified.log`。候选 v4 为上一层 `dist/Mathsemble-0.2.3-candidate-v4.zip`，摘要见 `release/SHA256SUMS_0.2.3-candidate-v4.txt`；此前候选及历史失败记录保留。

## 证据边界

本地浏览器自动化不等同于 Linux／Windows 远程 CI 或真实 Obsidian 导出。本轮不改写此前各版本的自动化及用户验收结果；实际六份 PDF 的历史检查和 v8 用户验收仍见 [外观测试记录](TESTING_APPEARANCE_20261109.md)。正式 Markdown 库、Obsidian 安装目录及另一工作区的“辨析”修改未纳入此次写入。

候选包仅包含三个插件安装文件、发布说明和 MIT 许可证；测试样例、依赖、日志、私人讲义和 PDF 均不在安装包中。
