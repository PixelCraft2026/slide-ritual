# Slide Ritual · Virtual Slide Projector

**English** · [简体中文](README.zh-CN.md)

A browser-based photo viewing room inspired by the **Leica P150** slide projector, with HDR support on compatible displays and browsers.

Load a folder of photographs and settle into a dark room. A softly blurred projector sits in the foreground, its vents glowing warm yellow. The fan hums, the slide magazine advances, and each photograph arrives on the wall through a brief moment of darkness. Slide Ritual brings the ritual of a slide show to your monitor, giving each photograph a little time and space.

![Darkroom interface: a mountain photograph projected onto the wall, with the virtual projector in the foreground and controls on the right](preview.JPG)

## The viewing experience

- **A P150-inspired projector in 3D.** The housing, vents, controls, lens, transport arm, and straight slide magazine are built in Three.js from photographic references. You watch from behind the machine, with adjustable foreground blur.
- **A deliberate startup.** The lamp warms up and projects an empty octagonal gate for at least five seconds before loading the first photograph.
- **Mechanical slide changes.** The old slide is withdrawn, the magazine advances, and a new slide is inserted. A roughly 1.5-second sequence combines lateral movement, a dark interval, motion blur, and a gradual return to steady exposure, guided by reference video.
- **Light that follows the photograph.** Wall diffusion picks up the image's colors; a subtle light beam and sparse floating dust connect the lens to the projection. Warm light escapes from the vents and slide opening, with adjustable bloom and housing reflections.
- **Sound with separate controls.** Recorded slide-change audio accompanies the transport, while a synthesized fan bed runs in the background. Mechanical volume and fan noise can be adjusted independently or muted together.
- **An unobtrusive viewing room.** Landscape and portrait photographs retain their full composition. Controls hide after 3.2 seconds of inactivity and return when you interact. Fullscreen, mobile layouts, and the system's reduced-motion preference are supported. Background tabs pause automatic playback and audio.

The geometry, optics, and motion are real-time approximations built from references. Wall diffusion, depth of field, and air scattering use lightweight effects rather than ray tracing.

## Get started

### Open the online version

