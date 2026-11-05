#!/bin/sh
set -e
cd "$(dirname "$0")"
rm -rf dist && mkdir -p dist/lib dist/icons
npx esbuild src/app.js --bundle --format=esm --minify --target=es2020,safari15,chrome100 --outfile=dist/app.js --log-level=warning
npx esbuild src/detector.worker.js --bundle --format=esm --minify --target=es2020,safari15,chrome100 --outfile=dist/detector.js --log-level=warning
mkdir -p dist/lib/ort dist/models
cp node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.wasm dist/lib/ort/
cp models/ctd-int8.onnx dist/models/
cp src/index.html src/manifest.webmanifest src/sw.js dist/
cp node_modules/pdfjs-dist/legacy/build/pdf.worker.min.mjs dist/lib/pdf.worker.min.js
cp -r node_modules/pdfjs-dist/wasm dist/lib/wasm
# (wasm/standard_fonts são os mesmos no build legacy)
cp -r node_modules/pdfjs-dist/standard_fonts dist/lib/standard_fonts
cp icons/*.png dist/icons/
du -sh dist; ls -la dist
