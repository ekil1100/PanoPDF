---
name: PanoPDF
description: 把 PDF 铺开读。
colors:
  surface: '#ffffff'
  surface-subtle: '#f6f7f8'
  canvas: '#e3e5e8'
  reader-canvas: '#e7e9ed'
  text: '#242830'
  text-muted: '#5b626d'
  text-disabled: '#747b84'
  border: '#c9cdd3'
  border-subtle: '#dfe2e6'
  accent: '#272b33'
  accent-hover: '#1d2026'
  accent-pressed: '#14171c'
  accent-soft: '#e8e9ec'
  on-accent: '#ffffff'
  hover: '#eceef1'
  pressed: '#dce0e5'
  error: '#a32929'
  error-surface: '#fff1ef'
  backdrop: 'rgb(24 30 39 / 36%)'
  focus: '#454b57'
  reader-focus: '#454b57'
  selection: '#d2d5db'
typography:
  headline:
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif'
    fontSize: 24px
    fontWeight: 650
    lineHeight: 1.3
  title:
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif'
    fontSize: 16px
    fontWeight: 600
    lineHeight: 1.5
  subtitle:
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif'
    fontSize: 15px
    fontWeight: 400
    lineHeight: 1.5
  body:
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif'
    fontSize: 13px
    fontWeight: 400
    lineHeight: 1.5
  label:
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif'
    fontSize: 13px
    fontWeight: 550
    lineHeight: 1.5
  caption:
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif'
    fontSize: 12px
    fontWeight: 400
    lineHeight: 1.5
rounded:
  control: 4px
  dialog: 8px
spacing:
  space-1: 4px
  space-2: 8px
  space-3: 12px
  space-4: 16px
  space-6: 24px
  space-8: 32px
components:
  button-primary:
    backgroundColor: '{colors.accent}'
    textColor: '{colors.on-accent}'
    typography: '{typography.body}'
    rounded: '{rounded.control}'
    padding: 4px 12px
  button-primary-hover:
    backgroundColor: '{colors.accent-hover}'
  button-primary-active:
    backgroundColor: '{colors.accent-pressed}'
  button-secondary:
    backgroundColor: '{colors.surface}'
    textColor: '{colors.text}'
    typography: '{typography.body}'
    rounded: '{rounded.control}'
    padding: 4px 12px
  button-icon:
    backgroundColor: transparent
    textColor: '{colors.text}'
    rounded: '{rounded.control}'
    padding: 6px
    width: 32px
    height: 32px
  control-disabled:
    backgroundColor: '{colors.surface-subtle}'
    textColor: '{colors.text-disabled}'
  input:
    backgroundColor: '{colors.surface}'
    textColor: '{colors.text}'
    typography: '{typography.body}'
    rounded: '{rounded.control}'
    padding: 4px 8px
    height: 32px
  navigation-selected:
    backgroundColor: '{colors.accent-soft}'
    textColor: '{colors.accent}'
    rounded: '{rounded.control}'
    padding: 4px 12px
  password-dialog:
    backgroundColor: '{colors.surface}'
    textColor: '{colors.text}'
    rounded: '{rounded.dialog}'
    padding: 24px
  pdf-page:
    backgroundColor: '{colors.surface}'
---

# Design System: PanoPDF

## Overview

**Creative North Star: "把 PDF 铺开读。"**

PanoPDF 的界面是阅读工具，不是展示页面。用户已批准紧凑工具栏、可收起导航、浅灰阅读背景与系统字体；设计用清楚的分组、稳定的控件尺寸和少量石墨黑强调支持阅读，不另创品牌主题。

默认平坦、紧凑、少装饰。白色工具面与灰色阅读底区分操作和内容，PDF 保留自身排版。系统字体随桌面平台变化，不追求不同操作系统逐像素一致。

**Key Characteristics:**

- 内容优先，工具占据有限空间。
- 白色工具面、冷中性浅灰底、单一石墨黑操作强调。
- 系统字体、小圆角、明确焦点与错误提示。
- 桌面窗口可收缩，工具栏按分组换行。

本文件记录已实现系统，不提出新方向。来源为 `tokens.css`、`src/style.css`、`src/reader.css`、`src/app.tsx` 与 `src/components/`；审查记录及限制见 `docs/verification.md`，阅读窗口的具体策略留在 `docs/reader-surface.md`。基础 token 由本文 frontmatter 记录；阴影、断点与组件样例放在 `.impeccable/design.json`，不加载进应用。

## Colors

