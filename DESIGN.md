---
name: PanoPDF
description: 把 PDF 铺开读。
colors:
  surface: "#ffffff"
  surface-subtle: "#f6f7f8"
  canvas: "#e3e5e8"
  reader-canvas: "#e7e9ed"
  text: "#242830"
  text-muted: "#5b626d"
  text-disabled: "#747b84"
  border: "#c9cdd3"
  border-subtle: "#dfe2e6"
  accent: "#195db3"
  accent-hover: "#124a92"
  accent-pressed: "#0d3975"
  accent-soft: "#e8f0fc"
  on-accent: "#ffffff"
  hover: "#eceef1"
  pressed: "#dce0e5"
  error: "#a32929"
  error-surface: "#fff1ef"
  backdrop: "rgb(24 30 39 / 36%)"
  focus: "#2469c0"
  reader-focus: "#165dca"
  selection: "#c3d9f6"
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
    backgroundColor: "{colors.accent}"
    textColor: "{colors.on-accent}"
    typography: "{typography.body}"
    rounded: "{rounded.control}"
    padding: 4px 12px
  button-primary-hover:
    backgroundColor: "{colors.accent-hover}"
  button-primary-active:
    backgroundColor: "{colors.accent-pressed}"
  button-secondary:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.text}"
    typography: "{typography.body}"
    rounded: "{rounded.control}"
    padding: 4px 12px
  button-icon:
    backgroundColor: transparent
    textColor: "{colors.text}"
    rounded: "{rounded.control}"
    padding: 6px
    width: 32px
    height: 32px
  control-disabled:
    backgroundColor: "{colors.surface-subtle}"
    textColor: "{colors.text-disabled}"
  input:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.text}"
    typography: "{typography.body}"
    rounded: "{rounded.control}"
    padding: 4px 8px
    height: 32px
  navigation-selected:
    backgroundColor: "{colors.accent-soft}"
    textColor: "{colors.accent}"
    rounded: "{rounded.control}"
    padding: 4px 12px
  password-dialog:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.text}"
    rounded: "{rounded.dialog}"
    padding: 24px
  pdf-page:
    backgroundColor: "{colors.surface}"
---

# Design System: PanoPDF

## Overview

**Creative North Star: "把 PDF 铺开读。"**

PanoPDF 的界面是阅读工具，不是展示页面。用户已批准紧凑工具栏、可收起导航、浅灰阅读背景与系统字体；设计用清楚的分组、稳定的控件尺寸和少量蓝色强调支持阅读，不另创品牌主题。

默认平坦、紧凑、少装饰。白色工具面与灰色阅读底区分操作和内容，PDF 保留自身排版。系统字体随桌面平台变化，不追求不同操作系统逐像素一致。

**Key Characteristics:**
- 内容优先，工具占据有限空间。
- 白色工具面、冷中性浅灰底、单一蓝色操作强调。
- 系统字体、小圆角、明确焦点与错误提示。
- 桌面窗口可收缩，工具栏按分组换行。

本文件记录已实现系统，不提出新方向。来源为 `tokens.css`、`src/style.css`、`src/reader.css`、`index.html` 与 `src/main.ts`；审查记录及限制见 `docs/verification.md`，阅读窗口的具体策略留在 `docs/reader-surface.md`。基础 token 由本文 frontmatter 记录；阴影、断点与组件样例放在 `.impeccable/design.json`，不加载进应用。

## Colors

配色以中性工具面为主，蓝色只负责操作和定位，不扩展成多套主题。

### Primary

- **操作蓝**（`accent`）：打开等主要按钮、选中导航文字。
- **交互深蓝**（`accent-hover`、`accent-pressed`）：主要按钮悬停和按下反馈。
- **浅蓝选中面**（`accent-soft`）：选中的导航按钮／标签，以及拖入提示。
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

**The 单一强调 Rule.** 新增外壳控件复用操作蓝及中性色，不因为功能增加而发明新的主题色。

Sidecar 中的八阶色带仅用于设计面板色样预览，按现有颜色合成；不表示应用已经使用这些阶梯色，也不替代 frontmatter 的规范值。

## Typography

统一使用 frontmatter 记录的系统字体栈，没有自托管展示字体或独立等宽字体。PDF 内容的字体属于文档本身，不能被外壳排版覆盖。

| 角色 | 用途 |
| --- | --- |
| `headline` | 空态产品名（24px，650，行高 1.3）。不是营销大标题。 |
| `title` | 密码弹窗、加载与错误标题（16px，600）。 |
| `body` | 控件和普通说明（13px，400）。 |
| `label` | 文件名及字段标签（13px，550）。 |
| `caption` | 底栏、隐私说明、最近文件页码（12px）。 |

空态标语单独使用 15px；最近打开的小标题为 13px、600。页码、缩放和结果计数使用等宽数字（`tabular-nums`），不引入等宽字体。没有自定义字距。说明文字按容器自然换行；错误说明最多 56ch，长文件名使用省略号。此处不是长文页面，不套用文章正文的固定行长。

**The 外壳与文档分离 Rule.** 外壳字号和字体只管理应用 UI；PDF 的文字层、页面和链接由阅读引擎保留自身规则。