Visit [Slide Ritual](https://pixelcraft2026.github.io/slide-ritual/) and choose a photo folder, or try the bundled examples. Photographs you import are processed in your own browser. HDR output depends on your display, system settings, and browser support.

### Open the standalone version

1. Download the project and open **`darkroom.html`** in your browser.
2. Click **文件夹** (Folder) to choose a photo folder, or **先看示例** (Try the examples) to view the three bundled photographs.
3. Let the startup sequence finish. Imported photographs begin playing automatically; press **F** for fullscreen.

`darkroom.html` contains the engine, styles, scripts, example photographs, and sounds in one file. It works offline without installing dependencies or running a server. The current interface is in Simplified Chinese.

### Run the source version

With Node.js installed, run this from the project directory:

```sh
npm start
```

Then open [http://127.0.0.1:8790](http://127.0.0.1:8790). You can also run `node server.mjs`, or use `./start.ps1` in PowerShell. The included static server listens only on the local machine; no dependency installation is required.

## Controls and settings

| Control | Action |
| --- | --- |
| `←` / `→` | Previous / next photograph |
| `Space` | Start / pause automatic playback |
| `P` | Projector power |
| `M` | Sound on / off |
| `F` or double-click the photograph | Toggle fullscreen / immersive view |
| `Esc` | Close settings and exit immersive view |

The settings panel offers image size, lamp brightness, lens focus, foreground blur, projection texture, and a **2–30 second** dwell time per photograph (default: **4 seconds**), with looping enabled by default. The dwell time is separate from the mechanical transition.

Expandable sections adjust wall and air scattering, bloom, top-cover reflection, and housing lights. You can move the projector vertically, tilt it by up to **±12°**, and adjust the photograph's vertical position independently. The display controls offer automatic HDR selection, an explicit SDR mode, and SDR highlight expansion when the floating-point HDR output is active.

## Your photographs

Choose a folder to load a new slide tray. Subfolders are included, non-photo files are ignored, and photographs are naturally sorted by relative path and filename, so `2.jpg` comes before `10.jpg`. Selecting another folder replaces the tray. Individual files selected in settings or dropped onto the page replace the examples on first import, then append to your current tray.

| Format | Handling |
| --- | --- |
| JPEG, PNG, WebP, AVIF | Decoded by the browser; availability depends on its image decoder |
| Radiance `.hdr` / `.rgbe` | Built-in RGBE decoder, preserving floating-point highlight values |
| Other browser-decodable images, such as GIF and BMP | Basic image loading; this is a still-photo viewing workflow |
| HEIC / HEIF, camera RAW, EXR, TIFF | Convert to a supported format before importing |

The file limit is **64 MiB per photograph**. Ordinary images are limited to **100 million pixels**, and Radiance images to **16,777,216 pixels**. Floating-point previews are scaled to approximately **3 million pixels** and a maximum **2560-pixel long edge**, with two decoded photographs cached at a time. The original files remain unchanged.

Photographs are processed locally in the browser. The application has no photo-upload service or analytics, and the bundled viewing experience needs no external network resources. The tray and settings belong to the current page session; refreshing the page resets them.

## HDR and display compatibility

In **Auto** mode, Slide Ritual checks the browser's `(dynamic-range: high)` signal and WebGPU extended-output support. Its floating-point HDR path uses an **`rgba16float`** canvas, **Display P3**, and **extended tone mapping**. Image processing, brightness adjustment, focus sampling, and highlight expansion operate in linear light before output encoding. The 3D projector is rendered on a separate SDR surface.

Radiance files are decoded directly from RGBE into floating-point values. For ordinary image files, Slide Ritual attempts browser-managed floating-point readback. If an image has HDR metadata but readback does not retain its highlights, it keeps the original browser `<img>` surface so the browser can handle supported gain maps or PQ / HLG content. Brightness and focus filters are disabled for this native HDR path in Auto mode to preserve its presentation.

SDR photographs can also receive a gentle highlight expansion on the HDR output: **2× by default**, adjustable from **1× to 4×**. Midtones below the linear-light threshold remain unchanged by this expansion. This is a viewing effect; it cannot recover highlight detail absent from the source file. These multipliers are relative signal levels, not measured display nits.

| Available rendering path | Display behavior |
| --- | --- |
| WebGPU with extended output and an HDR display environment | Floating-point HDR projection |
| WebGPU without an active HDR environment | SDR projection |
| WebGL2 fallback | SDR projection, with HDR sources mapped to SDR |
| Browser-native fallback | Native image display; Radiance uses a CPU-generated SDR preview |

Actual HDR appearance depends on the display, system HDR settings, browser, GPU, and image decoding support. HDR metadata alone does not establish that highlights reach the display. The JPEG screenshot above illustrates the interface, not HDR brightness. When 3D rendering is unavailable, photo playback can continue without the projector model.

## Development

The application uses plain HTML, CSS, and JavaScript ES modules. Three.js is bundled locally; there is no framework, package dependency installation, or build step needed to run the source version. The source version can also be served by a static host that supports ES modules.

| File | Role |
| --- | --- |
| `index.html`, `style.css` | Viewing room, controls, and responsive layout |
| `app.js` | Import, slide tray, playback, settings, and keyboard controls |
| `scene.js` | Three.js projector model, mechanism, and wall diffusion |
| `transition.js` | Optical transitions, transport timing, startup, and image layout |
| `hdr.js`, `renderer.js` | RGBE decoding, color math, WebGPU / WebGL2 projection |
| `atmosphere.js`, `machine-light.js` | Beam, dust, and housing bloom |
| `audio.js` | Slide-change and fan audio |
| `tools/build-standalone.mjs` | Generate the offline HTML from the source and assets |

The repository keeps the browser entry points and modules at the root, runtime media in `assets/`, the bundled engine and its license in `vendor/`, unit tests and fixtures in `tests/`, and historical implementation notes in `docs/`. The scripts in `tools/` cover standalone and website generation, test-fixture generation, sample-photo preparation, and fan synthesis.

Run the existing unit tests:

```sh
npm test
```

They cover color conversion, highlight expansion, RGBE decoding and error handling, half-float conversion, transition timing, transport order, and beam geometry. The original development README is preserved in [Implementation notes (Chinese)](docs/IMPLEMENTATION_NOTES.zh-CN.md). Its references to `qa/`, `reference/`, and historical browser scripts describe the local development archive, which is excluded from this public repository. Recorded GPU and fallback checks are implementation evidence; physical HDR appearance still needs evaluation on an HDR display.

After editing the source or assets, regenerate the standalone version from the project directory:

```sh
node tools/build-standalone.mjs
```

To assemble the GitHub Pages website locally, run `npm run build:pages`. It copies the runtime assets and offline HTML into the ignored `dist/` directory. The [deployment workflow](.github/workflows/pages.yml) runs the unit tests, regenerates the offline HTML, and publishes that directory after a push to `main`; it can also be started manually from the Actions tab.

Optional asset tools require Python, Pillow, and NumPy: `tools/prepare-assets.py` downloads the sample photographs and regenerates the fan sound; `tools/prepare-fan.py` regenerates only the fan sound and writes an ignored local report in `qa/`. `node tools/create-fixtures.mjs` regenerates the three synthetic failure/highlight fixtures. Viewing, the Node.js unit tests, and standalone generation require neither Python nor Browser Harness.

## Credits and license

- **Three.js r160** is bundled under the MIT license. See [vendor/LICENSE-three](vendor/LICENSE-three).
- **Example photographs** come from Unsplash. Their source URLs are recorded in the [implementation notes](docs/IMPLEMENTATION_NOTES.zh-CN.md#素材与复现) and `tools/prepare-assets.py`.
- **Slide-change audio** is extracted from a recording supplied during development; only the playback asset `assets/advance.wav` is distributed here. The fan sound is synthesized by `tools/prepare-fan.py`.
- **Projector appearance and motion** are informed by P150 photographs and videos retained in the local development archive. The original reference media are excluded from this repository.

A project-level license has not yet been added. The bundled Three.js license applies to that dependency; the photographs and reference media retain their respective rights.
