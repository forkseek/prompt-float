# Windows 发布流程

## 本地构建

要求 Windows 11、Node.js 22、npm lockfile 完整，并确保旧版 `Prompt Float.exe` 未占用输出目录。`npm run dist` 是正式签名发布入口；当前若没有签名证书、正式 HTTPS 更新目录和发布者资料，会在构建前拒绝执行。

```powershell
npm ci
npm run test:ci
npm run check:supply-chain
# 补全下面的正式发布环境变量后，再运行：
npm run dist
npm run test:e2e:packaged
npm run verify:release
```

输出按版本隔离在 `release/v<version>/`，旧版本不会被删除或混入当前哈希清单：

- `Prompt Float-Setup-<version>-x64.exe`：NSIS 安装版；
- `Prompt Float-Portable-<version>-x64.exe`：便携版；
- 更新元数据/差分文件（由 electron-builder 生成时）；
- `SHA256SUMS.txt`：发布物哈希清单。
- `SBOM.cdx.json`：CycloneDX 软件物料清单，纳入哈希清单。

CI 还运行使用独立应用标识的 NSIS 安装升级测试，确保设置与测试凭据在覆盖安装后仍可读取。正式发布前仍要在受控环境验证真实旧版二进制、签名更新、异常断电与回滚；当前测试不能替代这些验证。

## 代码签名

正式发布必须由发布负责人提供受信任的 Windows 代码签名证书、发布者证书 Subject、组织控制的 HTTPS 更新目录及正式应用标识：

```powershell
$env:PROMPT_FLOAT_UPDATE_URL = "https://{{组织控制的更新主机}}/{{更新目录}}/"
$env:PROMPT_FLOAT_PUBLISHER_NAME = "{{签名证书的完整 Subject}}"
$env:PROMPT_FLOAT_APP_ID = "{{组织的反向域名应用 ID}}"
$env:PROMPT_FLOAT_AUTHOR = "{{合法发布者名称}}"
$env:CSC_LINK = "{{受控的证书文件路径或安全 CI secret}}"
$env:CSC_KEY_PASSWORD = "{{证书密码}}"
npm run dist
npm run test:e2e:packaged
npm run verify:release
```

占位符仅用于说明，不能原样使用。发布门禁要求全部六项资料齐全，Windows 构建强制签名；校验时同时检查安装包/便携版的 Authenticode 状态、签名证书 Subject 与哈希清单。证书和密码不得写入仓库、`.env`、日志或诊断报告。仓库不会生成自签名证书冒充正式签名。`.github/workflows/release-check.yml` 只做手动签名发布检查，不上传安装包或测试证据。

没有这些材料时，可用 `npm run dist:portable` 构建**未签名、自动更新关闭的本地验证包**；它仅输出到 `release/local-verification/v<version>/`，文件名含 `UNSIGNED-LOCAL-ONLY`，不能作为正式安装包分发。独立的 `electron-builder --win dir` 测试构建也应指定隔离输出目录，不要修改 `release/v<version>/` 的正式发布目录来伪造验证结果。

`npm run verify:release` 默认同时核对哈希、有效签名与预期发布者。只有针对 `release/local-verification/` 下带完整清单的隔离测试包，才能显式使用 `scripts/verify-release.ps1 -AllowUnsignedLocalVerification` 做仅哈希验证。

本地包的完整哈希验证步骤（不等同于正式发布验证）：

```powershell
npm run dist:portable
$version = (Get-Content package.json -Raw | ConvertFrom-Json).version
$localDir = "release/local-verification/v$version"
npm run sbom -- --output "$localDir/SBOM.cdx.json"
node -e "require('./scripts/generate-release-manifest.cjs').generateManifest(process.argv[1]).then(console.log)" "$localDir"
pwsh -NoProfile -File scripts/verify-release.ps1 -ReleaseDirectory "$localDir" -AllowUnsignedLocalVerification
```

去掉 `-AllowUnsignedLocalVerification` 后，未签名包必须被正式校验拒绝。

## 自动更新

安装版仅在**正式构建时**将 `PROMPT_FLOAT_UPDATE_URL` 和 `PROMPT_FLOAT_PUBLISHER_NAME` 固定进应用包，并且启动时核对更新配置与包内信任信息完全一致后检查更新。运行时环境变量不能切换更新源。该地址必须：

- 使用 HTTPS；
- 不包含用户名、密码、查询参数或 fragment；
- 由发布组织控制，并提供与安装包一致的 electron-builder 元数据；
- 只发布已经通过 Authenticode 和 SHA-256 校验的文件。

正式构建必须签名，更新器会校验下载的 Windows 安装包是否由固定发布者签名；未签名、配置缺失或配置不一致时，更新功能保持关闭并写入脱敏诊断事件。便携版始终关闭自动更新，避免错误覆盖用户手动放置的文件。当前策略在后台下载，退出应用时安装；正式上线前还应由产品负责人确认更新提示文案和回滚策略。

## 上游 MCP 镜像

生产环境不得直接运行浮动镜像标签。先审核一个上游版本并取得 registry 返回的内容摘要，再把运行变量设置为不可变引用：

```powershell
$env:PROMPT_OPTIMIZER_IMAGE = "linshen/prompt-optimizer@sha256:{{已核验摘要}}"
if ($env:PROMPT_OPTIMIZER_IMAGE -match '\{\{') {
  throw "请先填入已核验的镜像摘要"
}
docker run --rm $env:PROMPT_OPTIMIZER_IMAGE
```

摘要必须来自实际准备部署的 registry 响应或组织镜像仓库，不能从文档示例复制。更新摘要时重新运行 MCP 路由、工具发现和最小模型探测测试。

## 发布前仍需负责人决策

- 客户端源码已声明 MIT 许可证；公开前仍需核对图标等素材的版权归属，并保留上游 Prompt Optimizer 独立的 AGPL-3.0-only 许可说明。
- 用正式组织身份替换开发期 `local.promptfloat.mvp` appId，并填写合法的 author/publisher 元数据。
- 提供正式签名证书、HTTPS 更新主机和回滚保留策略。
- 明确安装包发布渠道及其访问控制；当前流程不会自动上传到任何外部平台。
