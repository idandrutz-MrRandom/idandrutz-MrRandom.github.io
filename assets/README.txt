Drop your two background videos here:

  nature.mp4   shown at the top of the page (forest, water, mist, clouds - slow footage works best)
  cyber.mp4    fades in over it as you scroll down (neon city, rain, grid, etc.)

Optional smaller variants for Chrome/Firefox:
  nature.webm
  cyber.webm

Both videos play at the same time and the cyber one is faded in/out with scroll,
so keep each one small (~5-8 MB, 1080p or lower, no audio).

Until the files exist, the page shows built-in fallbacks: drifting light for the top of the page,
a neon perspective grid further down. The transition works either way.

Compress with ffmpeg:
  ffmpeg -i input.mp4 -an -vf "scale=1920:-2" -c:v libx264 -crf 28 -preset slow -movflags +faststart nature.mp4
  ffmpeg -i input.mp4 -an -vf "scale=1920:-2" -c:v libx264 -crf 28 -preset slow -movflags +faststart cyber.mp4

Code playground (bottom of the page)
  - Runs in a Web Worker, so the page must be served over http(s) (GitHub Pages is fine).
    Opening index.html straight from disk (file://) blocks workers; use any local server instead.
  - Luau:   real Luau via vendor/luau-web (WebAssembly).
  - Python: real CPython via Pyodide, downloaded from jsDelivr on first run (~10 MB).
  - C#:     js/csharp.js, a small built-in interpreter for everyday C# (no inheritance/interfaces/async).
