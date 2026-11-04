#!/usr/bin/env node
/* Orchestra Mobile モックアップの表示確認スクリプト
 * - 静的チェック（必須）: トークン一致・直書き色・アセット・必須要素
 * - ブラウザチェック（任意）: playwright があれば 390/360/320px で横スクロールの有無を見てスクリーンショットを撮る
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');

const designDir = __dirname;
const root = path.resolve(designDir, '..', '..');
const mockPath = path.join(designDir, 'orchestra-mobile-mockup.html');
const specPath = path.join(root, '.division', 'DESIGN.html');

const errors = [];
const warns = [];
const oks = [];
const ok = (m) => oks.push(m);
const err = (m) => errors.push(m);
const warn = (m) => warns.push(m);

function parseTokens(block) {
  const map = new Map();
  const re = /--([\w-]+)\s*:\s*([^;]+);/g;
  let m;
  while ((m = re.exec(block))) map.set(m[1], m[2].trim().replace(/\s+/g, ' '));
  return map;
}
function rootBlockAfter(html, fromIndex) {
  const re = /:root\s*\{([^}]*)\}/g;
  re.lastIndex = fromIndex;
  const m = re.exec(html);
  return m ? m[1] : '';
}
function lightTokens(html) {
  const styleStart = html.indexOf('<style');
  return parseTokens(rootBlockAfter(html, styleStart < 0 ? 0 : styleStart));
}
function darkTokens(html) {
  const i = html.search(/prefers-color-scheme:\s*dark/);
  return i < 0 ? new Map() : parseTokens(rootBlockAfter(html, i));
}
function compare(label, spec, mock) {
  let bad = 0;
  for (const [k, v] of spec) {
    if (!mock.has(k)) { err(`${label}: トークン --${k} がモックアップにない`); bad++; }
    else if (mock.get(k) !== v) { err(`${label}: --${k} の値が違う（spec=${v} / mock=${mock.get(k)}）`); bad++; }
  }
  for (const k of mock.keys()) if (!spec.has(k)) { err(`${label}: 仕様にない独自トークン --${k}`); bad++; }
  if (!bad) ok(`${label}: ${spec.size} 個のトークンが DESIGN.html と一致`);
}

function staticChecks() {
  if (!fs.existsSync(mockPath)) { err(`成果物がない: ${path.relative(root, mockPath)}`); return null; }
  ok(`成果物あり: ${path.relative(root, mockPath)}`);
  const html = fs.readFileSync(mockPath, 'utf8');

  if (fs.existsSync(specPath)) {
    const spec = fs.readFileSync(specPath, 'utf8');
    compare('light', lightTokens(spec), lightTokens(html));
    compare('dark', darkTokens(spec), darkTokens(html));
  } else {
    warn('.division/DESIGN.html が見つからないため、トークンの照合をスキップしました');
  }

  const defined = new Set([...lightTokens(html).keys()]);
  const used = new Set();
  html.replace(/var\(--([\w-]+)/g, (_, n) => used.add(n));
  const undef = [...used].filter((n) => !defined.has(n));
  if (undef.length) err(`未定義の CSS 変数: ${undef.map((n) => '--' + n).join(', ')}`);
  else ok(`CSS 変数 ${used.size} 種はすべて定義済み`);

  const styles = [];
  html.replace(/<style[^>]*>([\s\S]*?)<\/style>/g, (_, s) => styles.push(s));
  html.replace(/style="([^"]*)"/g, (_, s) => styles.push(s));
  const css = styles.join('\n').replace(/:root\s*\{[^}]*\}/g, '');
  const hex = css.match(/#[0-9a-fA-F]{3,8}\b/g) || [];
  if (hex.length) err(`:root 以外で hex 色を直書きしている: ${[...new Set(hex)].join(', ')}`);
  else ok(':root 以外に hex 色の直書きなし');

  const small = [];
  css.replace(/font-size\s*:\s*(\d+(?:\.\d+)?)px/g, (_, n) => { if (Number(n) < 11) small.push(n); });
  if (small.length) err(`11px 未満の文字サイズ: ${small.join(', ')}px`);
  else ok('文字サイズはすべて 11px 以上（本文は 15px）');

  if (/<meta[^>]+name="viewport"[^>]+width=device-width/.test(html)) ok('viewport meta あり');
  else err('viewport meta (width=device-width) がない');
  if (/<html[^>]+lang="ja"/.test(html)) ok('lang="ja"');
  else warn('html に lang="ja" がない');

  const imgs = [];
  html.replace(/<img[^>]+src="([^"]+)"/g, (_, s) => imgs.push(s));
  for (const src of imgs) {
    if (/^(https?:)?\/\//.test(src)) { err(`外部画像に依存している: ${src}`); continue; }
    const p = path.resolve(designDir, src);
    if (fs.existsSync(p)) ok(`アセットあり: ${path.relative(root, p)}`);
    else warn(`アセットがない（フォールバック表示になる）: ${path.relative(root, p)}`);
  }

  const screens = (html.match(/data-screen="/g) || []).length;
  if (screens >= 5) ok(`画面数: ${screens}`);
  else err(`画面数が足りない: ${screens}（5 必要）`);

  const required = [
    'Division でログイン', 'エージェントに頼みたいことを書く', '承認待ち', '承認する',
    'class="send', 'class="composer"', 'class="user-bubble"', 'class="agent-turn"',
    'class="drawer"', 'カンバン', 'タスクを追加', 'class="chip',
  ];
  const missing = required.filter((s) => !html.includes(s));
  if (missing.length) err(`必須要素がない: ${missing.join(' / ')}`);
  else ok(`主要な文言・操作要素 ${required.length} 件を確認`);

  return html;
}

async function browserChecks() {
  let chromium;
  try {
    ({ chromium } = require(require.resolve('playwright', { paths: [root, designDir] })));
  } catch {
    warn('playwright がないため、ブラウザでの表示チェックをスキップしました（目視確認は README の手順で行ってください）');
    return;
  }
  let browser;
  try {
    browser = await chromium.launch();
  } catch (e) {
    warn(`Chromium を起動できないため、ブラウザでの表示チェックをスキップしました: ${String(e.message || e).split('\n')[0]}`);
    return;
  }
  const outDir = path.join(designDir, 'screenshots');
  fs.mkdirSync(outDir, { recursive: true });
  try {
    for (const width of [390, 360, 320]) {
      const page = await browser.newPage({ viewport: { width, height: 844 }, deviceScaleFactor: 2 });
      await page.goto(pathToFileURL(mockPath).href, { waitUntil: 'load' });
      const r = await page.evaluate(() => {
        const vw = document.documentElement.clientWidth;
        const overflow = document.documentElement.scrollWidth > vw + 1;
        const phones = [...document.querySelectorAll('.phone')].map((p) => p.getBoundingClientRect());
        const phoneOverflow = phones.some((b) => b.right > vw + 1 || b.left < -1);
        const img = document.querySelector('.logo-wrap img');
        const logo = img ? img.complete && img.naturalWidth > 0 : false;
        return { vw, overflow, phoneOverflow, logo, count: phones.length };
      });
      if (r.overflow) err(`${width}px: ページに横スクロールが出ている`);
      else ok(`${width}px: 横スクロールなし`);
      if (r.phoneOverflow) err(`${width}px: 端末フレームが表示幅からはみ出している`);
      else ok(`${width}px: ${r.count} 個のフレームが幅内に収まっている`);
      if (width === 390) {
        if (r.logo) ok('ロゴ画像の読込を確認');
        else warn('ロゴ画像を読み込めず、フォールバック（✻）で表示されている');
      }
      const shot = path.join(outDir, `mockup-${width}.png`);
      await page.screenshot({ path: shot, fullPage: true });
      ok(`スクリーンショット: ${path.relative(root, shot)}`);
      await page.close();
    }
  } finally {
    await browser.close();
  }
}

(async () => {
  const html = staticChecks();
  if (html) await browserChecks();
  console.log('\n== Orchestra Mobile モックアップ確認 ==');
  for (const m of oks) console.log('  OK   ' + m);
  for (const m of warns) console.log('  WARN ' + m);
  for (const m of errors) console.log('  NG   ' + m);
  console.log(`\n結果: OK ${oks.length} / WARN ${warns.length} / NG ${errors.length}`);
  console.log(`表示: ブラウザで ${path.relative(process.cwd(), mockPath)} を開く`);
  process.exit(errors.length ? 1 : 0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
