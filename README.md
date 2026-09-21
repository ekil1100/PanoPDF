# PanoPDF

**全景 PDF 阅读器 · 把 PDF 铺开读。**

Electron + TypeScript + PDF.js 桌面应用。页面横向连续展开，同屏页数随窗口、页面尺寸和缩放变化；也可切换纵向布局。需求见 [首版需求](docs/requirements.md)。

## 开发与运行

使用 **Bun 1.4.0** 管理依赖和运行脚本，**Vitest** 负责单元测试，**Playwright** 负责 Electron 端到端测试；开发环境仍需 **Node.js 24 LTS**，供 Electron／Playwright 等工具使用。桌面应用自身运行于 Electron 自带的 Node.js，不改为 Bun。

```bash
bun install --frozen-lockfile
bun run dev          # Start Vite and Electron; Ctrl+C stops both
bun run build        # Type-check, bundle UI, and copy offline PDF.js assets
bun run start        # Start Electron with the production build
bun run test         # Run Vitest unit tests, excluding Playwright
bun run test:e2e     # Run Electron E2E tests after bun run build
bun run dist         # Build and package for the current platform
```

依赖版本由 `bun.lock` 锁定，不再维护 npm 锁文件。增加或升级依赖使用 `bun add`／`bun update`，提交对应锁文件变更。`trustedDependencies` 仅允许 Electron 及其 Windows 安装工具运行依赖安装脚本；不全局放开生命周期脚本。

首次安装需下载 Electron。开发服务器仅监听 `127.0.0.1`；页面热更新可用，修改 `electron/` 后需重启 `bun run dev`。`bun run dev:web` 只预览浏览器界面，不具备桌面桥接、系统菜单或桌面最近记录功能。

## 发布版本

`.github/workflows/release.yml` 在推送 `v*` 标签时运行。标签必须与 `package.json` 的版本完全一致，例如版本 `0.1.0` 对应 `v0.1.0`，否则停止发布。

工作流先运行 Vitest、类型检查及构建，macOS 还运行 Playwright Electron 测试，再汇总安装包到 GitHub Release：

| 平台 | 架构 | 安装包 |
| --- | --- | --- |
| macOS | Apple Silicon（arm64）、Intel（x64） | DMG、ZIP |
| Windows | x64 | NSIS EXE |
| Linux | x64 | AppImage |

产物名称包含版本、平台和架构，避免互相覆盖。全部构建与测试成功后才创建 Release，并自动生成发布说明；带 `-` 的版本标签（例如 `v0.2.0-beta.1`）标为预发布。使用 GitHub 自带的 `GITHUB_TOKEN`，只有发布任务有仓库写权限，不需要额外配置令牌。

先修改并提交 `package.json` 版本及必要的 `bun.lock` 变更，将代码推送后，再发布对应标签：

```bash
git tag v0.1.0
git push origin v0.1.0
```

**当前安装包不包含代码签名或 macOS 公证**，系统可能显示安全警告或拦截；自动打包不代表已通过安装与实机验收。此工作流配置尚需首次标签发布验证，本次没有创建或推送版本标签。

## 使用

- 首次启动显示欢迎界面和打开引导；之后默认打开上次的 PDF 并恢复阅读位置。通过系统或命令行明确指定的文件优先。
- 如果上次文件已移动或删除，会提示重新选择，不会偷偷打开其他旧文件。
- 自定义标题栏显示“文件”菜单、当前文件名及最小化／最大化或还原／关闭窗口按钮；不再有重复的打开文件行。
- 通过“文件 → 打开 PDF”、`⌘O` / `Ctrl+O`，或把一个本地 PDF 拖入窗口打开文档。欢迎页也提供打开按钮。
- “文件 → 关闭文档”或 `⌘W` / `Ctrl+W` 返回空白界面，不关闭窗口，也不立即重开文档。
- 拖入文件后，**核对系统确认框中的完整路径再允许读取**。确认默认选中取消。
- `⌘F` / `Ctrl+F` 查找；`⌘+` / `Ctrl++` 放大，`⌘-` / `Ctrl+-` 缩小，`⌘0` / `Ctrl+0` 恢复实际大小。
- 横向布局默认适应高度；可自由缩放，或选择动态计算的“容纳 1–4 页”。这些是快捷选项，不限制同屏页数。
- 切换“纵向滚动”后可设置每行页数（1–32）；改变每行页数不会锁定缩放比例。
- 横向滚动提供自动、按页、连续三种输入模式。自动识别是启发式，判断不合习惯时可以手动选择；横向触控板输入保留原生连续滚动。
- 页面放大超出高度时，滚轮优先上下查看当前页；也可用 Shift + 滚轮上下平移，Ctrl / ⌘ + 滚轮以指针位置缩放。
- 支持操作系统“打开方式”和启动参数传入 PDF，例如 `bun run start /absolute/path/book.pdf`。安装包声明 PDF 文件关联，但不会强制更改系统默认阅读器。
- 首次启动标记、阅读位置和最近记录保存在 Electron 的 `userData/settings.json` 中；最多保留 **20 个文件**。退出最近列表的文件，其保存位置也会移除。PDF 本身不复制到该目录。
- 单个 PDF 上限 **256 MiB**。文件移动或删除后需重新选择；损坏、无权限、不是 PDF 等情况会提示错误。损坏的设置会忽略，下一次成功保存时重建。

