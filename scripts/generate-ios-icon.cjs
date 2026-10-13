/**
 * Build an iOS-specific home screen icon with balanced white padding.
 * Keep assets/icon.png unchanged (it is also used by Android/web).
 *
 * Run by npm postinstall and app.config.ts before Expo's native prebuild.
 */
const fs = require('node:fs');
const path = require('node:path');
const { PNG } = require('pngjs');

const assetDir = path.resolve(__dirname, '..', 'assets');
const inputPath = path.join(assetDir, 'icon.png');
const outputPath = path.join(assetDir, 'icon-ios.png');
const ICON_SIZE = 1024;
const LOGO_SCALE = 0.75;

if (!fs.existsSync(inputPath)) {
  throw new Error('Expected source app icon at assets/icon.png');
}
if (
  fs.existsSync(outputPath) &&
  fs.statSync(outputPath).mtimeMs >= fs.statSync(inputPath).mtimeMs
) {
  process.exit(0);
}

const source = PNG.sync.read(fs.readFileSync(inputPath));
const target = new PNG({ width: ICON_SIZE, height: ICON_SIZE, colorType: 6 });
const logoSize = Math.round(ICON_SIZE * LOGO_SCALE);
const offset = Math.floor((ICON_SIZE - logoSize) / 2);

// iOS requires an opaque app icon. Fill the entire square with white.
for (let i = 0; i < target.data.length; i += 4) {
  target.data[i] = 255;
  target.data[i + 1] = 255;
  target.data[i + 2] = 255;
  target.data[i + 3] = 255;
}

// Bilinear sampling reduces jagged edges when shrinking the existing artwork.
function sample(x, y, channel) {
  const x0 = Math.max(0, Math.min(source.width - 1, Math.floor(x)));
  const y0 = Math.max(0, Math.min(source.height - 1, Math.floor(y)));
  const x1 = Math.min(source.width - 1, x0 + 1);
  const y1 = Math.min(source.height - 1, y0 + 1);
  const tx = Math.max(0, Math.min(1, x - x0));
  const ty = Math.max(0, Math.min(1, y - y0));
  const idx = (px, py) => (py * source.width + px) * 4 + channel;
  const top = source.data[idx(x0, y0)] * (1 - tx) + source.data[idx(x1, y0)] * tx;
  const bottom = source.data[idx(x0, y1)] * (1 - tx) + source.data[idx(x1, y1)] * tx;
  return top * (1 - ty) + bottom * ty;
}

for (let y = 0; y < logoSize; y++) {
  const sy = (y + 0.5) * source.height / logoSize - 0.5;
  for (let x = 0; x < logoSize; x++) {
    const sx = (x + 0.5) * source.width / logoSize - 0.5;
    const i = ((offset + y) * ICON_SIZE + offset + x) * 4;
    const a = sample(sx, sy, 3) / 255;
    for (let channel = 0; channel < 3; channel++) {
      target.data[i + channel] = Math.round(sample(sx, sy, channel) * a + 255 * (1 - a));
    }
  }
}

fs.writeFileSync(outputPath, PNG.sync.write(target));
console.log('Generated iOS app icon with 25% white padding: assets/icon-ios.png');
