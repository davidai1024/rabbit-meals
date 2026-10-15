# 图形素材说明

本开源版本的 `miniprogram/assets/*.svg`、`docs/images/cover.svg`、`features.svg` 与 `workflow.svg` 由 `scripts/generate-artwork.py` 使用基础几何图形和文字绘制，按仓库根目录的 MIT License 提供。

- 不包含原项目中的菜品照片或旧版卡通位图，也没有嵌入外部图片、第三方图标包或字体文件。
- 菜品封面是演示插画，用于展示功能，并非实拍照片、烹饪结果承诺或原菜谱照片。
- 功能图和流程图是文档示意，不是真机截图。实际微信界面、授权及通知效果需要在自行配置的环境验证。
- 中文文字使用操作系统字体回退；仓库不分发字体。

`asset-map.json` 仅记录旧位图引用到本版本原创 SVG 的迁移关系，不提供原位图下载，也不代表授予原位图任何使用许可。

重新生成：

```sh
python3 scripts/generate-artwork.py
```
