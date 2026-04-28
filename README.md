# PPT 社媒拼图模板设计器

一个本地运行的 PPT 社媒拼图模板编辑器。它只负责定义模板和导出模板包，不负责完整 PPT 转图或社媒发布。

## 本机启动

```bash
npm install
npm run dev
```

## 另一台电脑迁移

```bash
git clone <repo-url>
cd ppt-social-template-studio
npm install
npm run dev
```

模板迁移使用 ZIP：

```text
template-name.zip
  template.json
  assets/
```

导出的 `template.json` 不会包含 `/Users/admin/...` 这类本机绝对路径。

## 关键命令

```bash
npm run test
npm run build
npm run smoke:render
```

`npm run smoke:render` 会读取 `templates/sample-template.json`，用占位 PPT 页面生成 `output/golden-smoke.png`。这是模板合同的第一道验证。

## V1 能力

- 画布比例：`9:16`、`3:4`、`1:1`
- PPT 框默认 `16:9`，锁比例缩放
- 固定页码绑定
- 背景颜色、上传背景图、blur、opacity、overlay
- 框 opacity、feather、blend mode、radius、shadow、border
- 单张画布起步，支持复制和批量创建
- JSON / ZIP 导入导出
