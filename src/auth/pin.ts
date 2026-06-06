// src/auth/pin.ts
// Web Crypto PBKDF2-SHA256 PIN hashing.
// Format: pbkdf2$<iterations>$<saltB64>$<hashB64>
//
// Why PBKDF2 (not scrypt)?
// - Web Crypto API spec has PBKDF2 natively, no extra deps
// - Cloudflare Workers have crypto.subtle, no scrypt support
// - 100k iterations of PBKDF2-SHA256 (Cloudflare Workers Web Crypto limit is 100k)
const ITERATIONS = 100_000;
const SALT_BYTES = 16;
const HASH_BYTES = 32;

/** Hash a 4-8 digit PIN with a server-side secret. Returns a self-describing string. */
export async function hashPin(pin: string, secret: string): Promise<string> {
  if (!pin) throw new Error('PIN cannot be empty');
  const enc = new TextEncoder();
  const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES));
  const key = await deriveKey(`${pin}:${secret}`, salt, ITERATIONS);
  return `pbkdf2$${ITERATIONS}$${b64(salt)}$${b64(key)}`;
}

/** Constant-time verify a PIN against a stored hash. */
export async function verifyPin(pin: string, stored: string, secret: string): Promise<boolean> {
  if (!pin || !stored) return false;
  const parts = stored.split('$');
  if (parts.length !== 4 || parts[0] !== 'pbkdf2') return false;
  const iter = Number(parts[1]);
  if (!Number.isFinite(iter) || iter <= 0) return false;
  let salt: Uint8Array;
  let expected: Uint8Array;
  try {
    salt = unb64(parts[2]);
    expected = unb64(parts[3]);
  } catch {
    return false;
  }
  const actual = await deriveKey(`${pin}:${secret}`, salt, iter);
  return constantTimeEqual(actual, expected);
}

// ---------- internals ----------

async function deriveKey(material: string, salt: Uint8Array, iterations: number): Promise<Uint8Array> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    enc.encode(material),
    { name: 'PBKDF2' },
    false,
    ['deriveBits'],
  );
  const buf = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt, iterations, hash: 'SHA-256' },
    key,
    HASH_BYTES * 8,
  );
  return new Uint8Array(buf);
}

function b64(bytes: Uint8Array): string {
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function unb64(s: string): Uint8Array {
  const std = s.replace(/-/g, '+').replace(/_/g, '/');
  const pad = std.length % 4 === 0 ? '' : '='.repeat(4 - (std.length % 4));
  const bin = atob(std + pad);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function constantTimeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}
