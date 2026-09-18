# PanoPDF 渲染引擎选型研究：PDF.js、PDFium 与 MuPDF

## 结论

**能把 PDF.js 作为 PanoPDF 首版的渲染引擎；当前源码已经提供水平连续布局所需的可见页调度、可取消绘制、延迟重绘和局部高清画布，不应因为“它是 JavaScript”就排除它。**

但这不等于“PDF.js 不慢”：**大型矢量图、复杂透明合成、巨幅扫描图和高倍率缩放确实有性能风险；标准浏览器集成仍在 Electron renderer 的 UI 主线程执行 Canvas 绘制指令，worker 并未隔离全部绘制负载。**如果产品要求“任何复杂 PDF 都能立即清晰、缩放期间始终无卡顿”，现有证据不能支持这个承诺。

建议采用当前稳定版 PDF.js，复用其页面视图与调度机制，定制 PanoPDF 的横向布局和输入行为；不要先写一个“所有页面同时渲染、每个缩放事件都重新画整页”的简单封装，再把卡顿归因于引擎。对地图、CAD 等重矢量文档保留明确的性能边界，不承诺即时高清。这里给出的选型建议基于已存在的能力和瓶颈，不以“先做基准再说”代替结论。

### 研究口径

- 查阅日期：**2026-09-17（UTC）**。
- 当前官方 Latest：**v6.3.289，2026-08-29 发布**。[S01]
- 源码结论固定到 `v6.3.289`，不是把开发分支尚未发布的功能算作现状。Wiki、问题讨论和测试文档以查阅时内容为准。
- 优先级：发布版源码／官方文档 > 维护者带具体材料的 PR／问题回复 > 用户单例报告。仓库里的用户报告不自动等于维护者确认的基准结果。
- 本轮分两条线查阅 PDF.js 性能实现，以及 PDFium／MuPDF 的集成与许可；正文前六节详述 PDF.js，第七节汇总引擎选型。
- **没有进行跨引擎同条件实测，也没有在 PanoPDF 或三种操作系统上运行性能测试**。结论是基于能力、已知瓶颈和集成成本的工程建议，不是速度排名。

## 1. 性能究竟花在哪里

### 1.1 Worker 负责核心处理，不代表整页绘制离开 UI 线程

当前标准浏览器调用链可概括为：

1. UI 侧 `getDocument()` 建立 PDF worker。
2. worker 处理文档、字体／图像等资源，响应 `GetOperatorList`，输出绘制指令列表。
3. display 侧 `InternalRenderTask` 创建 `CanvasGraphics`，把指令落实为 Canvas 2D 调用；普通网页／Electron renderer 集成中，这一层运行在 UI 主线程。
4. 浏览器再负责 Canvas 后端栅格化与合成；不能把全部底层工作都称为“JavaScript 在主线程算像素”。文字层、注释层及页面 DOM 也有额外的 UI 成本。[S02][S03]

关键源码原文：

```js
const worker = new Worker(workerSrc, { type: "module" });
```

```js
const canvasContext =
  this._canvasContext ||
  this._canvas.getContext("2d", {
    alpha: false,
    willReadFrequently: !this._enableHWA,
  });

this.gfx = new CanvasGraphics(
```

来源：[S02] `PDFWorker`、`InternalRenderTask.initializeGraphics`；worker 接收任务见 [S03]。

因此两个极端说法都不成立：

- **“PDF.js 所有工作都在主线程”——不成立。**正常 worker 会分担解析和资源处理。
- **“配置 worker 后，复杂 PDF 就不会阻塞 UI”——不成立。**绘制指令仍可能占用 UI 线程；一次重操作也可能超过调度时间片。

Worker 创建失败时，源码还有 `Setting up fake worker.` 路径。[S02] PanoPDF 应把真正的 module worker 加载成功作为集成验收项，而不是忽略警告。本文中的“主线程”指 Electron renderer 的 UI 线程，**不是 Electron 主进程**；把整个渲染器搬到独立进程是另一项架构工作，不是 `workerSrc` 的效果。

### 1.2 OffscreenCanvas 已使用，但不是整页离屏绘制的开关

当前 API 的准确表述是：

> “Determines if we can use `OffscreenCanvas` in the worker. Primarily used to improve performance of image conversion/rendering.” [S02]

`isImageDecoderSupported` 同样针对 worker 中的图像转换／解码。当前 JPEG 和图像缩放源码确实使用 `ImageDecoder`、`OffscreenCanvas`，并检查适用条件。[S04]

官方问题 #10039 在 2022 年关闭时，维护者写道：

> “Closing since we now use `OffscreenCanvas` if it's available (by feature detection). This was introduced by PR #14754 for image rendering performance improvements …” [S05]

