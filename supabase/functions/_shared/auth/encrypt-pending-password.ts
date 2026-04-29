// AES-GCM encryption helper for short-lived secrets stored in pending_registrations.
// The encryption key is derived from SUPABASE_SERVICE_ROLE_KEY (or a dedicated secret if provided)
// so we don't introduce a new mandatory env var. Compromise of the service-role key already
// implies full DB access, so this defends against backups/WAL/cold storage exposure but not
// against a live service-role compromise — exactly the threat model in the security finding.

// @ts-nocheck

const ENC = new TextEncoder();
const DEC = new TextDecoder();

async function deriveKey(): Promise<CryptoKey> {
  const secret =
    Deno.env.get("REGISTRATION_ENCRYPTION_KEY") ||
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ||
    "";
  if (!secret) throw new Error("encryption key unavailable");
  // Use SHA-256 to compress the secret into a 32-byte AES key.
  const hash = await crypto.subtle.digest("SHA-256", ENC.encode(`pending-reg:${secret}`));
  return crypto.subtle.importKey("raw", hash, { name: "AES-GCM" }, false, [
    "encrypt",
    "decrypt",
  ]);
}

function bytesToB64(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s);
}

function b64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export async function encryptPassword(plaintext: string): Promise<string> {
  const key = await deriveKey();
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(
    await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, ENC.encode(plaintext)),
  );
  const out = new Uint8Array(iv.length + ct.length);
  out.set(iv, 0);
  out.set(ct, iv.length);
  // Prefix with a version marker so we can rotate later.
  return `v1:${bytesToB64(out)}`;
}

export async function decryptPassword(stored: string): Promise<string> {
  if (!stored.startsWith("v1:")) {
    // Backwards-compat for any rows written before encryption was added.
    return stored;
  }
  const key = await deriveKey();
  const blob = b64ToBytes(stored.slice(3));
  const iv = blob.slice(0, 12);
  const ct = blob.slice(12);
  const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, ct);
  return DEC.decode(pt);
}
