// Owner session auth (todo 4 — spec §A.6 owner dashboard).
//
// Uses Web Crypto `crypto.subtle` HMAC-SHA-256, NOT `node:crypto` — Next 15
// middleware runs on the Edge runtime which has no `node:crypto` (it throws
// there). Web Crypto is available in BOTH the Edge runtime and Node route
// handlers, so this one module serves the middleware gate, the login route, and
// any server-side check.
//
// The session is a signed token `base64url(payload).base64url(hmac)`; payload =
// { role:"owner", iat, exp }. Tamper or expiry → verifySession returns null. The
// secret is OWNER_SESSION_SECRET. The cookie itself (httpOnly+secure+sameSite)
// is set by the login route / cleared by logout — this module only signs/verifies
// the token string so it stays runtime-agnostic.

export interface SessionPayload {
  role: "owner";
  iat: number; // seconds
  exp: number; // seconds
}

export const SESSION_COOKIE = "gg_owner";
const SESSION_TTL_SECONDS = 7 * 24 * 60 * 60; // 7 days

function b64urlEncode(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function b64urlEncodeStr(s: string): string {
  return b64urlEncode(new TextEncoder().encode(s));
}

function b64urlDecodeToStr(s: string): string {
  const pad = s.length % 4 === 0 ? "" : "=".repeat(4 - (s.length % 4));
  const bin = atob(s.replace(/-/g, "+").replace(/_/g, "/") + pad);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}

async function hmacKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );
}

async function sign(data: string, secret: string): Promise<string> {
  const key = await hmacKey(secret);
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(data));
  return b64urlEncode(new Uint8Array(sig));
}

// Constant-time string compare (no early return on first mismatch).
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export async function signSession(secret: string, now = Date.now()): Promise<string> {
  const iat = Math.floor(now / 1000);
  const payload: SessionPayload = { role: "owner", iat, exp: iat + SESSION_TTL_SECONDS };
  const body = b64urlEncodeStr(JSON.stringify(payload));
  const mac = await sign(body, secret);
  return `${body}.${mac}`;
}

export async function verifySession(
  token: string | undefined,
  secret: string,
  now = Date.now(),
): Promise<SessionPayload | null> {
  if (!token || !secret) return null;
  const dot = token.indexOf(".");
  if (dot <= 0) return null;
  const body = token.slice(0, dot);
  const mac = token.slice(dot + 1);
  const expected = await sign(body, secret);
  if (!timingSafeEqual(mac, expected)) return null;
  let payload: SessionPayload;
  try {
    payload = JSON.parse(b64urlDecodeToStr(body)) as SessionPayload;
  } catch {
    return null;
  }
  if (payload.role !== "owner") return null;
  if (typeof payload.exp !== "number" || payload.exp < Math.floor(now / 1000)) return null;
  return payload;
}

// Constant-time password check for the login route.
export function passwordMatches(submitted: string, expected: string): boolean {
  if (!expected) return false;
  return timingSafeEqual(submitted, expected);
}

// In-handler owner-auth guard (cross-model review S7): defense-in-depth so an
// owner API route is NOT solely dependent on the middleware matcher. The matcher
// excludes dotted paths, so a route whose path contains a "." could bypass the
// gate — this re-checks the session cookie inside the handler. Returns true when
// the request carries a valid owner session. Reads the cookie from the standard
// Cookie header (works in Node route handlers without next/headers coupling).
export async function isAuthorizedOwnerRequest(
  cookieHeader: string | null,
  secret = process.env.OWNER_SESSION_SECRET,
): Promise<boolean> {
  if (!secret || !cookieHeader) return false;
  const token = parseCookie(cookieHeader, SESSION_COOKIE);
  return (await verifySession(token, secret)) !== null;
}

function parseCookie(header: string, name: string): string | undefined {
  for (const part of header.split(";")) {
    const eq = part.indexOf("=");
    if (eq < 0) continue;
    if (part.slice(0, eq).trim() === name) return part.slice(eq + 1).trim();
  }
  return undefined;
}
