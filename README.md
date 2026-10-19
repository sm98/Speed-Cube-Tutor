# Speed Cube Tutor

A web app that scans a Rubik's Cube with your camera and (soon) teaches you to solve it with CFOP.

## What works today

- **Cube model**: 54-facelet state, all face moves, notation, and validation (legal pieces, twists, flips, parity).
- **3D viewer** (Three.js): the scanned cube, with unscanned stickers shown black. Tap a sticker to repaint it.
- **Scanner**: take a photo of a cube corner and the app finds the cube, fits a 3D box, and reads all three visible faces at once. Two opposite corners cover the whole cube.
  - Faces are identified from the hue order of the six centre colours, so lighting casts don't matter.
  - White balance from the whitest sticker; dark navy and red/orange are told apart by hue.
  - A check screen lets you drag each face's corner handles if the grid misses, with colours updating live.
- **Auto-capture** (optional) while turning the cube in front of the camera.

## Run it

```bash
npm install
npm run dev      # http://localhost:5173
npm test         # vitest
npm run build
```

Camera access needs `localhost` or HTTPS.

## How the scanner works

`src/scan/` holds the pipeline: sticker colour classes (`stickers.ts`), the cube outline from hue diversity (`cuboid.ts`), pose refinement against sticker cells (`cubefit.ts`), still-photo analysis with a zoom-in second pass (`analyse.ts`), and the session that assembles six faces into a cube (`session.ts`, `orient.ts`). `src/cube/` is the cube model; `src/render/` the 3D view; `src/ui/` the app.

Tests use a ray-cast renderer (`testutil.ts`) that produces photos of a known cube from any angle, lighting and distance, so every reading is checked against ground truth. The repository contains no photographs.

## Roadmap

CFOP solver split into cross / F2L / OLL / PLL, a step-by-step player with arrows and step counter, rescan-and-resume, and an optional learned corner detector.
