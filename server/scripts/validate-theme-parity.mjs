#!/usr/bin/env node
// validate-theme-parity.mjs
// Phase 2 sustainability — verifies the theme-token system is intact.
//
// 8 checks:
//   1. Token parity — every theme file declares every token in base (theme.css).
//   2. Hex literals in enforced component CSS outside fallback chains / whitelist.
//   3. Palette rgba in enforced component CSS.
//   4. Every var(--token) reference resolves (tokens aggregated from all CSS + auto-discovered dynamic tokens).
//   5. HTML hygiene — zero <style> blocks, zero inline color/bg styles, zero JSX style={{}} with hex/rgba literals.
//   6. Switcher consistency — every theme-*.css on disk is registered; every registered theme has a file.
//   7. Font parity — every custom font in --font-* tokens is loaded in the HTML Google Fonts link.
//   8. Switcher swatch parity — every hex in a theme's THEMES.swatches array is declared in the theme's CSS file.
//
// Component CSS enforcement: all site/css/*.css EXCEPT those in SCOPED_EXEMPT (floating-chat.css, base.css).
// HTML scope: recursive scan of site/**/*.html + trips/**/*.html, filtered to files that link a theme stylesheet.
// Dynamic tokens: auto-discovered from inline style="--name:" / style={{'--name':}} / setProperty('--name') patterns.
//
// Exit 0 on full pass, 1 on any failure. Invoke via `npm run validate-themes` from server/.

