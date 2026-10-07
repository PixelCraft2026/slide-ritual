# Slide Ritual

**English** · [简体中文](README.zh-CN.md)

A browser-based photo viewer inspired by the **Leica P150** slide projector. Warm light, mechanical slide changes, and a quiet fan bring the ritual of a slide show to your monitor, with HDR on compatible displays and browsers.

**[Open Slide Ritual →](https://pixelcraft2026.github.io/slide-ritual/)**

![Slide Ritual: Ice Lake projected on the wall above the virtual slide projector](preview.JPG)

## Features

- A 3D projector with lamp warmup, an animated slide magazine, and recorded slide-change sound.
- Photo-responsive wall lighting, a subtle light beam, floating dust, and adjustable focus.
- Continuous slide motion within a fixed octagonal aperture, with dense GPU motion blur along the known transport path.
- Folder import, automatic playback, fullscreen, and mobile layouts, with controls that hide while you watch.
- HDR support, including Radiance `.hdr` / `.rgbe`, with SDR fallback.
- Local photo processing: imported photographs stay in your browser and are never uploaded.
- Complete darkroom video export: SDR MP4, 1080P / 4K, 30 / 60 fps, in landscape 16:9 or portrait 9:16, with optional mechanical sounds and fan ambience.

## Start watching

Open the [online viewer](https://pixelcraft2026.github.io/slide-ritual/), choose **Folder**, or click **Try the demo**. English and Simplified Chinese follow your system language; you can switch languages in settings.

The demo opens with **Ice Lake**, followed by **Fish Lanterns** and **Observatory**.

Foreground blur defaults to **2.0 on touch devices** and **4.0 on desktop**. If your mobile browser does not support folder selection, open settings and choose **Or choose individual photos**.

Use **← / →** to change photographs, **Space** to play or pause, **F** for fullscreen, **M** for sound, and **P** for power.

JPEG, PNG, WebP, and AVIF support depends on browser decoding. HDR output requires a compatible display, system settings, and browser; otherwise, the viewer uses SDR.

On compatible WebGPU HDR browsers, Adobe gain-map JPEGs use a reconstructed HDR preview for motion blur and a brief entry brightening, then return to the original native HDR image. **Lighting → HDR entry exposure** adjusts the effect from 0 to +2 EV (default +1 EV). Other native HDR formats retain browser rendering.

Live photo motion uses the same linear-light trajectory gathering method as video export, with a 1/120-second shutter on the 60 Hz effect clock and 16–128 samples chosen by displacement. Stationary photos bypass gathering. The existing compositor translation and floating HDR path remain in use; moving photo edges have transparent padding for the shutter tails.

**Lighting → Wall diffusion** ranges from 0–600%, defaulting to 200%. Cached light is accumulated without the previous opacity ceiling, so 200% gives twice the former 100% wall return. The same control is included in video export.

## Export video

Choose **Export video** in the control rail. The video includes the opening white field and every loaded photo once, with your current hold time and picture settings. Viewing and sound pause during export and resume afterward, including on cancellation or failure. A manually paused slideshow stays paused.

The 180-degree shutter covers 1/60 s at 30 fps and 1/120 s at 60 fps. Photos use dense linear-light gathers along the known transport path; the mechanism uses projected per-object velocity and depth. This avoids coarse averages of multiple full scenes and does not estimate optical flow from images. Holds cache the static layers around the animated dust; native canvas video frames avoid synchronous RGBA readbacks. Export requires WebGL 2 and native WebCodecs H.264 / AAC encoding. Support and speed depend on the device. Native direct saving is preferred; the fallback download path has a 512 MiB limit.

Select a video bitrate preset or enter 2–200 Mbps. Auto uses 24 / 36 Mbps for 1080P at 30 / 60 fps, and 72 / 108 Mbps for 4K. This is a variable bitrate target: static dark scenes may encode below it. The exact resolution, frame rate and requested bitrate are checked on the device before export.

The export module loads on demand, with no software encoder or large WASM download. It is approximately 70 KB gzip, within a 200 KB compressed budget (approximately 259 KB uncompressed). HTTP hosting needs compression enabled. The offline HTML embeds the same module and parses it when export is opened.

Wall return is integrated in linear light into a small cached diffuse field, retaining broad photo colors without enlarged photo outlines. Wall, air and machine bloom caches use float16 where supported; SDR export keeps float composition until its final gamma and 8-bit rounding pass. A fixed neutral rounding dither is limited to half a code value. Decorative wall noise is removed and photo texture no longer adds linear-light noise to black pixels. The supported WebGPU path retains floating-point machine bloom; WebGL fallback remains available.

Android uses a compatibility path for viewing and export: the previous three-lobe wall diffusion is prepared with a bounded CPU blur, and all lighting Canvas 2D caches use ordinary 8-bit storage. Live photos retain WebGPU-first HDR output when the browser supports extended floating presentation; environmental GPU output remains SDR. Legacy wall diffusion defaults to 100%, while the current model defaults to 200%; their saved adjustments are independent. Windows and Apple keep the current floating lighting path. The affected Xiaomi user confirmed that this byte lighting path removed the colored blocks; restored HDR photo output still needs hardware confirmation.

**Lighting → Environment gamma** adjusts the wall, light and projector from 0.50 to 2.00, leaving photos and controls unchanged. The default 1.00 keeps the original display path. On Windows and Apple, non-default values use float16 environment composition and a floating-point GPU curve, with neutral subpixel dither at final 8-bit rounding to reduce shadow banding. Native HDR photos remain outside all environment processing. SDR export also excludes photos from the gamma curve. Extra environment surfaces are allocated only when gamma is changed.

## Run locally

Download the repository and open `darkroom.html` for offline viewing. To run the source version with Node.js:

```sh
npm start
```

Open [localhost:8790](http://127.0.0.1:8790). No dependency installation is required.

## Development

Built with plain HTML, CSS, JavaScript, and bundled Three.js. Run `npm test` for unit tests. Install development dependencies with `npm ci` and run `npm run build` to rebuild the export bundle, offline HTML and Pages directory. Viewing and running the local server need no dependency installation.

See the [implementation notes (Chinese)](docs/IMPLEMENTATION_NOTES.zh-CN.md) for technical details.

The build checks the export module's gzip size against a 200,000-byte budget.

## License

Original code and documentation are licensed under [MIT](LICENSE). Dependencies and bundled photographs and audio retain their own terms; see [third-party notices](THIRD_PARTY_NOTICES.md).
