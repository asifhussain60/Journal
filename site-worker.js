// Cloudflare Worker — runs at journal.kashkole.com edge.
//
// Proxies /api/*, /trips/*, and /shared/* to journal-api.kashkole.com so that
// all API calls and media files from the browser are same-origin (no CORS
// preflight). The CF_Authorization cookie is forwarded so Cloudflare Access on
// the API side can issue its own JWT and let the request through to Express.
//
// All other requests fall through to the static-asset bundle (site/).

const API_ORIGIN = 'https://journal-api.kashkole.com';

// Paths that must be proxied to the API server.
const API_PREFIXES = ['/api/', '/trips/', '/shared/'];

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (API_PREFIXES.some(p => url.pathname.startsWith(p))) {
      const targetUrl = API_ORIGIN + url.pathname + url.search;

      const headers = new Headers(request.headers);
      headers.delete('host');
      headers.delete('cf-access-jwt-assertion');

      const response = await fetch(targetUrl, {
        method: request.method,
        headers,
        body: ['GET', 'HEAD'].includes(request.method) ? null : request.body,
        redirect: 'follow',
      });

      return response;
    }

    // Everything else: serve from the bundled static assets.
    return env.ASSETS.fetch(request);
  },
};
