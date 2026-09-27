# Prompt Float v0.6.2

一个带安全边界的 Electron 提示词优化桌面工具。v0.6.2 在原有首次启动 API Key 引导、多路由切换和诊断能力上，补充单实例锁、设置备份恢复、额度损坏时暂停请求、token 预留结算、MCP 工具能力协商，以及固定更新源与签名发布门禁。

## 外观与动效

- 标题栏可选择“跟随系统、浅色、深色”，主题偏好会保存到本机设置并在重启后恢复。
- 深浅主题分别定义背景、卡片、边框、文本和状态颜色，不使用简单反色。
- 按钮、模式切换和弹窗使用一次轻量弹性回弹；空白页面和正文不会跟随点击晃动。
- 系统启用“减少动态效果”时，缩放、位移和循环流光会自动停用。
- 设置弹窗的内容独立滚动，测试与保存按钮始终显示在底部。

## 首次启动与 API Key

- 全新设置目录的首次进入会优先显示“API Key 配置”，不会与模型路由设置重叠。
- 供应商列表包含 OpenAI、Anthropic Claude、Google Gemini、DeepSeek、智谱 AI 和硅基流动；每项提供其官方 API Key 控制台入口、固定 API 域名和默认模型摘要。
- 外链按钮只向主进程发送供应商 ID；主进程使用内置白名单解析固定 HTTPS 地址后交给系统默认浏览器，不接受 renderer 传入任意 URL。
- 保存时必须确认真实 API 域名；Key 通过原有 Electron `safeStorage` 加密，保存后不回显。一次可保存一个供应商，保存后可继续选择其他供应商。
- 至少成功保存一个直连 Key 后，首次引导标记会和路由一起原子持久化；点击“稍后设置”只关闭当前会话，下次启动仍会首先提醒。
- 后续可从“模型路由设置 → API Key 快速配置”重新打开。

## 结构边界

- `shared/providers.ts`：供应商、默认端点、建议模型及官方 API Key 入口的单一目录。
- `src/hooks/useAppDialogs.ts`：用互斥状态代替多个弹窗布尔值，保证首次引导与普通设置不会同时出现。
- `src/hooks/useModalFocus.ts`：复用弹窗初始焦点、焦点循环和 Escape 关闭逻辑。
- `src/components/ApiKeySetupDialog.tsx`：只负责首次配置界面与交互状态，不直接处理文件、加密或浏览器能力。
- `electron/services/settingsDocument.ts`：负责设置 schema、默认值、迁移和凭据作用域规则；`settingsRepository.ts` 负责凭据加密、路由更新和原子保存。
- `src/components/settings/`：路由选择、连接表单、测试、用量与诊断展示；`SettingsDialog.tsx` 保留交互编排。
- `electron/ipc/`：分别由设置与优化处理器注册通道，统一执行来源、请求结构和公开错误校验。
- `electron/services/providerLinks.ts`：校验固定 HTTPS 官方入口；IPC 仍统一执行来源与严格请求结构校验。

## 模型路由

每条路由分别保存供应商、模型、端点、域名确认和加密凭据。主窗口右上角的链路摘要可打开快速切换面板，面板按卡片展示名称、API/MCP 类型、供应商、模型、主机和凭据状态；当前链路使用高亮边框和“当前使用”标签。点击非当前卡片会立即启用该链路，点击铅笔按钮会在设置中直接打开该链路。切换失败时保留原活动链路并显示错误，成功选择会持久化到本机设置。

快速切换面板不会显示 API Key 或 MCP 访问令牌，只显示是否已保存凭据。设置弹窗仍可创建、删除、测试和启用路由；其中“已保存路由（选择即启用）”也会真正启用对应路由。优化请求始终使用当前路由保存的 LLM 和 API/MCP 地址。

## 历史记录

