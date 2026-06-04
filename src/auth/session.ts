// src/auth/session.ts
// HMAC-SHA256 signed session token (compact JWT-like format).
// Token: <base64url(payload)>.<base64url(hmac-sha256(payload))>
//
// We use HMAC instead of full JWT to keep the bundle small and the contract explicit.

export const SESSION_MAX_AGE_SECONDS = 7 * 24 * 60 * 60; // 7 days

export interface SessionPayload {
  user_id: number;
  exp: number; // Unix seconds
}

/** Sign a payload, returning "<payloadB64>.<sigB64>". */
export async function signSession(payload: SessionPayload, secret: string): Promise<string> {
  const enc = new TextEncoder();
  const json = JSON.stringify(payload);
  const payloadB64 = b64url(enc.encode(json));
  const sig = await hmac(secret, payloadB64);
  return `${payloadB64}.${sig}`;
}

/** Verify a token. Returns the payload on success, null on any failure. */
export async function verifySession(token: string, secret: string): Promise<SessionPayload | null> {
  if (!token || !token.includes('.')) return null;
  const [payloadB64, sig] = token.split('.');
  if (!payloadB64 || !sig) return null;
  const expected = await hmac(secret, payloadB64);
  if (!constantTimeStrEqual(sig, expected)) return null;
  let json: string;
  try {
    json = new TextDecoder().decode(unb64url(payloadB64));
  } catch {
    return null;
  }
  let payload: SessionPayload;
  try {
    payload = JSON.parse(json) as SessionPayload;
  } catch {
    return null;
  }
  if (typeof payload.user_id !== 'number' || typeof payload.exp !== 'number') return null;
  if (payload.exp <= Math.floor(Date.now() / 1000)) return null;
  return payload;
}

/**
 * Extract `pm_session` value from a Cookie header.
 * Returns null if not present.
 */
export function parseSessionCookie(cookieHeader: string | null | undefined): string | null {
  if (!cookieHeader) return null;
  const parts = cookieHeader.split(';');
  for (const p of parts) {
    const eq = p.indexOf('=');
    if (eq < 0) continue;
    const name = p.slice(0, eq).trim();
    if (name === 'pm_session') {
      return p.slice(eq + 1).trim();
    }
  }
  return null;
}

// ---------- internals ----------

async function hmac(secret: string, data: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    enc.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(data));
  return b64url(new Uint8Array(sig));
}

function b64url(bytes: Uint8Array): string {
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function unb64url(s: string): Uint8Array {
  const std = s.replace(/-/g, '+').replace(/_/g, '/');
  const pad = std.length % 4 === 0 ? '' : '='.repeat(4 - (std.length % 4));
  const bin = atob(std + pad);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function constantTimeStrEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
