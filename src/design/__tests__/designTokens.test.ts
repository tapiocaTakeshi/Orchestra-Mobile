/* eslint-disable @typescript-eslint/no-var-requires */
const fs = require('fs');
const path = require('path');

import { cssTokens, darkCssTokens } from '../tokens';
import { SCREEN_MAP, DRAWER_ORDER } from '../screenMap';

const ROOT = path.resolve(__dirname, '../../..');
const MOCK = path.join(ROOT, '.division/design/index.html');
const DESIGN = path.join(ROOT, '.division/DESIGN.html');

function read(p: string): string | null {
  return fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : null;
}

function parseRoot(block: string): Record<string, string> {
  const out: Record<string, string> = {};
  block.split(';').forEach((decl) => {
    const i = decl.indexOf(':');
    if (i < 0) return;
    const name = decl.slice(0, i).trim();
    if (!name.startsWith('--')) return;
    out[name] = decl.slice(i + 1).trim();
  });
  return out;
}

function rootBlocks(html: string): string[] {
  const re = /:root\s*\{([^}]*)\}/g;
  const blocks: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) blocks.push(m[1]);
  return blocks;
}

const norm = (v: string) => v.replace(/\s+/g, '').toLowerCase();

describe('design tokens', () => {
  const mock = read(MOCK);

  (mock ? it : it.skip)('index.html の :root と完全一致する', () => {
    const root = parseRoot(rootBlocks(mock as string)[0]);
    expect(Object.keys(root).sort()).toEqual(Object.keys(cssTokens).sort());
    Object.entries(cssTokens).forEach(([k, v]) => {
      expect([k, norm(root[k])]).toEqual([k, norm(v)]);
    });
  });

  const design = read(DESIGN);

  (design ? it : it.skip)('DESIGN.html のライト/ダークトークンと一致する', () => {
    const blocks = rootBlocks(design as string).map(parseRoot);
    const light = blocks[0];
    Object.entries(cssTokens).forEach(([k, v]) => {
      if (light[k] !== undefined) expect([k, norm(light[k])]).toEqual([k, norm(v)]);
    });
    const dark = blocks.find((b) => b['--color-bg'] && norm(b['--color-bg']) === norm(darkCssTokens['--color-bg']));
    if (dark) {
      Object.entries(darkCssTokens).forEach(([k, v]) => {
        if (dark[k] !== undefined) expect([k, norm(dark[k])]).toEqual([k, norm(v)]);
      });
    }
  });
});

describe('screen map', () => {
  const mock = read(MOCK);

  (mock ? it : it.skip)('index.html の全 data-screen が実装ファイルに割り当てられている', () => {
    const ids = Array.from(new Set(((mock as string).match(/data-screen="([\w-]+)"/g) || []).map((s) => s.slice(13, -1))));
    expect(ids.length).toBeGreaterThanOrEqual(7);
    const mapped = SCREEN_MAP.map((s) => s.id);
    const unmapped = ids.filter((id) => !mapped.includes(id));
    expect({ unmapped }).toEqual({ unmapped: [] });
  });

  it('割り当て先の画面ファイルが存在する', () => {
    const missing = SCREEN_MAP.filter((s) => !fs.existsSync(path.join(ROOT, s.file))).map((s) => s.file);
    expect({ missing }).toEqual({ missing: [] });
  });

  it('ドロワーの並びがすべて SCREEN_MAP にある', () => {
    DRAWER_ORDER.forEach((id) => {
      expect(SCREEN_MAP.find((s) => s.id === id)?.drawerLabel).toBeTruthy();
    });
  });

  // 後続の実装タスクの完了判定用: STRICT_MOCKUP=1 npx jest src/design
  (process.env.STRICT_MOCKUP === '1' ? it : it.skip)('各画面ファイルにモックの必須文言がある', () => {
    const lacks: Record<string, string[]> = {};
    SCREEN_MAP.forEach((s) => {
      const src = [s.file, ...(s.extraFiles ?? [])].map((f) => read(path.join(ROOT, f)) || '').join('\n');
      const skip = new Set(s.notImplemented ?? []);
      const miss = s.requiredTexts.filter((t) => !skip.has(t) && !src.includes(t));
      if (miss.length) lacks[s.id] = miss;
    });
    expect(lacks).toEqual({});
  });
});
