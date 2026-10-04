# 验证记录

## 关闭期间宿主尺寸修复

普通关闭会先发布 `closing`，等待最终保存后才调用 `reader.close()`。原来的 `hidden=true` 让仍存活的 reader 宿主变为零尺寸；原生 ResizeObserver 随后调度动画帧，PDF.js 刷新触发 `offsetParent is not set -- cannot scroll` 并将实时比例降至 0.1。受控诊断和旧入口/PDF.js 6.3 对照见 `.agents/verification/review-fix/queued-refresh-diagnosis.md`。这是继承的宿主显隐缺陷；原始历史事件缺少帧状态，无法逐帧还原该次事件。

`src/components/reader-host.tsx` 现将 `opening` 和 `closing` 设为 `visibility:hidden`，仅 `empty/error` 使用 `hidden`。保留 `@refresh skip`、保存顺序、控制队列和 reader 算法。

永久回归复用 `tests/e2e/lifecycle.spec.ts` 与 `lifecycle-fixture.ts`：真实 Solid/ReaderHost/PDF.js、合成 PDF、阻塞保存、原生观察器与三个动画帧。断言关闭期间宿主宽高为正、页面保留 offsetParent、阅读控件禁用、worker 仍存活且没有控制台错误；释放保存后 worker 归零，保存的第 7 页及完整位置/比例与关闭前快照精确一致。桥接保存由夹具记录，磁盘恢复仍由现有 HMR 和生产 E2E 覆盖。软断言用于收集多项失败证据，任何一项失败都会使测试失败。

### 实际验证

以下日志和独立产物目录均位于 `.agents/verification/review-fix/`，原 `final-e2e.log` 的 **27 通过、1 失败（app/entry HMR）** 及其 trace 保持原样。

| 检查                                    | 结果                                              | 日志                                |
| --------------------------------------- | ------------------------------------------------- | ----------------------------------- |
| 永久关闭回归，修复前                    | 1 失败：0×0 宿主、offsetParent 错误、实时比例 0.1 | `closing-host-regression-red.log`   |
| 永久关闭回归 + 原 app/entry HMR，修复后 | 2/2 通过                                          | `closing-host-regression-green.log` |
| TypeScript + 生产构建                   | 通过，保留大包提示                                | `closing-host-build-green.log`      |
| 构建后完整 E2E，执行一次                | 28 通过、1 跳过；默认 Chromium 路径缺少浏览器     | `closing-host-full-e2e.log`         |
| 单独补跑浏览器预览                      | 1/1 通过，使用已有 Chrome 和临时 profile          | `closing-host-browser-e2e.log`      |
| `bun run check`                         | 0 错误，保留原有 4 条集合展开建议                 | `closing-host-check.log`            |
| 修改文件格式检查与 diff 空白检查        | 通过                                              | `closing-host-format.log`           |

完整套件包含原有 28 项及新增 1 项；通过完整执行与浏览器定向补跑，**29 个不同 E2E 均已通过**。命令分别为：

```sh
bunx playwright test tests/e2e/lifecycle.spec.ts --grep 'ordinary close' --output=.agents/verification/review-fix/closing-host-regression-red
bunx playwright test tests/e2e/lifecycle.spec.ts tests/e2e/app-hmr.spec.ts --grep 'ordinary close|app HMR followed by entry HMR' --output=.agents/verification/review-fix/closing-host-regression-green
bun run build
bunx playwright test --output=.agents/verification/review-fix/closing-host-full-e2e
PANO_PREVIEW_CHROMIUM='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' bunx playwright test tests/e2e/reader.spec.ts --grep 'browser preview' --output=.agents/verification/review-fix/closing-host-browser-e2e
bun run check
bunx vp fmt --check src/components/reader-host.tsx tests/e2e/lifecycle.spec.ts tests/e2e/lifecycle-fixture.ts docs/architecture.md docs/verification.md
git diff --check
```

