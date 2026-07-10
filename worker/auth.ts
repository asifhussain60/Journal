import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from "jose";
import type { Env, Identity } from "./types";

// Cloudflare Access identity verification.
//
// In production, Access gates the whole zone at the edge and injects the
// `Cf-Access-Jwt-Assertion` header. We independently verify that JWT against the
// team's JWKS (defense in depth — never trust "Access is in front of me" alone).
// In local dev, Access can't gate localhost, so DEV_AUTH_BYPASS short-circuits.

const jwksCache = new Map<string, JWTVerifyGetKey>();

function getJWKS(teamDomain: string): JWTVerifyGetKey {
  let jwks = jwksCache.get(teamDomain);
  if (!jwks) {
    jwks = createRemoteJWKSet(new URL(`https://${teamDomain}/cdn-cgi/access/certs`));
    jwksCache.set(teamDomain, jwks);
  }
  return jwks;
}

export async function verifyAccess(request: Request, env: Env): Promise<Identity | null> {
  if (env.DEV_AUTH_BYPASS === "true") {
    return { email: env.DEV_USER_EMAIL || "dev@localhost" };
  }

  const token =
    request.headers.get("Cf-Access-Jwt-Assertion") ||
    cookie(request, "CF_Authorization");
  if (!token || !env.CF_ACCESS_TEAM_DOMAIN || !env.CF_ACCESS_AUD) return null;

  try {
    const { payload } = await jwtVerify(token, getJWKS(env.CF_ACCESS_TEAM_DOMAIN), {
      issuer: `https://${env.CF_ACCESS_TEAM_DOMAIN}`,
      audience: env.CF_ACCESS_AUD,
    });
    const email = typeof payload.email === "string" ? payload.email : "";
    return email ? { email } : null;
  } catch {
    return null;
  }
}

/** True if the identity is allowed to perform writes (git commits). */
export function isEditor(identity: Identity, env: Env): boolean {
  const allow = (env.ALLOWED_EDITORS || "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  return allow.includes(identity.email.toLowerCase());
}

function cookie(request: Request, name: string): string | null {
  const raw = request.headers.get("Cookie");
  if (!raw) return null;
  for (const part of raw.split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k === name) return v.join("=");
  }
  return null;
}
