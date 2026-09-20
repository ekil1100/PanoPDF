# 首版验证记录

## 已实现范围

Electron + PDF.js 桌面阅读器：本地打开、横向连续与纵向多列布局、缩放、按页／连续滚动、页面纵向居中、页码跳转、文字选择与复制基础、全文搜索、目录、密码输入、最近文件及阅读位置恢复。不包含批注编辑、PDF 编辑、多标签页。

## 可重复运行的检查

```bash
bun install --frozen-lockfile
bun test
bun run build
bun run test:e2e
```

- 单元测试使用 Bun 运行，Playwright 端到端测试独立运行：28 项，覆盖安全与持久化 16 项、阅读几何与输入策略 12 项，全部通过。
- TypeScript 与 Vite 生产构建通过。主应用包含 PDF.js，Vite 有大包体积提示；没有忽略或隐藏该提示。
- Electron 端到端测试：3 项，全部通过。使用实际 Electron 与生产资源，无远程 PDF、无模拟渲染器；测试生成的 PDF 明确为合成数据。
- 离线资源检查包含 CMap、字体、WASM 以及已有便笺的图标。PDF.js worker 单独打包，不回退到主线程 fake worker。

## Bun 迁移验证

项目改用 Bun 1.4.0，已从原锁文件迁移到 `bun.lock` 并移除 `package-lock.json`，没有主动升级依赖。Bun 负责安装、脚本入口和单元测试；Electron 自带运行时不变，开发工具仍使用 Node.js 24。

- 空目录中使用 `bun install --frozen-lockfile` 成功安装，Electron 可执行文件有效。
- `bun test` 正确排除 Playwright 测试，28 项单元测试通过。
- `bun run dist --dir --mac --arm64` 完成类型检查、Vite 构建和未签名 macOS 目录打包。
- `bun run test:e2e` 的 3 项 Electron 测试全部通过。
- `bun run dev` 的本地 HTTP 就绪及 Ctrl+C 退出检查通过。
- CI 已改用固定 Bun 版本与冻结锁文件安装；尚未远端执行。

## 端到端覆盖

1. 启动参数打开本地 PDF，实际文字层可选择；搜索及下一匹配、无结果、目录跳转；横向居中、纵向每行页数；关闭重开后保留页码与缩放；沙箱内无 Node require；离线资源可读取。
2. renderer 忙碌时连续接收原生 B→A 打开事件，仍保留 A 刚读到的第 7 页，不被事件中的旧磁盘快照覆盖。
3. 页码改变后立即退出，最终位置在退出前写入磁盘。

专项阅读器检查还覆盖真实加密 PDF 的错误密码／取消、混合尺寸页面、缩放锚点、快速换文档、滚轮／触控板策略、detail canvas、失败 worker 的清理；该轮临时检查脚本保留在本机忽略目录 `.agents/`，不替代仓库中正式测试的可重复性。

## 检视与修复

- 独立 Electron 安全审查发现设置文件为命名管道时可能阻塞启动，已以非阻塞读取和普通文件检查修复，并保留回归测试。
- 独立审查复现连续原生打开事件造成旧位置覆盖新位置。先让端到端测试在“第 7 页退回第 1 页”上失败，再修复为优先使用当前会话的新位置快照；回归通过。
- 补齐 PDF.js `web/images` 离线资源，端到端检查验证 SVG 内容类型及读取成功。
- 五张有效界面截图覆盖空态、搜索阅读、密码错误和 800／1440／1920 像素宽客户区。独立视觉审查为 **ship**：符合用户批准的紧凑工具栏、可收起侧栏、浅灰背景及系统字体。截图不代表跨平台原生窗口验证。
- 机械界面检测仅报告未解析外部 CSS 的字号误报；实际字号与截图一致。设计系统已记录于 `DESIGN.md` 与 `.impeccable/design.json`。
- 初版使用 `npm audit --omit=dev` 时未报告生产依赖漏洞；该结果是当时的检查记录，不是持续扫描或安全无漏洞保证。

## 构建产物与边界

本机为 macOS / Apple Silicon。已用以下命令生成未签名应用目录：

```bash
CSC_IDENTITY_AUTO_DISCOVERY=false bun run dist --dir --mac --arm64
```

产物：`release/mac-arm64/PanoPDF.app`。应用仍使用 Electron 默认图标；尚未制作品牌图标、DMG／安装器，未签名或公证。

尚未验证：Windows/Linux 原生运行、三平台安装器、系统文件关联、真实拖放与原生文件选择交互，以及大型复杂 PDF 的性能基准。配置了跨平台 CI，但尚未推送执行。强制结束进程不能保证保存最后一次进度。