**不能把这个关闭状态解释为“完整 PDF 页面已经默认在 worker 中绘制”。**相反，当前 display 源码仍显示上述 Canvas 调用链。2018 年 #10319 的 `document is not defined` 报错也只能说明当时的集成问题，不能直接断言现在完全不支持任何自定义 worker 渲染；该讨论中的伪造 DOM 方案是用户实验，不是 PanoPDF 应默认依赖的完整官方方案。[S05]

### 1.3 现在已经使用 WASM，而且不止一种用途

API 原文：

> “Attempt to use WebAssembly in order to improve e.g. image decoding performance. The default value is `true`.” [S02]

发布版源码可确认：[S06]

| 用途 | 当前实现 | 性能含义与边界 |
| --- | --- | --- |
| JPEG 2000／JPX 解码 | `openjpeg.wasm` | 不再是“所有图像都由手写 JS 解码”；不加速与 JPX 无关的矢量路径 |
| JBIG2、CCITT 传真编码解码 | `jbig2.wasm`，PDFium 解码器的 WASM 路径 | 对黑白扫描件很重要；不是把整个 PDFium 引擎嵌入 PDF.js |
| ICC 色彩转换 | QCMS，`qcms_bg.wasm` | 处理色彩转换，不等于整页栅格器 |
| PDF PostScript 函数 | `buildPostScriptWasmFunction` | 对相应函数尝试编译为 WASM；失败仍有 JS 解释路径，不是所有 PDF 操作都编译成 WASM |

2026 年合入的 JBIG2 PR 原文：

> “The decoder is ~4x faster than the JS decoder on large images.” [S07]

这是维护者报告的**特定解码阶段**提升，不能改写成“PDF.js 现在所有扫描 PDF 都快四倍”。同样，当前无 WASM 的 JBIG2／CCITT 回退实现也已更换，旧解码器的故障不能原样外推到新版本。[S07]

PanoPDF 应打包并正确配置同版本 worker、`wasmUrl`、所需 CMap／标准字体等资源；WASM 文件加载失败时，部分路径会尝试 JS 回退，ICC 支持还可能缺失。[S02][S06] **资源打包错误既可能降低性能，也可能影响显示正确性。**

`enableHWA` 默认是 `false`，当前绘制路径会据此设置 `willReadFrequently`。[S02] 它是 Canvas 后端选择的相关提示，不是“打开就保证 GPU 全程加速”的承诺。

## 2. 哪些 PDF／操作确实容易慢

### 2.1 大量矢量路径、透明度和遮罩

2022 年 #14652 附带楼层图 `Floor2.pdf`，报告者在 Chrome 99／macOS 下描述缩放出现白屏、等待 5–10 秒，并称 Preview 和 Chrome 内置阅读器更快。维护者诊断原文：

> “That PDF document contains a *huge* amount of path rendering operators, which likely explains why this is a bit slow since that's something that's not entirely easy to optimize …” [S08]

可采信的是：**有可复现材料，维护者确认大量路径是合理瓶颈方向。**不能采信为：当前版本普遍慢 5–10 秒，或任何原生引擎都更快。该问题现已关闭；后续用户还有不同耗时报告，不构成相同环境下的版本对比。

路径计数也不能随意简化：同一讨论中维护者明确指出，单数 `OPS.constructPath` 会低估，因为一个这样的操作包含多个实际路径操作。[S08] 文件小、页数少，不代表绘制简单；高度压缩的矢量内容也可能很重。

官方 FAQ 建议避免昂贵的遮罩／透明合成：

> “Avoid using expensive compositions/effects such as transitions/masking -- flatten transparency;” [S09]

这解释了瓶颈来源，不应变成桌面阅读器要求用户先修改 PDF 的前提。2026 年软遮罩优化已经合入，PR 原文为：

> “Prepare reusable soft-mask canvases for filtered and backdrop-dependent masks, and use a faster destination-in composition path where possible.” [S10]

所以“透明遮罩永远只能走旧的慢路径”也是过时说法；但优化不等于消灭所有复杂合成开销。

### 2.2 扫描件：压缩体积不等于解码后大小

扫描件至少包含图像解码、色彩转换、缩放、上传／复制和绘制等成本。WASM 能改善其中一些阶段，但不能消除展开后的像素内存。[S04][S06]

官方 FAQ 不建议全书同时建立高分辨率画布，给出 letter 页面 `816 × 1056`、每像素 4 字节的计算，并明确写道：

> “Our recommendation is to create and render only visible pages.” [S09]

按此模型推算，**不是实测内存**：

- 100% 缩放、DPR=2：`816 × 1056 × 4 × 2² ≈ 13.15 MiB/页`。
- 200% 缩放、DPR=2：约 `52.59 MiB/页`。
- 100 张前一种画布仅裸像素就约 `1.28 GiB`；还没算解码图、临时画布、GPU 副本、指令列表和文字层。