测试开发过程同样保留：`closing-host-red.log` 首次复现；`closing-host-green.log` 中 HMR 通过，新回归因要求尺寸和实时比例完全不变而失败。工具栏收起后高度从 703 变为 751、适应比例从 0.59 变为 0.64 属于有效布局变化，因此最终断言检查正尺寸和精确保存快照，并重新执行修复前失败/修复后通过验证。`closing-host-build.log` 记录测试 DOM 类型缺少具体元素类型的首次检查失败，补充 `HTMLDivElement` 后构建通过。

已有 112 项单元测试结果沿用，单元测试及其代码未变更。此次未提交、修改主工作区、全局配置或个人数据。历史日志与诊断证据保持原样。

## Round2 P2：阅读宿主热更新边界

`ReaderHost` 使用文件级 `/* @refresh skip */`，由 app/main 的挂载所有者统一完成旧 reader 释放和最终保存，再替换宿主 DOM。生产 reader 与阅读算法保持原样。

- 独立复现记录位于 `.agents/verification/review-fix/independent-r2/host-hmr.ts`、`result.json` 和 `result-skip.json`：修复前当前 viewer 从 12 页变为 0 页，已断开的旧 viewer 保留 12 页，worker 仍为 1，导航报告 `offsetParent` 错误；注入跳过标记后新宿主可正常阅读。
- `tests/e2e/app-hmr.spec.ts` 复用原探针和转换插件，参数化覆盖 app/app、app/entry、host/host、host/entry。验证最终保存阻塞时旧 worker、观察器、订阅及页面 DOM 全部释放，保存完成后新宿主恢复 12 页、已保存页码，并可导航和关闭。标题栏 HMR 测试保持原样。
- 新增 host/host 回归在永久标记加入前失败：旧 reader 未销毁，同时捕获本次路径的 `offsetParent` 错误。加入标记后定向 HMR 测试 5/5 通过，无跳过、警告或控制台错误。产物位于 `.agents/verification/review-fix/host-hmr-{red,green}/`。
- 该复现证明宿主热更新路径存在问题。普通关闭另有已确认的宿主尺寸缺陷，见上方关闭回归记录；历史单次日志缺少帧状态，无法将该次事件逐帧归因于其中一条路径。

| 命令                                                                                                                               | 结果                            |
| ---------------------------------------------------------------------------------------------------------------------------------- | ------------------------------- |
| `bun run test:e2e tests/e2e/app-hmr.spec.ts tests/e2e/development.spec.ts --output=.agents/verification/review-fix/host-hmr-green` | 5/5 通过                        |
| `bun run check`                                                                                                                    | 通过；保留原有 4 条集合展开建议 |
| `node_modules/.bin/tsc --noEmit`                                                                                                   | 通过                            |
| `bunx vp fmt --check src/components/reader-host.tsx tests/e2e/app-hmr.spec.ts docs/architecture.md docs/verification.md README.md` | 通过                            |

父任务在 Round1 修复后已完成 112 项单元测试、26 项 E2E、检查和构建。本次新增 2 项 E2E，当前共 28 项；仅运行上述定向验证，未重跑完整套件或生产构建。改动仅涉及宿主标记、HMR 回归和相关文档；未提交或修改全局配置、主工作区。

## 应用热更新与换行回归修复

本轮仅修改 `src/app.tsx`、`src/main.tsx`、`tests/dev.test.ts`，新增 `tests/e2e/app-hmr.spec.ts`，并定向修正文档。生产开发脚本、依赖、原有标题栏热更新测试和生命周期测试保持原样。

