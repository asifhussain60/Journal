// Environment bindings for the Worker. Secrets are set via `wrangler secret put`
// (production) or .dev.vars (local); vars live in wrangler.toml [vars].
export interface Env {
  // Static assets binding (Vite dist/) — SPA fallback configured in wrangler.toml.
  ASSETS: Fetcher;

  // Chapter text storage — key is the chapter id (e.g. "ch03"). The single
  // source of truth for saves made through the web editor.
  CHAPTERS_KV: KVNamespace;

  // Secrets
  ANTHROPIC_API_KEY: string;
  GEMINI_API_KEY: string;

  // Optional model override for Gemini (defaults to gemini-2.5-flash).
  GEMINI_MODEL?: string;

  // Vars
  CF_ACCESS_TEAM_DOMAIN: string; // e.g. myteam.cloudflareaccess.com
  CF_ACCESS_AUD: string; // Access application audience tag
  ALLOWED_EDITORS: string; // comma-separated emails permitted to write

  // Local-dev only. When "true", auth is bypassed (Access can't gate localhost).
  DEV_AUTH_BYPASS?: string;
  DEV_USER_EMAIL?: string;
}

export interface Identity {
  email: string;
}