配色以中性工具面为主，石墨黑只负责操作和定位，不扩展成多套主题。

### Primary

- **石墨黑**（`accent`）：打开等主要按钮、选中导航文字。
- **交互深灰**（`accent-hover`、`accent-pressed`）：主要按钮悬停和按下反馈。
- **浅灰选中面**（`accent-soft`）：选中的导航按钮／标签，以及拖入提示。
- **焦点与选区**（`focus`、`selection`）：外壳键盘焦点、文本选区；PDF 阅读区另有 `reader-focus`，记录实际差异而不擅自统一。
- **反白文字**（`on-accent`）：主要按钮文字。

### Neutral

- **白色工具面**（`surface`）：工具栏、侧栏、表单、弹窗；白色也用于 PDF 页面底。
- **浅灰辅助面**（`surface-subtle`）：状态栏与不可用控件。
- **空态灰底**（`canvas`）与**阅读灰底**（`reader-canvas`）：前者来自共享 token，后者是 `src/reader.css` 的已实现覆盖值；两者不可误记成同一个色值。
- **深灰／次要灰／禁用灰**（`text`、`text-muted`、`text-disabled`）：依次用于正文、辅助说明及不可用状态。
- **分界灰**（`border`、`border-subtle`）：控件外框和结构分隔，不靠阴影包裹所有面板。
- **交互灰面**（`hover`、`pressed`）：普通按钮和控件的鼠标反馈。
- **遮罩灰**（`backdrop`）：密码弹窗后方的半透明遮罩，不是模糊玻璃。

错误使用 `error` 和 `error-surface`，是语义状态，不是第二品牌色。PDF.js 的搜索匹配高亮由阅读引擎管理，不改成全局品牌强调色。

**The 单一强调 Rule.** 新增外壳控件复用石墨黑及中性色，不因为功能增加而发明新的主题色。

Sidecar 中的八阶色带仅用于设计面板色样预览，按现有颜色合成；不表示应用已经使用这些阶梯色，也不替代 frontmatter 的规范值。

## Typography

统一使用 frontmatter 记录的系统字体栈，没有自托管展示字体或独立等宽字体。PDF 内容的字体属于文档本身，不能被外壳排版覆盖。

| 角色       | 用途                                                              |
| ---------- | ----------------------------------------------------------------- |
| `headline` | 保留的标题 token（24px，650，行高 1.3）；欢迎页不显示产品名标题。 |
| `title`    | 密码弹窗、加载与错误标题（16px，600）。                           |
| `body`     | 控件和普通说明（13px，400）。                                     |
| `label`    | 文件名及字段标签（13px，550）。                                   |
| `caption`  | 底栏、隐私说明、最近文件页码（12px）。                            |

欢迎页不显示标语及说明段落；最近打开的小标题为 13px、600。页码、缩放和结果计数使用等宽数字（`tabular-nums`），不引入等宽字体。没有自定义字距。说明文字按容器自然换行；错误说明最多 56ch，长文件名使用省略号。此处不是长文页面，不套用文章正文的固定行长。

**The 外壳与文档分离 Rule.** 外壳字号和字体只管理应用 UI；PDF 的文字层、页面和链接由阅读引擎保留自身规则。

## Layout

- 全窗口以弹性阅读工作区为主；工具栏悬浮于阅读区右上角，以扣除侧栏后的阅读区宽度为边界，按控件组换行，始终避开侧栏。阅读进度悬浮于右下角。两者默认隐藏，悬停或键盘聚焦时显示，不占工作区布局空间。工具栏隐藏时不参与鼠标命中；阅读区检测工具栏范围内的指针移动后即时显示，拖动选择文字时不触发悬停显示。键盘焦点在工具栏内或下拉菜单展开时保持显示。空白／欢迎状态隐藏整个悬浮工具栏与阅读进度。
- 应用 CSS 最小宽度为 640px，这是实现约束，不代表本轮已验证该尺寸。本次工具栏回归使用合成 PDF，覆盖 800、849、850、851、1440px 宽 Electron 客户区的侧栏开关和工具栏显隐；不发布移动端。
- macOS 保留系统窗口圆角，使用 shadcn-solid Button 绘制 12px 圆形红黄绿控件，Electron 执行关闭、最小化与全屏操作（Option + 绿色切换最大化）；标题栏背景和文字由应用绘制，高 32px，背景为阅读区同色 `#e7e9ed`，支持拖动，全屏隐藏；欢迎页隐藏标题文字，保留窗口控制与拖动区域。其他桌面平台保留系统默认标题栏。悬浮工具栏位于阅读区右上角。阅读滚动区域左右内缩为 0px，纸张在滚动区域内裁剪；阅读面不绘制整圈焦点边框，控件和 PDF 链接保留焦点提示。工具栏不包含“文件”按钮。悬浮工具栏内边距为 8px，控件组内间距 4px，常规组间横向间距 8px。
- 普通控件最小高 32px，图标按钮为 32px 方形；空态打开按钮最小高 40px。状态栏最小高 28px。
- 侧栏宽 260px，独立滚动；阅读区弹性填充且可双向滚动。PDF 页间距与内边距均为 16px。
- 横向页面保持一行，各自按视口高度居中；高于视口的页面从上方开始并允许滚动。纵向使用按每行页数配置的网格，不强行将所有页压进视口。
- 空态内容最大宽 400px，仅保留 Logo、最小高 152px 的无边框拖入区、带快捷键键帽的打开按钮和最近文件；居中容器可滚动；错误／加载状态采用相同的简洁中心布局。
- ≤1100px：侧栏缩为 232px，缩放菜单由 156px 缩为 144px，工具栏组间距收紧。
- ≤850px：隐藏工具栏组间分隔线，布局组另起一行；空态外边空间减至 24px。保持控件尺寸与主要操作可用。