全页栅格内存近似随 **缩放倍率平方 × DPR 平方** 增长。不要用“缓存 10 页”代替全局字节预算，也不要用 `maxImageSize` 做无损内存控制：API 明确说明超过它的图像将不被渲染。[S02]

### 2.3 页数、批量读取、文字和注释层

FAQ 有一句：

> “The amount of pages does not affect the performance.” [S09]

应将其理解为“单页内容复杂度不由总页数决定”，**不能当作整个应用对页数零成本的保证**。当前 viewer 会为各页建立 `PDFPageView`；缓存、布局元数据、全文搜索或全书注释读取仍会扩大工作量。[S11]

2026 年 #21442 有 PDF 和脚本：20 页、2000 个高亮，报告 `getAnnotations()` 从 5.2.133 的约 106 ms 增至 5.4.149 的约 516 ms。其方法是遍历全部页获取注释，**不是整页渲染速度测试**。问题虽标记关闭，但维护者没有承诺去掉辅助功能需要的文本提取；v6.3.289 的 `getAnnotationsData` 仍对可见高亮执行 `extractTextContent`。[S12]

对 PanoPDF 的直接意义：先加载可见页所需文字／注释，其他工作排到低优先级；不要在打开文档时把所有页面的文本和注释一次性并发读取。

### 2.4 大文件加载与页面绘制要分开看

官方支持 HTTP Range，在服务器和文件结构允许时，不必等全部字节下载完成才能显示可见页。[S09] 但 **Range 优化的是读取等待，不会减少一页内部的路径或图像解码工作**。PanoPDF 主要读取本地文件，不能直接把远程下载优化当成本地绘制加速；如需按范围读取本地大文件，需要应用侧接入相应传输能力，而不是只设置一个 URL 就假设已完成。

低层 API 建议使用 `Uint8Array`，并说明：

> “If TypedArrays are used they will generally be transferred to the worker-thread. This will help reduce main-thread memory usage, however it will take ownership of the TypedArrays.” [S02]

因此建议避免 base64 和不必要的全文件复制，并注意数据转移后的所有权。`disableAutoFetch` 不是“只渲染可见页”的开关；文档说明，关闭预取还需同时关闭 streaming。[S02] 同样，`canvasMaxAreaInBytes` 控制 worker 内图像缩放判断，不能与 viewer 的 `maxCanvasPixels` 或全应用内存预算混为一谈。

## 3. 取消、虚拟化与缩放：当前能做什么

### 3.1 取消是协作式，不是立即中断一条重操作

`RenderTask.cancel()` 文档原文：

> “If the task is currently rendering it will not be cancelled until graphics pauses with a timeout.” [S02]

Canvas 执行器当前使用：

```js
const EXECUTION_TIME = 15; // ms
const EXECUTION_STEPS = 10;
```

但这是操作之间的时间检查，**不是每帧最多占用 15 ms 的硬保证**；某条图像／路径操作本身可能很长。[S13] `onContinue` 可用于暂停、恢复并让出调度机会。

#17485 中用户认为分片有约三倍开销，建议大幅增大时间片。维护者明确反对，指出这会破坏可见页优先和取消能力：

> “It would effectively break the ability to render the most visible page (in the viewer) *first* …”
>
> “Note that *cancelling* of rendering can only happen when rendering pauses …” [S14]

因此对 PanoPDF，不能为了让某页的计时数字更小，就把一次绘制变成秒级不让步的任务。

另外，取消画布任务并不意味着立刻停止所有 worker 解析：`_abortOperatorList` 故意短暂延后终止，以避免缩放／旋转时丢掉可复用工作。[S02] 实现上应等待取消任务结束再复用同一 canvas，处理 `RenderingCancelledException`，并用任务代次标记防止旧结果覆盖新缩放状态。

### 3.2 已有可见页优先队列和缓存，不等于彻底 DOM 虚拟化

官方队列源码列出的优先级是：

> “1. visible pages”
>
> “2. zoomed-in partial views of visible pages”
>
> “3. … the page after the visible pages … [or] the page before the visible pages” [S15]

它支持暂停／恢复、滚动方向预渲染；viewer 根据实际可见页数调整页面缓存，使用 `Math.max(DEFAULT_CACHE_SIZE, 2 * numVisiblePages + 1)`。[S11]

但 viewer 仍会建立各页视图对象和页面容器。[S11] **“没有给每一页分配高清 canvas”与“DOM 只保留可见页”不是同一件事。**首版可以沿用前者；超长文档是否还需 DOM 窗口化，是独立问题，不能声称 PDF.js 已包办。

离开缓存的页面应取消任务、释放 canvas／页面资源。`PDFPageProxy.cleanup()` 会在仍有渲染等工作时返回未成功清理；文档切换则结束整个 loading task／文档。[S02] 不能每次滚动都销毁文档，也不能假设清理后系统任务管理器数字立即下降。维护者在 #16647 说明：