标准数据目录通常是 macOS 的 `~/Library/Application Support/PanoPDF`、Windows 的 `%APPDATA%/PanoPDF`、Linux 的 `$XDG_CONFIG_HOME/PanoPDF`（未设置时为 `~/.config/PanoPDF`），具体以 Electron 当前系统配置为准。

首版不包含批注、PDF 编辑、多标签页或 OCR；加密文档需要密码。复杂文档、大型扫描件不保证即时高清。

## 桌面与安全边界

- `electron/main.cjs` 是主入口；`electron/preload.cjs` 可在沙箱中运行，仅暴露 `src/contracts.ts` 定义的 `DesktopBridge`。
- 启用 `contextIsolation`、`sandbox`，禁用 Node 集成、网页内嵌窗口、任意导航和下载。每个 IPC 请求都检查主窗口、主框架、可信页面及参数边界。
- 原生选择器或操作系统打开的文件获得授权；最近文件只能通过不透明 ID 重开，不能传入任意路径。拖入文件使用 `webUtils.getPathForFile` 获取原生路径；这不能证明用户手势，因此主进程还必须征得明确同意，然后才访问文件。
- 仅读取普通 `.pdf` 文件，检查文件大小及 PDF 文件头。文件头检查不是杀毒或完整格式验证；解析错误仍由 PDF.js 处理。
- 页面和 PDF.js 资源只来自本地。生产使用安全的 `pano://app/index.html` 协议，只映射 `dist` 目录；不是任意本地文件服务器。
- CSP 禁止远程内容、普通 JS 字符串求值和嵌入对象，仅允许 PDF.js 所需的 WASM、模块 worker、字体和页面样式。阅读器不运行 PDF 内嵌脚本或动作；系统浏览器仅接受校验过的 HTTP/HTTPS 外链，打开外链后由浏览器自行联网。
- 设置更新按序执行，先写同目录临时文件并同步，再原子替换；写入失败会报告错误，不会继续沿用失效的写入队列。

`vite.config.ts` 在开发时直接提供本地 `node_modules/pdfjs-dist/{cmaps,standard_fonts,wasm}` 及 `web/images`，构建时复制到 `dist/pdfjs/{cmaps,standard_fonts,wasm,images}/`，与安装的 PDF.js 版本一致。模块 worker 由 Vite 打包。无需 CDN，也不生成需要提交到 Git 的大型 `public/` 文件。

## 验证与支持范围

发布目标是 **macOS、Windows、Linux**；这不表示三个平台的安装包都已验证。

本次已在 **macOS / Apple Silicon** 验证：

- **46 项 Vitest 单元测试**：原有 28 项安全／阅读测试，以及 18 项启动恢复、首次启动持久化、窗口动作与 IPC 测试。
- **8 项 Playwright Electron 端到端测试**：离线阅读、搜索／目录／布局、位置恢复、原生打开竞态、退出保存、首次欢迎、自动续读、明确打开优先、缺失文件恢复、自定义窗口控制及 resize 后页码回退回归。测试 PDF 在本地生成，不使用用户文件。
- TypeScript 检查与 Vite 生产构建；PDF.js 主包有大于 500 kB 的体积提示，不是构建错误。
- 开发与生产离线资源；开发启动脚本正确处理占用端口，收到 `Ctrl+C` 后关闭 Electron 和 Vite。
- Release Action 配置已通过 actionlint；本机 `bun run dist --mac --arm64 --publish never` 成功生成 **未签名** macOS arm64 DMG、ZIP 及应用目录。版本标签检查的通过／拒绝分支已验证；这不等于安装、签名、公证或远端工作流已验证。
- 本轮检查了 800、1440 像素宽欢迎界面及自定义标题栏阅读页；此前首版另有 800／1440／1920 宽客户区与密码状态的独立视觉审查，结论为 `ship`。

尚未验证 Windows/Linux 原生运行、发行包安装、代码签名、公证、所有操作系统文件关联和真实拖放手势。原生选择器及确认框仍需人工验收。没有对大型扫描件、复杂矢量图做性能基准，不宣称性能达标。纯安全单元测试不依赖 Electron 运行时。

`.github/workflows/ci.yml` 配置三平台 Vitest 与构建，以及 macOS Playwright Electron 测试。远端结果以对应提交的 GitHub Actions 为准，不能将本机通过等同于所有平台通过。详细验收记录见 [验证记录](docs/verification.md)。

自动化测试如需隔离数据目录，必须同时设置 `PANO_TEST_MODE=1` 与绝对路径 `PANO_USER_DATA`。该覆盖仅对未打包应用有效；普通运行及发行包忽略 `PANO_USER_DATA`。不要使用日常阅读数据目录进行测试。
