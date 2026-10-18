/** @file デザイントークンからfavicon SVG・透過32px PNG・背景付き180px PNGを生成する。 */
import { readFileSync, writeFileSync } from 'node:fs';
import { chromium } from 'playwright';

const tokens = readFileSync(new URL('../ui/styles/tokens.css', import.meta.url), 'utf8');
const { hosting } = JSON.parse(readFileSync(new URL('../firebase.json', import.meta.url), 'utf8'));
const colors = {};
for (const name of ['orange', 'ink', 'bg']) {
  const match = tokens.match(new RegExp(`--${name}:(#[0-9a-f]{6});`, 'i'));
  if (!match) {
    throw new Error(`Missing color token: --${name}`);
  }
  colors[name] = match[1];
}

const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" style="--orange:${colors.orange};--ink:${colors.ink}">
  <path fill="${colors.orange}" d="M32 2a30 30 0 1 1 0 60a30 30 0 1 1 0-60Z"/>
  <path fill="none" stroke="${colors.ink}" stroke-width="2" d="M32 2V13"/>
  <path fill="none" stroke="${colors.ink}" stroke-width="2" d="M32 51V62"/>
  <path fill="none" stroke="${colors.ink}" stroke-width="8" stroke-linecap="round" d="M45.435 18.565A19 19 0 1 0 45.435 45.435"/>
</svg>
`;

const browser = await chromium.launch();
try {
  const page = await browser.newPage();
  for (const [file, size] of [['favicon-32.png', 32], ['apple-touch-icon.png', 180]]) {
    const png = await page.evaluate(async ({ source, size, background }) => {
      const image = new Image();
      image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(source)}`;
      await image.decode();
      const canvas = document.createElement('canvas');
      canvas.width = size;
      canvas.height = size;
      const context = canvas.getContext('2d');
      if (!context) {
        throw new Error('Canvas 2D context unavailable');
      }
      let drawSize = size;
      let offset = 0;
      if (size === 180) {
        context.fillStyle = background;
        context.fillRect(0, 0, size, size);
        drawSize = size * 0.85;
        offset = (size - drawSize) / 2;
      }
      context.drawImage(image, offset, offset, drawSize, drawSize);
      return canvas.toDataURL('image/png').split(',')[1];
    }, { source: svg, size, background: colors.bg });
    writeFileSync(new URL(`../${hosting.public}/${file}`, import.meta.url), Buffer.from(png, 'base64'));
  }
  writeFileSync(new URL(`../${hosting.public}/favicon.svg`, import.meta.url), svg);
} finally {
  await browser.close();
}