间距采用 frontmatter 的 4px 基础阶梯；源码另有 20px 等局部值，不能宣称所有尺寸严格落在同一阶梯。

## Elevation & Depth

工具栏、侧栏、表单靠白色面和细分界线组织，不加悬浮卡片阴影。唯一自定义页面阴影是 PDF 白纸的轻柔投影（`0 1px 4px rgb(20 30 45 / 18%)`），页面本身无边框；密码弹窗靠遮罩与细边框建立层级，没有额外投影或背景模糊。

**The 平坦工具面 Rule.** 不把工具组、搜索区和空态包装成悬浮卡片；阴影用于分离 PDF 纸页与阅读底。

默认没有装饰性动画或转场。滚动使用 `auto`，不启用 CSS scroll snap；减少动态效果偏好会关闭动画和转场。不补造尚不存在的 easing 或 duration token。

## 品牌标志

采用正视 P 形 Logo 与圆角方形底板，底板外透明。默认使用白底石墨黑版，源文件为 `assets/brand/panopdf-logo-white-tile.png`；石墨黑底白色版保存为 `assets/brand/panopdf-logo-graphite-tile.png`。欢迎页在无边框拖入区上方显示 96px 白底轻阴影图像，桌面应用图标同样使用白底轻阴影版；浏览器页签使用独立的无阴影 `assets/icons/favicon.png`。轻阴影源图分别在原文件名后增加 `-shadow`，无阴影原图保留。`assets/icons/` 保存默认版的 PNG、ICO 与 ICNS 图标，`assets/icons/dark/` 保存主色底版本的对应格式。桌面打包配置显式引用默认版文件。资源说明与切换位置见 [Logo 资源说明](assets/brand/README.md)。

## Shapes

控件小圆角（`control`），密码弹窗稍大圆角（`dialog`）；PDF 页面是直角纸面。普通输入与选择器使用 1px 边框，图标按钮以透明边框保留占位。导航选中态是浅灰色面，不用粗色条。

界面没有胶囊标签、业务卡片或插画容器。欢迎页拖入区域无边框，仅在拖入时高亮背景；阅读中的全区域拖入提示保留虚线框。

## Components

### 按钮与图标

主要按钮用石墨黑底和反白文字；普通按钮用白底和细框；文本／图标按钮使用无可见边框的轻量外观。通用按钮内边距 4px 12px，空态主要按钮横向内边距扩大到 16px。图标为 18px 的一致线性矢量几何，不使用 emoji 替代图标。

所有可用按钮有悬停与按下色；不可用控件使用禁用文字和辅助灰面，图标透明度降为 0.65。焦点描边为 2px，通常外偏移 2px。原生 `title` 承担短提示，没有自定义 tooltip 组件。

### 标题栏与文件操作

标题栏是窗口拖动区域，窗口按钮使用非拖动区域；关闭文档与关闭窗口是不同操作。

文件操作使用系统菜单和快捷键：⌘O／Ctrl+O 打开文档，⌘W／Ctrl+W 关闭文档。欢迎页统一提供无边框拖入区、打开按钮和最近文件，不显示产品名、标语、隐私说明或首次阅读引导。按钮内通过 TanStack Hotkeys 的 `formatForDisplay` 格式化 `Mod+O`，并用 Solid 版 Kbd 展示按键。原有系统菜单及键盘事件处理继续负责执行，格式化工具不另行注册快捷键。拖入文件时原位高亮拖入区背景，阅读中继续使用全区域拖入提示。

