# Slide Ritual · 暗室

[English](README.md) · **简体中文**

一个以 **徕卡 Leica P150** 幻灯机为灵感的网页观片室。暖色灯光、机械过片与风扇低鸣，让照片在显示器上慢慢放映，重拾观看幻灯片的仪式感，并在兼容环境下支持 HDR。

**[进入在线观片室 →](https://pixelcraft2026.github.io/slide-ritual/)**

![Slide Ritual 使用界面：照片投映在暗室墙上，前景为虚拟幻灯机](preview.JPG)

## 主要功能

- 三维幻灯机、灯泡预热、片匣运动与机械过片录音。
- 随照片变化的墙面光、投影光束、浮尘与可调对焦。
- 照片在固定八边形光孔内连续移动，配合轻微的 GPU 运动模糊。
- 文件夹导入、自动放映、全屏观看与自动隐藏的控制栏，适配桌面及移动端浏览器。
- 支持 HDR，包括 Radiance `.hdr` / `.rgbe`；兼容 SDR 显示。
- 照片只在浏览器本地处理，不会上传。

## 开始观看

打开[在线版](https://pixelcraft2026.github.io/slide-ritual/)，点击 **文件夹** 导入照片，或点击 **先看示例**。支持简体中文与英文，默认跟随系统语言，也可在设置中切换。

移动触控设备的前景虚焦默认 **2.0**，桌面端默认 **4.0**。移动浏览器若不支持文件夹选择，可在设置中点击 **也可以选择单张照片**。

**← / →** 切换照片，**空格** 播放或暂停，**F** 全屏，**M** 声音开关，**P** 电源开关。

JPEG、PNG、WebP、AVIF 的支持取决于浏览器解码能力。HDR 输出需要兼容的显示器、系统设置与浏览器；其他环境使用 SDR。

兼容 WebGPU HDR 的浏览器中，Adobe gain map JPEG 使用重建的 HDR 预览实现运动模糊与入场时短暂增亮，随后恢复原生 HDR 原图。可在 **光照设置 → HDR 入场曝光** 调节 0 至 +2 EV，默认 +1 EV。其他原生 HDR 格式保留浏览器显示路径。

## 本地运行

下载仓库后，直接打开 `darkroom.html` 即可离线观片。安装 Node.js 后，也可以运行源码版：

```sh
npm start
```

然后访问 [localhost:8790](http://127.0.0.1:8790)，无需安装项目依赖。

## 开发

项目使用原生 HTML、CSS、JavaScript 与本地提供的 Three.js。执行 `npm test` 运行单元测试；修改源码后，执行 `node tools/build-standalone.mjs` 更新离线 HTML。推送到 `main` 会自动部署至 GitHub Pages。

技术细节见[实现说明](docs/IMPLEMENTATION_NOTES.zh-CN.md)。

## 许可

原创代码与文档采用 [MIT 许可证](LICENSE)。第三方依赖与素材保留各自的许可条款，见[第三方说明](THIRD_PARTY_NOTICES.md)。
