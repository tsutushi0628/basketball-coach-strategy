/** @file 全HTML経路のタブ・ホーム画面アイコンと、Hosting公開資産の契約を検証する。 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { chromium } from 'playwright';
import { renderPage, TOKENS } from './render-shared.mjs';
import { loginPageHtml } from './login.mjs';
import { joinPageHtml } from './join.mjs';
import { tenantPickerHtml } from './tenant-picker.mjs';

const config = { apiKey: 'synthetic-key', authDomain: 'synthetic.example', projectId: 'synthetic-project' };
const pages = [
  ['renderPage', () => renderPage({ title: 'Practice', css: '', body: '<p>Practice</p>', script: '' })],
  ['loginPageHtml', () => loginPageHtml(config)],
  ['joinPageHtml', () => joinPageHtml(config)],
  ['tenantPickerHtml', () => tenantPickerHtml({ tenants: [{ tenantId: 'synthetic-team', name: 'Synthetic', role: 'owner' }] })],
];

/** PNGの実画素から四隅の色、不透明性、背景以外の描画範囲を測る。 */
async function measurePng(png) {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    return await page.evaluate(async (base64) => {
      const image = new Image();
      image.src = `data:image/png;base64,${base64}`;
      await image.decode();
      const canvas = document.createElement('canvas');
      canvas.width = image.naturalWidth;
      canvas.height = image.naturalHeight;
      const context = canvas.getContext('2d');
      if (!context) {
        throw new Error('Canvas 2D context unavailable');
      }
      context.drawImage(image, 0, 0);
      const { width, height } = canvas;
      const { data } = context.getImageData(0, 0, width, height);
      const corners = [0, width - 1, (height - 1) * width, width * height - 1]
        .map((pixel) => Array.from(data.slice(pixel * 4, pixel * 4 + 4)));
      let opaque = true;
      const bounds = [width, height, -1, -1];
      for (let y = 0; y < height; y += 1) {
        for (let x = 0; x < width; x += 1) {
          const offset = (y * width + x) * 4;
          if (data[offset + 3] !== 255) {
            opaque = false;
          }
          if (corners[0].every((channel, index) => data[offset + index] === channel)) {
            continue;
          }
          bounds[0] = Math.min(bounds[0], x);
          bounds[1] = Math.min(bounds[1], y);
          bounds[2] = Math.max(bounds[2], x);
          bounds[3] = Math.max(bounds[3], y);
        }
      }
      return { width, height, corners, opaque, bounds };
    }, png.toString('base64'));
  } finally {
    await browser.close();
  }
}

for (const [name, render] of pages) {
  test(`${name}: head にPNG→SVGのiconとapple-touch-iconが各1本ある`, () => {
    const head = render().match(/<head>([\s\S]*?)<\/head>/)[1];
    assert.equal([...head.matchAll(/rel="icon"/g)].length, 2);
    assert.equal([...head.matchAll(/rel="apple-touch-icon"/g)].length, 1);
    assert.equal([...head.matchAll(/<link rel="icon" type="image\/png" sizes="32x32" href="\/favicon-32\.png"\s*\/>/g)].length, 1);
    assert.equal([...head.matchAll(/<link rel="icon" type="image\/svg\+xml" href="\/favicon\.svg"\s*\/>/g)].length, 1);
    assert.ok(head.indexOf('href="/favicon-32.png"') < head.indexOf('href="/favicon.svg"'));
    assert.match(head, /<link rel="apple-touch-icon" href="\/apple-touch-icon\.png"\s*\/>/);
  });
}