主操作面板右侧“优化结果”卡片新增“历史”视图：可在工作区直接搜索、浏览记录，点击一条记录进入其完整原文、优化结果和差异详情。标题栏原有“历史记录”入口仍可打开完整历史弹窗。记录按时间倒序保留最近 50 次成功优化；第 51 条进入时淘汰最旧的一条。如果极长内容让加密文件接近 32 MiB 读取上限，也会提前淘汰最旧记录，始终优先保留最新记录。失败或取消的请求不进入历史。

历史仅保存在本机应用数据目录的 `history.json`（及其备份），整个记录文档经 Electron `safeStorage` 加密后再原子写入，不会同步到其他设备。若安全存储或历史文件不可用，界面会提示，现有优化结果仍可使用；损坏的历史文件不会被空记录覆盖。历史功能会持久化原始与优化后的提示词，涉及敏感内容时请注意本机账号与备份的访问权限。

- **直连模型 API**：内置 OpenAI、Anthropic Claude、Google Gemini、DeepSeek、智谱 AI、硅基流动，以及自定义 OpenAI 兼容接口。
- **自动模型列表**：切换已保存直连路由时，会自动用该路由的安全凭据从其 API 地址获取该供应商的实时模型列表，并预选该路由保存的模型。旧路由的慢响应会被丢弃，不能覆盖新路由。无 Key、离线或不支持 `/models` 的接口会明确保留建议列表；始终可以手动填写模型名称。
- **原生协议**：Anthropic 使用 Messages API，Gemini 使用 GenerateContent API；其余内置供应商和自定义接口走 OpenAI Chat Completions 兼容协议。
- **Prompt Optimizer MCP**：可以保存多条 MCP 路由并切换到对应服务端。每条路由保存供应商/模型身份信息，实际模型由该 MCP 服务端独立配置；由于 MCP 标准没有通用“列出远端模型”接口，MCP 路由仅显示保存模型和供应商建议列表。连接后会先确认服务端工具能力并检查相应优化工具是否存在，缺失时明确报错。

## 关键意图澄清

用户提示词模式会在原任务缺少会明显改变结果的信息时，要求优化结果列出最多 3 个针对任务的具体问题，让后续 Agent 先问用户、等到回答再执行；信息足够时不添加提问。系统提示词模式会为未来的用户任务写入同样的判断与提问规则；尚无具体任务时不会编造固定问题。直连与 MCP 两种引擎使用同一套要求，优化器本身不会在当前窗口向用户提问。

官方 MCP 工具只接收待优化提示词，桌面端会把补充要求与原文一起交给该工具，因此接近 MCP 的 50,000 字输入上限时可能提示缩短少量原文。最终问题由所选模型生成，需要用户检查是否准确体现原意。

## 路由测试与延迟

保存前可运行“测试路由”。它会发送一个最多 1 个输出 token 的最小真实探测请求，并计入请求次数和少量 token 预算。

直连路由显示：DNS、TCP、TLS、本机发送完成、服务首字节、首响应和总回路耗时。MCP 路由还会显示 MCP 握手、工具发现和最小模型探测耗时。`DNS/TCP/TLS` 不适用于 IP 直连或不经过 TLS 的路径时会显示 `—`。

“发送完成”表示请求已在本机写入网络栈；客户端无法直接测量服务端实际收到请求的时刻。“首字节 / 首响应”是本机收到服务返回的可观测时间点。

## 本地运行

```powershell
npm install
npm run dev
```

首次启动会首先打开“API Key 配置”。选择供应商后可打开其官方申请页面，填写 Key、确认发送域名并保存；需要自定义接口、模型发现、连接测试或 MCP 时，再进入“模型路由设置”。

## 启动官方 Prompt Optimizer MCP

MCP Server 属于上游项目，本程序通过标准协议连接，不复制或打包其 AGPL Core。生产运行前先审核准备部署的上游版本，并把 registry 返回的 digest 填入不可变镜像引用；下面仅绑定本机回环地址：

