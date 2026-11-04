#!/usr/bin/env node
/*
 * Division continuation survey
 * 既存計画・本体実装・モックアップ(.division/design/index.html)・DESIGN.html を突き合わせ、
 * 後続タスク用の対応表を .division/plan/continuation-report.{md,json} に出力する。
 * 依存なし / 読み取り専用（レポート出力以外にファイルを変更しない）。
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const ROOT = process.cwd();
const OUT_DIR = path.join(ROOT, '.division', 'plan');
const IGNORE = new Set(['node_modules', '.git', 'ios', 'android', 'dist', 'build', '.expo', 'web-build', 'coverage', 'screenshots']);

const read = (p) => { try { return fs.readFileSync(path.join(ROOT, p), 'utf8'); } catch (e) { return null; } };
const exists = (p) => fs.existsSync(path.join(ROOT, p));
const sh = (cmd) => { try { return execSync(cmd, { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(); } catch (e) { return null; } };
const stripTags = (s) => s.replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();
const uniq = (a) => Array.from(new Set(a));

function walk(dir, out) {
  out = out || [];
  let ents;
  try { ents = fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true }); } catch (e) { return out; }
  for (const e of ents) {
    if (IGNORE.has(e.name)) continue;
    const p = dir ? dir + '/' + e.name : e.name;
    if (e.isDirectory()) walk(p, out); else out.push(p);
  }
  return out;
}

/* ---------- 1. Mockup screens ---------- */
function parseScreens(html) {
  if (!html) return [];
  const parts = html.split(/<section\b/).slice(1).filter((s) => /data-screen="/.test(s.slice(0, 300)));
  return parts.map((raw, i) => {
    const body = raw.split(/<\/section>/)[0];
    const head = body.slice(0, 300);
    const id = (head.match(/data-screen="([^"]+)"/) || [])[1];
    const aria = (head.match(/aria-label="([^"]+)"/) || [])[1] || '';
    const label = stripTags((body.match(/class="screen-label">([\s\S]*?)<\/div>/) || [])[1] || '');
    const pageTitle = stripTags((body.match(/class="page-title">([\s\S]*?)<\/div>/) || [])[1] || '');
    const buttons = uniq((body.match(/<button[^>]*>[\s\S]*?<\/button>/g) || []).map(stripTags).filter(Boolean));
    const attr = (name) => uniq((body.match(new RegExp(name + '="([^"]+)"', 'g')) || []).map((m) => m.replace(new RegExp('^' + name + '="|"$', 'g'), '')));
    return {
      order: i + 1, id, ariaLabel: aria, screenLabel: label, pageTitle,
      buttons, go: attr('data-go'), actions: attr('data-action'), toasts: attr('data-toast'),
      filters: attr('data-filter'), prefills: attr('data-prefill'), switches: attr('data-name'),
      hasDrawer: /id="drawerLayer"/.test(body), hasSheet: /id="sheetLayer"/.test(body),
      hasApproval: /id="approvalBar"/.test(body),
    };
  });
}

/* ---------- 2. Tokens ---------- */
function parseVars(block) {
  const m = {};
  const re = /(--[\w-]+)\s*:\s*([^;}]+)/g;
  let r;
  while ((r = re.exec(block || ''))) m[r[1]] = r[2].trim().replace(/\s+/g, ' ');
  return m;
}
function tokens(css) {
  if (!css) return { light: {}, dark: {} };
  const light = parseVars((css.match(/:root\s*\{([^}]*)\}/) || [])[1]);
  const dark = parseVars((css.match(/prefers-color-scheme\s*:\s*dark\s*\)\s*\{\s*:root\s*\{([^}]*)\}/) || [])[1]);
  return { light, dark };
}
function diffTokens(a, b) {
  const keys = uniq(Object.keys(a).concat(Object.keys(b)));
  const out = { same: 0, mismatch: [], onlyA: [], onlyB: [] };
  for (const k of keys) {
    if (!(k in b)) out.onlyA.push(k);
    else if (!(k in a)) out.onlyB.push(k);
    else if (a[k].toLowerCase() === b[k].toLowerCase()) out.same++;
    else out.mismatch.push({ key: k, design: a[k], mock: b[k] });
  }
  return out;
}

/* ---------- 3. Project ---------- */
const pkgRaw = read('package.json');
let pkg = {};
try { pkg = pkgRaw ? JSON.parse(pkgRaw) : {}; } catch (e) { pkg = {}; }
const deps = Object.assign({}, pkg.dependencies || {}, pkg.devDependencies || {});
const depPick = Object.keys(deps).filter((d) => /^(expo|react|react-native|react-dom|@react-navigation\/|expo-router|@supabase\/|jest|jest-expo|@testing-library\/|typescript|react-native-safe-area-context|react-native-gesture-handler|react-native-reanimated)/.test(d)).sort();

