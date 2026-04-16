// Cloudflare Access JWT verification middleware.
//
// When the proxy is exposed via Cloudflare Tunnel, every request that reaches
// it has already been auth'd at Cloudflare's edge (email-PIN policy on the
// Access application). The edge injects a signed JWT in the
// `Cf-Access-Jwt-Assertion` header; this middleware verifies it against
// Cloudflare's public JWKS for our team, so a bypass of the tunnel (direct
// curl to 127.0.0.1:3001 from outside the Mac, or a forged header) can't
// impersonate an authed user.
//
// Behaviour:
//   - Loopback requests (127.0.0.1 / ::1 / localhost) bypass entirely — this
//     is what the site/ dev server hits, and what launchd-originated local
//     scripts use.
//   - If CF_ACCESS_TEAM_DOMAIN or CF_ACCESS_AUD are not set, the middleware
//     also bypasses. Keeps the current localhost-only dev workflow working
//     byte-identically until the cloud env vars are provided.
//   - Otherwise: missing or invalid JWT → 401.
//
// Env:
//   CF_ACCESS_TEAM_DOMAIN   e.g. asifhussain.cloudflareaccess.com
//   CF_ACCESS_AUD           the Application Audience tag from the Access
//                           application's Overview tab (long hex string)

import { createRemoteJWKSet, jwtVerify } from "jose";

const TEAM = process.env.CF_ACCESS_TEAM_DOMAIN || "";
const AUD = process.env.CF_ACCESS_AUD || "";

let jwks = null;
function getJWKS() {
  if (!TEAM) return null;
  if (!jwks) {
    jwks = createRemoteJWKSet(new URL(`https://${TEAM}/cdn-cgi/access/certs`));
  }
  return jwks;
}

function isLoopback(req) {
  const ip = req.ip || "";
  if (ip === "127.0.0.1" || ip === "::1" || ip === "::ffff:127.0.0.1") return true;
  const host = (req.hostname || "").toLowerCase();
  if (host === "localhost" || host === "127.0.0.1") return true;
  return false;
}

export function accessAuth() {
  const configured = Boolean(TEAM && AUD);
  if (!configured) {
    // No cloud env: pass every request through, but tag res.locals so the
    // health endpoint can surface the posture.
    return (_req, res, next) => {
      res.locals.accessAuth = "disabled";
      next();
    };
  }

  return async (req, res, next) => {
    if (isLoopback(req)) {
      res.locals.accessAuth = "bypass-loopback";
      return next();
    }
    const token = req.headers["cf-access-jwt-assertion"];
    if (!token) {
      return res
        .status(401)
        .json({ ok: false, error: "cloudflare access token missing" });
    }
    try {
      const { payload } = await jwtVerify(token, getJWKS(), {
        issuer: `https://${TEAM}`,
        audience: AUD,
      });
      req.cfUser = { email: payload.email, sub: payload.sub };
      res.locals.accessAuth = "verified";
      next();
    } catch (err) {
      res
        .status(401)
        .json({ ok: false, error: `cloudflare access token invalid: ${err.message}` });
    }
  };
}

export function accessAuthStatus() {
  return {
    enabled: Boolean(TEAM && AUD),
    teamDomain: TEAM || null,
    aud: AUD ? AUD.slice(0, 8) + "…" : null,
  };
}