> “the decision on how/when said data is actually being evicted from memory is ultimately up to the browser *and* operating system.” [S16]

### 3.3 高倍率缩放已不只有“模糊地放大整张 canvas”

当前 viewer 已有两项不同能力：[S11][S17]

1. **局部高清画布 `enableDetailCanvas`：默认 `true`。**整页超过画布限制时，保留低分辨率底图，再在视口附近覆盖一张高清局部图。滚动后移动／重绘这个局部区域。
2. **局部操作过滤 `enableOptimizedPartialRendering`：当前通用 viewer 默认 `false`。**记录绘制操作的包围盒和依赖，随后局部渲染时过滤不相交的操作。它已经存在于发布版，但不能把“支持”写成“默认开启”。

源码对第二项的说明原文：

> “rendering will keep track of which areas of the page each PDF operation affects. Then, when rendering a partial page … it will only run through the operations that affect that portion.” [S11]

默认值原文：

```js
"enableOptimizedPartialRendering",
{
  /** @type {boolean} */
  value: false,
```

因此，2015 年 #6419 仍开放，**不等于 2026 年还完全不能局部渲染**。[S18] 同时，也不能反过来宣称完整的任意多瓦片系统已经做完：当前 detail view 主要是每页一个视口附近的高清区域；操作过滤需要先有记录数据，不是首次解析时自动只处理可见区域。[S17]

默认 `maxCanvasPixels` 为 `2 ** 25`，一张这样的 RGBA 画布裸像素就是 128 MiB；还有 `maxCanvasDim`、视口面积约束。[S11][S17] 这不是 PanoPDF 的总内存预算。detail view 在可见区本身超过其像素额度时还存在忽略该额度的分支，不能把单项设置当成绝对内存上限。[S17]

### 3.4 缩放应分成“立即响应”与“重新清晰”

当前 `PDFPageView.update()` 已有 `drawingDelay`、CSS 缩放和取消旧任务的处理。[S19] 对 PanoPDF 建议：

- 连续缩放期间先变换现有画布，保持鼠标／触控板缩放锚点稳定；这是暂时模糊，不是最终输出。
- 停顿后按最终尺度重新渲染可见区域；保留旧图直到新图可显示，减少白闪。
- 超大页面使用局部高清，不无限扩大整页 canvas。
- 不在每个 wheel／pinch 事件上启动一个全页高分辨率 render。
- 操作过滤先作为明确的可选优化验证显示正确性，不在没有依据时强制打开；不要删除库中的依赖跟踪、只按几何框过滤。

当前 viewer 还会在快速滚动反复取消 detail view 时暂缓其重绘，待滚动停止再补齐；缩放中也会推迟 detail view 重绘。[S11] 这正是“优先响应操作，而不是追逐每个中间高清状态”的现成策略。

当前 viewer 还会限制**未完成页面内容的可见画布更新频率**，默认相关间隔为 500 ms；这是避免大型画布反复提交，不是把滚动帧率锁成 2 FPS。[S20]

## 4. 对 PanoPDF 交互的具体判断

以下是根据上面源码能力提出的应用设计建议，不是 PDF.js 官方对 PanoPDF 的性能保证。

| 核心 UX | 能否支持／实现重点 |
| --- | --- |
| 横向连续页面 | 能。已有 `ScrollMode.HORIZONTAL`、横向可见区域计算；不需要换引擎才能实现。[S11] |
| 同时可见页数可变 | 能。用页面与视口交集形成可见集合，不假设固定单页／双页。沿用可见页优先，邻页少量预渲染，并额外限制总像素／字节预算。 |
| 任意缩放比例 | 能支持连续尺度，但不等于无限清晰、无限画布或零等待。CSS 预览与最终栅格分离，高倍率走局部高清。 |
| 滚轮逐页吸附 | 属于输入／滚动控制层。依据当前几何位置选目标页，滚动动画不等待高清完成，不把普通滚轮事件全部当作缩放。 |
| 触控板平滑滚动 | 尽量保留连续滚动与惯性，不强制每个小 delta 都吸附到一页。浏览器 wheel 事件没有可依赖的通用“来自鼠标／触控板”身份，应使用保守策略并提供模式选择。渲染调度必须独立于滚动动画。 |
| 页面垂直居中 | 属于布局，不需要引擎改动。官方横向 CSS 已有 `vertical-align: middle`，但那是同行页面对齐；PanoPDF 仍需明确相对视口居中的规则，以及页面高于视口时的平移／溢出行为。[S21] |