import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { join, dirname, basename, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPO_ROOT = join(__dirname, '..', '..');

const PATHS = {
  themes: join(REPO_ROOT, 'site/css/themes'),
  cssDir: join(REPO_ROOT, 'site/css'),
  jsDir:  join(REPO_ROOT, 'site/js'),
  switcher: join(REPO_ROOT, 'site/js/theme-switcher.js'),
  siteDir: join(REPO_ROOT, 'site'),
  tripsDir: join(REPO_ROOT, 'trips'),
};

// Component files exempted from hex/rgba/palette-leak enforcement.
// floating-chat: deliberately scoped --fc-* palette, independent of site theme.
// base: architectural defaults (:root fallbacks overridden by theme files).
const SCOPED_EXEMPT = new Set(['floating-chat.css', 'base.css']);

const READER_THEME_SELECTORS = [
  '[data-reading-theme="sepia"]',
  '[data-reading-theme="light"]',
];
const INTENTIONAL_HARDCODE_CLASSES = [
  '.dark-dot',
  '.sepia-dot',
  '.light-dot',
];

// Specific hex literals that are intentional regardless of selector context.
const INTENTIONAL_HEX_CONTEXTS = [
  { file: 'app.css', hex: '#7a4a24', reason: 'bookshelf wooden-plank decoration' },
  { file: 'app.css', hex: '#5c3318', reason: 'bookshelf wooden-plank decoration' },
  { file: 'app.css', hex: '#4a2a12', reason: 'bookshelf wooden-plank decoration' },
  { file: 'itinerary.css', hex: '#fff', context: 'box-shadow', reason: 'map-pin outer ring (theme-agnostic white)' },
];

// Always-OK dynamic tokens (set by code at runtime). Auto-discovery supplements this list.
const BASELINE_DYNAMIC_TOKENS = new Set([
  'swatch', 'mood-color', 'stagger-delay', 'scale', 'fill-pct', 'font-scale',
]);

// System fonts that don't need Google Fonts loading. Anything else in --font-*
// must appear in the HTML <link> Google Fonts URL.
const SYSTEM_FONTS = new Set([
  'serif', 'sans-serif', 'monospace', 'cursive', 'fantasy',
  'system-ui', 'ui-sans-serif', 'ui-serif', 'ui-monospace', 'ui-rounded',
  'Georgia', 'Arial', 'Helvetica', 'Helvetica Neue', 'Times', 'Times New Roman',
  'Courier', 'Courier New', 'Verdana', 'Tahoma', 'Trebuchet MS',
  'Segoe UI', 'SF Pro Display', 'SF Pro Text', 'SF Mono', 'Menlo', 'Monaco', 'Consolas',
  'Apple Color Emoji', 'Segoe UI Emoji', 'Noto Color Emoji',
  'sans',
]);

const results = { pass: 0, fail: 0, checks: [] };

function record(name, passed, detailLines = []) {
  results.checks.push({ name, passed, detailLines });
  if (passed) results.pass++;
  else results.fail++;
}

function stripCssComments(css) {
  return css.replace(/\/\*[\s\S]*?\*\//g, ' ');
}

function extractTokens(css) {
  const stripped = stripCssComments(css);
  const out = new Set();
  for (const match of stripped.matchAll(/(?:^|\s|;|\{)--([\w-]+)\s*:/g)) out.add(match[1]);
  return out;
}

function extractTokenValues(css) {
  const stripped = stripCssComments(css);
  const out = new Map();
  for (const match of stripped.matchAll(/(?:^|\s|;|\{)--([\w-]+)\s*:\s*([^;]+);/g)) {
    out.set(match[1], match[2].trim());
  }
  return out;
}

function hexToRgb(hex) {
  const h = hex.replace('#', '').toLowerCase();
  if (h.length === 3) return [parseInt(h[0]+h[0], 16), parseInt(h[1]+h[1], 16), parseInt(h[2]+h[2], 16)];
  if (h.length === 6) return [parseInt(h.slice(0,2), 16), parseInt(h.slice(2,4), 16), parseInt(h.slice(4,6), 16)];
  return null;
}

function fileLines(path) {
  return readFileSync(path, 'utf8').split('\n');
}

function lineInReaderThemeBlock(lines, lineIndex) {
  let depth = 0;
  for (let i = lineIndex; i >= 0; i--) {
    const line = lines[i];
    for (let j = line.length - 1; j >= 0; j--) {
      const c = line[j];
      if (c === '}') depth++;
      else if (c === '{') {
        if (depth === 0) {
          const selectorText = lines.slice(Math.max(0, i - 3), i + 1).join(' ');
          if (READER_THEME_SELECTORS.some(sel => selectorText.includes(sel))) return true;
          return false;
        }
        depth--;
      }
    }
  }
  return false;
}

function lineMatchesIntentionalClass(line) {
  return INTENTIONAL_HARDCODE_CLASSES.some(cls => line.includes(cls));
}

function listEnforcedComponentFiles() {
  return readdirSync(PATHS.cssDir)
    .filter(f => f.endsWith('.css'))
    .filter(f => !SCOPED_EXEMPT.has(f));
}

function listAllComponentFiles() {
  return readdirSync(PATHS.cssDir).filter(f => f.endsWith('.css'));
}

// Recursive scan of site/**/*.html + trips/**/*.html, filtered to files that link the theme system.
function listHtmlFiles() {
  const found = [];
  function walk(dir) {
    if (!existsSync(dir)) return;
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (['node_modules', '.git', 'snapshots', 'receipts', 'voice-inbox', 'dead-letter'].includes(entry.name)) continue;
        walk(p);
      } else if (entry.isFile() && entry.name.endsWith('.html')) {
        found.push(p);
      }
    }
  }
  walk(PATHS.siteDir);
  walk(PATHS.tripsDir);
  // Filter to files that participate in the theme system.
  return found.filter(p => {
    const c = readFileSync(p, 'utf8');
    return c.includes('theme-stylesheet') || /themes\/theme(-[\w-]+)?\.css/.test(c);
  });
}

// Discover dynamic tokens: names set via inline style=, style={{}}, or setProperty().
// Scans JS, HTML, CSS component files.
function discoverDynamicTokens() {
  const dynamic = new Set(BASELINE_DYNAMIC_TOKENS);
  const sources = [];
  if (existsSync(PATHS.jsDir)) {
    for (const f of readdirSync(PATHS.jsDir)) {
      if (/\.(js|jsx|mjs|cjs)$/.test(f)) sources.push(join(PATHS.jsDir, f));
    }
  }
  sources.push(...listHtmlFiles());

  for (const path of sources) {
    const content = readFileSync(path, 'utf8');
    // 1. HTML inline: style="--xxx: ..."
    for (const m of content.matchAll(/style\s*=\s*["'][^"']*--([\w-]+)\s*:/g)) dynamic.add(m[1]);
    // 2. JSX: style={{ '--xxx': ... }} or style={{ "--xxx": ... }}
    for (const m of content.matchAll(/style\s*=\s*\{\s*\{[^}]*['"]--([\w-]+)['"]\s*:/g)) dynamic.add(m[1]);
    // 3. Imperative: element.style.setProperty('--xxx', ...)
    for (const m of content.matchAll(/setProperty\s*\(\s*['"]--([\w-]+)/g)) dynamic.add(m[1]);
  }
  return dynamic;
}

// Parse font-family values into individual family names.
function extractFontFamilies(fontValue) {
  return fontValue
    .split(',')
    .map(s => s.trim().replace(/^['"]|['"]$/g, ''))
    .filter(Boolean);
}

// From a Google Fonts CSS2 URL, extract the set of loaded family names.
function extractLoadedFonts(html) {
  const loaded = new Set();
  for (const m of html.matchAll(/href="https:\/\/fonts\.googleapis\.com\/css2\?([^"]+)"/g)) {
    for (const fm of m[1].matchAll(/family=([^&]+)/g)) {
      const raw = fm[1].split(':')[0];
      loaded.add(decodeURIComponent(raw.replace(/\+/g, ' ')));
    }
  }
  // Also accept self-hosted @font-face via explicit <link href*="fonts"> (e.g. opendyslexic)
  for (const m of html.matchAll(/href="[^"]*\/css\/([\w-]+)"/g)) {
    // Don't parse further — fine-grained font name unknown without CSS parse; accept as noise-safe
  }
  return loaded;
}

// ═══════════════════════════════════════════════════
// Check 1 — Token parity across themes
// ═══════════════════════════════════════════════════

function checkTokenParity() {
  const themeFiles = readdirSync(PATHS.themes).filter(f => f.endsWith('.css'));
  if (!themeFiles.includes('theme.css')) {
    record('[1/8] Token parity', false, ['theme.css not found — cannot establish baseline.']);
    return new Set();
  }
  const baseTokens = extractTokens(readFileSync(join(PATHS.themes, 'theme.css'), 'utf8'));
  const violations = [];
  const otherThemes = themeFiles.filter(f => f !== 'theme.css');
  for (const file of otherThemes) {
    const tokens = extractTokens(readFileSync(join(PATHS.themes, file), 'utf8'));
    const missing = [...baseTokens].filter(t => !tokens.has(t));
    const extra = [...tokens].filter(t => !baseTokens.has(t));
    if (missing.length) violations.push(`  ${file}: missing ${missing.length} token(s): ${missing.slice(0, 5).join(', ')}${missing.length > 5 ? ', …' : ''}`);
    if (extra.length) violations.push(`  ${file}: declares ${extra.length} extra token(s) not in base: ${extra.slice(0, 5).join(', ')}${extra.length > 5 ? ', …' : ''}`);
  }
  record('[1/8] Token parity across themes',
    violations.length === 0,
    violations.length === 0
      ? [`${themeFiles.length} theme files, ${baseTokens.size} tokens each — all parallel.`]
      : violations);
  return baseTokens;
}

// ═══════════════════════════════════════════════════
// Check 2 — Hex literals in enforced component CSS
// ═══════════════════════════════════════════════════

function checkHexInComponents() {
  const violations = [];
  const files = listEnforcedComponentFiles();
  for (const fname of files) {
    const path = join(PATHS.cssDir, fname);
    const lines = fileLines(path);
    for (let i = 0; i < lines.length; i++) {
      const rawLine = lines[i];
      const line = rawLine.replace(/\/\*.*?\*\//g, '');
      if (!line.match(/#[0-9a-fA-F]{3,6}\b/)) continue;
      const stripped = line.replace(/var\s*\(\s*--[\w-]+\s*,\s*[^)]+\)/g, '');
      if (!stripped.match(/#[0-9a-fA-F]{3,6}\b/)) continue;
      if (lineMatchesIntentionalClass(rawLine)) continue;
      if (lineInReaderThemeBlock(lines, i)) continue;
      if (line.match(/url\s*\([^)]*#[0-9a-fA-F]/)) continue;
      const hexMatches = [...stripped.matchAll(/#[0-9a-fA-F]{3,6}\b/g)].map(m => m[0]);
      const flagged = hexMatches.filter(hex => {
        return !INTENTIONAL_HEX_CONTEXTS.some(rule =>
          rule.file === fname && rule.hex.toLowerCase() === hex.toLowerCase() &&
          (rule.context === undefined || rawLine.includes(rule.context))
        );
      });
      if (flagged.length === 0) continue;
      violations.push(`  ${fname}:${i + 1}  ${flagged.join(', ')}  | ${rawLine.trim().slice(0, 80)}`);
    }
  }
  record('[2/8] Hex literals in enforced component CSS',
    violations.length === 0,
    violations.length === 0
      ? [`${files.length} file(s) scanned (exempt: ${[...SCOPED_EXEMPT].join(', ')}), 0 hex leaks.`]
      : [`${violations.length} hex literal(s):`, ...violations.slice(0, 25), violations.length > 25 ? `  … and ${violations.length - 25} more` : null].filter(Boolean));
}

// ═══════════════════════════════════════════════════
// Check 3 — Palette rgba in enforced component CSS
// ═══════════════════════════════════════════════════

function checkPaletteRgba() {
  const palette = new Set();
  const paletteSource = new Map();
  const themeFiles = readdirSync(PATHS.themes).filter(f => f.endsWith('.css'));
  for (const file of themeFiles) {
    const css = stripCssComments(readFileSync(join(PATHS.themes, file), 'utf8'));
    for (const m of css.matchAll(/#([0-9a-fA-F]{3,6})\b/g)) {
      const rgb = hexToRgb('#' + m[1]);
      if (!rgb) continue;
      const key = rgb.join(',');
      palette.add(key);
      if (!paletteSource.has(key)) paletteSource.set(key, { themes: new Set(), hex: '#' + m[1] });
      paletteSource.get(key).themes.add(file);
    }
  }

  const violations = [];
  const files = listEnforcedComponentFiles();
  for (const fname of files) {
    const path = join(PATHS.cssDir, fname);
    const lines = fileLines(path);
    for (let i = 0; i < lines.length; i++) {
      const rawLine = lines[i];
      const line = rawLine.replace(/\/\*.*?\*\//g, '');
      const stripped = line.replace(/var\s*\(\s*--[\w-]+\s*,\s*[^)]+\)/g, '');
      if (lineInReaderThemeBlock(lines, i)) continue;
      for (const m of stripped.matchAll(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,[^)]*)?\)/g)) {
        const r = parseInt(m[1]), g = parseInt(m[2]), b = parseInt(m[3]);
        if ((r === 0 && g === 0 && b === 0) || (r === 255 && g === 255 && b === 255)) continue;
        const key = `${r},${g},${b}`;
        if (palette.has(key)) {
          const src = paletteSource.get(key);
          violations.push(`  ${fname}:${i + 1}  rgba(${key},…) matches ${src.hex} (declared in ${[...src.themes].join(', ')})`);
        }
      }
    }
  }
  record('[3/8] Palette rgba in enforced component CSS',
    violations.length === 0,
    violations.length === 0
      ? [`${palette.size} palette triplets across ${themeFiles.length} themes — 0 leaks in ${files.length} enforced file(s).`]
      : [`${violations.length} palette-rgba leak(s):`, ...violations.slice(0, 25), violations.length > 25 ? `  … and ${violations.length - 25} more` : null].filter(Boolean));
}

// ═══════════════════════════════════════════════════
// Check 4 — Token reference validity
// ═══════════════════════════════════════════════════

function checkTokenReferences(baseTokens, dynamicTokens) {
  const globalTokens = new Set(baseTokens);
  for (const fname of listAllComponentFiles()) {
    for (const t of extractTokens(readFileSync(join(PATHS.cssDir, fname), 'utf8'))) globalTokens.add(t);
  }

  const unknown = new Map();
  for (const fname of listAllComponentFiles()) {
    const path = join(PATHS.cssDir, fname);
    const lines = fileLines(path);
    for (let i = 0; i < lines.length; i++) {
      const line = stripCssComments(lines[i]);
      for (const m of line.matchAll(/var\s*\(\s*--([\w-]+)/g)) {
        const token = m[1];
        if (globalTokens.has(token)) continue;
        if (dynamicTokens.has(token)) continue;
        if (!unknown.has(token)) unknown.set(token, []);
        unknown.get(token).push(`${fname}:${i + 1}`);
      }
    }
  }
  const violations = [];
  for (const [token, locs] of unknown) {
    violations.push(`  --${token}  (referenced at ${locs.slice(0, 3).join(', ')}${locs.length > 3 ? ` +${locs.length - 3} more` : ''})`);
  }
  record('[4/8] Token reference validity',
    violations.length === 0,
    violations.length === 0
      ? [`All var(--token) references resolve (${globalTokens.size} declared + ${dynamicTokens.size} dynamic).`]
      : [`${violations.length} undefined token(s):`, ...violations.slice(0, 15), violations.length > 15 ? `  … and ${violations.length - 15} more` : null].filter(Boolean));
}

// ═══════════════════════════════════════════════════
// Check 5 — HTML hygiene (incl. JSX style={{}} inside <script type="text/babel">)
// ═══════════════════════════════════════════════════

function checkHtmlHygiene() {
  const violations = [];
  const files = listHtmlFiles();
  for (const path of files) {
    const content = readFileSync(path, 'utf8');
    const rel = relative(REPO_ROOT, path);

    // <style> blocks — zero tolerance
    for (const m of content.matchAll(/<style\b[^>]*>/g)) {
      const line = content.slice(0, m.index).split('\n').length;
      violations.push(`  ${rel}:${line}  <style> block`);
    }

    // HTML attribute: style="..." with hex/rgba in color/bg properties
    for (const m of content.matchAll(/\bstyle\s*=\s*"([^"]*)"/g)) {
      const body = m[1];
      if (body.match(/(background|color|border[\w-]*|fill|stroke)\s*:\s*[^;]*(#[0-9a-fA-F]{3,6}|rgba?\()/i)) {
        const line = content.slice(0, m.index).split('\n').length;
        violations.push(`  ${rel}:${line}  inline style (HTML) with hex/rgba: ${body.slice(0, 70)}${body.length > 70 ? '…' : ''}`);
      }
    }

    // JSX inside <script type="text/babel"> blocks: style={{ ... }} with hex/rgba literals
    const babelBlockRegex = /<script\b[^>]*type\s*=\s*['"]text\/babel['"][^>]*>([\s\S]*?)<\/script>/g;
    for (const bMatch of content.matchAll(babelBlockRegex)) {
      const blockContent = bMatch[1];
      const blockStartOffset = bMatch.index + bMatch[0].indexOf(bMatch[1]);
      // Match JSX style={{ ... }}. Non-greedy, single-level.
      for (const sm of blockContent.matchAll(/style\s*=\s*\{\s*\{([^{}]*)\}\s*\}/g)) {
        const body = sm[1];
        // Fine to reference var(--x). Flag literal hex or rgba outside var() fallback.
        const cleanBody = body.replace(/var\s*\(\s*--[\w-]+\s*,\s*[^)]+\)/g, '');
        const hasHex = /['"]#[0-9a-fA-F]{3,6}['"]/.test(cleanBody);
        const hasRgba = /['"]\s*rgba?\s*\(/.test(cleanBody) || /rgba?\s*\(\s*\d+\s*,/.test(cleanBody);
        if (hasHex || hasRgba) {
          const absIdx = blockStartOffset + sm.index;
          const line = content.slice(0, absIdx).split('\n').length;
          violations.push(`  ${rel}:${line}  JSX style={{…}} with hex/rgba literal: ${body.slice(0, 70).replace(/\s+/g, ' ')}${body.length > 70 ? '…' : ''}`);
        }
      }
    }
  }
  record('[5/8] HTML hygiene (HTML + JSX inline styles)',
    violations.length === 0,
    violations.length === 0
      ? [`${files.length} HTML file(s) scanned — 0 <style> blocks, 0 inline hex/rgba styles (HTML + JSX).`]
      : [`${violations.length} violation(s):`, ...violations.slice(0, 20), violations.length > 20 ? `  … and ${violations.length - 20} more` : null].filter(Boolean));
}

// ═══════════════════════════════════════════════════
// Check 6 — Switcher consistency
// ═══════════════════════════════════════════════════

function checkSwitcherConsistency() {
  if (!existsSync(PATHS.switcher)) {
    return record('[6/8] Switcher consistency', false, [`Switcher script not found: ${PATHS.switcher}`]);
  }
  const js = readFileSync(PATHS.switcher, 'utf8');
  const themesArrayMatch = js.match(/const\s+THEMES\s*=\s*\[([\s\S]*?)\n\s*\]\s*;/);
  if (!themesArrayMatch) {
    return record('[6/8] Switcher consistency', false, ['Could not locate THEMES array in theme-switcher.js.']);
  }
  const arrayBody = themesArrayMatch[1];
  const fileRefs = [...arrayBody.matchAll(/file:\s*['"]([^'"]+)['"]/g)].map(m => m[1]);
  const onDisk = readdirSync(PATHS.themes).filter(f => f.endsWith('.css'));
  const missing = fileRefs.filter(f => !onDisk.includes(f));
  const unregistered = onDisk.filter(f => !fileRefs.includes(f));
  const violations = [];
  for (const f of missing) violations.push(`  registered but missing on disk: ${f}`);
  for (const f of unregistered) violations.push(`  on disk but not registered in THEMES: ${f}`);
  record('[6/8] Switcher consistency',
    violations.length === 0,
    violations.length === 0
      ? [`${fileRefs.length} theme(s) registered, ${onDisk.length} on disk — fully aligned.`]
      : violations);
}

// ═══════════════════════════════════════════════════
// Check 7 — Font parity (every font in --font-* is loaded in HTML)
// ═══════════════════════════════════════════════════

function checkFontParity() {
  // Collect every --font-* stack from every theme file. Skip alias tokens (values
  // that start with var(…) — they point to another token and the target stack is
  // checked on its own).
  const stacks = []; // [{ token, primary, families, source }]
  const themeFiles = readdirSync(PATHS.themes).filter(f => f.endsWith('.css'));
  for (const file of themeFiles) {
    const values = extractTokenValues(readFileSync(join(PATHS.themes, file), 'utf8'));
    for (const [name, value] of values) {
      if (!name.startsWith('font-')) continue;
      if (value.trim().startsWith('var(')) continue;
      const families = extractFontFamilies(value);
      // The "primary" family is the first non-system family — that's the author's
      // visual intent. Everything after is fallback.
      const primary = families.find(f => !SYSTEM_FONTS.has(f));
      if (!primary) continue; // Stack is entirely system/generic — always satisfied.
      stacks.push({ token: name, primary, families, source: file });
    }
  }

  const violations = [];
  const htmlFiles = listHtmlFiles();
  for (const path of htmlFiles) {
    const html = readFileSync(path, 'utf8');
    const loaded = extractLoadedFonts(html);
    const rel = relative(REPO_ROOT, path);
    const unmet = [];
    // Collect distinct unmet primary fonts across all stacks.
    const unmetSet = new Map(); // primary -> Set<source>
    for (const { token, primary, source } of stacks) {
      if (loaded.has(primary)) continue;
      if (!unmetSet.has(primary)) unmetSet.set(primary, new Set());
      unmetSet.get(primary).add(`${source}:--${token}`);
    }
    if (unmetSet.size > 0) {
      const details = [...unmetSet.entries()].map(([font, sources]) =>
        `${font} (needed by ${[...sources].slice(0, 2).join(', ')}${sources.size > 2 ? ` +${sources.size - 2} more` : ''})`
      );
      violations.push(`  ${rel}  missing ${unmetSet.size} primary font(s): ${details.join('; ')}`);
    }
  }
  const distinctPrimaries = new Set(stacks.map(s => s.primary)).size;
  record('[7/8] Font parity (themes ↔ HTML loaders)',
    violations.length === 0,
    violations.length === 0
      ? [`${stacks.length} font stack(s) across ${themeFiles.length} themes — ${distinctPrimaries} distinct primaries, all loaded in ${htmlFiles.length} HTML file(s).`]
      : [`${violations.length} HTML file(s) missing primary fonts:`, ...violations.slice(0, 10), violations.length > 10 ? `  … and ${violations.length - 10} more` : null].filter(Boolean));
}

// ═══════════════════════════════════════════════════
// Check 8 — Switcher swatch parity (swatches declared in their theme's CSS)
// ═══════════════════════════════════════════════════

function checkSwatchParity() {
  if (!existsSync(PATHS.switcher)) {
    return record('[8/8] Switcher swatch parity', false, ['Switcher script not found.']);
  }
  const js = readFileSync(PATHS.switcher, 'utf8');
  const themesArrayMatch = js.match(/const\s+THEMES\s*=\s*\[([\s\S]*?)\n\s*\]\s*;/);
  if (!themesArrayMatch) {
    return record('[8/8] Switcher swatch parity', false, ['Could not locate THEMES array.']);
  }

  // Parse each theme object — naive parse OK since format is controlled.
  const themes = [];
  const objectRegex = /\{\s*id:\s*['"]([^'"]+)['"][\s\S]*?file:\s*['"]([^'"]+)['"][\s\S]*?swatches:\s*\[([^\]]+)\]\s*\}/g;
  for (const m of themesArrayMatch[1].matchAll(objectRegex)) {
    const swatches = [...m[3].matchAll(/['"](#[0-9a-fA-F]+)['"]/g)].map(s => s[1].toLowerCase());
    themes.push({ id: m[1], file: m[2], swatches });
  }

  const violations = [];
  for (const { id, file, swatches } of themes) {
    const path = join(PATHS.themes, file);
    if (!existsSync(path)) continue;
    const css = stripCssComments(readFileSync(path, 'utf8')).toLowerCase();
    const missing = swatches.filter(s => !css.includes(s));
    if (missing.length) {
      violations.push(`  ${id} (${file})  swatch(es) not declared anywhere in theme file: ${missing.join(', ')}`);
    }
  }
  record('[8/8] Switcher swatch parity',
    violations.length === 0,
    violations.length === 0
      ? [`${themes.length} theme swatch set(s) — all hex values present in their theme files.`]
      : violations);
}

// ═══════════════════════════════════════════════════
// Main
// ═══════════════════════════════════════════════════

function emitReport() {
  const header = `Theme Parity Validator — ${new Date().toISOString()}`;
  const bar = '═'.repeat(Math.max(header.length, 60));
  console.log(bar);
  console.log(header);
  console.log(bar);
  for (const { name, passed, detailLines } of results.checks) {
    const status = passed ? 'PASS' : 'FAIL';
    const dots = '.'.repeat(Math.max(4, 62 - name.length));
    console.log(`${name} ${dots} ${status}`);
    for (const line of detailLines) console.log(line);
    if (detailLines.length) console.log('');
  }
  console.log(bar);
  const ok = results.fail === 0;
  console.log(`Summary: ${results.pass} passed, ${results.fail} failed.`);
  console.log(ok ? '✓ Theme system is in parity.' : '✗ Theme parity violations found — see details above.');
  console.log('');
  console.log('Remediation patterns:');
  console.log('  hex in background  →  var(--bg), var(--bg-secondary), var(--bg-tertiary)');
  console.log('  hex in color       →  var(--text), var(--text-muted), var(--contrast-dark)');
  console.log('  rgba(r,g,b,a)      →  color-mix(in srgb, var(--token) [a*100]%, transparent)');
  console.log('  undefined token    →  declare in every theme-*.css or correct the reference');
  console.log('  JSX style={{…}}    →  style={{ backgroundColor: "var(--bg)" }} or remove literal hex/rgba');
  console.log('  missing font       →  add family to <link href="https://fonts.googleapis.com/css2?…"> in all HTML loaders');
  console.log('  swatch mismatch    →  update swatches in theme-switcher.js or fix the theme file hex');
  return ok ? 0 : 1;
}

const baseTokens = checkTokenParity();
const dynamicTokens = discoverDynamicTokens();
checkHexInComponents();
checkPaletteRgba();
checkTokenReferences(baseTokens, dynamicTokens);
checkHtmlHygiene();
checkSwitcherConsistency();
checkFontParity();
checkSwatchParity();
process.exit(emitReport());
