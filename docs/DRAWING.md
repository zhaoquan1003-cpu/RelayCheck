# 画图检测与 Cockpit Tools 对齐

`pelican` 模式采用 [Cockpit Tools](https://github.com/jlcodes99/cockpit-tools/tree/27a4a7e87f214acdea52ad58bb6d3141671ed6d0) 的鹈鹕动画题目、交付指令、可执行预览和人工判读流程。参考固定在提交 `27a4a7e87f214acdea52ad58bb6d3141671ed6d0`，不会随上游更新自动改变。RelayCheck 在现有 Vue / Fastify 架构内实现这些行为，保留自己的托管限制。

## 请求

从题目版本 `2026-11-v4` 开始，用户题目逐字为：

```text
创建一个 HTML，内容是 SVG 绘制一个鹈鹕骑自行车的 2D 动画，你不需要任何测试，不要有任何限制
```

另行发送以下交付指令，不把观察标准或参考答案加入题目：

```text
Follow the output format requested by the user. For HTML or SVG creation tasks, return a complete standalone HTML document without Markdown fences or external dependencies. For other tasks, answer directly in the requested format; do not wrap plain text or JSON in HTML. Do not use external tools or search.
```

- Responses：使用 `instructions` 传递交付指令，`reasoning` 为所选 `effort` 加 `summary: "auto"`，开启流式并设置 `store: false`。
- Chat Completions：用 system 消息传递交付指令，user 消息保持原题，开启流式并保留所选 `reasoning_effort`。
- 每次检测只有一次生成请求，不提供工具，不自动重试、不回退到其他模型。其他检测模式不添加这些画图专用参数。
- 历史记录保留创建时的题目和版本。回答保存前仍执行本站既有的凭据及地址脱敏，不修补模型生成的代码。

## 提取与预览

优先从闭合的 `html`、`svg`、`xml` 或无语言标签代码块中提取完整 HTML / SVG，再回退检查原始回答。文档须有 HTML 或 SVG 根元素及对应结束标签；不把纯 HTML 片段拼成文档，也不补全截断内容。未完成的 HTML 不会降级提取内部 SVG。明确标记为 SVG 的输出，其脚本里的 HTML 字符串不会改变格式识别。

HTML 和独立 SVG 通过同一个隔离 iframe 运行，保留模型的 CSS、JavaScript 和控件，也支持脚本动态创建 SVG。预览包装层在生成代码执行前添加网络、RTC 和弹窗限制；它不修改保存的回答或替模型修图。可停止预览、重新播放、查看原始源码；关闭详情时卸载动画。隔离策略见 [威胁模型](THREAT_MODEL.md)，HTTP 行为见 [API 文档](API.md#drawing-preview)。

## 判读与范围

Cockpit Tools 的动画题没有自动视觉评分。RelayCheck 同样把成功请求记为 `verdict: unknown`，显示“待人工判读”；输出缺失、格式问题、请求失败或资源限制都不转换成降智结论。Cockpit Tools 对部分其他文字题的自动评分不用于这道动画题。

本站保留车轮、腿与脚踏、视角、鹈鹕喙四项观察建议和四档自绘示意，供用户自愿参考。这些内容来自本站原有教学指南，不是 Cockpit Tools 的评分标准，也不参与请求或自动判定。比较多次结果时应保持题目、模型和思考强度一致。

以下为有意保留的托管差异：

| 边界 | RelayCheck | 参考固定版本 |
| --- | --- | --- |
| 预览源文件大小 | 固定 512 KiB，按 UTF-8 字节计算 | 未使用相同的 512 KiB 预览上限 |
| 总时限 | `TEST_TIMEOUT_MS` 可配置，默认 300 秒，含进入运行后的并发等待 | 生成请求总时限 15 分钟，空闲时限 120 秒 |
| 回答大小 | `MAX_ANSWER_BYTES` 可配置，默认 2 MiB；另有传输体上限 | 传输响应上限 16 MiB；保存产物另有限制 |

因此，本次对齐不代表所有资源参数、账户管理和批量比较界面都与参考项目相同。

## 固定来源

- [默认动画题目](https://github.com/jlcodes99/cockpit-tools/blob/27a4a7e87f214acdea52ad58bb6d3141671ed6d0/src/types/codexPelican.ts)
- [交付指令与请求参数](https://github.com/jlcodes99/cockpit-tools/blob/27a4a7e87f214acdea52ad58bb6d3141671ed6d0/src-tauri/src/modules/codex_pelican_transport.rs)
- [HTML / SVG 提取](https://github.com/jlcodes99/cockpit-tools/blob/27a4a7e87f214acdea52ad58bb6d3141671ed6d0/src-tauri/src/modules/codex_pelican.rs)
- [预览隔离包装](https://github.com/jlcodes99/cockpit-tools/blob/27a4a7e87f214acdea52ad58bb6d3141671ed6d0/src/components/codex/pelican/pelicanPreviewDocument.ts)
- [人工判读与评分入口](https://github.com/jlcodes99/cockpit-tools/blob/27a4a7e87f214acdea52ad58bb6d3141671ed6d0/src/components/codex/pelican/PelicanScore.tsx)