最小实现建议：**一个文档对应一套正常 worker／文档状态，优先复用 `PDFPageView`、`PDFRenderingQueue` 或其既有机制，外层负责横向几何和输入策略。**不要一页一个独立文档／worker，也不要用 `Promise.all` 无限制启动全部页面绘制。仅调用低层 `page.render()` 时，不会自动获得 viewer 层的缓存、局部高清、缩放延迟和输入管理，需要自己接入。

## 5. 可以相信哪些性能数字

### 5.1 官方持续测试存在，但不等于跨引擎排行榜

PDF.js 官方基准说明要求性能改动提供对照；示例对同一测试运行 50 轮，并强调：

> “As a sanity check, you should do this twice with the same code and compare the results.” [S22]

Firefox Talos `pdfpaint` 的定义为：

> “reporting: time from *performance.timing.navigationStart* to *pagerendered* event in ms (lower is better)” [S23]

文档描述按 PDF 集合分块、每块 100 个 PDF、每个 5 次迭代；本地不指定 chunk 时默认只跑一个 cycle。PDF.js Wiki 将其概括为打开 PDF 到第一页绘制完成。[S22][S23]

这证明项目有真实回归测试体系，但该指标**不直接测横向多页滚动、触控板惯性、连续缩放的尾延迟、总内存，也不是 Electron/Chromium 与原生引擎的同条件比较**。本轮未取得可直接回答 PanoPDF UX 的当前跨引擎基准。

### 5.2 具体证据及其适用范围

| 来源与时间 | 原文／结果 | 能推出什么；不能推出什么 |
| --- | --- | --- |
| #19856，2025-04 合入 | “with wuppertal_2012.pdf on Windows, displaying it at 150% takes around 14 min !!! without this patch when it takes only around 14 sec with.” | 维护者给出明确文件、平台、缩放和前后对照；大型可见画布更新频率可能造成灾难性开销。不能把约 60 倍当作所有 PDF 的提升，也不能把 14 秒当作当前 Electron 的实测值。[S20] |
| #20546，2026-01 合入 | “The decoder is ~4x faster than the JS decoder on large images.” | 支持 WASM JBIG2 改善特定解码瓶颈。缺完整硬件、分布和端到端数据，不能推广为整页／整书四倍。[S07] |
| #19043，2024-12 实验，2025-08 合入 | “a low-resolution image … taking 12 seconds”／“the ‘detail view’ … taking only 1.4 seconds and only running one fifth of the PDF operations” | 展示局部操作过滤的潜力，**不是等工作量 A/B**：首次低清全页与后续局部高清范围不同，且作者同帖承认当时尚有显示错误。不能当成当前稳定版普遍快 8.6 倍。[S24] |
| #21442，2026-06 | 20 页／2000 高亮，`getAnnotations()` 约 106 → 516 ms | 有附件、脚本、版本和系统的用户回归报告；当前源码仍有对应额外工作。不是 raster benchmark，也不是本轮复测。[S12] |
| #14652，2022-03 | 缩放白屏等待 5–10 秒 | 历史复杂矢量反例，有附件和维护者分析；不能直接代表 v6.3.289。[S08] |

尤其值得注意：#19856 的提升来自提交／显示策略，#20546 来自解码器实现。**性能由具体工作量、算法、缓存、调度和浏览器后端共同决定，不是“JS 必慢”或“原生必快”的语言标签。**本轮证据既不能证明 PDF.js 全面领先，也不能证明原生方案必胜。

## 6. 推荐、边界和仍未解决的问题

### 推荐

采用 **v6.3.289 作为首版基线**，以“滚动／缩放立即响应、高清允许随后补齐”为体验模型。首版就应包含可见页调度、有限预渲染、取消旧任务、缩放预览、局部高清和总内存预算；这些不是以后补上的小优化，而是连续阅读器正确的渲染方式。

### 不应承诺

- 任意 PDF 在任意倍率下都立即清晰。
- 有 worker 就没有 UI 长任务。
- WASM／硬件加速能消除路径、遮罩和像素规模成本。
- 单个 `maxCanvasPixels` 能限制整个进程内存。
- 当前默认就开启局部操作过滤，或已经有完整的多瓦片渲染系统。

### 剩余不确定性

1. **当前 Electron／Chromium 在 macOS、Windows、Linux 上的表现尚未确认。**官方 Firefox 结果不能直接外推到不同 GPU、DPR 和合成后端。
2. **重矢量文档能否满足目标流畅度无法判断。**缺 PanoPDF 的具体文档范围、目标硬件及帧延迟要求；已知风险位置是主线程绘制、单个长操作、首次全页处理和局部重绘。
3. **没有当前同条件跨引擎证据。**后续若比较其他引擎，应统一页面区域、缩放／DPR、冷暖缓存、显示正确性及计时终点；只比“第一页 render 完成”不足以决定本产品体验。
4. **通用 viewer 的局部操作过滤默认关闭。**源码确认能力存在，但本轮未建立开启后在 PanoPDF 文档集合中的正确性和收益保证。
5. **上游优先级并不等于桌面产品需求。**#21442 的维护者回复明确强调 Firefox 场景和维护负担；不能假设特定 Electron 性能诉求必获上游实现。[S12]