- 修复前，应用组件清理会卸载整个根节点；阻塞保存期间，热替换还会创建失去根节点的新实例。组件资源释放与根节点卸载现由不同入口负责。应用模块更新交给挂载入口串行处理，等待旧实例全部工作完成；子组件继续使用 Solid 热更新。
- 新增两项真实 Electron/PDF.js 回归：应用更新后，在最终保存阻塞期间再次更新应用或入口。验证旧 worker、观察器和订阅释放，保存完成前保持原入口的所有权，之后挂载可用外壳、从最近文件恢复第 5 页，并使用新 worker 导航与关闭。测试只改变开发服务器转换结果，源码保持原样。
- 编排测试将实际 `scripts/dev.mjs` 分别转换为 LF/CRLF 后运行同一 VM 测试组。修复前 LF 的 5 项通过、CRLF 的 5 项均以导入语法错误失败；导入删除表达式增加可选回车后，10 项全部通过。

定向验证结果：

| 命令                                                                                                                                                          | 结果                             |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------- |
| `bun run test tests/dev.test.ts`                                                                                                                              | 10/10 通过                       |
| `node_modules/.bin/tsc --noEmit`                                                                                                                              | 通过                             |
| `bun run check`                                                                                                                                               | 通过；保留原有 4 条集合展开建议  |
| `bun run test:e2e tests/e2e/development.spec.ts tests/e2e/app-hmr.spec.ts tests/e2e/lifecycle.spec.ts --output=.agents/verification/review-fix/e2e-artifacts` | 9/9 通过，无跳过                 |
| `bun run test:e2e tests/e2e/app-hmr.spec.ts --repeat-each=5 --output=.agents/verification/review-fix/hmr-console-artifacts`                                   | 补充控制台错误断言后，10/10 通过 |

一次额外复跑出现 PDF.js 的 `offsetParent is not set -- cannot scroll` 控制台日志，功能断言通过。随后补充错误堆栈采集和断言，重复五轮均通过；后续受控诊断已稳定复现同一错误与 reader/PDF.js 调用链：普通关闭等待保存时隐藏宿主，原生观察器触发零尺寸刷新。旧入口及 PDF.js 6.3 对照同样失败，确认是继承的宿主生命周期缺陷。历史单次事件缺少完整帧状态，逐帧归因仍无法判断。保留 `hmr-green.log` 和 `hmr-console.log`，修复限定于 ReaderHost 显隐策略。

失败与通过日志位于 `.agents/verification/review-fix/`。Electron 测试使用合成 PDF、独立用户数据目录；应用热更新测试还使用独立 Vite 缓存。现有生命周期回归继续验证立即销毁、幂等 Promise、最终保存等待和迟到回调隔离。本轮按范围执行定向检查，完整单元测试、完整 E2E、生产构建和跨平台验收沿用下文历史记录，未重跑。

## 最新直接依赖升级

按 npm `latest` 标签升级四项直接依赖，其余八项实际安装版本已是最新：

| 依赖          | 升级前  | 升级后  |
| ------------- | ------- | ------- |
| `pdfjs-dist`  | 6.3.289 | 6.4.299 |
| `electron`    | 44.4.2  | 44.5.1  |
| `typescript`  | 5.9.3   | 7.0.2   |
| `@types/node` | 24.13.5 | 26.6.4  |

`package.json` 与 `bun.lock` 已更新；Electron 继续属于开发依赖。Vite 使用 `@voidzero-dev/vite-plus-core@1.0.0` 别名，按实际包核对。此次范围为项目直接依赖，传递依赖由相应版本约束解析，Bun 和全局 Node 工具保持原样。Node 类型定义为 26 系列，实际开发运行时仍为 Node 24 LTS；类型通过并不代表新增的 Node 26 API 可用于该运行时。

升级后 **107/107 单元测试、24/24 E2E（无跳过）**、Vite+ 检查、TypeScript 7 类型检查与生产构建通过。保留原有 4 条集合展开建议和大包提示。Electron 44.5.1 的本机二进制已下载并用于 E2E，测试使用隔离数据目录和临时浏览器 profile。主 JS 为 **710.58 kB / gzip 219.27 kB**；PDF.js worker 和 CSS 随库升级更新。

日志位于 `.agents/verification/dependency-upgrade/`。本轮未重新打包、执行跨平台验收或重跑性能与像素比较。下文为此前各阶段的历史验证，版本和产物数值按当时记录保留。

