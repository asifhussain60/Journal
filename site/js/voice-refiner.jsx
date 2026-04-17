/* voice-refiner.jsx — floating right-side drawer for voice DNA refinement.
   Mounts at its own root (#ai-drawer-root) so the existing App tree is untouched.
   Compiled in-browser by @babel/standalone; loaded via <script type="text/babel" src="...">.

   Dependencies (all loaded via index.html):
     - React 18 UMD (window.React, window.ReactDOM)
     - window.BabuAI  (site/js/claude-client.js)
     - window.Diff    (jsdiff UMD from CDN)
*/

(function () {
  const { useState, useRef, useEffect } = React;

  // ---- word-level diff renderer -------------------------------------------
  function DiffPane({ raw, refined }) {
    if (!window.Diff || !raw || !refined) {
      return React.createElement("div", { className: "ai-diff-empty" }, "Run refine to see the diff.");
    }
    const parts = window.Diff.diffWords(raw, refined);
    return React.createElement(
      "div",
      { className: "ai-diff-pane" },
      parts.map((p, i) => {
        const cls = p.added ? "ai-diff-add" : p.removed ? "ai-diff-del" : "ai-diff-same";
        return React.createElement("span", { key: i, className: cls }, p.value);
      })
    );
  }

  // ---- shared toast (delegated to window.notify / Sonner) -----------------
  // The single source of truth lives in site/js/toast.js — it mounts a Sonner
  // <Toaster /> once per page and exposes success/error/info/warning/message.
  function toast(msg, variant) {
    const v = variant || "info";
    const n = window.notify;
    if (n && typeof n[v] === "function") return n[v](msg);
    if (n && typeof n.message === "function") return n.message(msg);
    console.log("[TOAST]", v, msg);
  }

  // ---- main drawer component ----------------------------------------------
  function VoiceRefiner() {
    const [open, setOpen] = useState(false);
    const [raw, setRaw] = useState("");
    const [refined, setRefined] = useState("");
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState("");
    const [usage, setUsage] = useState(null);
    const [view, setView] = useState("diff"); // "diff" | "refined"

    async function runRefine() {
      setBusy(true);
      setError("");
      setRefined("");
      setUsage(null);
      try {
        const r = await window.BabuAI.refine(raw);
        setRefined(r.refined);
        setUsage(r.usage || null);
        toast("Refined", "success");
      } catch (err) {
        const msg = err.message || String(err);
        setError(msg);
        toast("Refine failed: " + msg, "error");
      } finally {
        setBusy(false);
      }
    }

    async function copyRefined() {
      if (!refined) return;
      try {
        await navigator.clipboard.writeText(refined);
        toast("Copied to clipboard", "success");
      } catch {
        toast("Copy failed", "error");
      }
    }

    function clearAll() {
      setRaw("");
      setRefined("");
      setError("");
      setUsage(null);
    }

    // Esc closes the drawer
    useEffect(() => {
      if (!open) return;
      function onKey(e) { if (e.key === "Escape") setOpen(false); }
      window.addEventListener("keydown", onKey);
      return () => window.removeEventListener("keydown", onKey);
    }, [open]);

    return React.createElement(
      "div",
      { className: "ai-drawer-root" },

      // Floating toggle button (always visible)
      React.createElement(
        "button",
        {
          className: "ai-drawer-toggle",
          title: "Voice refine (Claude Sonnet 4.6)",
          onClick: () => setOpen((v) => !v),
        },
        React.createElement("i", { className: "fa-solid fa-wand-magic-sparkles" }),
        React.createElement("span", null, "Voice Refine")
      ),

      // Overlay + drawer
      React.createElement(
        "div",
        { className: `ai-drawer ${open ? "open" : ""}` },
        React.createElement(
          "div",
          { className: "ai-drawer-header" },
          React.createElement(
            "div",
            { className: "ai-drawer-title" },
            React.createElement("i", { className: "fa-solid fa-wand-magic-sparkles" }),
            " Voice Refine"
          ),
          React.createElement(
            "button",
            { className: "ai-drawer-close", onClick: () => setOpen(false), title: "Close (Esc)" },
            React.createElement("i", { className: "fa-solid fa-xmark" })
          )
        ),

        React.createElement(
          "div",
          { className: "ai-drawer-body" },

          // Left: raw input
          React.createElement(
            "div",
            { className: "ai-col" },
            React.createElement("label", { className: "ai-label" }, "Raw entry"),
            React.createElement("textarea", {
              className: "ai-textarea",
              value: raw,
              onChange: (e) => setRaw(e.target.value),
              placeholder: "Paste a journal entry, chapter fragment, or draft paragraph…",
              spellCheck: true,
            }),
            React.createElement(
              "div",
              { className: "ai-actions" },
              React.createElement(
                "button",
                { className: "ai-btn ai-btn-primary", disabled: busy || !raw.trim(), onClick: runRefine },
                busy
                  ? React.createElement(React.Fragment, null,
                      React.createElement("i", { className: "fa-solid fa-circle-notch fa-spin" }), " Refining…")
                  : React.createElement(React.Fragment, null,
                      React.createElement("i", { className: "fa-solid fa-wand-magic-sparkles" }), " Refine")
              ),
              React.createElement(
                "button",
                { className: "ai-btn ai-btn-ghost", disabled: busy, onClick: clearAll },
                React.createElement("i", { className: "fa-solid fa-eraser" }), " Clear"
              )
            )
          ),

          // Right: refined + diff
          React.createElement(
            "div",
            { className: "ai-col" },
            React.createElement(
              "div",
              { className: "ai-col-head" },
              React.createElement(
                "div",
                { className: "ai-tabs" },
                React.createElement(
                  "button",
                  { className: `ai-tab ${view === "diff" ? "active" : ""}`, onClick: () => setView("diff") },
                  React.createElement("i", { className: "fa-solid fa-code-compare" }), " Diff"
                ),
                React.createElement(
                  "button",
                  { className: `ai-tab ${view === "refined" ? "active" : ""}`, onClick: () => setView("refined") },
                  React.createElement("i", { className: "fa-solid fa-feather-pointed" }), " Refined"
                )
              ),
              React.createElement(
                "button",
                { className: "ai-btn ai-btn-ghost ai-btn-sm", disabled: !refined, onClick: copyRefined, title: "Copy refined text" },
                React.createElement("i", { className: "fa-solid fa-copy" }), " Copy"
              )
            ),

            view === "diff"
              ? React.createElement(DiffPane, { raw, refined })
              : React.createElement(
                  "div",
                  { className: "ai-refined-pane" },
                  refined || React.createElement("span", { className: "ai-diff-empty" }, "No refined text yet.")
                ),

            error ? React.createElement("div", { className: "ai-error" },
              React.createElement("i", { className: "fa-solid fa-triangle-exclamation" }),
              " ", error) : null,

            usage ? React.createElement("div", { className: "ai-usage" },
              `tokens: ${usage.input_tokens} in / ${usage.output_tokens} out`) : null
          )
        )
      )
    );
  }

  // ---- mount --------------------------------------------------------------
  function mount() {
    const el = document.getElementById("ai-drawer-root");
    if (!el) {
      console.warn("[voice-refiner] #ai-drawer-root not found; drawer not mounted");
      return;
    }
    const root = ReactDOM.createRoot(el);
    root.render(React.createElement(VoiceRefiner));
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", mount);
  } else {
    mount();
  }
})();
