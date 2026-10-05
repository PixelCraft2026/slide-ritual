`highlights.hdr` 是 `tools/create-fixtures.mjs` 生成的确定性 RGBE 渐变，用于检查大于 1 的线性值与 RLE 解码；`broken.hdr`、`unsupported.heic` 是失败处理测试用的无效文件。

`gradient-pq.avif` 是 Chromium 开发者 HDR 示例中的 PQ 渐变。原始来源：[ccameron-chromium/webgl-examples](https://github.com/ccameron-chromium/webgl-examples/blob/master/gradient-pq.avif)。仅用于本项目的解码检查，不嵌入交付页面。本地历史检查在 SDR 环境完成，其报告 `qa/avif-report.json` 不包含在公开仓库中；检测到的 HDR 元数据不会被当作实体 HDR 显示的验证。
