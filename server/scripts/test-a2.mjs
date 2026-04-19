import { readFile } from "node:fs/promises";
import Ajv from "ajv";
import addFormats from "ajv-formats";
import { hashField } from "../src/lib/hash-field.js";

const schema = JSON.parse(await readFile("src/schemas/trip-edit.schema.json", "utf8"));
const ajv = new Ajv({ strict: false, allErrors: true });
addFormats(ajv);
const validate = ajv.compile(schema);

const trip = { schemaVersion: "1", name: "Test", slug: "test", dates: { start: "2026-04-01", end: "2026-04-10" }, narrative: "A narrative.", narrativeAiHashes: ["abcdef0123456789"], highlightsAiHashes: ["1234567890abcdef"], dayoneTags: ["food"], rejectedAiTags: ["stale"] };
console.log("With new fields:", validate(trip));
if (!validate(trip)) { console.error(validate.errors); process.exit(1); }

const legacy = { schemaVersion: "1", name: "Old", slug: "old", dates: { start: "2026-01-01", end: "2026-01-05" } };
console.log("Legacy:", validate(legacy));
if (!validate(legacy)) { console.error(validate.errors); process.exit(1); }

const overflow = { schemaVersion: "1", name: "X", slug: "x", dates: { start: "2026-01-01", end: "2026-01-05" }, rejectedAiTags: Array.from({ length: 51 }, (_, i) => "tag-" + i) };
const oValid = validate(overflow);
console.log("51 rejected tags rejected:", !oValid);
if (oValid) { console.error("Should have been rejected"); process.exit(1); }

const h = hashField("hello");
console.log("hashField ok:", h.length === 16 && /^[a-f0-9]{16}$/.test(h));
console.log("All A2 gates pass.");
