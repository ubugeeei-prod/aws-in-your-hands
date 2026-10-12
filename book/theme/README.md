# Open Current / Horizon

The book's look, applied to Ox Content. The source of truth is the brand guide
(Book & Design System 7.0); this directory is that guide as code.

| File | What it is |
| --- | --- |
| `theme.ts` | Colours, typefaces, and layout as an Ox Content theme |
| `brand.css` | Everything the theme's options cannot say: reading surfaces, navigation, the cover |
| `brand/*.svg` | The mark (32 px and up), the micro mark (16–24 px), and the outlined wordmark, cut from the guide's vectors |
| `assets.ts` | Serves `brand/` and the cover's scripts under `/brand/` |
| `motion/` | The cover's cloud |

## The cover's cloud

`motion/fluid-cloud.ts` draws a volume of cloud with WebGL2 and lets the reader push it.

```ts
const cloud = createFluidCloud(canvas, { seed: 17, reducedMotion: "system" });
```

Three things happen each frame.

1. **A fluid is solved** on a grid 144 cells high (`shaders.ts`, `fluid`). The pointer adds
   force, the velocity carries itself, and a pressure solve removes the divergence. This is a
   real incompressible flow, in two dimensions.
2. **The cloud is ray-marched** (`volumeFragment`). Its shape comes from a 3D noise texture
   built on the CPU (`noise.ts`): gradient noise for the large forms, cellular noise for the
   billows. Light is absorbed on its way from the sun to each sample, with a second, gentler
   falloff standing in for light that scatters many times. The cloud is looked up through the
   map the fluid carries, so a push moves the cloud itself.
3. **The image is finished** (`finishFragment`): enlarged from the small ray-marched image,
   with the cover's paper grain and a darker foot for the title to stand on.

What it is not: a 3D fluid simulation. Depth and lighting are an optical approximation.

It holds still for readers who ask for reduced motion, stops when the tab or the canvas is
out of sight, and shrinks the ray-marched image when frames run slow (`quality.ts`). Without
WebGL2 the cover keeps its CSS background. Without float render targets the cloud still
drifts but cannot be pushed.

The scripts are TypeScript that runs once its types are removed, which is all `assets.ts`
does to them. No bundler, and no Three.js: the scene is one triangle.

## Fonts

Syne (display), Hubot Sans (Latin text), Noto Sans JP (Japanese), Commit Mono (code), all
OFL-1.1, self-hosted from `@fontsource/*`. Digits are left to Noto Sans JP: Hubot Sans draws
its zero with a bar through it, which in running text reads as a theta.
