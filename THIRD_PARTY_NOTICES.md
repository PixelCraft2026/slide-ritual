# Third-party notices / 第三方说明

The project [MIT license](LICENSE) covers original code and documentation. The items below retain their own rights and terms, including copies embedded in `darkroom.html` or shown in `preview.JPG`.

项目 [MIT 许可证](LICENSE)适用于原创代码与文档。以下依赖与素材保留各自的权利和条款，包括 `darkroom.html` 中内嵌的副本及 `preview.JPG` 中展示的素材。

## Three.js

`vendor/three.module.js` bundles Three.js r160, copyright 2010–2023 Three.js authors, under the [MIT license](vendor/LICENSE-three). Preserve its copyright and license notices when redistributing.

Three.js r160 采用 [MIT 许可](vendor/LICENSE-three)，再次分发时须保留其版权与许可声明。

## Mediabunny

`video-export.js` includes the MP4 writing and WebCodecs integration portions of Mediabunny 1.61.3, copyright Vanilagy, under [MPL-2.0](vendor/LICENSE-mediabunny). Its source is available at <https://github.com/Vanilagy/mediabunny/tree/v1.61.3>. The pinned npm dependency and `tools/build-video-export.mjs` reproduce this bundle. Mediabunny is loaded only when video export is opened; no software video encoder is bundled.

视频导出组件包含 Mediabunny 1.61.3 的 MP4 封装及 WebCodecs 集成，保留 MPL-2.0 许可。导出组件按需加载，不包含大型软件编码器。

## Example photographs / 示例照片

The demo photographs were supplied by the repository maintainer on 7 October 2026. They are excluded from the project's MIT license. Rights remain with their respective owners; this repository does not specify a separate reuse license for these photographs.

示例照片由仓库维护者于 2026 年 10 月 7 日提供，不属于项目的 MIT 许可范围。权利归各照片的权利人所有；仓库未为这些照片指定单独的再利用许可。

| File | Demo title |
| --- | --- |
| `assets/ice lake.jpg` | Ice Lake / 冰湖 |
| `assets/fish lantern.jpg` | Fish Lanterns / 鱼灯 |
| `assets/observatory.jpg` | Observatory / 天文台 |

## Slide-change recording / 过片录音

`assets/advance.mp3` and `assets/advance-startup.mp3` were extracted from the latest recording supplied on 7 October 2026. A single mechanical cycle is trimmed and fitted to the regular and opening slide-change timings while preserving pitch. They are excluded from the project's MIT license. Rights remain with the recording's owner; this repository does not specify a separate reuse license for that recording.

`assets/advance.mp3`、`assets/advance-startup.mp3` 截取自 2026 年 10 月 7 日最后提供的录音，采用单次机械动作，保持音高并分别适配普通与开场过片时长。不属于项目的 MIT 许可范围。权利归录音的权利人所有；仓库未为该录音指定单独的再利用许可。

`assets/fan.mp3` is the compressed playback copy of the fan sound synthesized by the project's `tools/prepare-fan.py`. The current repository contains only these three MP3 playback files, also embedded in the offline viewer.

`assets/fan.mp3` 是项目 `tools/prepare-fan.py` 合成风扇声的压缩播放副本。仓库当前只保留以上三份 MP3 播放文件，离线版也内嵌这三份音频。