后续最有价值的验证不是泛泛重跑“PDF.js 快不快”，而是核查：正常 worker／WASM 是否实际加载、复杂页面是否产生 UI 长任务、取消到新页显示的延迟、连续缩放是否出现过期覆盖／白闪、长距离滚动后资源是否受到预算约束。这些验证用于确认已知风险，不改变本轮“可以采用，但不能承诺所有复杂文档实时高清”的结论。

## 7. 与 PDFium、MuPDF 比较后的最终选型

**建议首版选择 Electron + PDF.js；不因性能印象直接换成原生引擎，也不同时维护两套引擎。** 若目标文档暴露出解析／绘制瓶颈，优先评估 PDFium WASM；只有原生路径能提供明确的端到端收益时，再承担原生发布成本。这是当前需求下的工程取舍，不是 PDF.js 最快的断言。

| 方案 | 已核实的能力 | 对 PanoPDF 的主要代价 | 建议 |
| --- | --- | --- | --- |
| PDF.js | 页面绘制、文字层、注释／链接层、搜索控制器及 viewer 调度 | 标准 Canvas 指令仍可能占用 UI 线程；低层 render 不自动附送 viewer 优化 | 首版首选 |
| PDFium WASM | 可按页／区域输出位图；现有封装提供文字几何与搜索 | Worker、内存、像素传输和交互层仍需集成 | 首选替代候选，不预设一定更快 |
| PDFium 原生 | 公开 C API 支持位图、变换／裁剪、文字与链接 | 原生桥接、IPC、三平台二进制部署、签名和引擎安全更新 | 当前不优先 |
| MuPDF WASM／原生 | 官方接口支持渲染、结构化文字、搜索及选择辅助 | AGPL 合规或商业授权；原生方案另有部署成本 | 授权方向明确后再考虑 |

### 7.1 Electron 内置 PDFium 不能当作现成渲染 SDK

Electron 内置 PDF 查看器可在其构建源码中核实；但它没有因此公开一套受支持的 JS API，让应用取得 PDFium 文档句柄、按任意页面区域渲染并读取字符框。PDFium 的公开 C API 是给独立嵌入该库的开发者使用，不等于 Electron 自动转发这些 API。[S25][S26]

`printToPDF()` 是生成 PDF；Electron 的离屏渲染是获取窗口合成画面，二者都不是 PDF 解码 SDK。依赖查看器私有 DOM、内部消息或截图拼页，不适合作为 PanoPDF 的长期架构。[S27] **“Electron 已经带 PDFium，所以定制阅读器只需直接调用”这个推断不成立。**

### 7.2 有可行集成路径，但不能混淆引擎和完整阅读器

- **PDFium WASM**：`@embedpdf/pdfium`／`@embedpdf/engines` 与 `@hyzyla/pdfium` 都是真实候选。EmbedPDF 提供文字几何、搜索与矩形渲染封装；其 `PdfiumNative` 类实际接收 WASM 模块，不是系统原生 Node 插件。查阅时 EmbedPDF 稳定线为 `v2`，主分支为不建议生产使用的 v3 开发线，应锁定版本并核查对应许可。[S28]
- **PDFium 原生**：`bblanchon/pdfium-binaries` 提供跨平台预编译动态库，但属于第三方发行，不是 Google 官方 Electron SDK；`pdfium-render` 是 Rust 绑定，也不是即插即用的 Node 插件。[S29]
- **MuPDF WASM**：官方包名是 `mupdf`，支持浏览器和 Node，无平台原生依赖；不要与旧社区包 `mupdf-js` 混淆。[S30]

原生／WASM 引擎并非只能输出图片：PDFium 和 MuPDF 均有文字、搜索及链接相关 API。但字符坐标和搜索结果不等于浏览器中的拖选、跨页选择、键盘操作、剪贴板、链接命中层和无障碍能力，这些仍需要阅读器集成。PDF.js 已有相应前端构件，是首版成本较低的重要原因。[S31]

原生路线还需处理平台／架构匹配、动态库装载、ASAR 外部资源、签名及安全升级。Node-API 可减少部分 ABI 变化影响，不消除外部库和操作系统依赖；独立辅助进程也不自动获得 Chromium PDF 沙箱。[S32] 不建议为减少实现成本，把不受信任 PDF 的原生处理直接塞进 Electron 主进程。

### 7.3 许可边界