## Effect 接入验证

在已有 Solid/Vite+ 工作树上引入 **Effect 4.0.0**。本轮改动集中在应用控制层及其测试、依赖和文档。Solid 界面、PDF.js reader、布局算法、Electron 安全边界和样式保持原样。

接入前重新验证：**99 项单元测试、24 项 E2E、类型检查和生产构建通过**。快照和日志位于 `.agents/verification/effect/baseline/`，避免将已有的 Solid 迁移差异算作本轮新增。

### 实现与回归

- `makeAppController` 通过 `Context.Service` 获取依赖，实例保留 Context；测试使用独立 TestClock 和 Logger 验证回调中的注入仍然有效。
- 文件、reader、保存、平台和输入错误使用带标签的数据。同步抛错与异步拒绝进入类型化错误通道，原始 cause 和保存文件 ID 得以保留。
- Scope / `acquireRelease` 管理 reader 与订阅；密码使用 Deferred，防抖使用可中断 Fiber。替换旧 Promise 队列、手工取消竞争及资源集合。
- 外部读取可以退出等待，迟到结果保持静默；已拥有的 reader 工作和保存持续被跟踪。`dispose()` 在同一任务内销毁 reader，随后等待全部 owned work；窗口关闭独立等待最终保存。
- 独立核查发现初版 Semaphore 的互斥不能保证严格 FIFO：在释放许可与唤醒等待者之间提交任务，会发生 A→C→B，以及最终位置 3 被较早位置 2 覆盖。两个确定性测试先复现失败，再改为显式 Fiber 前驱依赖后通过。没有将互斥等同于有序提交。
- 额外定向脚本覆盖 reader/保存适配器返回 Promise 前重入释放、获取订阅期间释放、销毁重入、外部请求迟到拒绝等 **13 项检查，0 个未处理 rejection**。FIFO 和退出保存复现脚本也已通过；关键回归已纳入正式测试。

### 最终检查

| 检查                         | 本机结果                                                         |
| ---------------------------- | ---------------------------------------------------------------- |
| 冻结锁文件安装               | 通过，Effect 精确锁定 4.0.0                                      |
| Vite+ lint / TypeScript      | 通过，0 错误；保留原有 4 条 reader/preload 集合展开建议          |
| 单元测试                     | **107/107**：原有 46、控制层 53、类型化错误 3、开发编排 5        |
| 生产构建                     | 通过；PDF.js 大包提示保留                                        |
| Playwright                   | **24/24，无跳过**：23 Electron、1 临时 Chrome profile 浏览器预览 |
| 修改文件格式与 diff 空白检查 | 通过                                                             |

新应用 JS 为 **710.63 kB / gzip 218.94 kB**；本轮接入前为 **665.76 / 203.59 kB**，增加 **44.87 / 15.35 kB**。worker 与 CSS 产物名称和大小保持一致。日志位于 `.agents/verification/effect/{install,check,unit,build,e2e,format}.log`，队列失败与修复证据为 `fifo-red.log`、`fifo-green.log`。

本轮使用 macOS arm64 与隔离测试数据。未重新运行性能基准、截图像素比较或 electron-builder 打包；现存 `release/` 安装包以及下文性能、截图、打包结果均属于 **Effect 接入前的 Solid 版本**。Windows/Linux、安装后验收、签名与公证仍待验证。未提交、推送或修改主工作区。

## Vite+/Solid 迁移记录（Effect 接入前）

2026-10-03 至 2026-10-04，在 `feat/solid-viteplus` 工作树完成 Vite+、Solid 和应用控制层同步迁移。代码基线为 `a468279`。本机 macOS / Apple Silicon 的检查、单元测试、构建、Electron/浏览器 E2E 和未签名 macOS arm64 打包通过。安装后的实机验收与其他平台运行仍待执行。

