#!/usr/bin/env node
// validate-schemas.mjs — Phase 1 schema + fixture validator.
// Loads every schema in server/src/schemas/ and every fixture in __fixtures__/,
// compiles the schemas with ajv, asserts valid fixtures pass and invalid ones fail.
//
// Exits 0 and prints "schemas OK, fixtures OK" on success; exits 1 with a precise
// failure reason otherwise. Used by `npm run validate` and as Phase 1 acceptance
// criterion #1 in _workspace/ideas/app-cowork-execution-plan.md \u00a79.2.

import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import process from "node:process";
import Ajv from "ajv";
import addFormats from "ajv-formats";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const SCHEMA_DIR = path.resolve(__dirname, "../src/schemas");
const FIXTURE_DIR = path.join(SCHEMA_DIR, "__fixtures__");

// Each fixture filename pattern: {schemaStem}.valid.json or {schemaStem}.invalid.json
// where schemaStem matches {schemaStem}.schema.json in SCHEMA_DIR.

function die(message) {
  process.stderr.write(`[validate-schemas] ${message}\n`);
  process.exit(1);
}

async function readJSON(file) {
  const raw = await readFile(file, "utf8");
  try {
    return JSON.parse(raw);
  } catch (err) {
    die(`could not parse JSON at ${file}: ${err.message}`);
  }
}

async function main() {
  const schemaFiles = (await readdir(SCHEMA_DIR)).filter((f) => f.endsWith(".schema.json"));
  if (schemaFiles.length === 0) die(`no *.schema.json files under ${SCHEMA_DIR}`);

  const fixtureFiles = (await readdir(FIXTURE_DIR)).filter((f) => f.endsWith(".json"));
  if (fixtureFiles.length === 0) die(`no fixtures under ${FIXTURE_DIR}`);

  const ajv = new Ajv({ strict: true, allErrors: true });
  addFormats(ajv);

  const validators = new Map();
  for (const file of schemaFiles) {
    const stem = file.replace(/\.schema\.json$/, "");
    const schema = await readJSON(path.join(SCHEMA_DIR, file));
    try {
      validators.set(stem, ajv.compile(schema));
    } catch (err) {
      die(`schema ${file} failed to compile: ${err.message}`);
    }
  }

  let validCount = 0;
  let invalidCount = 0;

  for (const file of fixtureFiles) {
    const match = file.match(/^(.+)\.(valid|invalid)\.json$/);
    if (!match) die(`fixture ${file} must match {stem}.{valid|invalid}.json`);
    const [, stem, variant] = match;
    const validator = validators.get(stem);
    if (!validator) die(`fixture ${file} has no matching schema ${stem}.schema.json`);

    const data = await readJSON(path.join(FIXTURE_DIR, file));
    const ok = validator(data);

    if (variant === "valid" && !ok) {
      die(
        `fixture ${file} expected to validate but failed: ` +
          JSON.stringify(validator.errors, null, 2)
      );
    }
    if (variant === "invalid" && ok) {
      die(`fixture ${file} expected to fail validation but passed`);
    }
    if (variant === "valid") validCount += 1;
    else invalidCount += 1;
  }

  // Contract: at least one valid + one invalid fixture per schema.
  for (const stem of validators.keys()) {
    const hasValid = fixtureFiles.includes(`${stem}.valid.json`);
    const hasInvalid = fixtureFiles.includes(`${stem}.invalid.json`);
    if (!hasValid) die(`schema ${stem} missing a .valid.json fixture`);
    if (!hasInvalid) die(`schema ${stem} missing a .invalid.json fixture`);
  }

  process.stdout.write(
    `schemas OK, fixtures OK (${validators.size} schemas, ${validCount} valid, ${invalidCount} invalid)\n`
  );
  process.exit(0);
}

main().catch((err) => die(`unexpected failure: ${err.stack || err.message}`));