- **PDF.js** 使用 Apache-2.0；闭源分发需履行对应许可和通知义务。[S33]
- **PDFium** 当前官方 LICENSE 含 BSD 三条款声明和 Apache-2.0 文本；应按锁定版本保留完整许可及第三方组件通知。绑定层的 MIT 等许可不能代替引擎许可。[S33]
- **MuPDF** 提供 AGPL 与商业授权；官方明确其 JS 包装层和 WASM 二进制都受该授权安排约束。若不接受 AGPL 所需的源码开放等义务，应取得商业授权。不能因为使用 WASM、宽松许可包装层或独立进程，就认定绕过底层授权要求。[S30]

以上用于选型筛查，不替代针对最终组合及分发方式的法律审核。PanoPDF 尚未确定开源／商业授权方向，因此当前不把 MuPDF 设为默认依赖。

### 7.4 公开基准能支持的结论

本轮未找到足以对当前 Electron 三平台做速度排名的同条件公开数据。PyMuPDF 官方有固定文档集的渲染基准，但对手是 XPDF／PDF2JPG，且计时包含输出文件写入；不能据此推断 MuPDF WASM 比当前 PDF.js／PDFium 更快。[S34] 第三方封装 README 的“可能更快”也不能代替可复现的端到端比较。

因此，**不能证实“PDF.js 普遍性能不行”，也不能证实“换原生就能解决”。能确认的是主线程指令执行、复杂页面和高分辨率位图的风险，以及当前已有的缓解机制。** 对一般阅读场景，先利用成熟 viewer 基础更符合当前需求；若产品转向超大地图、CAD 等重矢量专用阅读器，应重新评估选型。

验证应覆盖首屏、滚动长任务、缩放后恢复清晰的延迟和峰值内存，并统一文档、画质、DPR、缓存状态和显示正确性。此处描述的是后续验收范围，**本轮没有执行这些测试**。

## 来源索引

源码链接固定在 v6.3.289；问题／PR 链接包含原文及上下文。

