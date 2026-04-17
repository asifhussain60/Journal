// routes/theme.js — tweaker endpoints.
//   POST /api/theme-swatches  — Haiku, returns 4 compatible color suggestions for the user's current edit.
//   POST /api/theme-review    — Sonnet, holistic pre-save review of accumulated changes.
//   POST /api/theme-save      — No model. Writes token mutations + scoped overrides back to disk.
//
// The save endpoint invokes `npm run validate-themes` as a subprocess before
// committing the write. If the validator rejects, the file is not modified and
// the client receives the violations for display.

import express from "express";
import { readFile, writeFile, rename } from "node:fs/promises";
import { existsSync } from "node:fs";
import { spawn, execFile } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadPrompt } from "../prompts/index.js";
import { extractJsonObject } from "../util/json.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.join(__dirname, "..", "..", "..");
const THEMES_DIR = path.join(REPO_ROOT, "site/css/themes");
const SWITCHER_FILE = path.join(REPO_ROOT, "site/js/theme-switcher.js");
const SERVER_DIR = path.join(REPO_ROOT, "server");

const OVERRIDES_HEADER = "/* ─── TWEAKER OVERRIDES (managed by theme-save; edit carefully) ─── */";
const OVERRIDES_FOOTER = "/* ─── END TWEAKER OVERRIDES ─── */";

