# PanoPDF

**全景 PDF 阅读器 · 把 PDF 铺开读。**

Electron + Solid + TypeScript + PDF.js 桌面应用，使用 Vite+ 构建、Effect 管理应用控制流程。页面横向连续展开，同屏页数随窗口、页面尺寸和缩放变化；也可切换纵向布局。需求见 [首版需求](docs/requirements.md)。

## 开发与运行

使用 **Bun 1.4.0** 管理依赖和运行脚本，**Vite+ 1.0.0** 提供 Vite、Vitest、Oxlint 和 Oxfmt，**Playwright** 负责 Electron 端到端测试。开发环境使用 **Node.js 24.11.0 或更高的 24 LTS 版本**；桌面应用运行于 Electron 自带的 Node.js。界面使用 **Solid 1.9.15**，应用控制层使用 **Effect 4.0.0**，PDF.js 为 **6.4.299**，Electron 为 **44.5.1**，TypeScript 为 **7.0.2**。Node 类型定义已升级到 **26.6.4**；开发运行时仍使用 Node 24 LTS，新增 Node API 需确认其运行时支持。

```bash
bun install --frozen-lockfile
bun run dev          # Start Vite+ and Electron; Ctrl+C stops both
bun run check        # Run lint and type checks through Vite+
bun run build        # Type-check source and tests, bundle UI, copy offline assets
bun run start        # Start Electron with the production build
bun run test         # Run Vitest unit tests through Vite+, excluding Playwright
bunx playwright install chromium  # Install the optional browser-preview test runtime
bun run test:e2e     # Run Electron and browser-preview E2E after bun run build
bun run dist         # Build and package for the current platform
```

依赖版本由 `bun.lock` 锁定，不再维护 npm 锁文件。增加或升级依赖使用 `bun add`／`bun update`，提交对应锁文件变更。`trustedDependencies` 仅允许 Electron 及其 Windows 安装工具运行依赖安装脚本；不全局放开生命周期脚本。

首次安装需下载 Electron。开发服务器仅监听 `127.0.0.1`；默认端口被占用时会选择实际可用端口并传给 Electron。Solid 界面支持热更新，修改 `electron/` 后需重启 `bun run dev`。`bun run dev:web` 只预览浏览器界面，不具备桌面桥接、系统菜单或桌面最近记录功能。

`vp dev` 启动内置网页服务器，`vp run dev` 执行桌面启动脚本。完整构建使用 `bun run build` 或 `vp run build`，包含前置类型检查；安装包使用 electron-builder，`vp pack` 用于库构建。全局 `vp` 为可选工具，项目脚本使用已安装的本地版本。

检查、测试与构建配置集中在 `vite.config.ts`。`bun run check` 统一执行全库格式检查、类型感知 lint 与类型检查。使用 `bunx vp fmt` 格式化全库，或用 `bunx vp fmt <paths>` 格式化指定文件。安全过滤表达式与 Playwright 必需的空对象参数有定向规则说明。

## 源码结构

- `src/main.tsx`：挂载入口、样式与热更新清理。
- `src/app.tsx`、`src/components/`：Solid 界面、输入草稿、焦点、搜索和稳定阅读宿主。
- `src/app-controller.ts`：Effect 应用程序与 Solid 互操作入口，管理文件身份、启动、打开/关闭、位置保存、密码请求和实例 Scope。
- `src/app-effects.ts`：类型化错误、Promise 适配、严格 FIFO 的有序 Fiber 和外部等待中断。
- `src/reader.ts`、`src/reader-layout.ts`：原有 PDF.js 阅读器与布局/滚轮算法。
- `electron/`、`src/contracts.ts`：桌面安全能力、持久化与现有接口。

详见 [架构与生命周期](docs/architecture.md)。

## 发布版本

`.github/workflows/release.yml` 在推送 `v*` 标签时运行。标签必须与 `package.json` 的版本完全一致，例如版本 `0.1.0` 对应 `v0.1.0`，否则停止发布。