- **[S01] 官方发布页**：https://github.com/mozilla/pdf.js/releases/tag/v6.3.289
- **[S02] API、worker 创建、Canvas 调用、取消和清理**：https://github.com/mozilla/pdf.js/blob/v6.3.289/src/display/api.js （参数约 L140–219；worker 约 L2233；清理约 L1840；取消约 L3304；Canvas 约 L3402–3457）
- **[S03] worker 的 GetOperatorList**：https://github.com/mozilla/pdf.js/blob/v6.3.289/src/core/worker.js#L890-L938
- **[S04] 浏览器图像解码／缩放路径**：https://github.com/mozilla/pdf.js/blob/v6.3.289/src/core/jpeg_stream.js ；https://github.com/mozilla/pdf.js/blob/v6.3.289/src/core/image_resizer.js
- **[S05] OffscreenCanvas 历史与边界**：https://github.com/mozilla/pdf.js/issues/10039#issuecomment-1094264553 ；https://github.com/mozilla/pdf.js/issues/10319
- **[S06] WASM 的实际用途和加载**：https://github.com/mozilla/pdf.js/blob/v6.3.289/src/core/jpx.js ；https://github.com/mozilla/pdf.js/blob/v6.3.289/src/core/jbig2_ccittFax.js ；https://github.com/mozilla/pdf.js/blob/v6.3.289/src/core/icc_colorspace.js ；https://github.com/mozilla/pdf.js/blob/v6.3.289/src/core/function.js#L350-L367 ；https://github.com/mozilla/pdf.js/blob/v6.3.289/src/core/wasm_image.js
- **[S07] JBIG2 WASM 与后续回退实现**：https://github.com/mozilla/pdf.js/pull/20546 ；https://github.com/mozilla/pdf.js/pull/21139
- **[S08] 重矢量单例及维护者诊断／计数纠正**：https://github.com/mozilla/pdf.js/issues/14652 ；https://github.com/mozilla/pdf.js/issues/14652#issuecomment-1062946046 ；https://github.com/mozilla/pdf.js/issues/14652#issuecomment-1064936685
- **[S09] 官方 FAQ：画布内存、可见页、慢 PDF、Range**：https://github.com/mozilla/pdf.js/wiki/Frequently-Asked-Questions （`allthepages`、`optimize`、`range` 小节）
- **[S10] 软遮罩优化**：https://github.com/mozilla/pdf.js/pull/21235
- **[S11] viewer 布局、缓存、页视图建立和参数**：https://github.com/mozilla/pdf.js/blob/v6.3.289/web/pdf_viewer.js （约 L122–145、L160–224、L1089–1128、L1990、L2094）
- **[S12] 注释读取回归与当前实现**：https://github.com/mozilla/pdf.js/issues/21442 ；https://github.com/mozilla/pdf.js/issues/21442#issuecomment-4763127994 ；https://github.com/mozilla/pdf.js/blob/v6.3.289/src/core/document.js#L745-L799
- **[S13] Canvas 时间片和操作过滤**：https://github.com/mozilla/pdf.js/blob/v6.3.289/src/display/canvas.js#L61-L65 ；https://github.com/mozilla/pdf.js/blob/v6.3.289/src/display/canvas.js#L662-L751
- **[S14] 时间片与可见页／取消的权衡**：https://github.com/mozilla/pdf.js/issues/17485
- **[S15] 渲染优先队列**：https://github.com/mozilla/pdf.js/blob/v6.3.289/web/pdf_rendering_queue.js#L120-L243
- **[S16] 缓存释放与 GC 的边界**：https://github.com/mozilla/pdf.js/issues/16647#issuecomment-1623595224
- **[S17] 局部高清、包围盒过滤及默认开关**：https://github.com/mozilla/pdf.js/blob/v6.3.289/web/pdf_page_detail_view.js ；https://github.com/mozilla/pdf.js/blob/v6.3.289/web/app_options.js#L355-L362 ；https://github.com/mozilla/pdf.js/blob/v6.3.289/web/app_options.js#L429-L436 ；https://github.com/mozilla/pdf.js/pull/19128
- **[S18] 多瓦片长期问题**：https://github.com/mozilla/pdf.js/issues/6419
- **[S19] 页面缩放更新逻辑**：https://github.com/mozilla/pdf.js/blob/v6.3.289/web/pdf_page_view.js#L766-L877
- **[S20] 大画布提交优化及当前实现**：https://github.com/mozilla/pdf.js/pull/19856 ；https://github.com/mozilla/pdf.js/blob/v6.3.289/web/base_pdf_page_view.js#L112-L155
- **[S21] 横向布局 CSS**：https://github.com/mozilla/pdf.js/blob/v6.3.289/web/pdf_viewer.css#L223-L255
- **[S22] 官方基准方法**：https://github.com/mozilla/pdf.js/wiki/Benchmarking-your-changes
- **[S23] Firefox Talos pdfpaint 指标定义**：https://firefox-source-docs.mozilla.org/testing/perfdocs/talos.html#pdfpaint
- **[S24] 绘制区域跟踪及早期局部渲染实验**：https://github.com/mozilla/pdf.js/pull/19043
- **[S25] Electron PDF 查看器与构建**：https://www.electronjs.org/blog/electron-9-0 ；https://github.com/electron/electron/blob/main/BUILD.gn
- **[S26] PDFium 嵌入边界与公开 API**：https://pdfium.googlesource.com/pdfium/+/refs/heads/main/README.md ；https://pdfium.googlesource.com/pdfium/+/refs/heads/main/public/fpdfview.h
- **[S27] Electron 离屏渲染与打印接口**：https://www.electronjs.org/docs/latest/tutorial/offscreen-rendering ；https://www.electronjs.org/docs/latest/api/web-contents#contentsprinttopdfoptions
- **[S28] PDFium WASM 候选及稳定线**：https://github.com/embedpdf/embed-pdf-viewer ；https://github.com/embedpdf/embed-pdf-viewer/blob/v2/packages/engines/README.md ；https://github.com/hyzyla/pdfium
- **[S29] PDFium 第三方预编译与 Rust 绑定**：https://github.com/bblanchon/pdfium-binaries ；https://github.com/ajrcarey/pdfium-render
- **[S30] MuPDF 官方 JS／WASM 包及授权原文**：https://github.com/ArtifexSoftware/mupdf.js ；https://github.com/ArtifexSoftware/mupdf/blob/master/README
- **[S31] 引擎文字／链接接口及 PDF.js 搜索层**：https://pdfium.googlesource.com/pdfium/+/refs/heads/main/public/fpdf_text.h ；https://pdfium.googlesource.com/pdfium/+/refs/heads/main/public/fpdf_doc.h ；https://github.com/ArtifexSoftware/mupdf/blob/master/include/mupdf/fitz/structured-text.h ；https://github.com/mozilla/pdf.js/blob/v6.3.289/web/pdf_find_controller.js
- **[S32] 原生模块、ABI、打包与 Chromium PDF 沙箱**：https://www.electronjs.org/docs/latest/tutorial/using-native-node-modules ；https://nodejs.org/api/n-api.html#implications-of-abi-stability ；https://www.electronjs.org/docs/latest/tutorial/asar-archives ；https://chromium.googlesource.com/chromium/src/+/main/pdf/README.md
- **[S33] PDF.js 与 PDFium 官方许可证**：https://github.com/mozilla/pdf.js/blob/v6.3.289/LICENSE ；https://pdfium.googlesource.com/pdfium/+/refs/heads/main/LICENSE
- **[S34] PyMuPDF 基准方法与比较范围**：https://pymupdf.readthedocs.io/en/latest/app4.html
