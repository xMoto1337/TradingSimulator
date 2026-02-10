// Generate PWA icons from the existing Tauri icon
const sharp = require('sharp');
const path = require('path');

const SOURCE = path.join(__dirname, '..', 'src-tauri', 'icons', 'icon.png');
const OUT_DIR = path.join(__dirname, '..', 'public');

async function generate() {
  await sharp(SOURCE).resize(192, 192).png().toFile(path.join(OUT_DIR, 'icon-192.png'));
  await sharp(SOURCE).resize(512, 512).png().toFile(path.join(OUT_DIR, 'icon-512.png'));
  await sharp(SOURCE).resize(180, 180).png().toFile(path.join(OUT_DIR, 'apple-touch-icon.png'));
  console.log('PWA icons generated in public/');
}

generate().catch(console.error);
