# PanoPDF Logo

正式图标保留正视 P 字形，使用圆角方形底板，底板外透明。

| 版本               | 源文件                                  | 桌面图标                            |
| ------------------ | --------------------------------------- | ----------------------------------- |
| 白底石墨黑（默认） | `panopdf-logo-white-tile-shadow.png`    | `../icons/icon.{png,ico,icns}`      |
| 石墨黑底白色       | `panopdf-logo-graphite-tile-shadow.png` | `../icons/dark/icon.{png,ico,icns}` |

PNG 桌面图标为 1024 × 1024；ICO 包含 16、32、128、256px；ICNS 包含标准及高分辨率尺寸。默认版与主色底版的正式源图及导出图标均纳入版本控制。生成 ICNS 所用的中间 PNG 保存在本地 `build/icons/icon.iconset/` 和 `build/icons/dark/icon.iconset/`，由 Git 忽略。

默认白底轻阴影版已接入欢迎页、桌面窗口、macOS 开发版 Dock 和三平台打包配置。浏览器页签单独使用 `assets/icons/favicon.png`，由白底无阴影源图缩放生成。

两份轻阴影资源为：`panopdf-logo-white-tile-shadow.png` 和 `panopdf-logo-graphite-tile-shadow.png`。它们由本地 CoreGraphics 在原图底板外添加投影，不重新生成字形；以 1024px 画布计，阴影向下偏移 5px、模糊 10px、不透明度 18%。两份无阴影源图仍保留，供小尺寸图标和其他平面场景使用。本地 `drafts/panopdf-logo-shadow-comparison.png` 左列为原图、右列为轻阴影版，上行为白底、下行为主色底。

如需改用主色底版，需要同步更新：

- `src/components/empty-state.tsx` 中的图片路径。
- `index.html` 中的页签图标路径。
- `electron/main.cjs` 中的 `iconPath`。
- `package.json` 中的三个平台 `icon` 路径及 `build.files` 的 PNG 路径。

早期设计稿和阴影对比图保留在本地 `drafts/`，由 Git 忽略。源图由内置 imagegen 生成，提示词要点为保留 P 字形、圆角底板、白底石墨黑与石墨黑底白色两种配色；桌面格式由源图缩放与封装得到。
