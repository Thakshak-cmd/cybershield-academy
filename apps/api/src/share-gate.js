// @ts-check
import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";

/**
 * A password in front of a shared preview.
 *
 * `npm run share` puts the platform on a public tunnel URL. A link alone is a
 * weak lock -- links are forwarded, logged and kept in history -- so everything
 * behind the tunnel first asks for a password, handed out with the link.
 *
 * A page and a signed cookie rather than HTTP basic auth: basic auth travels in
 * the Authorization header, which the app already uses for its own bearer
 * tokens, and the two would overwrite each other on every API call.
 *
 * Only used by the share server. Ordinary development and the study itself run
 * locally and never pass through this.
 */

const COOKIE = "cs_share";
const SESSION_MS = 12 * 60 * 60 * 1000;

/**
 * @param {{
 *   password: string,
 *   secret?: Buffer,
 *   now?: () => number,
 *   maxAttempts?: number,
 *   windowMs?: number
 * }} options
 */
export function createShareGate({ password, secret = randomBytes(32), now = Date.now, maxAttempts = 10, windowMs = 15 * 60 * 1000 }) {
  if (!password || password.length < 8) throw new Error("The share password must be at least 8 characters.");
  const expected = digest(password);
  /** @type {Map<string, { count: number, resetAt: number }>} */
  const attempts = new Map();

  const sign = expiry => createHmac("sha256", secret).update(String(expiry)).digest("base64url");

  function valid(cookieValue) {
    if (!cookieValue) return false;
    const [expiry, sig] = cookieValue.split(".");
    if (!expiry || !sig || Number(expiry) < now()) return false;
    const good = Buffer.from(sign(expiry));
    const given = Buffer.from(sig);
    return good.length === given.length && timingSafeEqual(good, given);
  }

  /** Behind the tunnel every request arrives from localhost; Cloudflare says who sent it. */
  const clientOf = req => String(req.headers["cf-connecting-ip"] ?? req.socket.remoteAddress ?? "unknown");

  function limited(client) {
    const t = now();
    const entry = attempts.get(client);
    if (!entry || entry.resetAt < t) {
      attempts.set(client, { count: 1, resetAt: t + windowMs });
      return false;
    }
    entry.count++;
    return entry.count > maxAttempts;
  }

  /** @param {unknown} value */
  function matches(value) {
    return timingSafeEqual(digest(String(value ?? "")), expected);
  }

  /** Start a session for this browser. */
  function admit(req, res) {
    const expiry = now() + SESSION_MS;
    const secure = req.headers["x-forwarded-proto"] === "https" || String(req.headers["cf-visitor"] ?? "").includes("https");
    res.cookie(COOKIE, `${expiry}.${sign(expiry)}`, {
      httpOnly: true, sameSite: "lax", secure, maxAge: SESSION_MS, path: "/"
    });
  }

  /**
   * @param {import("express").Request} req
   * @param {import("express").Response} res
   * @param {import("express").NextFunction} next
   */
  function middleware(req, res, next) {
    // Not for search engines, and the link should not leak to other sites
    // through the Referer header when someone follows a link out.
    res.set("X-Robots-Tag", "noindex, nofollow");
    res.set("Referrer-Policy", "no-referrer");

    // Liveness for the launcher's own readiness check; it reveals nothing.
    if (req.path === "/api/health") return next();

    if (req.path === "/__share") {
      if (req.method === "GET") return res.type("html").send(page());
      if (req.method === "POST") {
        if (limited(clientOf(req))) {
          return res.status(429).type("html").send(page("Too many attempts. Wait fifteen minutes and try again."));
        }
        if (!matches(req.body?.password)) {
          return res.status(401).type("html").send(page("That password isn't right."));
        }
        admit(req, res);
        return res.redirect(303, "/");
      }
      return res.sendStatus(405);
    }

    // The link itself can carry the key, so a tester gets one link and no
    // password to type. It is swapped for the session cookie at once and the
    // redirect drops it from the address bar, so it is not left on screen or
    // in the page the tester bookmarks.
    if (req.method === "GET" && typeof req.query.key === "string") {
      if (limited(clientOf(req))) {
        return res.status(429).type("html").send(page("Too many attempts. Wait fifteen minutes and try again."));
      }
      if (!matches(req.query.key)) {
        return res.status(401).type("html").send(page(
          "That link has expired or isn't right. Ask for a new one, or enter the password if you have it."));
      }
      admit(req, res);
      const rest = new URLSearchParams(/** @type {Record<string, string>} */ (req.query));
      rest.delete("key");
      return res.redirect(303, req.path + (rest.size ? `?${rest}` : ""));
    }

    if (valid(readCookie(req.headers.cookie, COOKIE))) return next();

    if (req.path.startsWith("/api/")) {
      return res.status(401).json({ error: "This preview is password protected. Reload the page to sign in." });
    }
    return res.redirect(303, "/__share");
  }

  return { middleware };
}

/** Fixed-length digests, so comparing them is constant-time whatever was typed. */
function digest(value) {
  return createHash("sha256").update(value, "utf8").digest();
}

/** @param {string|undefined} header @param {string} name */
export function readCookie(header, name) {
  for (const part of (header ?? "").split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k === name) return decodeURIComponent(v.join("="));
  }
  return null;
}

/** The password page, self-contained: nothing behind the gate can be loaded yet. */
function page(error = "") {
  const esc = s => s.replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c] ?? c);
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>Password · CyberShield Academy</title>
<style>
  :root { color-scheme: dark; }
  body { margin: 0; min-height: 100vh; display: grid; place-items: center; background: #0D1117; color: #E6EAF0;
         font: 15px/1.6 ui-sans-serif, system-ui, -apple-system, sans-serif; padding: 16px; box-sizing: border-box; }
  main { width: 100%; max-width: 360px; border: 2px solid #C08A4A; background: #161D27; padding: 24px; }
  h1 { margin: 0 0 6px; font-size: 18px; color: #E8B776; }
  p { margin: 0 0 16px; color: #AAB4C2; }
  label { display: block; font-size: 12px; letter-spacing: .06em; text-transform: uppercase; color: #AAB4C2; margin-bottom: 6px; }
  input { width: 100%; box-sizing: border-box; padding: 10px 12px; font: inherit; background: #0A0E14; color: #E6EAF0;
          border: 1px solid #677180; }
  input:focus, button:focus-visible { outline: 2px solid #E8A254; outline-offset: 2px; }
  button { margin-top: 14px; width: 100%; padding: 10px; font: inherit; font-weight: 600; background: #E8A254; color: #0D1117;
           border: 0; cursor: pointer; }
  .error { color: #F2726E; margin: 0 0 12px; }
</style>
</head>
<body>
<main>
  <h1>CyberShield Academy</h1>
  <p>This is a private preview. Enter the password you were sent with the link.</p>
  ${error ? `<p class="error" role="alert">${esc(error)}</p>` : ""}
  <form method="post" action="/__share">
    <label for="password">Password</label>
    <input id="password" name="password" type="password" autocomplete="current-password" required autofocus>
    <button type="submit">Continue</button>
  </form>
</main>
</body>
</html>`;
}
