import * as fs from 'fs';
import * as path from 'path';
import { ColorName, cssVarOf, darkColors, lightColors, radius, space } from '../tokens';

const root = path.resolve(__dirname, '..', '..', '..');
const indexHtml = path.join(root, '.division', 'design', 'index.html');
const listHtml = path.join(root, '.division', 'design', 'orchestra-mobile-mockup.html');

function norm(v: string): string {
  return v.trim().toLowerCase().replace(/\s+/g, '');
}

function parseVars(block: string): Record<string, string> {
  const out: Record<string, string> = {};
  const re = /--([a-z0-9-]+)\s*:\s*([^;]+);/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(block))) out['--' + m[1]] = norm(m[2]);
  return out;
}

function rootBlock(html: string, from = 0): string {
  const start = html.indexOf(':root{', from);
  if (start < 0) return '';
  const end = html.indexOf('}', start);
  return html.slice(start, end);
}

const names = Object.keys(lightColors) as ColorName[];

describe('design tokens', () => {
  const hasIndex = fs.existsSync(indexHtml);
  (hasIndex ? it : it.skip)('light colors match .division/design/index.html :root', () => {
    const vars = parseVars(rootBlock(fs.readFileSync(indexHtml, 'utf8')));
    for (const n of names) {
      expect([cssVarOf(n), vars[cssVarOf(n)]]).toEqual([cssVarOf(n), norm(lightColors[n])]);
    }
  });

  (hasIndex ? it : it.skip)('space / radius match :root', () => {
    const vars = parseVars(rootBlock(fs.readFileSync(indexHtml, 'utf8')));
    for (const [k, v] of Object.entries(space)) expect(vars['--space-' + k]).toBe(`${v}px`);
    for (const [k, v] of Object.entries(radius)) expect(vars['--radius-' + k]).toBe(`${v}px`);
  });

  const hasList = fs.existsSync(listHtml);
  (hasList ? it : it.skip)('dark colors match prefers-color-scheme: dark :root', () => {
    const html = fs.readFileSync(listHtml, 'utf8');
    const darkAt = html.indexOf('prefers-color-scheme: dark');
    expect(darkAt).toBeGreaterThan(-1);
    const vars = parseVars(rootBlock(html, darkAt));
    for (const n of names) {
      expect([cssVarOf(n), vars[cssVarOf(n)]]).toEqual([cssVarOf(n), norm(darkColors[n])]);
    }
  });

  it('cssVarOf converts camelCase to CSS variable names', () => {
    expect(cssVarOf('bgSidebar')).toBe('--color-bg-sidebar');
    expect(cssVarOf('onAccent')).toBe('--color-on-accent');
  });
});