test('アイコン再生成: faviconを保ちapple-touch-iconの背景色はトークンに追従する', async () => {
  const temporaryRoot = new URL('../.tmp/', import.meta.url);
  mkdirSync(temporaryRoot, { recursive: true });
  const fixture = pathToFileURL(`${mkdtempSync(new URL('icons-', temporaryRoot))}/`);
  assert.ok(fixture.href.startsWith(temporaryRoot.href));
  try {
    for (const directory of ['scripts/', 'ui/styles/', 'public/']) {
      mkdirSync(new URL(directory, fixture), { recursive: true });
    }
    for (const file of ['scripts/generate-icons.mjs', 'ui/styles/tokens.css', 'firebase.json', 'public/favicon.svg']) {
      copyFileSync(new URL(`../${file}`, import.meta.url), new URL(file, fixture));
    }
    const background = TOKENS.match(/--surface:(#[0-9a-f]{6});/i)[1];
    writeFileSync(new URL('ui/styles/tokens.css', fixture), TOKENS.replace(/--bg:#[0-9a-f]{6};/i, `--bg:${background};`));
    await import(new URL('scripts/generate-icons.mjs', fixture).href);
    const svg = readFileSync(new URL('public/favicon.svg', fixture), 'utf8');
    assert.doesNotMatch(svg, /(?:fill|stroke)="var\(/);
    const orange = TOKENS.match(/--orange:([^;]+);/)[1];
    const ink = TOKENS.match(/--ink:([^;]+);/)[1];
    assert.ok(svg.includes(`fill="${orange}"`));
    assert.equal([...svg.matchAll(new RegExp(`stroke="${ink}"`, 'g'))].length, 3);
    const png = readFileSync(new URL('public/favicon-32.png', fixture));
    assert.equal(png.subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
    assert.equal(png.readUInt32BE(16), 32);
    assert.equal(png.readUInt32BE(20), 32);
    assert.equal(svg, readFileSync(new URL('../public/favicon.svg', import.meta.url), 'utf8'));
    assert.deepEqual(png, readFileSync(new URL('../public/favicon-32.png', import.meta.url)));
    const apple = await measurePng(readFileSync(new URL('public/apple-touch-icon.png', fixture)));
    const rgba = [...background.slice(1).match(/../g).map((channel) => Number.parseInt(channel, 16)), 255];
    assert.deepEqual(apple.corners, [rgba, rgba, rgba, rgba]);
    assert.equal(apple.opaque, true);
  } finally {
    rmSync(fixture, { recursive: true, force: true });
  }
});

test('Hosting公開資産: SVGはpathだけでCが右に開き、16pxで線幅2px以上を保つ', async () => {
  const { hosting } = JSON.parse(readFileSync(new URL('../firebase.json', import.meta.url), 'utf8'));
  const svg = readFileSync(new URL(`../${hosting.public}/favicon.svg`, import.meta.url), 'utf8');
  assert.doesNotMatch(svg, /<text\b|gradient|filter|shadow/i);
  assert.doesNotMatch(svg, /(?:fill|stroke)="var\(/);
  for (const name of ['orange', 'ink']) {
    const value = TOKENS.match(new RegExp(`--${name}:([^;]+);`))[1];
    assert.ok(svg.includes(`--${name}:${value}`));
  }
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    const measurement = await page.evaluate((source) => {
      const xml = new DOMParser().parseFromString(source, 'image/svg+xml');
      if (xml.querySelector('parsererror')) {
        throw new Error('Invalid SVG XML');
      }
      const svgElement = document.importNode(xml.documentElement, true);
      document.body.append(svgElement);
      svgElement.style.width = '16px';
      svgElement.style.height = '16px';
      const paths = [...svgElement.children];
      const c = paths.find((path) => Number(getComputedStyle(path).strokeWidth.replace('px', '')) >= 8);
      if (!c) {
        throw new Error('Missing bold C');
      }
      const viewBox = svgElement.viewBox.baseVal;
      const at = (x, y) => c.isPointInStroke(new DOMPoint(x, y));
      return {
        tags: paths.map((path) => path.localName),
        viewBox: [viewBox.x, viewBox.y, viewBox.width, viewBox.height],
        width: svgElement.getBoundingClientRect().width,
        ballFill: getComputedStyle(paths[0]).fill,
        cStroke: getComputedStyle(c).stroke,
        strokePx: Number.parseFloat(getComputedStyle(c).strokeWidth) * 16 / viewBox.width,
        seamStrokePx: paths.slice(1, -1).map((path) => Number.parseFloat(getComputedStyle(path).strokeWidth) * 16 / viewBox.width),
        transparentCorner: !paths[0].isPointInFill(new DOMPoint(0, 0)),
        left: at(13, 32), top: at(32, 13), bottom: at(32, 51),
        rightOpen: !at(51, 32), centerOpen: !at(32, 32),
      };
    }, svg);
    assert.ok(measurement.tags.length >= 3 && measurement.tags.length <= 4);
    assert.ok(measurement.tags.every((tag) => tag === 'path'));
    assert.deepEqual(measurement.viewBox, [0, 0, 64, 64]);
    assert.equal(measurement.width, 16);
    assert.ok(measurement.strokePx >= 2);
    assert.ok(measurement.seamStrokePx.every((width) => width < measurement.strokePx));
    for (const key of ['left', 'top', 'bottom', 'rightOpen', 'centerOpen', 'transparentCorner']) {
      assert.equal(measurement[key], true, key);
    }
  } finally {
    await browser.close();
  }
});

for (const [file, size, backgroundToken] of [['favicon-32.png', 32, null], ['apple-touch-icon.png', 180, 'bg']]) {
  test(`Hosting公開資産: ${file}は${size}x${size}で四隅が指定の背景色・透過性を持つ`, async () => {
    const { hosting } = JSON.parse(readFileSync(new URL('../firebase.json', import.meta.url), 'utf8'));
    const png = readFileSync(new URL(`../${hosting.public}/${file}`, import.meta.url));
    assert.equal(png.subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
    assert.equal(png.readUInt32BE(16), size);
    assert.equal(png.readUInt32BE(20), size);
    const measurement = await measurePng(png);
    assert.equal(measurement.width, size);
    assert.equal(measurement.height, size);
    if (backgroundToken) {
      const background = TOKENS.match(new RegExp(`--${backgroundToken}:(#[0-9a-f]{6});`, 'i'))[1];
      const rgba = [...background.slice(1).match(/../g).map((channel) => Number.parseInt(channel, 16)), 255];
      assert.deepEqual(measurement.corners, [rgba, rgba, rgba, rgba]);
      assert.equal(measurement.opaque, true);
      const [left, top, right, bottom] = measurement.bounds;
      assert.equal(left, size - right - 1);
      assert.equal(top, size - bottom - 1);
      for (const diameter of [right - left + 1, bottom - top + 1]) {
        assert.ok(diameter >= size * 0.78 && diameter <= size * 0.82, `circle diameter: ${diameter}`);
      }
    } else {
      assert.equal(png[25], 6);
      assert.ok(measurement.corners.every((corner) => corner[3] === 0));
    }
  });
}