原有 PDF.js 阅读器、布局算法、Electron/preload 安全实现、启动与设置实现以及样式文件保持原样；替代的 `src/main.ts`、静态界面和单独 Vitest 配置已移除。职责和清理顺序见 [架构与生命周期](architecture.md)。

## 环境与基线

- Apple M2，Darwin 27.0.0，arm64；Node 24.21.0、Bun 1.4.0。
- Vite+ 1.0.0、Solid 1.9.15、vite-plugin-solid 2.11.14。
- Electron 44.4.2、PDF.js 6.3.289 保持原版本。
- 原始 manifest、锁文件、构建、截图和日志保存在本地 `.agents/verification/baseline/`。
- 原始冻结安装首次遇到代理连接/完整性错误，取消该次命令的代理环境并降低下载并发后完成；未修改全局工具或代理配置。
- 首次 E2E 的 Electron 下载失败导致 1 项失败；下载完成后，原始 **46 项单元测试和 8 项 Electron E2E 全部通过**，类型检查和生产构建通过。
- Vite+ 官方迁移完成后，Solid 接入前再次通过同一组测试与构建，产物与原始基线相同。迁移报告没有 BLOCK/REVIEW 项，也没有生成 Vitest v4 或 tsdown 兼容设置。

## 可重复检查

```bash
bun install --frozen-lockfile
bun run check
bun run test
bun run build
bunx playwright install chromium
bun run test:e2e
CSC_IDENTITY_AUTO_DISCOVERY=false bun run dist --mac --arm64 --publish never

# Optional existing compatible browser, always with a temporary test profile
PANO_PREVIEW_CHROMIUM='/path/to/chrome' bun run test:e2e

# Observe an existing production build; never modifies it
bun scripts/measure-reader.ts .agents/verification/electron/measurement.json 3 5
```

| 检查             | 本机结果                                                                |
| ---------------- | ----------------------------------------------------------------------- |
| 冻结锁文件安装   | 通过；最终安装无依赖变化                                                |
| `bun run check`  | 通过；0 错误、4 条原有集合展开建议                                      |
| TypeScript       | 通过；覆盖应用、全部测试、配置及测量脚本                                |
| 单元测试         | **99/99**；原有 46、应用控制 48、开发编排 5                             |
| 生产构建         | 通过；保留 PDF.js 大于 500 kB 的提示                                    |
| Playwright       | **24/24，无跳过**；23 项 Electron、1 项浏览器预览                       |
| 修改文件格式检查 | 通过；历史未改文件保持原排版                                            |
| 开发编排实测     | 通过；5173 占用后使用 5174，实际 URL 注入、两种信号和子进程退出清理有效 |
| macOS arm64 分发 | 未签名 DMG、ZIP、应用目录生成；包内离线资源检查通过                     |

`check.fmt: false` 是有意保留历史排版的迁移决策，单独对修改文件执行 `vp fmt` / `vp fmt --check`。首次全库格式检查发现 21 个历史文件差异，未据此全库改写。安全控制字符过滤与 Playwright 的空对象参数有定向 lint 说明；4 条剩余建议在未改动的 reader/preload 集合快照中，保留其原实现。测试、断言和类型检查范围均未缩减。

本机浏览器预览使用 Chrome 154 的独立临时 profile；缺少 Playwright Chromium 且未指定浏览器时，预览用例明确跳过。CI 在 macOS E2E 前安装匹配的 Chromium，因此无需依赖系统 Chrome。旧缓存 Chromium 143 曾在首次打开 PDF 时报错，精确原因尚未定位。

## 功能与生命周期覆盖

原有 8 项 Electron 用例完整保留：

1. 离线打开、文字选择、搜索/下一匹配、无结果、目录跳转、横向居中、纵向多列、关闭重开恢复。
2. renderer 忙碌时原生 B→A 事件保留 A 的最新未保存位置。
3. 页码变化后立即退出，最终位置写入磁盘。
4. 首次欢迎、再次启动、快捷键提示和空态工具栏隐藏。
5. 自动续读与关闭文档保留窗口。
6. 明确启动文件优先于旧文档。
7. 缺失文件恢复、菜单键盘/焦点、窗口控制和退出保存。
8. resize 回调保持之后发生的导航及保存位置。

