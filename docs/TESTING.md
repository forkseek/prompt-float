# 测试与验证

## 自动化门禁

```powershell
npm ci
npm run check:supply-chain
npm run test:ci
npm run sbom -- --output release/ci-verification/SBOM.cdx.json
# 先运行 npm run build，再生成独立未签名包
npx electron-builder --win dir --config.directories.output=release/ci-verification
$env:PROMPT_FLOAT_RELEASE_DIR = 'release/ci-verification'
npm run test:e2e:packaged
```

Vitest 对关键 IPC、安全策略、JSON 持久化、串行任务队列、设置/用量仓库、模型协议、MCP 工具协商、流式解析和诊断脱敏模块统计 V8 覆盖率。额度测试覆盖唯一预留、一次性结算、供应商超额计入、无用量/崩溃保守扣除与旧文件兼容。JSON 测试覆盖 BOM、畸形内容脱敏、大小上限、非有限数值、备份恢复、崩溃中断状态与额度损坏失败关闭。更新信任测试覆盖缺失信任根、恶意地址和发布者不匹配。当前最低门禁为：语句、函数、行 80%，分支 70%。`coverage/` 是本地临时结果，不提交仓库。

Playwright 直接启动 Electron，覆盖首次启动、凭据保存、链路切换、模型索引、路由测试、流式输出、快照/撤销、主题持久化、窗口层级，以及诊断 IPC/UI 不泄漏凭据。测试使用独立临时 `userData`，不会读取日常配置。

`.github/workflows/ci.yml` 在 Windows 运行相同检查，并加入安装升级测试。为避免测试输入或 trace 被传到外部，工作流不上传 coverage、日志、截图或 Playwright trace。

供应链门禁先检查 lockfile 的根依赖、registry 地址和已有包 tarball 的 SHA-512 完整性，再运行高危漏洞审计与 npm registry 签名检查；SBOM 为 CycloneDX JSON，包含构建图的生产与开发依赖。部分 npm lockfile 条目不含 tarball `resolved`/`integrity`（例如仅元数据条目），脚本不会把它们误称为已完整哈希锁定；签名检查也不等于对发布者身份或源码行为的审计。

## 打包验证

```powershell
# 正式发布：先按 RELEASE.md 配好签名与更新资料
npm run dist
npm run smoke:package
npm run verify:release
```

`verify:release` 默认检查 `SHA256SUMS.txt`、有效 Authenticode 签名与预期发布者；未签名或签名无效的 EXE 直接失败。显式的 `-AllowUnsignedLocalVerification` 仅允许在 `release/local-verification/` 下验证隔离测试包的哈希，不能用于正式发布。

`test:e2e:packaged`（`smoke:package` 的同义入口）会先读取 EXE 的 Fuse wire，再注入 `VITE_DEV_SERVER_URL`、`ELECTRON_RUN_AS_NODE`、恶意 `NODE_OPTIONS --require`、伪 CA 路径和恶意更新源。打包版必须只加载 `prompt-float://app/` renderer、不能执行注入模块或接触恶意更新源，并且生产 CSP 与会话网络策略必须使诱饵服务器保持 0 请求。测试还要求第二次启动退出并唤回原窗口；首次启动和重启都执行安全检查。由于生产 Fuse 关闭了 Node 调试参数，该测试通过 Chromium CDP 驱动 renderer，不依赖 Electron 主进程 inspector。CI 使用独立未签名包验证，未签名包不会启用更新。

安装升级回归测试只在 Windows CI 中显式启用：用隔离 appId/产品名构建两份 NSIS 安装包，第一份用 `0.6.1` 版本元数据作为基线，第二份用当前版本；静默安装到唯一临时目录，保存测试用凭据，升级并验证版本、设置文件哈希和加密凭据仍可读取，最后调用该测试应用自己的卸载器。这验证安装器升级与数据保留机制，**不**证明历史 `0.6.1` 二进制的所有迁移路径，也不代替正式签名更新链的演练。手工运行需要在独立测试机上设置 `CI=true`、`PROMPT_FLOAT_ENABLE_INSTALL_UPGRADE_TEST=1` 后执行 `npm run test:install-upgrade`。

## 测试数据要求

- 不在测试、快照、截图、trace 或日志中使用真实 API Key。
- 模型网络测试使用本机 mock server。
- 恶意更新源测试只使用本机不会被访问的诱饵监听器；真实更新下载需在组织控制的 HTTPS 测试源单独验证，不得把生产签名证书放入仓库。
