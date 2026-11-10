import "server-only";

const WINDOW_MS = 60_000;
const LIMIT = 180;
const hits = new Map<string, { count: number; resetAt: number }>();

/**
 * There are no accounts, so these routes must not become a free proxy for the
 * API keys. Rejects cross-site calls and throttles by IP (per server instance).
 */
export function rejectIfAbusive(request: Request): Response | null {
  const origin = request.headers.get("origin");
  const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host");
  if (origin && host && new URL(origin).host !== host) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "local";
  const now = Date.now();
  const entry = hits.get(ip);
  if (!entry || entry.resetAt < now) {
    if (hits.size > 5000) hits.clear();
    hits.set(ip, { count: 1, resetAt: now + WINDOW_MS });
    return null;
  }
  entry.count += 1;
  return entry.count > LIMIT ? Response.json({ error: "Slow down a little" }, { status: 429 }) : null;
}