新增验证：

- 控制层：不可变文件 ID/位置快照、延迟写入、原生竞争、启动确认、错误后恢复、密码取消、外部 Promise 迟到成功/失败、窗口状态响应顺序、同步重入与重复实例。
- 真实 Solid + PDF.js：空态、打开中、密码等待、已加载时卸载；立即销毁先于 worker ready；Promise 幂等；完成时 worker、ResizeObserver、桥接订阅全部释放。
- 保存阻塞时，DOM/worker 已释放，但 `dispose()` 等待最终写入完成。重新挂载后旧 startup/window 响应及旧事件对新旧 DOM 都没有修改。
- opening 的宿主尺寸大于零；工具栏、侧栏、菜单、布局和缩放更新保持 host/viewer/page 节点身份。
- 页码、缩放、列数编辑草稿保留；搜索及数字输入的 composing Enter 保持行为；真实加密 PDF 错误密码、取消、正确密码恢复；纯栅格扫描件实际绘制和无文字搜索。
- 同一浏览器会话连续重开文档，验证 worker 转移 buffer 后仍有原始数据可用。

## 开发、离线和视觉

- Vite+ 官方规则要求保留程序化 `vite` API 导入；Bun 的直接 core alias 与 override 均保留。
- 开发和生产检查 module worker、CMap、标准字体、WASM、批注图片。生产 WASM 魔数、资源内容类型与长度有效。
- 受控回环服务器证明目标可达；renderer CSP 和 Electron session 请求过滤器分别阻止外部访问，服务端未收到应用请求。
- Solid HMR 测试修改的是开发服务器转换结果，不改仓库源码。标题栏热更新后，页码、PDF 页面节点和单个 worker 保持有效，随后可正常关闭文档。
- 本地编排脚本实测使用隔离用户目录；覆盖占用端口、实际端口/数据目录注入、SIGINT、SIGTERM、Electron 子进程异常退出、缺失安装。端口和测试子进程均已释放。脚本及结果位于 `.agents/verification/check-dev.mjs`、`dev-orchestration.json`。
- `src/style.css`、`src/reader.css`、`tokens.css` 未修改。800/1440 欢迎页及横向、纵向阅读页四张截图与基线逐像素相同。第五张标题栏阅读截图的 PDF 区域有垂直位移，标题栏、工具栏和状态栏一致；该截图紧接提示条隐藏和缩放，未固定布局帧，不作静态相等依据。页面居中的行为断言通过。

## 本轮发现与修复

1. **数字输入 IME**：基线 composing Enter 会让输入失焦。迁移后的输入模块在组合期间保留草稿和焦点，正常 Enter 再提交，回归通过。
2. **组件外响应式计算**：开发模式提交页码时出现 Solid 所有者警告。调用栈定位到事件处理器读取动态 prop getter。将实际值读取放入组件 memo，开发/HMR 测试从失败转为通过，保留无警告断言。
3. **SIGTERM 清理竞态**：实际 Bun/Vite+ 启动中，Vite 独立退出处理可能先结束父进程，留下 Electron。开发脚本现在在同一信号任务内启动两边清理，随后共同等待；实测和 5 项编排回归通过。

## 性能对比

脚本：`scripts/measure-reader.ts`。固定本地合成夹具和初始阅读设置，每类 3 个新进程，每进程 5 轮关闭/重开。夹具字节哈希一致，测量前后各自产物哈希一致；每次使用隔离数据目录。

表格为最初基线与最终版本的中位数，单位毫秒。打开包含 Electron 启动和自动化观察；加密文档包含密码输入；搜索包含防抖和轮询。

