#!/usr/bin/env node
// validate-theme-parity.mjs
// Phase 2 sustainability — verifies the theme-token system is intact:
//   1. Every theme file declares every token in the base (theme.css).
//   2. Component CSS contains no hex literals outside fallback chains / known hardcodes.
//   3. Component CSS contains no palette-rgba literals (catches the rgba(43,34,64,...) class of bug).
//   4. Every var(--token) reference in component CSS resolves against theme.css.
//   5. The 3 theme-consuming HTML files carry zero <style> blocks and zero style="..." attrs with color/bg values.
//   6. Every theme-*.css file is registered in theme-switcher.js; every registered theme has a file on disk.
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
  switcher: join(REPO_ROOT, 'site/js/theme-switcher.js'),
};

const ENFORCED_COMPONENT_FILES = [
  'app.css',
  'itinerary.css',
  'ai-drawer.css',
  'theme-switcher.css',
];
const ADVISORY_COMPONENT_FILES = [
  'base.css',
  'floating-chat.css',
];

const READER_THEME_SELECTORS = [
  '[data-reading-theme="sepia"]',
  '[data-reading-theme="light"]',
];
const INTENTIONAL_HARDCODE_CLASSES = [
  '.dark-dot',
  '.sepia-dot',
  '.light-dot',
];

// Tokens set dynamically via inline style="--name:value" or style={{ '--name': value }}.
// These won't appear as declarations in CSS files — whitelist them for check 4.
const DYNAMIC_TOKENS = new Set([
  'swatch',       // theme-switcher.js injects --swatch on each swatch element
  'mood-color',   // chapter reader injects mood color per chapter
  'stagger-delay',// list stagger animations
  'scale',        // dynamic scale
  'fill-pct',     // progress bars
  'font-scale',   // reader font size preference
]);

// Specific hex literals that are intentional regardless of selector context.
// (Wooden shelf decorative gradient; box-shadow white ring on map pin.)
const INTENTIONAL_HEX_CONTEXTS = [
  { file: 'app.css', hex: '#7a4a24', reason: 'bookshelf wooden-plank decoration' },
  { file: 'app.css', hex: '#5c3318', reason: 'bookshelf wooden-plank decoration' },
  { file: 'app.css', hex: '#4a2a12', reason: 'bookshelf wooden-plank decoration' },
  { file: 'itinerary.css', hex: '#fff', context: 'box-shadow', reason: 'map-pin outer ring (theme-agnostic white)' },
];

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
  // Strip comments first so we don't match --xxx: inside /* ... */
  const stripped = stripCssComments(css);
  const out = new Set();
  // Match --name: preceded by whitespace, { or ; (so we don't match var(--name)... the `(` excludes it)
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
  if (h.length === 3) {
    return [parseInt(h[0] + h[0], 16), parseInt(h[1] + h[1], 16), parseInt(h[2] + h[2], 16)];
  }
  if (h.length === 6) {
    return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
  }
  return null;
}

function fileLines(path) {
  return readFileSync(path, 'utf8').split('\n');
}