```powershell
$env:PROMPT_OPTIMIZER_IMAGE = "linshen/prompt-optimizer@sha256:{{已核验摘要}}"
if ($env:PROMPT_OPTIMIZER_IMAGE -match "\{\{") {
  throw "请先填入已核验的镜像摘要"
}
docker run -d -p 127.0.0.1:8081:80 `
  -e VITE_OPENAI_API_KEY=your-openai-key `
  -e MCP_DEFAULT_MODEL_PROVIDER=openai `
  --name prompt-optimizer `
  $env:PROMPT_OPTIMIZER_IMAGE
```

然后新建一条 **Prompt Optimizer MCP** 路由，填写：

```text
http://127.0.0.1:8081/mcp
```

上游 `prompt-optimizer` 当前固定使用服务端的 `mcp-default` 模型，MCP 工具没有运行时的 `provider` 或 `model` 参数。因此，桌面端的 MCP 路由切换会真实切换到不同的 MCP 服务地址；供应商和模型字段用于标识并核对该服务端已配置的模型，不能直接重写远端 Core。运行“测试路由”会实际调用最小 MCP 工具请求，验证该服务端模型有响应。

也可以克隆[上游仓库](https://github.com/linshenkx/prompt-optimizer)，按其 [MCP 用户指南](https://github.com/linshenkx/prompt-optimizer/blob/develop/docs/user/mcp-server.md)配置 Node 24、pnpm 和 `.env.local`，再运行 `pnpm mcp:dev`；开发模式默认地址是 `http://127.0.0.1:3000/mcp`。

## 诊断与兼容性

设置中的“高级设置与费用保护”可查看应用版本、在线状态、当前路由代理解析、显示器数量和 DPI 缩放，并可由用户主动导出 JSON 诊断报告。主进程同时维护 1 MB 轮换日志，用于记录窗口生命周期、路由测试和优化耗时。

诊断数据经过字段与文本双重脱敏，不写入 API Key、MCP Token、提示词、迭代要求或模型输出正文。代理、自定义 CA、不同 DPI 和多显示器的发布前验证矩阵见 [`docs/COMPATIBILITY.md`](docs/COMPATIBILITY.md)。

## 安全与费用保护

- 远程 API/MCP 只允许 HTTPS；HTTP 只允许精确的 `localhost`、`127.0.0.1` 或 `::1`。
- 保存或测试前必须明确确认实际发送域名，所有网络请求禁止重定向。
- 每条路由的凭据由 Electron `safeStorage` 加密；renderer 无法读取明文。凭据绑定到供应商和完整目标地址，切换供应商或地址时不会复用旧 Key。
- 本地设置和用量 JSON 采用有界读取、脱敏解析错误和可恢复原子替换。设置文件可从有效备份恢复，损坏的原件会保留；额度文件损坏时暂停模型请求，不使用可能低估用量的旧备份继续扣费。
- 桌面端只允许一个运行实例；再次启动会唤回原窗口。
- 正式构建将 GitHub Releases 更新仓库与签名发布者固定到包内，运行时环境变量不能切换更新源；没有受信任发布配置的测试包不启用自动更新。
- MCP 路由可选保存访问令牌；模型服务自身的 API Key 仍应由 MCP 服务端保管和限制。
- IPC 只接受当前主窗口 main frame，并使用严格 Zod schema 校验；导航、新窗口、WebView 和页面权限默认拒绝。
- 打包版始终加载应用内置的 `dist/index.html`；启动环境不能用 `VITE_DEV_SERVER_URL` 替换 renderer。开发版只接受精确的 `http://127.0.0.1:5173/`，加载目标与 IPC 信任地址在启动时统一计算并冻结。
- 生产 renderer 通过固定的 `prompt-float://app/` 协议只映射 ASAR 内 `dist` 目录；协议拒绝其他主机、越界路径、查询参数、片段和非自身发起源。
- 生产 renderer 使用 `default-src 'none'`、`connect-src 'none'` 和无内联样式放行的 CSP；Electron 会话层同时取消 renderer 发起的 HTTP、HTTPS、WS 和 WSS 请求。模型 API/MCP 网络只允许从主进程服务发出。
- 打包时严格配置全部 Electron Fuses：禁用 `ELECTRON_RUN_AS_NODE`、`NODE_OPTIONS`、Node 调试参数和 `file://` 额外权限，启用 Cookie 加密、ASAR 完整性、仅从 ASAR 加载和 WebAssembly 越界陷阱。
- 供应商申请页由主进程固定白名单打开；renderer 不能要求系统打开任意外部网址。
- 每个 renderer 同时只能运行一个优化或路由测试；可配置每小时请求数、每日 token 预算和直连单次最大输出。
- 用量限制在请求前保守预留 token；直连模型成功返回可信用量时结算为供应商报告的实际 token，缺少用量、失败、取消或崩溃则保留全额预留。实际用量超过预估时会照实计入，后续请求可能因超预算被阻止。这是本地安全阀，不等于供应商账单；MCP 的真实模型和输出上限由 MCP Server 控制，生产使用还应在供应商或 MCP 服务端设置硬额度。
- 请求期间原文、模式和迭代要求会锁定；差异基于不可变快照，“应用结果”支持最近 20 次内存撤销。优化期间的临时快照不会单独写盘；成功完成后，原文和结果会按上述规则加密保存到本机历史记录。

## 测试与构建

```powershell
npm run typecheck
npm run lint
npm run test:coverage
npm run test:e2e
npm run test:e2e:packaged
npm run test:ci
npm run check:supply-chain
npm run sbom -- --output release/ci-verification/SBOM.cdx.json
npm run dist  # 仅在已配置正式签名资料时执行
npm run smoke:package
npm run verify:release
```

正式校验默认要求有效 Authenticode 签名。没有签名资料时，`npm run dist:portable` 只在 `release/local-verification/v<version>/` 生成文件名含 `UNSIGNED-LOCAL-ONLY` 的本地验证包，不得作为正式版本分发。

测试覆盖首次弹窗优先级、供应商目录、设置内重开入口、schema v5 迁移、官方外链白名单、API Key IPC、JSON 大小/BOM/脱敏边界、原子加密保存、多路由迁移、凭据作用域、模型发现、流式解析和 token 结算、MCP 工具协商、路由探测、并发门禁、预算、链路切换、普通窗口层级、快照、撤销、历史记录上限/恢复/加密/重启、恶意环境变量、生产 CSP、renderer 网络封锁、Electron Fuses，以及诊断 IPC/UI 和凭据泄漏检查。Windows CI 另外运行隔离的安装升级测试；关键模块的覆盖率门禁为语句/函数/行 80%、分支 70%。

安装版、签名、自动更新和镜像固定要求见 [`docs/RELEASE.md`](docs/RELEASE.md)；完整架构与测试边界见 [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) 和 [`docs/TESTING.md`](docs/TESTING.md)。

## 已知协议边界

上游 MCP 工具当前以一次工具结果返回完整文本，因此 MCP 模式会在工具完成后一次显示结果；直连模式会逐 token/分块更新。两者都沿用同一套 IPC 事件、取消、快照和 UI 状态机。

## 开源许可

本仓库的 Prompt Float 客户端源码采用 [MIT 许可证](LICENSE)。`private: true` 仅用于防止误发布到 npm，不限制 GitHub 源码仓库公开。

上游 [Prompt Optimizer](https://github.com/linshenkx/prompt-optimizer) 是独立项目，使用 AGPL-3.0-only；本仓库通过 MCP 与其服务通信，不包含或重新授权其 Core。第三方依赖仍按各自许可证使用。本仓库当前不提供正式签名安装包；本地 `UNSIGNED-LOCAL-ONLY` 验证包不应作为公开发行版上传。