const allFiles = walk('');
const srcFiles = allFiles.filter((f) => /^(src|app)\//.test(f) && /\.(tsx?|jsx?)$/.test(f));
const entryCandidates = ['App.tsx', 'App.js', 'index.js', 'index.ts', 'app/_layout.tsx', 'src/App.tsx', pkg.main].filter(Boolean);
const entries = uniq(entryCandidates).filter(exists);

const contentCache = {};
const content = (f) => (f in contentCache ? contentCache[f] : (contentCache[f] = read(f) || ''));
const codeFiles = uniq(srcFiles.concat(entries.filter((e) => /\.(tsx?|jsx?)$/.test(e))));

const navInfo = codeFiles.map((f) => {
  const c = content(f);
  const names = uniq((c.match(/<\w+\.Screen[^>]*?name=\{?["']([^"']+)["']/g) || []).map((m) => (m.match(/name=\{?["']([^"']+)["']/) || [])[1]));
  const libs = uniq((c.match(/from ['"](@react-navigation\/[\w-]+|expo-router)['"]/g) || []).map((m) => m.replace(/from ['"]|['"]/g, '')));
  return { file: f, names, libs };
}).filter((n) => n.names.length || n.libs.length);

const grepFiles = (re) => codeFiles.filter((f) => re.test(content(f)));
const authFiles = grepFiles(/supabase|signIn|DivisionAuth|useAuth/i);
const supabaseFiles = grepFiles(/@supabase\/|createClient\(|supabase\./);
const testFiles = allFiles.filter((f) => /(__tests__\/|\.test\.|\.spec\.)/.test(f) && !/node_modules/.test(f));

const hexByFile = codeFiles.map((f) => {
  const m = content(f).match(/['"`]#[0-9a-fA-F]{3,8}['"`]/g) || [];
  return { file: f, count: m.length };
}).filter((h) => h.count > 0).sort((a, b) => b.count - a.count);

const themeFiles = codeFiles.filter((f) => /theme|tokens|colors/i.test(f) || /faf9f5|b95a3a/i.test(content(f)));

/* ---------- 4. Plans ---------- */
const planDocs = allFiles.filter((f) => /^(\.division|docs)\//.test(f) && /\.(md|txt)$/i.test(f));
const openTodos = [];
for (const f of planDocs) {
  (content(f).split('\n')).forEach((line, i) => {
    if (/^\s*[-*]\s+\[ \]/.test(line)) openTodos.push({ file: f, line: i + 1, text: line.trim() });
  });
}
const screenMapSrc = read('src/design/screenMap.ts');

/* ---------- 5. Git ---------- */
const gitStatus = sh('git status --porcelain');
const gitLog = sh('git log --oneline -15');
const gitBranch = sh('git rev-parse --abbrev-ref HEAD');

/* ---------- 6. Mapping ---------- */
const mockHtml = read('.division/design/index.html');
const designHtml = read('.division/DESIGN.html');
const screens = parseScreens(mockHtml);
const tMock = tokens(mockHtml);
const tDesign = tokens(designHtml);
const tokenDiff = { light: diffTokens(tDesign.light, tMock.light), dark: diffTokens(tDesign.dark, tMock.dark) };

const KEYWORDS = {
  login: ['Login', 'SignIn', 'Auth', 'Welcome'],
  home: ['Home', 'Chat', 'Conversation'],
  projects: ['Project'],
  kanban: ['Kanban', 'Board', 'Task'],
  quick: ['Quick', 'Action', 'Discover'],
  mcp: ['Mcp', 'MCP'],
  remote: ['Remote', 'Pair', 'Connect', 'Device'],
  settings: ['Setting'],
  approval: ['Approval', 'Decision'],
};
const screenComponentFiles = srcFiles.filter((f) => /(screens?|app)\//i.test(f) && /\.(tsx|jsx)$/.test(f) && !/__tests__/.test(f));
const navNames = uniq([].concat.apply([], navInfo.map((n) => n.names)));

const mapping = screens.map((s) => {
  const kws = KEYWORDS[s.id] || [s.id.charAt(0).toUpperCase() + s.id.slice(1)];
  const candidates = screenComponentFiles.filter((f) => kws.some((k) => path.basename(f).toLowerCase().includes(k.toLowerCase())));
  const navHit = navNames.filter((n) => kws.some((k) => n.toLowerCase().includes(k.toLowerCase())));
  const texts = s.buttons.concat([s.ariaLabel, s.pageTitle]).filter((t) => t && t.length >= 2);
  const joined = candidates.map(content).join('\n');
  const found = texts.filter((t) => joined.includes(t.replace(/[▾↑←＋✎☰]/g, '').trim()));
  return {
    id: s.id, label: s.screenLabel || s.ariaLabel, candidates, navRegistered: navHit,
    textCoverage: texts.length ? found.length + '/' + texts.length : '-',
    missingTexts: texts.filter((t) => !found.includes(t)).slice(0, 12),
    interactions: { go: s.go, actions: s.actions, toasts: s.toasts.length, drawer: s.hasDrawer, sheet: s.hasSheet, approval: s.hasApproval, filters: s.filters, switches: s.switches, prefills: s.prefills.length },
    status: candidates.length === 0 ? '未実装（画面ファイルなし）' : (found.length === texts.length ? 'モック文言反映済み（見た目要確認）' : '既存あり・モック未反映'),
  };
});

/* ---------- 7. Output ---------- */
const report = {
  generatedAt: new Date().toISOString(),
  git: { branch: gitBranch, status: gitStatus ? gitStatus.split('\n') : [], log: gitLog ? gitLog.split('\n') : [] },
  package: { name: pkg.name, main: pkg.main, scripts: pkg.scripts || {}, deps: depPick.reduce((o, d) => (o[d] = deps[d], o), {}) },
  entries, navigation: navInfo, authFiles, supabaseFiles, testFiles, themeFiles, hexByFile,
  screens, mapping, tokenDiff,
  tokens: { lightCount: Object.keys(tDesign.light).length, darkCount: Object.keys(tDesign.dark).length, light: tDesign.light, dark: tDesign.dark },
  plans: { docs: planDocs, openTodos, screenMapPresent: !!screenMapSrc },
};

const L = [];
const tbl = (rows) => rows.map((r) => '| ' + r.map((c) => String(c == null ? '' : c).replace(/\|/g, '\\|').replace(/\n/g, ' ')).join(' | ') + ' |').join('\n');
L.push('# 続行地点レポート（自動生成）', '', '生成: ' + report.generatedAt + '  ', '生成元: `node scripts/division-survey.cjs`（読み取り専用）', '');
L.push('## 0. サマリ', '');
L.push('- モックアップ data-screen: **' + screens.length + ' 個** → ' + screens.map((s) => '`' + s.id + '`').join(', '));
L.push('- 未実装画面: ' + (mapping.filter((m) => !m.candidates.length).map((m) => '`' + m.id + '`').join(', ') || 'なし'));
L.push('- トークン差分（DESIGN.html vs index.html）: light 一致 ' + tokenDiff.light.same + ' / 不一致 ' + tokenDiff.light.mismatch.length + '、dark 一致 ' + tokenDiff.dark.same + ' / DESIGN のみ ' + tokenDiff.dark.onlyA.length);
L.push('- 未コミット変更: ' + report.git.status.length + ' 件（保持すること）');
L.push('- 未完了 TODO: ' + openTodos.length + ' 件', '');

L.push('## 1. 画面対応表（data-screen → 実装先）', '');
L.push(tbl([['#', 'data-screen', 'モック名', '実装候補', 'ナビ登録', '文言反映', '状態']].concat([['---', '---', '---', '---', '---', '---', '---']]).concat(
  mapping.map((m, i) => [i + 1, '`' + m.id + '`', m.label, m.candidates.join('<br>') || '—', m.navRegistered.join(', ') || '—', m.textCoverage, m.status]))));
L.push('');
L.push('### 1.1 画面ごとの操作・未反映文言', '');
for (const m of mapping) {
  const it = m.interactions;
  L.push('#### `' + m.id + '` — ' + m.label);
  L.push('- 遷移(data-go): ' + (it.go.join(', ') || '—'));
  L.push('- アクション: ' + (it.actions.join(', ') || '—') + (it.drawer ? ' / ドロワー' : '') + (it.sheet ? ' / シート' : '') + (it.approval ? ' / 承認バー' : ''));
  if (it.filters.length) L.push('- タブフィルタ: ' + it.filters.join(', '));
  if (it.switches.length) L.push('- スイッチ: ' + it.switches.join(', '));
  if (it.prefills) L.push('- 入力欄プリフィル: ' + it.prefills + ' 件（home へ遷移して composer に挿入）');
  L.push('- トースト: ' + it.toasts + ' 種');
  L.push('- 未反映文言: ' + (m.missingTexts.map((t) => '「' + t + '」').join(' ') || 'なし'), '');
}

L.push('## 2. アプリ構成', '');
L.push('- 起点: ' + (entries.map((e) => '`' + e + '`').join(', ') || '検出なし'));
L.push('- ナビゲーション:');
navInfo.forEach((n) => L.push('  - `' + n.file + '` libs=' + (n.libs.join(',') || '-') + ' screens=' + (n.names.join(',') || '-')));
L.push('- 認証関連: ' + (authFiles.map((f) => '`' + f + '`').join(', ') || '—'));
L.push('- Supabase 連携: ' + (supabaseFiles.map((f) => '`' + f + '`').join(', ') || '—'));
L.push('- テスト: ' + (testFiles.map((f) => '`' + f + '`').join(', ') || '—'));
L.push('- テーマ/トークン: ' + (themeFiles.map((f) => '`' + f + '`').join(', ') || '—'));
L.push('- 色の直書き（上位）: ' + (hexByFile.slice(0, 15).map((h) => '`' + h.file + '`(' + h.count + ')').join(', ') || 'なし'), '');

L.push('## 3. package.json', '');
L.push('