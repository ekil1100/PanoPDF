# PanoPDF

**全景 PDF 阅读器 · 把 PDF 铺开读。**

Electron + TypeScript + PDF.js 桌面应用。页面横向连续展开，同屏页数随窗口、页面尺寸和缩放变化；也可切换纵向布局。需求见 [首版需求](docs/requirements.md)。

## 开发与运行

使用 **Bun 1.4.0** 管理依赖、运行脚本及单元测试；开发环境仍需 **Node.js 24 LTS**，供 Electron／Playwright 等工具使用。桌面应用自身运行于 Electron 自带的 Node.js，不改为 Bun。

```bash
bun install --frozen-lockfile
bun run dev          # 同时启动本地 Vite 和 Electron；Ctrl+C 关闭两者
bun run build        # TypeScript 检查、构建页面、复制 PDF.js 离线资源
bun run start        # 使用 dist 中的构建结果运行 Electron
bun test             # Bun 单元测试，不包含 Playwright 测试
bun run test:e2e     # Electron 端到端测试；先运行 bun run build
bun run dist         # 构建后由 electron-builder 生成当前平台的发行包
```

依赖版本由 `bun.lock` 锁定，不再维护 npm 锁文件。增加或升级依赖使用 `bun add`／`bun update`，提交对应锁文件变更。`trustedDependencies` 仅允许 Electron 及其 Windows 安装工具运行依赖安装脚本；不全局放开生命周期脚本。

首次安装需下载 Electron。开发服务器仅监听 `127.0.0.1`；页面热更新可用，修改 `electron/` 后需重启 `bun run dev`。`bun run dev:web` 只预览浏览器界面，不具备桌面桥接、系统菜单或桌面最近记录功能。

## 使用

- 点击“打开”，按 `⌘O` / `Ctrl+O`，或把一个本地 PDF 拖入窗口。
- 拖入文件后，**核对系统确认框中的完整路径再允许读取**。确认默认选中取消。
- `⌘F` / `Ctrl+F` 查找；`⌘+` / `Ctrl++` 放大，`⌘-` / `Ctrl+-` 缩小，`⌘0` / `Ctrl+0` 恢复实际大小。
- 横向布局默认适应高度；可自由缩放，或选择动态计算的“容纳 1–4 页”。这些是快捷选项，不限制同屏页数。
- 切换“纵向滚动”后可设置每行页数（1–32）；改变每行页数不会锁定缩放比例。
- 横向滚动提供自动、按页、连续三种输入模式。自动识别是启发式，判断不合习惯时可以手动选择；横向触控板输入保留原生连续滚动。
- 页面放大超出高度时，滚轮优先上下查看当前页；也可用 Shift + 滚轮上下平移，Ctrl / ⌘ + 滚轮以指针位置缩放。
- 支持操作系统“打开方式”和启动参数传入 PDF，例如 `bun run start /absolute/path/book.pdf`。安装包声明 PDF 文件关联，但不会强制更改系统默认阅读器。
- 阅读位置和最近记录保存在 Electron 的 `userData/settings.json` 中；最多保留 **20 个文件**。退出最近列表的文件，其保存位置也会移除。PDF 本身不复制到该目录。
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

- **28 项单元测试**：16 项覆盖来源校验、外链限制、路径边界、PDF 验证、损坏／管道设置恢复、串行原子写入及退出刷新；12 项覆盖布局、缩放、阅读锚点、滚轮及错误处理。
- **3 项 Electron 端到端测试**：实际离线阅读、文字选择、搜索、目录、布局与恢复；连续原生打开事件的进度覆盖回归；立即退出时保存最终位置。测试 PDF 在本地生成，不使用用户文件。
- TypeScript 检查与 Vite 生产构建；PDF.js 主包有大于 500 kB 的体积提示，不是构建错误。
- 开发与生产离线资源；开发启动脚本正确处理占用端口，收到 `Ctrl+C` 后关闭 Electron 和 Vite。
- `electron-builder --dir --mac --arm64` 成功生成 **未签名** 应用目录 `release/mac-arm64/PanoPDF.app`；这不等于安装器、签名或公证已完成。
- 800、1440、1920 像素宽桌面客户区及密码状态的界面检视；独立视觉审查结论为 `ship`。

尚未验证 Windows/Linux 原生运行、发行包安装、代码签名、公证、所有操作系统文件关联和真实拖放手势。原生选择器及确认框仍需人工验收。没有对大型扫描件、复杂矢量图做性能基准，不宣称性能达标。纯安全单元测试不依赖 Electron 运行时。

`.github/workflows/ci.yml` 配置三平台单元测试与构建，以及 macOS Electron 端到端测试；尚未推送执行，配置本身不代表 CI 已通过。详细验收记录见 [验证记录](docs/verification.md)。

自动化测试如需隔离数据目录，必须同时设置 `PANO_TEST_MODE=1` 与绝对路径 `PANO_USER_DATA`。该覆盖仅对未打包应用有效；普通运行及发行包忽略 `PANO_USER_DATA`。不要使用日常阅读数据目录进行测试。