### 输入与选择器

输入高 32px，内边距 4px 8px；页码和缩放居中并使用等宽数字。页码输入宽 48px、缩放输入宽 64px。搜索输入铺满侧栏内容宽度，placeholder 使用次要文字色，光标使用石墨黑。

输入和选择器聚焦时描边偏移为 0；错误使用错误边框及文字说明，不能只变颜色。密码截图可见错误边框与石墨灰焦点同时存在。选择器采用 Kobalte 自定义菜单与向下箭头图标，菜单通过 Portal 展示，保留键盘导航与关闭后的焦点恢复。

### 导航与列表

目录和搜索共用可收起侧栏。标签选中时浅灰底、石墨黑文字；源码提供 tab 语义、选中状态及方向键处理。目录子级缩进 16px，长章节名允许换行；没有目录时解释如何改用页码或搜索。最近文件是分隔线列表，不是卡片网格。

### 组件实现

按钮、输入框、Select 下拉选择器、Tabs 导航、Alert 提示、Progress 进度、Label 标签、分隔线与密码弹窗采用本地 shadcn-solid 源码组件。欢迎页另用本地 Solid 组件实现 shadcn 的 Empty 和 Kbd 组合模式。Kobalte 管理选择器、Tabs 与弹窗的焦点、键盘及可访问性行为。Select 打开时保持悬浮工具栏可见，关闭后恢复焦点；自定义缩放项转到缩放输入框。Tabs 保留未选中面板的 DOM 和搜索草稿。加载进度使用不确定状态，不显示虚构百分比，并遵循减少动态效果设置。Tailwind CSS 4 使用 `ui:` 前缀和 `--ui-*` 主题变量，主题配置位于 `src/ui.css`，通过 Vite 插件构建且不导入 Preflight；控件重置仅作用于显式标记的 `.ui-base`，PDF.js 页面保持自己的样式。页码、缩放与列数仍通过现有草稿逻辑提交，保留输入法组合输入行为。

### 阅读面与状态栏

PDF 页面在灰色滚动面上连续排列；不限制横向同屏页数。缩放菜单中的“容纳 N 页”描述计算比例，不承诺滚动位置变化后总能看到 N 张完整页面。右下角悬浮状态栏仅以弱化文字显示“第 48 / 421 页 · 81%”格式的阅读进度；操作状态保留给屏幕阅读器播报。

文本层选区、匹配高亮及滚动条保留阅读引擎／操作系统实现；本系统没有自定义滚动条皮肤。阅读滚动面聚焦时不绘制整圈描边，PDF 链接保留独立焦点提示。

### 密码与反馈

密码使用原生模态 `dialog`，宽度为 `min(400px, calc(100vw - 48px))`，内边距 24px；标题、说明、标签、输入、错误提示和右对齐操作依次排列。取消为普通按钮，打开为主要按钮。弹窗由真实的解锁任务触发，不用于普通导航。

已有空态、加载进度、打开失败、提示条、密码错误、搜索无结果和拖入提示；文案说明问题及恢复动作。浏览器预览最近文件列表标记为“本次会话”，不能误标为桌面持久化。焦点恢复、菜单键盘操作、窗口控制与启动恢复由 Playwright Electron 测试覆盖；真实标题栏拖动和 Windows／Linux 原生窗口行为仍需实机确认。

Sidecar 的组件样例仅展示已有主要／普通／图标按钮、输入、导航和 PDF 页面，不模拟完整阅读器或新增功能。

## Do's and Don'ts

### Do:

- **Do** 保持系统字体、紧凑控件与分组换行，让 PDF 保持主要空间。
- **Do** 复用已有颜色、焦点及错误状态；明确区分外壳和 PDF 引擎样式。
- **Do** 同时记录空态灰底与阅读灰底的真实差异，不把文档当作静默重构。
- **Do** 保留窄桌面窗口的主要操作，必要时换行并收起导航。

### Don't:

- **Don't** 加入未经批准的深色主题、展示字体、渐变、玻璃或装饰动画。
- **Don't** 将工具组变成营销卡片，或用假文档、假指标填充空态。
- **Don't** 用应用字体覆盖 PDF 内容，或以固定同屏页数替代自由缩放。
- **Don't** 将内部方向合同、seed 或审查元数据加入浏览器产物。
