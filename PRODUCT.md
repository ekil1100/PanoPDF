# PanoPDF

<!-- impeccable:product-schema 1 -->

## Platform

web

界面运行于 Electron 桌面窗口，发布目标为 macOS、Windows、Linux；不是托管网站。

## Stack

用户已确认 Electron + PDF.js，并使用 Bun 管理依赖和项目脚本。首版采用 TypeScript 与 Vite 构建，不引入额外前端框架。Electron 运行时保持不变。

## Product Purpose

全景 PDF 阅读器：把 PDF 铺开读。横向连续页面与自由缩放让多页内容同屏呈现，同屏页数不是固定限制。

## Operating Context

用户打开本地 PDF，在桌面窗口阅读，可切换横向连续布局与可设置每行页数的纵向布局。

## Capabilities and Constraints

功能与首版边界以 [已确认需求](docs/requirements.md) 为准。包含文字选择与复制、全文搜索、文档目录、页码跳转及阅读位置恢复；不包含批注、编辑、多标签页。不承诺所有复杂文档均可即时高清。

## Brand Commitments

名称 PanoPDF，中文描述“全景 PDF 阅读器”，标语“把 PDF 铺开读。”用户已批准工具优先、少装饰的界面：顶部紧凑工具栏、可收起的目录／搜索侧栏、浅灰背景和系统字体；阅读区占据主要空间。

## Evidence on Hand

- `docs/requirements.md`：用户确认的首版范围。
- `docs/research/pdf-rendering-engines.md`：引擎调研与性能边界。
- Skim 与 Scrolex 为交互参考，不复用其品牌素材。

## Product Principles

- 阅读内容优先于界面装饰。
- 自由缩放和布局切换保留阅读上下文。
- 页面高度不足时居中，溢出时内容仍可访问。
- 本地文件无需上传，文件访问仅限用户明确选择。