export function createThemeRouter({ anthropic, DEFAULT_MODEL, themeSaveValidator }) {
  const router = express.Router();

  // ─── POST /api/theme-swatches ──────────────────────────────────────────────
  // Body: { currentColor, role, activePalette, context? }
  router.post("/api/theme-swatches", async (req, res) => {
    const { currentColor, role, activePalette, context } = req.body ?? {};
    if (typeof currentColor !== "string" || !/^#[0-9a-fA-F]{3,6}$/.test(currentColor)) {
      return res.status(400).json({ ok: false, error: "currentColor (hex) required" });
    }
    if (!["bg", "fg", "accent", "border"].includes(role)) {
      return res.status(400).json({ ok: false, error: "role must be bg|fg|accent|border" });
    }
    if (!activePalette || typeof activePalette !== "object") {
      return res.status(400).json({ ok: false, error: "activePalette (object) required" });
    }
    req.body.promptName = "theme-swatches";
    try {
      const prompt = loadPrompt("theme-swatches");
      const payload = { currentColor, role, activePalette, context: context ?? null };
      const msg = await anthropic.messages.create({
        model: prompt.model ?? DEFAULT_MODEL,
        max_tokens: 800,
        system: prompt.system,
        messages: [{ role: "user", content: JSON.stringify(payload, null, 2) }],
      });
      const text = msg.content.filter((b) => b.type === "text").map((b) => b.text).join("").trim();
      let parsed;
      try {
        parsed = extractJsonObject(text);
      } catch {
        return res.status(502).json({ ok: false, error: "model returned non-JSON output", rawText: text });
      }
      if (!parsed || !Array.isArray(parsed.swatches)) {
        return res.status(502).json({ ok: false, error: "model output missing swatches[]", rawText: text });
      }
      // Per-swatch schema: hex must be a 6-digit lowercase hex, label must be
      // a short string. Drop anything malformed rather than trusting the model.
      const cleaned = parsed.swatches
        .filter((s) => s && typeof s.hex === "string" && /^#[0-9a-fA-F]{6}$/.test(s.hex) && typeof s.label === "string" && s.label.trim())
        .map((s) => ({
          hex: s.hex.toLowerCase(),
          label: String(s.label).trim().slice(0, 40),
          contrastAA: Boolean(s.contrastAA),
          rationale: typeof s.rationale === "string" ? s.rationale.slice(0, 200) : "",
        }));
      if (cleaned.length === 0) {
        return res.status(502).json({ ok: false, error: "all swatches failed validation", rawText: text });
      }
      res.json({ ok: true, model: msg.model, usage: msg.usage, promptName: prompt.name, swatches: cleaned });
    } catch (err) {
      res.status(502).json({ ok: false, error: err?.message ?? String(err) });
    }
  });

  // ─── POST /api/theme-review ────────────────────────────────────────────────
  // Body: { activeTheme, baselineTokens, pendingChanges }
  router.post("/api/theme-review", async (req, res) => {
    const { activeTheme, baselineTokens, pendingChanges } = req.body ?? {};
    if (!activeTheme || typeof activeTheme !== "object") {
      return res.status(400).json({ ok: false, error: "activeTheme required" });
    }
    if (!baselineTokens || typeof baselineTokens !== "object") {
      return res.status(400).json({ ok: false, error: "baselineTokens required" });
    }
    if (!Array.isArray(pendingChanges)) {
      return res.status(400).json({ ok: false, error: "pendingChanges (array) required" });
    }
    req.body.promptName = "theme-review";
    try {
      const prompt = loadPrompt("theme-review");
      const payload = { activeTheme, baselineTokens, pendingChanges };
      const msg = await anthropic.messages.create({
        model: prompt.model ?? DEFAULT_MODEL,
        max_tokens: 1500,
        system: prompt.system,
        messages: [{ role: "user", content: JSON.stringify(payload, null, 2) }],
      });
      const text = msg.content.filter((b) => b.type === "text").map((b) => b.text).join("").trim();
      let parsed;
      try {
        parsed = extractJsonObject(text);
      } catch {
        return res.status(502).json({ ok: false, error: "model returned non-JSON output", rawText: text });
      }
      if (!parsed || typeof parsed.assessment !== "string") {
        return res.status(502).json({ ok: false, error: "model output missing assessment", rawText: text });
      }
      res.json({
        ok: true,
        model: msg.model,
        usage: msg.usage,
        promptName: prompt.name,
        review: {
          assessment: parsed.assessment,
          flagged: Array.isArray(parsed.flagged) ? parsed.flagged : [],
          suggestedTweaks: Array.isArray(parsed.suggestedTweaks) ? parsed.suggestedTweaks : [],
        },
      });
    } catch (err) {
      res.status(502).json({ ok: false, error: err?.message ?? String(err) });
    }
  });

  // ─── POST /api/theme-save ──────────────────────────────────────────────────
  // Body: { schemaVersion, mode, slug, baseSlug?, name?, description?, category?, swatches?, tokenMutations[], scopedOverrides[] }
  router.post("/api/theme-save", async (req, res) => {
    if (!themeSaveValidator(req.body ?? {})) {
      return res.status(400).json({
        ok: false,
        error: "schema validation failed",
        details: themeSaveValidator.errors,
      });
    }
    const body = req.body;
    try {
      let writePath;
      let writeContent;
      let switcherPatch = null;

      if (body.mode === "overwrite") {
        writePath = path.join(THEMES_DIR, `theme-${body.slug}.css`);
        if (body.slug === "rose-mauve-night") writePath = path.join(THEMES_DIR, "theme.css");
        if (!existsSync(writePath)) {
          return res.status(404).json({ ok: false, error: `theme file not found: ${path.basename(writePath)}` });
        }
        const original = await readFile(writePath, "utf8");
        writeContent = applyMutationsToThemeCss(original, body.tokenMutations, body.scopedOverrides);
      } else {
        // mode = new
        const baseFile =
          body.baseSlug === "rose-mauve-night"
            ? path.join(THEMES_DIR, "theme.css")
            : path.join(THEMES_DIR, `theme-${body.baseSlug}.css`);
        if (!existsSync(baseFile)) {
          return res.status(404).json({ ok: false, error: `base theme not found: ${body.baseSlug}` });
        }
        const newFile = path.join(THEMES_DIR, `theme-${body.slug}.css`);
        if (existsSync(newFile)) {
          return res.status(409).json({ ok: false, error: `theme slug already exists: ${body.slug}` });
        }
        const baseContent = await readFile(baseFile, "utf8");
        writeContent = applyMutationsToThemeCss(baseContent, body.tokenMutations, body.scopedOverrides);
        writePath = newFile;
        switcherPatch = buildSwitcherEntry(body);
      }

      // Stage the write to a temp file, run validator, then rename on success.
      const tempPath = writePath + `.tmp-${Date.now()}`;
      await writeFile(tempPath, writeContent, "utf8");

      // Swap in the tempPath to the real path atomically so the validator sees it.
      // Preserve original for rollback if validator fails.
      let originalContent = null;
      if (existsSync(writePath) && body.mode === "overwrite") {
        originalContent = await readFile(writePath, "utf8");
      }
      await rename(tempPath, writePath);

      // If mode=new, also patch the switcher in-memory; but the switcher check
      // requires both sides to match, so we write the switcher patch BEFORE
      // running the validator.
      let switcherOriginal = null;
      if (switcherPatch) {
        switcherOriginal = await readFile(SWITCHER_FILE, "utf8");
        const patched = insertThemeIntoSwitcher(switcherOriginal, switcherPatch);
        await writeFile(SWITCHER_FILE, patched, "utf8");
      }

      // Run validator as subprocess.
      const validatorResult = await runValidator();
      if (!validatorResult.ok) {
        // Roll back.
        if (body.mode === "overwrite" && originalContent !== null) {
          await writeFile(writePath, originalContent, "utf8");
        } else {
          // Delete the new file we just wrote.
          try {
            const { unlink } = await import("node:fs/promises");
            await unlink(writePath);
          } catch {}
        }
        if (switcherOriginal !== null) {
          await writeFile(SWITCHER_FILE, switcherOriginal, "utf8");
        }
        return res.status(400).json({
          ok: false,
          error: "theme-parity validator rejected the save",
          validator: validatorResult.output,
        });
      }

      res.json({
        ok: true,
        mode: body.mode,
        slug: body.slug,
        path: path.relative(REPO_ROOT, writePath),
        tokenMutations: body.tokenMutations.length,
        scopedOverrides: body.scopedOverrides.length,
      });
    } catch (err) {
      res.status(500).json({ ok: false, error: err?.message ?? String(err) });
    }
  });

  // ─── POST /api/theme-reset ─────────────────────────────────────────────────
  // Revert a theme CSS file to its git-HEAD "original default" state. This is
  // what the tweaker's Reset action calls. Only themes present in git HEAD are
  // resettable — freshly-created-in-session themes have no baseline and return
  // 404 so the UI can surface a clear message.
  //
  // Body: { slug }
  // Flow: read from git → stage write → run validator → rollback on failure.
  router.post("/api/theme-reset", async (req, res) => {
    const slug = typeof req.body?.slug === "string" ? req.body.slug.trim() : "";
    if (!slug) {
      return res.status(400).json({ ok: false, error: "slug required" });
    }
    // Shape matches theme-save.
    const fileName = slug === "rose-mauve-night" ? "theme.css" : `theme-${slug}.css`;
    const writePath = path.join(THEMES_DIR, fileName);
    const repoRelPath = path.relative(REPO_ROOT, writePath);

    try {
      // Fetch the pristine content straight from git's object store — no
      // working-tree dependency, so this also works mid-rebase or with
      // unstaged edits elsewhere.
      const pristine = await new Promise((resolve, reject) => {
        execFile(
          "git",
          ["show", `HEAD:${repoRelPath}`],
          { cwd: REPO_ROOT, encoding: "utf8", maxBuffer: 4 * 1024 * 1024 },
          (err, stdout) => {
            if (err) reject(err);
            else resolve(stdout);
          }
        );
      }).catch((err) => {
        const msg = String(err?.stderr || err?.message || err);
        // git emits "exists on disk, but not in 'HEAD'" or similar for
        // untracked/new files — surface a 404 so the client can explain.
        if (/not in|does not exist|exists on disk/i.test(msg)) {
          return { __notFound: true };
        }
        throw err;
      });

      if (pristine && pristine.__notFound) {
        return res.status(404).json({
          ok: false,
          error: `theme "${slug}" has no original state in git — Reset is only available for themes checked into the repo`,
        });
      }
      if (typeof pristine !== "string" || !pristine.length) {
        return res.status(500).json({ ok: false, error: "git HEAD returned empty content" });
      }

      // Preserve current content for rollback if the validator rejects.
      const originalContent = existsSync(writePath)
        ? await readFile(writePath, "utf8")
        : null;

      // Atomic-ish write via temp + rename so a concurrent reader never sees
      // a half-written file.
      const tempPath = writePath + `.tmp-${Date.now()}`;
      await writeFile(tempPath, pristine, "utf8");
      await rename(tempPath, writePath);

      const validatorResult = await runValidator();
      if (!validatorResult.ok) {
        if (originalContent !== null) {
          await writeFile(writePath, originalContent, "utf8");
        }
        return res.status(500).json({
          ok: false,
          error: "theme-parity validator rejected the reset — unexpected since git HEAD should already pass",
          validator: validatorResult.output,
        });
      }

      res.json({
        ok: true,
        slug,
        path: repoRelPath,
        bytesWritten: pristine.length,
      });
    } catch (err) {
      res.status(500).json({ ok: false, error: err?.message ?? String(err) });
    }
  });

  return router;
}

// ═══════════════════════════════════════════════════
// Theme CSS serialization
// ═══════════════════════════════════════════════════

function applyMutationsToThemeCss(css, tokenMutations, scopedOverrides) {
  let output = css;

  // 1. Token mutations — replace `--name: oldValue;` with `--name: newValue;`.
  //    Preserves surrounding whitespace/comments.
  for (const { name, value } of tokenMutations) {
    const escapedName = name.replace(/[-/\\^$*+?.()|[\]{}]/g, "\\$&");
    const pattern = new RegExp(`(${escapedName}\\s*:\\s*)([^;]+)(;)`, "g");
    output = output.replace(pattern, `$1${value}$3`);
  }

  // 2. Scoped overrides — manage a labeled section at the bottom of the file.
  //    Parse any existing overrides, merge the new ones by selector+property,
  //    rewrite the whole section.
  const existingOverrides = extractExistingOverrides(output);
  const stripped = stripOverridesSection(output);
  const merged = mergeOverrides(existingOverrides, scopedOverrides);
  const rendered = renderOverridesSection(merged);
  output = stripped.trimEnd() + (merged.length ? "\n\n" + rendered + "\n" : "\n");

  return output;
}

function extractExistingOverrides(css) {
  const startIdx = css.indexOf(OVERRIDES_HEADER);
  if (startIdx === -1) return [];
  const endIdx = css.indexOf(OVERRIDES_FOOTER, startIdx);
  if (endIdx === -1) return [];
  const body = css.slice(startIdx + OVERRIDES_HEADER.length, endIdx);
  const out = [];
  const rules = [...body.matchAll(/([^{]+)\{\s*([a-z-]+)\s*:\s*([^;]+)\s*;\s*\}/g)];
  for (const m of rules) {
    out.push({ selector: m[1].trim(), property: m[2].trim(), value: m[3].trim() });
  }
  return out;
}

function stripOverridesSection(css) {
  const startIdx = css.indexOf(OVERRIDES_HEADER);
  if (startIdx === -1) return css;
  const endIdx = css.indexOf(OVERRIDES_FOOTER, startIdx);
  if (endIdx === -1) return css;
  return css.slice(0, startIdx) + css.slice(endIdx + OVERRIDES_FOOTER.length);
}

function mergeOverrides(existing, incoming) {
  const map = new Map();
  for (const o of existing) map.set(`${o.selector}|${o.property}`, o);
  for (const o of incoming) map.set(`${o.selector}|${o.property}`, o);
  return [...map.values()];
}

function renderOverridesSection(overrides) {
  const body = overrides
    .map((o) => `${o.selector} { ${o.property}: ${o.value}; }`)
    .join("\n");
  return `${OVERRIDES_HEADER}\n${body}\n${OVERRIDES_FOOTER}`;
}

// ═══════════════════════════════════════════════════
// Switcher patching for new-theme mode
// ═══════════════════════════════════════════════════

function buildSwitcherEntry({ slug, name, description, category, swatches }) {
  return {
    id: slug,
    file: `theme-${slug}.css`,
    name,
    description: description || `Custom theme • ${category}`,
    category,
    swatches,
  };
}

function insertThemeIntoSwitcher(js, entry) {
  const arrayMatch = js.match(/(const\s+THEMES\s*=\s*\[)([\s\S]*?)(\n\s*\]\s*;)/);
  if (!arrayMatch) throw new Error("could not locate THEMES array in theme-switcher.js");
  const [, head, body, tail] = arrayMatch;
  const rendered = `    {
      id: '${entry.id}',
      file: '${entry.file}',
      name: '${entry.name.replace(/'/g, "\\'")}',
      description: '${(entry.description || "").replace(/'/g, "\\'")}',
      category: '${entry.category}',
      swatches: [${entry.swatches.map((s) => `'${s}'`).join(", ")}]
    }`;
  // Append to the array body, before the closing bracket.
  const newBody = body.trimEnd().endsWith(",") ? `${body}\n${rendered}` : `${body.trimEnd()},\n${rendered}`;
  return js.replace(arrayMatch[0], `${head}${newBody}${tail}`);
}

// ═══════════════════════════════════════════════════
// Validator invocation
// ═══════════════════════════════════════════════════

function runValidator() {
  return new Promise((resolve) => {
    const child = spawn("npm", ["run", "--silent", "validate-themes"], {
      cwd: SERVER_DIR,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => (stdout += d.toString()));
    child.stderr.on("data", (d) => (stderr += d.toString()));
    child.on("close", (code) => {
      resolve({ ok: code === 0, output: stdout + stderr });
    });
    child.on("error", (err) => resolve({ ok: false, output: `spawn failed: ${err.message}` }));
  });
}