工作流先运行 Vite+ 检查、Vitest、类型检查及构建，macOS 还安装测试浏览器并运行 Playwright Electron／浏览器预览测试，再汇总安装包到 GitHub Release：

| 平台    | 架构                                 | 安装包   |
| ------- | ------------------------------------ | -------- |
| macOS   | Apple Silicon（arm64）、Intel（x64） | DMG、ZIP |
| Windows | x64                                  | NSIS EXE |
| Linux   | x64                                  | AppImage |

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

本次迁移已在 **macOS / Apple Silicon** 验证：

- 迁移前基线：**46 项单元测试、8 项 Electron E2E**、类型检查和构建通过。
- Round1 修复后：**112 项单元测试、26 项 Playwright E2E 全部通过**，检查和构建通过。覆盖 FIFO 微任务竞争、退出最终保存顺序、注入 Clock/Logger、终结器失败后的清理及 LF/CRLF 开发编排。
- ReaderHost HMR 修复新增 2 项回归，关闭期间宿主尺寸修复再新增 1 项，当前 **29 个不同 E2E 已分次验证通过**：完整套件执行结果为 **28 通过、1 跳过**（缺少默认 Chromium），随后使用已有 Chrome 和临时 profile 单独补跑浏览器预览，**1/1 通过**。覆盖应用、入口、阅读宿主和标题栏 HMR、关闭期间宿主尺寸、真实 worker 释放、四种阶段卸载、重复挂载、稳定 DOM、输入草稿与 IME、密码取消和扫描件。沿用已有 **112 项单元测试**通过结果；本轮未重新执行跨平台验收、打包或性能基准。
- TypeScript 同时检查应用、测试和测量脚本；Vite+ lint/type 检查与生产构建通过，保留 PDF.js 大于 500 kB 的体积提示。
- 开发/生产的 worker、CMap、字体、WASM、图片均来自本地，外部请求被阻止。端口占用、实际 URL 注入、SIGINT/SIGTERM、Electron 子进程退出和缺失安装清理已检查。
- Effect 接入前已生成 macOS arm64 **未签名** DMG、ZIP 与应用目录，当时包内 285 个前端/离线资源文件与构建一致。Effect 版本已验证源码构建和 E2E，尚未重新打包。
- Effect 接入前，800/1440 欢迎页及横向、纵向阅读截图与原始迁移前逐像素相同；本轮继续保留样式和阅读算法，未重复像素比较。
- Effect 接入前已记录三类合成 PDF 基准，涵盖打开、搜索、滚动/缩放长任务与五轮开关。Effect 版本尚未重跑性能基准；现有结果只描述先前 Solid 版本。

浏览器预览项需要 Playwright Chromium，或通过 `PANO_PREVIEW_CHROMIUM` 指定已有兼容浏览器；本机使用 Chrome 154 的独立临时 profile。缺失浏览器时该项明确跳过，Electron 项继续运行；CI 安装对应浏览器。

尚待验证 Windows/Linux 原生运行、发行包安装后启动、签名、公证、系统文件关联、真实拖放及原生对话框手势。打包版按设计忽略测试数据目录覆盖，本轮采用包内资源检查，保留个人阅读数据。详细记录包含性能波动和验证边界。

`.github/workflows/ci.yml` 配置三平台 Vitest 与构建，以及 macOS Playwright Electron 测试。远端结果以对应提交的 GitHub Actions 为准，不能将本机通过等同于所有平台通过。详细验收记录见 [验证记录](docs/verification.md)。

自动化测试如需隔离数据目录，必须同时设置 `PANO_TEST_MODE=1` 与绝对路径 `PANO_USER_DATA`。该覆盖仅对未打包应用有效；普通运行及发行包忽略 `PANO_USER_DATA`。不要使用日常阅读数据目录进行测试。
