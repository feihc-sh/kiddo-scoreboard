// scripts/hash-pin.mjs
// One-shot utility: hash a PIN with a secret, print the hash string.
// Usage: node scripts/hash-pin.mjs <pin> <secret>
const crypto = globalThis.crypto;

const ITERATIONS = 100_000;
const SALT_BYTES = 16;
const HASH_BYTES = 32;

async function deriveKey(material, salt, iterations) {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey('raw', enc.encode(material), { name: 'PBKDF2' }, false, ['deriveBits']);
  const buf = await crypto.subtle.deriveBits({ name: 'PBKDF2', salt, iterations, hash: 'SHA-256' }, key, HASH_BYTES * 8);
  return new Uint8Array(buf);
}

function b64(bytes) {
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return Buffer.from(bin, 'binary').toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

const [pin, secret] = [process.argv[2], process.argv[3]];
if (!pin || !secret) {
  console.error('Usage: node scripts/hash-pin.mjs <pin> <secret>');
  process.exit(1);
}

const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES));
const key = await deriveKey(`${pin}:${secret}`, salt, ITERATIONS);
console.log(`pbkdf2$${ITERATIONS}$${b64(salt)}$${b64(key)}`);
