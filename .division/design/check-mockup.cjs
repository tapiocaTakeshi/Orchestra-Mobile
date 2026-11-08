#!/usr/bin/env node
/* Orchestra Mobile デザイン資料の静的・ブラウザ検査 */
'use strict';
const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');
const designDir = __dirname;
const root = path.resolve(designDir, '..', '..');
const specPath = path.join(root, '.division', 'DESIGN.html');
const pages = [
  { file: 'index.html', minScreens: 7 },
  { file: 'login.html' }, { file: 'home.html' }, { file: 'cloud-detail.html' },
  { file: 'remote-chat.html' }, { file: 'projects.html' }, { file: 'navigation.html' },
  { file: 'screens.html', minScreens: 7, archived: true },
  { file: 'orchestra-mobile-mockup.html', legacy: true, minScreens: 5 },
];
const errors = [], warns = [], oks = [];
const ok = m => oks.push(m), err = m => errors.push(m), warn = m => warns.push(m);
function parseTokens(block) {
  const map = new Map(), re = /--([\w-]+)\s*:\s*([^;}]+)/g;
  let m; while ((m = re.exec(block))) map.set(m[1], m[2].trim().replace(/\s+/g, ' '));
  return map;
}
function rootAfter(html, from = 0) {
  const re = /:root\s*\{([^}]*)\}/g; re.lastIndex = from;
  const m = re.exec(html); return m ? m[1] : '';
}
function lightTokens(html) { return parseTokens(rootAfter(html, html.indexOf('<style'))); }
function darkTokens(html) {
  const i = html.search(/prefers-color-scheme:\s*dark/);
  return i < 0 ? new Map() : parseTokens(rootAfter(html, i));
}
function normTokens(map) { return new Map([...map].map(([k, v]) => [k, v.replace(/\s+/g, '').toLowerCase()])); }
function compare(label, spec, actual, exact = false) {
  const a = normTokens(spec), b = normTokens(actual);
  const missing = [...a.keys()].filter(k => !b.has(k));
  const changed = [...a].filter(([k, v]) => b.has(k) && b.get(k) !== v).map(([k]) => k);
  const extra = exact ? [...b.keys()].filter(k => !a.has(k)) : [];
  if (missing.length || changed.length || extra.length) {
    err(`${label}: トークン差分 missing=${missing.join(',') || '-'} changed=${changed.join(',') || '-'} extra=${extra.join(',') || '-'}`);
  } else ok(`${label}: ${a.size}個のトークン一致`);
}
function staticChecks(page, specLight, specDark, indexRoot) {
  const file = path.join(designDir, page.file), label = page.file;
  if (!fs.existsSync(file)) { err(`${label}: ファイルがありません`); return null; }
  const html = fs.readFileSync(file, 'utf8');
  if (!/^<!DOCTYPE html>/i.test(html)) err(`${label}: DOCTYPEがありません`);
  if (!/<html[^>]+lang="ja"/.test(html)) err(`${label}: lang=jaがありません`);
  if (!/<meta[^>]+charset="?utf-8/i.test(html)) err(`${label}: charset=utf-8がありません`);
  if (!/<meta[^>]+name="viewport"[^>]+width=device-width/.test(html)) err(`${label}: viewportがありません`);
  const styles = (html.match(/<style(?:\s[^>]*)?>/g) || []).length;
  if (styles !== 1) err(`${label}: inline styleは1個必要（現在${styles}）`);
  if (/<(?:script|img)[^>]+src="(?:https?:)?\/\//i.test(html) || /<link[^>]+href="(?:https?:)?\/\//i.test(html)) err(`${label}: 外部assetに依存しています`);
  if (/<(?:script)[^>]+src=/i.test(html)) err(`${label}: 外部scriptがあります`);
  if (!page.legacy) {
    compare(`${label} light`, specLight, lightTokens(html), page.file === 'index.html');
    compare(`${label} dark`, specDark, darkTokens(html));
    if (page.file !== 'index.html') {
      const expected = JSON.stringify(normTokens(indexRoot));
      if (JSON.stringify(normTokens(lightTokens(html))) !== expected) err(`${label}: index.htmlと:rootが一致しません`);
    }
    if (!page.archived) {
      if (Buffer.byteLength(html, 'utf8') > 30000) err(`${label}: 30,000 bytesを超えています（${Buffer.byteLength(html, 'utf8')}）`);
      else ok(`${label}: 30,000 bytes以内`);
    } else ok(`${label}: 保全版のため30,000 bytes上限の対象外`);
  }
  const defined = new Set(lightTokens(html).keys()), used = new Set();
  html.replace(/var\(--([\w-]+)/g, (_, n) => { used.add(n); return _; });
  const undef = [...used].filter(n => !defined.has(n));
  if (undef.length) err(`${label}: 未定義CSS変数 ${undef.join(',')}`);
  const ids = new Set(); let idMatch;
  const idRe = /\bid="([^"]+)"/g;
  while ((idMatch = idRe.exec(html))) {
    if (ids.has(idMatch[1])) err(`${label}: idが重複: ${idMatch[1]}`);
    ids.add(idMatch[1]);
  }
  const hrefRe = /\bhref="([^"]+)"/g;
  while ((idMatch = hrefRe.exec(html))) {
    const href = idMatch[1];
    if (/^(?:https?:|mailto:|tel:|javascript:)/i.test(href)) { err(`${label}: 外部・非設計リンク ${href}`); continue; }
    if (href.startsWith('#')) { if (!page.legacy && !ids.has(href.slice(1))) err(`${label}: ページ内リンク先がありません ${href}`); continue; }
    const [target, hash] = href.split('#');
    const targetPath = path.resolve(designDir, decodeURIComponent(target));
    if (!targetPath.startsWith(root) || !fs.existsSync(targetPath)) { err(`${label}: リンク先がありません ${href}`); continue; }
    if (hash && targetPath.endsWith('.html')) {
      const targetHtml = fs.readFileSync(targetPath, 'utf8');
      if (!new RegExp(`\\bid="${hash.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"`).test(targetHtml)) err(`${label}: アンカーがありません ${href}`);
    }
  }
  const screens = (html.match(/data-screen="/g) || []).length;
  if (page.minScreens && screens < page.minScreens) err(`${label}: data-screen ${screens}/${page.minScreens}`);
  if (page.file === 'index.html') {
    const expected = ['theme','colors','typography','components','layout','elevation','dos-donts','responsive','agent-guide'];
    const found = [...html.matchAll(/<section\s+id="([^"]+)"/g)].map(m => m[1]);
    if (JSON.stringify(found) !== JSON.stringify(expected)) err(`index.html: 9章のID・順序が不正 ${found.join(',')}`);
    else ok('index.html: 必須9章のID・順序を確認');
    for (const name of ['login','home','cloud-detail','remote-chat','projects','navigation','screens']) {
      if (!html.includes(`href="${name}.html"`)) err(`index.html: ${name}.htmlへのリンクがありません`);
    }
    const uniqueScreens = new Set([...html.matchAll(/data-screen="([\w-]+)"/g)].map(m => m[1]));
    if (uniqueScreens.size < 7) err(`index.html: 一意の画面IDが7個未満`);
  }
  ok(`${label}: 構造・リンク・外部依存を検査`);
  return html;
}
async function browserChecks(validPages) {
  let chromium;
  try { ({ chromium } = require(require.resolve('playwright', { paths: [root, designDir] }))); }
  catch { warn('playwrightがないため実ブラウザ描画・スクリーンショットは未検証です'); return; }
  let browser;
  try { browser = await chromium.launch(); }
  catch (e) { warn(`Chromiumを起動できないため実ブラウザ検証をスキップ: ${String(e.message || e).split('\n')[0]}`); return; }
  const outDir = path.join(designDir, 'screenshots'); fs.mkdirSync(outDir, { recursive: true });
  try {
    for (const page of validPages.filter(p => !p.legacy && p.file !== 'screens.html')) {
      for (const width of [390, 360, 320]) {
        const browserPage = await browser.newPage({ viewport: { width, height: 844 } });
        await browserPage.goto(pathToFileURL(path.join(designDir, page.file)).href, { waitUntil: 'load' });
        const result = await browserPage.evaluate(() => ({ vw: document.documentElement.clientWidth, sw: document.documentElement.scrollWidth }));
        if (result.sw > result.vw + 1) err(`${page.file} ${width}px: 横scroll ${result.sw}>${result.vw}`);
        else ok(`${page.file} ${width}px: 横scrollなし`);
        if (width === 390) {
          const shot = path.join(outDir, `${page.file.replace('.html','')}-${width}.png`);
          await browserPage.screenshot({ path: shot, fullPage: true }); ok(`スクリーンショット ${path.relative(root, shot)}`);
        }
        await browserPage.close();
      }
    }
  } finally { await browser.close(); }
}
(async () => {
  if (!fs.existsSync(specPath)) throw new Error('.division/DESIGN.htmlがありません');
  const spec = fs.readFileSync(specPath, 'utf8'), specLight = lightTokens(spec), specDark = darkTokens(spec);
  const indexHtml = fs.readFileSync(path.join(designDir, 'index.html'), 'utf8'), indexRoot = lightTokens(indexHtml);
  for (const page of pages) staticChecks(page, specLight, specDark, indexRoot);
  console.log('\n== Orchestra Mobile デザイン確認 ==');
  for (const m of oks) console.log('  OK   ' + m);
  for (const m of warns) console.log('  WARN ' + m);
  for (const m of errors) console.log('  NG   ' + m);
  console.log(`\n静的結果: OK ${oks.length} / WARN ${warns.length} / NG ${errors.length}`);
  const previousWarnCount = warns.length;
  await browserChecks(pages);
  for (const m of warns.slice(previousWarnCount)) console.log('  WARN ' + m);
  console.log(`最終結果: ${errors.length ? '失敗' : '静的検査は合格'} / WARN ${warns.length} / NG ${errors.length}`);
  process.exit(errors.length ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
