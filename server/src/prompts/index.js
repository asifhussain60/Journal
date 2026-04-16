// prompts/index.js — named-prompt registry + loader.
//
// Phase 1 shape (\u00a79.1.1 of the execution plan):
//   - Each named prompt is a module under server/src/prompts/{name}.js.
//   - Every prompt exports a default object: { name, system, ...meta }.
//   - The loader is a thin, cached factory keyed by prompt name.
//   - No model call happens here. Callers compose the prompt with a model request.
//
// Future phases register additional prompts (trip-qa, trip-assistant, trip-edit,
// extract-receipt, ingest-itinerary). Each one lives in its own file; the registry
// stays the single lookup surface.

import examplePrompt from "./example.js";
import tripQaPrompt from "./trip-qa.js";
import tripAssistantPrompt from "./trip-assistant.js";
import extractReceiptPrompt from "./extract-receipt.js";

/**
 * Registry of all prompts known at startup time. Extend by importing the new
 * prompt module above and adding it here \u2014 no dynamic discovery, no fs walks.
 * @type {Record<string, { name: string; system: string; [k: string]: unknown }>}
 */
const REGISTRY = Object.freeze({
  [examplePrompt.name]: examplePrompt,
  [tripQaPrompt.name]: tripQaPrompt,
  [tripAssistantPrompt.name]: tripAssistantPrompt,
  [extractReceiptPrompt.name]: extractReceiptPrompt,
});

/**
 * Return every registered prompt name, sorted for stable logs.
 * @returns {string[]}
 */
export function listPrompts() {
  return Object.keys(REGISTRY).sort();
}

/**
 * Return true if `name` is a registered prompt.
 * @param {string} name
 * @returns {boolean}
 */
export function hasPrompt(name) {
  return typeof name === "string" && Object.prototype.hasOwnProperty.call(REGISTRY, name);
}

/**
 * Load a named prompt definition. Throws if not found \u2014 call sites should
 * validate `hasPrompt(name)` first if they want a soft miss.
 * @param {string} name
 * @returns {{ name: string; system: string; [k: string]: unknown }}
 */
export function loadPrompt(name) {
  if (!hasPrompt(name)) {
    throw new Error(`unknown prompt "${name}". Registered: ${listPrompts().join(", ") || "<none>"}`);
  }
  return REGISTRY[name];
}