function lineInReaderThemeBlock(lines, lineIndex) {
  // A line is inside a reader-theme block if the nearest unclosed selector above it matches.
  // Cheap heuristic: search backward for a line containing a reader-theme selector until we hit a `}` at zero depth.
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

// ═══════════════════════════════════════════════════
// Check 1 — Token parity
// ═══════════════════════════════════════════════════

function checkTokenParity() {
  const themeFiles = readdirSync(PATHS.themes).filter(f => f.endsWith('.css'));
  if (!themeFiles.includes('theme.css')) {
    return record('[1/6] Token parity', false, ['theme.css not found — cannot establish baseline.']);
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
  record('[1/6] Token parity',
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
  for (const fname of ENFORCED_COMPONENT_FILES) {
    const path = join(PATHS.cssDir, fname);
    if (!existsSync(path)) continue;
    const lines = fileLines(path);
    for (let i = 0; i < lines.length; i++) {
      const rawLine = lines[i];
      // Strip inline comments first, keep only code
      const line = rawLine.replace(/\/\*.*?\*\//g, '');
      if (!line.match(/#[0-9a-fA-F]{3,6}\b/)) continue;
      // Strip fallback chains: var(--x, #hex) — the hex is allowed there
      const stripped = line.replace(/var\s*\(\s*--[\w-]+\s*,\s*[^)]+\)/g, '');
      if (!stripped.match(/#[0-9a-fA-F]{3,6}\b/)) continue;
      // Intentional hardcode classes (reader-pref dots)
      if (lineMatchesIntentionalClass(rawLine)) continue;
      // Reader-theme override blocks
      if (lineInReaderThemeBlock(lines, i)) continue;
      // url() data URIs
      if (line.match(/url\s*\([^)]*#[0-9a-fA-F]/)) continue;
      const hexMatches = [...stripped.matchAll(/#[0-9a-fA-F]{3,6}\b/g)].map(m => m[0]);
      // Filter out intentional hardcodes
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
  record('[2/6] Hex literals in enforced component CSS',
    violations.length === 0,
    violations.length === 0
      ? [`${ENFORCED_COMPONENT_FILES.length} files scanned, 0 hex leaks.`]
      : [`${violations.length} hex literal(s) in enforced component CSS:`, ...violations.slice(0, 25), violations.length > 25 ? `  … and ${violations.length - 25} more` : null].filter(Boolean));
}

// ═══════════════════════════════════════════════════
// Check 3 — Palette rgba in enforced component CSS
// ═══════════════════════════════════════════════════

function checkPaletteRgba(baseTokens) {
  // Build the palette: extract every hex value from every theme file.
  const palette = new Set(); // stringified "r,g,b"
  const paletteSource = new Map(); // "r,g,b" -> {themes: Set<string>, hex: string}
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
  for (const fname of ENFORCED_COMPONENT_FILES) {
    const path = join(PATHS.cssDir, fname);
    if (!existsSync(path)) continue;
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
          violations.push(`  ${fname}:${i + 1}  rgba(${key},…) matches ${src.hex} (used in ${[...src.themes].join(', ')})`);
        }
      }
    }
  }
  record('[3/6] Palette rgba in enforced component CSS',
    violations.length === 0,
    violations.length === 0
      ? [`${palette.size} palette triplets across ${themeFiles.length} themes — 0 leaks in enforced files.`]
      : [`${violations.length} palette-rgba leak(s):`, ...violations.slice(0, 25), violations.length > 25 ? `  … and ${violations.length - 25} more` : null].filter(Boolean));
}

// ═══════════════════════════════════════════════════
// Check 4 — Token reference validity
// ═══════════════════════════════════════════════════

function checkTokenReferences(baseTokens) {
  // Build a global pool: base theme tokens + tokens declared anywhere in site/css/*.css (component files
  // may declare their own scoped tokens, e.g. --fc-*, --z-nav).
  const globalTokens = new Set(baseTokens);
  const allCssFiles = [...ENFORCED_COMPONENT_FILES, ...ADVISORY_COMPONENT_FILES];
  for (const fname of allCssFiles) {
    const path = join(PATHS.cssDir, fname);
    if (!existsSync(path)) continue;
    for (const t of extractTokens(readFileSync(path, 'utf8'))) globalTokens.add(t);
  }

  const unknown = new Map(); // token -> [file:line, ...]
  for (const fname of allCssFiles) {
    const path = join(PATHS.cssDir, fname);
    if (!existsSync(path)) continue;
    const lines = fileLines(path);
    for (let i = 0; i < lines.length; i++) {
      const line = stripCssComments(lines[i]);
      for (const m of line.matchAll(/var\s*\(\s*--([\w-]+)/g)) {
        const token = m[1];
        if (globalTokens.has(token)) continue;
        if (DYNAMIC_TOKENS.has(token)) continue;
        if (!unknown.has(token)) unknown.set(token, []);
        unknown.get(token).push(`${fname}:${i + 1}`);
      }
    }
  }
  const violations = [];
  for (const [token, locs] of unknown) {
    violations.push(`  --${token}  (referenced at ${locs.slice(0, 3).join(', ')}${locs.length > 3 ? ` +${locs.length - 3} more` : ''})`);
  }
  record('[4/6] Token reference validity',
    violations.length === 0,
    violations.length === 0
      ? [`All var(--token) references resolve (${globalTokens.size} declared tokens + ${DYNAMIC_TOKENS.size} dynamic whitelisted).`]
      : [`${violations.length} undefined token(s):`, ...violations.slice(0, 15), violations.length > 15 ? `  … and ${violations.length - 15} more` : null].filter(Boolean));
}

// ═══════════════════════════════════════════════════
// Check 5 — HTML hygiene
// ═══════════════════════════════════════════════════

function listHtmlFiles() {
  const files = [join(REPO_ROOT, 'site/index.html')];
  const itinDir = join(REPO_ROOT, 'site/itineraries');
  if (existsSync(itinDir)) {
    for (const f of readdirSync(itinDir)) {
      if (f.endsWith('.html')) files.push(join(itinDir, f));
    }
  }
  const tripsDir = join(REPO_ROOT, 'trips');
  if (existsSync(tripsDir)) {
    for (const slug of readdirSync(tripsDir)) {
      const slugPath = join(tripsDir, slug);
      if (statSync(slugPath).isDirectory()) {
        const itin = join(slugPath, 'itinerary.html');
        if (existsSync(itin)) files.push(itin);
      }
    }
  }
  return files;
}

function checkHtmlHygiene() {
  const violations = [];
  const files = listHtmlFiles();
  for (const path of files) {
    const content = readFileSync(path, 'utf8');
    const rel = relative(REPO_ROOT, path);
    // <style> blocks
    const styleBlockMatches = [...content.matchAll(/<style\b[^>]*>/g)];
    for (const m of styleBlockMatches) {
      const line = content.slice(0, m.index).split('\n').length;
      violations.push(`  ${rel}:${line}  <style> block`);
    }
    // style="..." attributes containing color/background/color-like property with hex or rgba
    const inlineStyleMatches = [...content.matchAll(/\bstyle\s*=\s*"([^"]*)"/g)];
    for (const m of inlineStyleMatches) {
      const body = m[1];
      if (body.match(/(background|color|border[\w-]*|fill|stroke)\s*:\s*[^;]*(#[0-9a-fA-F]{3,6}|rgba?\()/i)) {
        const line = content.slice(0, m.index).split('\n').length;
        violations.push(`  ${rel}:${line}  inline style with hex/rgba: ${body.slice(0, 70)}${body.length > 70 ? '…' : ''}`);
      }
    }
  }
  record('[5/6] HTML hygiene',
    violations.length === 0,
    violations.length === 0
      ? [`${files.length} HTML file(s) scanned — 0 <style> blocks, 0 inline color/bg styles.`]
      : [`${violations.length} violation(s):`, ...violations.slice(0, 20), violations.length > 20 ? `  … and ${violations.length - 20} more` : null].filter(Boolean));
}

// ═══════════════════════════════════════════════════
// Check 6 — Switcher consistency
// ═══════════════════════════════════════════════════

function checkSwitcherConsistency() {
  if (!existsSync(PATHS.switcher)) {
    return record('[6/6] Switcher consistency', false, [`Switcher script not found: ${PATHS.switcher}`]);
  }
  const js = readFileSync(PATHS.switcher, 'utf8');
  const themesArrayMatch = js.match(/const\s+THEMES\s*=\s*\[([\s\S]*?)\n\s*\]\s*;/);
  if (!themesArrayMatch) {
    return record('[6/6] Switcher consistency', false, ['Could not locate THEMES array in theme-switcher.js.']);
  }
  const arrayBody = themesArrayMatch[1];
  const fileRefs = [...arrayBody.matchAll(/file:\s*['"]([^'"]+)['"]/g)].map(m => m[1]);
  const onDisk = readdirSync(PATHS.themes).filter(f => f.endsWith('.css'));
  const missing = fileRefs.filter(f => !onDisk.includes(f));
  const unregistered = onDisk.filter(f => !fileRefs.includes(f));
  const violations = [];
  for (const f of missing) violations.push(`  registered but missing on disk: ${f}`);
  for (const f of unregistered) violations.push(`  on disk but not registered in THEMES: ${f}`);
  record('[6/6] Switcher consistency',
    violations.length === 0,
    violations.length === 0
      ? [`${fileRefs.length} theme(s) registered, ${onDisk.length} on disk — fully aligned.`]
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
    const dots = '.'.repeat(Math.max(4, 58 - name.length));
    console.log(`${name} ${dots} ${status}`);
    for (const line of detailLines) console.log(line);
    if (detailLines.length) console.log('');
  }
  console.log(bar);
  const ok = results.fail === 0;
  console.log(`Summary: ${results.pass} passed, ${results.fail} failed.`);
  console.log(ok ? '✓ Theme system is in parity.' : '✗ Theme parity violations found — see details above.');
  console.log('');
  console.log('Remediation patterns (when fixing component CSS):');
  console.log('  hex in background  →  var(--bg), var(--bg-secondary), var(--bg-tertiary)');
  console.log('  hex in color       →  var(--text), var(--text-muted), var(--contrast-dark)');
  console.log('  rgba(r,g,b,a)      →  color-mix(in srgb, var(--token) [a*100]%, transparent)');
  console.log('  undefined token    →  declare in every theme-*.css or correct the reference');
  return ok ? 0 : 1;
}

const baseTokens = checkTokenParity();
checkHexInComponents();
checkPaletteRgba(baseTokens);
checkTokenReferences(baseTokens);
checkHtmlHygiene();
checkSwitcherConsistency();
process.exit(emitReport());
