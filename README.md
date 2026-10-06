# Slide Ritual

**English** · [简体中文](README.zh-CN.md)

A browser-based photo viewer inspired by the **Leica P150** slide projector. Warm light, mechanical slide changes, and a quiet fan bring the ritual of a slide show to your monitor, with HDR on compatible displays and browsers.

**[Open Slide Ritual →](https://pixelcraft2026.github.io/slide-ritual/)**

![Slide Ritual: a photograph projected in a dark room with a virtual slide projector](preview.JPG)

## Features

- A 3D projector with lamp warmup, an animated slide magazine, and recorded slide-change sound.
- Photo-responsive wall lighting, a subtle light beam, floating dust, and adjustable focus.
- Folder import, automatic playback, fullscreen, and mobile layouts, with controls that hide while you watch.
- HDR support, including Radiance `.hdr` / `.rgbe`, with SDR fallback.
- Local photo processing: imported photographs stay in your browser and are never uploaded.

## Start watching

Open the [online viewer](https://pixelcraft2026.github.io/slide-ritual/), choose **Folder**, or click **Try the demo**. English and Simplified Chinese follow your system language; you can switch languages in settings.

Foreground blur defaults to **2.0 on touch devices** and **4.0 on desktop**. If your mobile browser does not support folder selection, open settings and choose **Or choose individual photos**.

Use **← / →** to change photographs, **Space** to play or pause, **F** for fullscreen, **M** for sound, and **P** for power.

JPEG, PNG, WebP, and AVIF support depends on browser decoding. HDR output requires a compatible display, system settings, and browser; otherwise, the viewer uses SDR.

On compatible WebGPU HDR browsers, Adobe gain-map JPEGs briefly brighten during entry using a reconstructed HDR preview, then return to the original native HDR image. **Lighting → HDR entry exposure** adjusts the effect from 0 to +2 EV (default +1 EV). Other native HDR formats retain browser rendering.

## Run locally

Download the repository and open `darkroom.html` for offline viewing. To run the source version with Node.js:

```sh
npm start
```

Open [localhost:8790](http://127.0.0.1:8790). No dependency installation is required.

## Development

Built with plain HTML, CSS, JavaScript, and bundled Three.js. Run `npm test` for unit tests and `node tools/build-standalone.mjs` to regenerate the offline HTML. Pushes to `main` automatically deploy to GitHub Pages.

See the [implementation notes (Chinese)](docs/IMPLEMENTATION_NOTES.zh-CN.md) for technical details.

## License

Original code and documentation are licensed under [MIT](LICENSE). Third-party dependencies and media retain their own terms; see [third-party notices](THIRD_PARTY_NOTICES.md).
