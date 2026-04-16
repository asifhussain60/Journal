// prompts/example.js \u2014 minimal Phase 1 prompt used to prove the loader contract.
//
// Shape:
//   { name, system, description, model?, max_tokens? }
//
// Feature prompts (trip-qa, trip-assistant, etc.) arrive in later phases and will
// live in sibling files with the same shape.

export default Object.freeze({
  name: "example",
  description:
    "Phase 1 smoke prompt. Proves the /api/refine and /api/chat routes honour the promptName field without altering byte-identical behaviour when promptName is omitted.",
  system:
    "You are a minimal Phase 1 test prompt. Reply with a single short sentence confirming that the named-prompt loader is wired end-to-end. Do not add preamble.",
});
