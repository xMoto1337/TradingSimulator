// Generate app icons - a stylized "M" with candlestick chart motif
// Uses Canvas API via node to create PNGs

const fs = require('fs');
const { createCanvas } = (() => {
  try {
    return require('canvas');
  } catch {
    return { createCanvas: null };
  }
})();

function generateSVG(size) {
  const s = size;
  const pad = Math.round(s * 0.1);
  const inner = s - pad * 2;

  // Candlestick bar positions (4 bars forming an uptrend)
  const barWidth = Math.round(inner * 0.12);
  const gap = Math.round(inner * 0.08);
  const totalBarsWidth = barWidth * 4 + gap * 3;
  const startX = pad + Math.round((inner - totalBarsWidth) / 2);

  const bars = [
    { x: startX, bodyTop: 0.65, bodyBot: 0.85, wickTop: 0.55, wickBot: 0.90, up: false },
    { x: startX + barWidth + gap, bodyTop: 0.45, bodyBot: 0.70, wickTop: 0.35, wickBot: 0.75, up: true },
    { x: startX + (barWidth + gap) * 2, bodyTop: 0.30, bodyBot: 0.55, wickTop: 0.20, wickBot: 0.60, up: true },
    { x: startX + (barWidth + gap) * 3, bodyTop: 0.20, bodyBot: 0.40, wickTop: 0.12, wickBot: 0.48, up: true },
  ];

  let barsSvg = '';
  for (const bar of bars) {
    const color = bar.up ? '#00ff41' : '#ff0040';
    const wickX = bar.x + barWidth / 2;
    const wickWidth = Math.max(1, Math.round(s * 0.015));

    // Wick
    barsSvg += `<rect x="${wickX - wickWidth/2}" y="${Math.round(bar.wickTop * s)}" width="${wickWidth}" height="${Math.round((bar.wickBot - bar.wickTop) * s)}" fill="${color}" opacity="0.7"/>`;
    // Body
    barsSvg += `<rect x="${bar.x}" y="${Math.round(bar.bodyTop * s)}" width="${barWidth}" height="${Math.round((bar.bodyBot - bar.bodyTop) * s)}" rx="${Math.max(1, Math.round(s * 0.015))}" fill="${color}"/>`;
  }

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${s}" height="${s}" viewBox="0 0 ${s} ${s}">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#0d0d0d"/>
      <stop offset="100%" stop-color="#1a1a1a"/>
    </linearGradient>
    <linearGradient id="glow" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#00ff41" stop-opacity="0.15"/>
      <stop offset="100%" stop-color="#00ff41" stop-opacity="0"/>
    </linearGradient>
  </defs>
  <!-- Background -->
  <rect width="${s}" height="${s}" rx="${Math.round(s * 0.18)}" fill="url(#bg)"/>
  <rect width="${s}" height="${s}" rx="${Math.round(s * 0.18)}" stroke="#00ff41" stroke-width="${Math.max(1, Math.round(s * 0.02))}" fill="none" opacity="0.5"/>
  <!-- Glow -->
  <rect x="${pad}" y="${Math.round(s * 0.15)}" width="${inner}" height="${Math.round(s * 0.5)}" fill="url(#glow)"/>
  <!-- Candlesticks -->
  ${barsSvg}
</svg>`;
}

// Write SVGs at different sizes, user can convert with external tools
const sizes = {
  'icon-1024.svg': 1024,
  'icon-512.svg': 512,
};

for (const [name, size] of Object.entries(sizes)) {
  const svg = generateSVG(size);
  fs.writeFileSync(__dirname + '/' + name, svg);
  console.log(`Generated ${name} (${size}x${size})`);
}

// Also generate the main SVG
const mainSvg = generateSVG(512);
fs.writeFileSync(__dirname + '/icon.svg', mainSvg);
console.log('Generated icon.svg');
console.log('\nTo convert to PNG/ICO, run:');
console.log('  npx @tauri-apps/cli icon src-tauri/icons/icon.svg');
