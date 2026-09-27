# Prompt Float 架构说明

## 目标与边界

Prompt Float 是本地 Electron 桌面客户端。renderer 负责界面和交互状态；所有系统能力、设置持久化、凭据解密和模型网络请求都位于主进程。应用不包含上游 Prompt Optimizer Core，而是通过标准 MCP 连接独立部署的服务。

## 目录职责

| 目录/文件 | 职责 |
| --- | --- |
| `src/` | React renderer、主题、动效和用户交互 |
| `src/components/settings/` | 路由选择、连接表单、路由测试、用量限制和诊断等设置子模块 |
| `src/hooks/` | 弹窗、焦点和业务交互状态 |
| `shared/` | renderer、preload、主进程共享的纯类型、供应商目录和 CSP 常量 |
| `electron/main.ts` | 单实例锁、窗口生命周期、权限拒绝策略、诊断和更新启动 |
| `electron/infrastructure/` | 原子文件替换、有界 JSON 读写和进程内串行任务队列 |
| `electron/security/` | 生产/开发 renderer 加载目标、不可变信任策略和更新源校验 |
| `electron/preload.ts` | 最小、显式、强类型的 IPC 桥 |
| `electron/ipc/` | IPC 来源校验、Zod 请求校验、设置处理器和优化处理器 |
| `electron/services/` | 设置文档 schema/迁移、仓库操作、路由、凭据、模型协议、额度、诊断和更新服务 |
| `e2e/` | Electron + Playwright 用户流程测试 |
| `scripts/` | Windows 打包、冒烟、哈希和签名校验 |
| `docs/` | 架构、测试、兼容性和发布说明 |

仓库根目录只保留当前可构建源码和交付配置。历史代码汇总、前端修改包及视觉预览仍保留在本机，但由 `.gitignore` 排除，避免误作为当前实现提交或打包。

## 信任边界

```text
React renderer
  -> window.promptFloat（contextBridge 白名单）
  -> IPC 来源 + main-frame + payload schema 校验
  -> 主进程服务
       -> safeStorage 加密设置 / 用量文件 / 脱敏日志
       -> HTTPS 模型 API 或本机回环 MCP
```

- renderer 开启 `sandbox` 与 `contextIsolation`，关闭 `nodeIntegration`。
- 打包版无条件从应用内置文件加载 renderer，并忽略 `VITE_DEV_SERVER_URL`；开发版只允许固定的 `127.0.0.1:5173` 回环源。
- 生产内容通过固定 `prompt-float://app/` 自定义安全协议映射 ASAR 内 `dist` 目录，拒绝路径越界、其他主机和非自身发起源；不再给 renderer 使用 `file://`。
- renderer 加载目标和 IPC `trustedUrl` 来自同一个启动时冻结的策略对象，IPC 处理期间不再读取环境变量。
- 生产 CSP 使用 `default-src 'none'` 与 `connect-src 'none'`，不允许内联样式；会话级 `webRequest` 再取消 renderer 的 HTTP(S)/WebSocket 请求。模型 API/MCP 请求只存在于主进程。
- electron-builder 的 `afterPack` 钩子使用严格全量配置翻转并回读验证 Electron Fuses；生产 EXE 不接受 `ELECTRON_RUN_AS_NODE`、`NODE_OPTIONS` 或 Node 调试参数，并强制校验、只加载 `app.asar`。
- renderer 不能任意打开外链；供应商申请页由主进程白名单解析。
- API Key/MCP Token 只在主进程解密，公开设置只包含 `hasCredential`。
- 远程端点必须为 HTTPS；HTTP 仅允许精确回环地址。
- 网络请求不跟随重定向，避免凭据跨域转发。
- IPC 错误日志经过字段级和文本级脱敏，不记录请求 payload、提示词或模型输出正文。
- 正式包内固定更新源及签名发布者；启动时核对包内信任信息与更新配置，不接受环境变量改写。未签名测试包不启用自动更新。

## 本地持久化边界

- `services` 只负责设置迁移、Zod 业务校验、凭据作用域和用量规则；文件系统与 JSON 细节统一位于 `infrastructure`。
- JSON 文件使用有界分块读取：设置文件最多 5 MiB，用量文件最多 256 KiB，超限时不会继续读取或解析。
- 解析支持 UTF-8 BOM，但畸形 JSON 只返回通用错误，不把可能含凭据的原文拼进异常。
- 序列化统一使用两空格、UTF-8、结尾换行，并拒绝会被 JSON 静默转换为 `null` 的 `NaN` 和无穷值。
- 写入先落到权限受限的唯一临时文件，再通过备份与重命名替换；同一仓库实例内的读改写由公共串行队列保证顺序。
- 设置文件主副本均经过 schema 校验；主文件缺失或损坏时可恢复有效备份，并隔离损坏原件。用量备份可能低估请求数，因此额度文件异常时不自动恢复，模型请求失败关闭。

## 核心请求流程

1. renderer 为本次优化生成请求 ID，并保存不可变输入快照。
2. 主进程验证 IPC 来源和请求结构。
3. 设置服务读取当前活动路由，在主进程内解密其作用域凭据。
4. 用量服务写入带唯一 ID 的预留凭据，同时预扣请求次数和 token 预算；并发注册表拒绝同一 renderer 的重入请求。
5. MCP 适配器先检查服务声明的工具能力，再有界分页发现所需工具；缺失时在模型调用前失败。直连适配器解析流式/JSON 响应的供应商用量信息。
6. 协议适配器调用直连模型 API 或 Prompt Optimizer MCP，并通过单向事件发送流式分块。成功时用可信的供应商 token 总数结算预留；无用量数据、失败、取消或进程崩溃则保留全额预扣。真实用量超出预估时照实记账，后续请求会被预算挡住。
7. renderer 只接收匹配当前请求 ID 的事件；完成后允许应用结果与撤销。
8. 诊断服务只记录路由 ID、供应商、模型名、耗时、结果长度和错误类别。

本地额度是安全阀，不是账单对账：MCP 服务端没有通用 token 用量回报时按全额预留计入；跨日的未完成凭据不会冲减新一天额度。路由测试计入请求次数和保守 token 预留。

## 设置页拆分

`SettingsDialog.tsx` 保留路由草稿、模型发现与保存编排。展示和纯数据职责分别下沉到：

- `RoutePickerSection.tsx`：已保存路由选择与当前路由提示；
- `ConnectionSettingsSection.tsx`：供应商、模型、地址和凭据输入；
- `src/components/routeDraft.ts`：路由草稿的纯转换函数；
- `RouteTestPanel.tsx`：路由回路耗时和质量；
- `UsageLimitsPanel.tsx`：请求与 token 上限；
- `DiagnosticsPanel.tsx`：应用、网络代理、显示器缩放与报告导出。

主进程的 `settingsDocument.ts` 定义设置数据 schema、默认值与迁移；`settingsRepository.ts` 只负责读改写和凭据管理。`settingsHandlers.ts`、`optimizationHandlers.ts` 分别注册对应 IPC；`secureHandle.ts` 统一来源校验和公开错误转换。暂不重写设置状态机，以降低回归范围。