| 夹具              | 基线就绪 | 最终就绪 | 基线首画布 | 最终首画布 | 基线搜索 | 最终搜索 |
| ----------------- | -------: | -------: | ---------: | ---------: | -------: | -------: |
| 12 页混合方向文字 |    483.8 |    504.3 |      515.6 |      557.5 |    833.6 |    805.7 |
| 3 页图像扫描件    |    561.8 |    562.2 |      576.6 |      575.1 |   无文字 |   无文字 |
| 1 页加密文字      |    530.1 |    517.9 |      552.9 |      538.9 |    798.5 |    796.7 |

- 最终文字文档就绪范围 466.6–565.0ms，首画布 500.7–581.3ms，样本有波动。一次中间测量的加密打开较慢，重放旧产物及最终版本后没有稳定复现该趋势；全部原始记录保留。
- 文字首画布中位数比原始基线高约 42ms。现有样本不足以判断稳定回退，也不足以宣称性能提升；未设定任意百分比阈值掩盖差异。
- 全部测量的滚动/缩放窗口观测到 0 个超过 50ms 的主线程长任务。
- 每轮关闭后 0 worker，重开后 1 worker。
- 第 1 到第 5 次关闭后的强制 GC 堆增量：基线约 0.315/0.402/0.487 MiB，最终约 0.332/0.415/0.504 MiB（文字/扫描/加密）。两者均有小幅上升，五轮样本不足以证明或排除长期泄漏。
- 最终应用 JS 665.76 kB、gzip 203.59 kB；原始 635.57/192.44 kB。worker 与 CSS 内容保持一致。

原始结果：`.agents/verification/electron/{baseline,baseline-replay,candidate,candidate-final}.json`；汇总：`comparison.json`。首轮较慢样本也保留，未用后续样本覆盖。测量未覆盖 OS 冷缓存、进程 RSS、GPU/canvas 原生内存、worker 堆、大型真实文档和复杂矢量内容。

## 分发与验证边界

产物：

- `release/mac-arm64/PanoPDF.app`
- `release/PanoPDF-0.1.0-beta.1-mac-arm64.dmg`
- `release/PanoPDF-0.1.0-beta.1-mac-arm64.zip`

包内 285 个前端与离线资源文件逐字节核对，其中 CMap 169、标准字体 16、WASM 目录 13、images 82；module worker 独立存在。包内没有测试、源码或 `.agents` 目录。使用默认 Electron 图标，未签名、公证。构建还提示缺少 author 元数据及当前平台之外的可选 canvas 二进制，未阻止 arm64 打包。

保留三平台检查/构建、macOS E2E、四组平台架构分发和版本标签校验。CI/发布增加 Vite+ 检查和 macOS 测试浏览器安装。本轮未提交、推送、触发远端工作流或修改主工作区。

待验收：

- Windows/Linux 原生运行、macOS Intel 打包，以及各平台安装后启动/离线打开、文件关联、签名、公证。
- 打包应用按安全约定忽略测试 userData 覆盖，因此本轮没有用发行包启动触碰正常阅读数据；包内资源检查与源码 Electron E2E 分别记录。
- 原生文件选择/确认框与真实拖放手势、系统输入法候选窗口、标题栏真实拖动。
- 专门 CJK/JPX 文档实际消费 CMap/WASM 解码资源。当前证明离线资源可读，未声称覆盖每种编码。
- 大型复杂 PDF 性能与长期内存趋势。

所有源码 Electron 测试均同时设置 `PANO_TEST_MODE=1` 和绝对 `PANO_USER_DATA`；浏览器使用临时 profile。测试仅使用合成 PDF。强制终止进程仍可能丢失最后进度。

## 历史记录

前期实现已修复设置路径为命名管道时的阻塞、原生 B→A 旧快照覆盖、立即退出保存和 resize 旧锚点覆盖；本轮保留原回归。首版视觉审查曾覆盖 800/1440/1920 宽度与密码错误状态；该历史结论与本轮截图比较分开。此前 Release Action 经 actionlint 检查，本轮调整仍须以实际远端执行结果确认跨平台环境。