## Layout

- 全窗口纵向结构：顶部文件行与工具栏、中间弹性工作区、底部状态栏；没有营销页最大宽度容器。
- 应用 CSS 最小宽度为 640px，这是实现约束，不代表本轮已验证该尺寸。审查覆盖 800、1440、1920px 宽桌面客户区，不发布移动端。
- 文件行高 44px，水平内边距 12px；工具栏内边距为 8px 12px，控件组内间距 4px，常规组间横向间距 8px。
- 普通控件最小高 32px，图标按钮为 32px 方形；空态打开按钮最小高 36px。状态栏最小高 28px。
- 侧栏宽 260px，独立滚动；阅读区弹性填充且可双向滚动。PDF 页间距与内边距均为 16px。
- 横向页面保持一行，各自按视口高度居中；高于视口的页面从上方开始并允许滚动。纵向使用按每行页数配置的网格，不强行将所有页压进视口。
- 空态内容最大宽 400px，居中容器可滚动；错误／加载状态采用相同的简洁中心布局。
- ≤1100px：侧栏缩为 232px，缩放菜单由 156px 缩为 144px，工具栏组间距收紧。
- ≤850px：隐藏工具栏组间分隔线，布局组另起一行，隐藏次要存储状态；空态外边空间减至 24px。不是缩小所有控件或隐藏主要操作。

间距采用 frontmatter 的 4px 基础阶梯；源码另有 20px 等局部值，不能宣称所有尺寸严格落在同一阶梯。

## Elevation & Depth

工具栏、侧栏、表单靠白色面和细分界线组织，不加悬浮卡片阴影。唯一自定义页面阴影是 PDF 白纸的轻柔投影（`0 1px 4px rgb(20 30 45 / 18%)`），页面本身无边框；密码弹窗靠遮罩与细边框建立层级，没有额外投影或背景模糊。

**The 平坦工具面 Rule.** 不把工具组、搜索区和空态包装成悬浮卡片；阴影用于分离 PDF 纸页与阅读底。

默认没有装饰性动画或转场。滚动使用 `auto`，不启用 CSS scroll snap；减少动态效果偏好会关闭动画和转场。不补造尚不存在的 easing 或 duration token。

## Shapes

控件小圆角（`control`），密码弹窗稍大圆角（`dialog`）；PDF 页面是直角纸面。普通输入与选择器使用 1px 边框，图标按钮以透明边框保留占位。导航选中态是浅蓝色面，不用粗色条。

界面没有胶囊标签、业务卡片或插画容器。拖入提示使用虚线框表达文件投放区域，不能推广成普通面板装饰。

## Components

### 按钮与图标

主要按钮用操作蓝底和反白文字；普通按钮用白底和细框；文本／图标按钮使用无可见边框的轻量外观。通用按钮内边距 4px 12px，空态主要按钮横向内边距扩大到 16px。图标为 18px 的一致线性矢量几何，不使用 emoji 替代图标。

所有可用按钮有悬停与按下色；不可用控件使用禁用文字和辅助灰面，图标透明度降为 0.65。焦点描边为 2px，通常外偏移 2px。原生 `title` 承担短提示，没有自定义 tooltip 组件。

### 输入与选择器

输入高 32px，内边距 4px 8px；页码和缩放居中并使用等宽数字。页码输入宽 48px、缩放输入宽 64px。搜索输入铺满侧栏内容宽度，placeholder 使用次要文字色，光标使用操作蓝。

输入和选择器聚焦时描边偏移为 0；错误使用错误边框及文字说明，不能只变颜色。密码截图可见错误边框与蓝色焦点同时存在。选择器保留系统下拉箭头，不绘制另一套菜单。

### 导航与列表

目录和搜索共用可收起侧栏。标签选中时浅蓝底、蓝字；源码提供 tab 语义、选中状态及方向键处理。目录子级缩进 16px，长章节名允许换行；没有目录时解释如何改用页码或搜索。最近文件是分隔线列表，不是卡片网格。

### 阅读面与状态栏

PDF 页面在灰色滚动面上连续排列；不限制横向同屏页数。缩放菜单中的“容纳 N 页”描述计算比例，不承诺滚动位置变化后总能看到 N 张完整页面。状态栏以弱化文字显示当前页、比例和操作状态，窄窗口优先保留页码／比例。

文本层选区、匹配高亮及滚动条保留阅读引擎／操作系统实现；本系统没有自定义滚动条皮肤。阅读区焦点为独立的 2px 蓝色描边，内偏移 2px。

### 密码与反馈

密码使用原生模态 `dialog`，宽度为 `min(400px, calc(100vw - 48px))`，内边距 24px；标题、说明、标签、输入、错误提示和右对齐操作依次排列。取消为普通按钮，打开为主要按钮。弹窗由真实的解锁任务触发，不用于普通导航。

已有空态、加载进度、打开失败、提示条、密码错误、搜索无结果和拖入提示；文案说明问题及恢复动作。浏览器预览明确标记仅本次会话，不能误标为桌面持久化。源码包含焦点恢复、禁用与快捷键路径，但本次文档工作没有重新运行这些行为。

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
