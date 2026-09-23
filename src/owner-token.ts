export const OWNER_TOKEN_LIFETIME_SECONDS = 365 * 24 * 60 * 60;

const encoder = new TextEncoder();

export interface OwnerTokenOptions {
  secret: string;
  now?: () => number;
  randomBytes?: (length: number) => Uint8Array;
}

export interface OwnerIdentity {
  ownerId: string;
  ownerToken: string;
}

export interface OwnerTokens {
  issue(ownerId?: string): Promise<OwnerIdentity>;
  verify(token: string | undefined | null): Promise<string | null>;
}

function base64url(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("base64url");
}

function decodeBase64url(value: string): Uint8Array | null {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) return null;
  try { return new Uint8Array(Buffer.from(value, "base64url")); } catch { return null; }
}

function random(length: number): Uint8Array {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  return bytes;
}

async function hmac(key: CryptoKey, value: string): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.sign("HMAC", key, encoder.encode(value)));
}

function equalConstantTime(left: Uint8Array, right: Uint8Array): boolean {
  let difference = left.length ^ right.length;
  const length = Math.max(left.length, right.length);
  for (let index = 0; index < length; index++) difference |= (left[index] ?? 0) ^ (right[index] ?? 0);
  return difference === 0;
}
export function createOwnerTokens(options: OwnerTokenOptions): OwnerTokens {
  if (!options.secret) throw new Error("DECISION_OWNER_SECRET is required when durable decision storage is enabled");
  const secret = encoder.encode(options.secret);
  if (secret.byteLength < 32) throw new Error("DECISION_OWNER_SECRET must contain at least 32 bytes");
  const key = crypto.subtle.importKey(
    "raw",
    secret,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const randomBytes = options.randomBytes ?? random;
  const now = options.now ?? Date.now;

  const issue = async (ownerId = base64url(randomBytes(24))): Promise<OwnerIdentity> => {
    const payload = base64url(encoder.encode(JSON.stringify({ v: 1, id: ownerId, iat: now() })));
    const signature = base64url(await hmac(await key, payload));
    return { ownerId, ownerToken: `${payload}.${signature}` };
  };

  const verify = async (token: string | undefined | null): Promise<string | null> => {
    if (!token || token.length > 1024) return null;
    const parts = token.split(".");
    if (parts.length !== 2) return null;
    const supplied = decodeBase64url(parts[1]!);
    if (!supplied) return null;
    const expected = await hmac(await key, parts[0]!);
    if (!equalConstantTime(supplied, expected)) return null;
    const encoded = decodeBase64url(parts[0]!);
    if (!encoded) return null;
    try {
      const payload = JSON.parse(new TextDecoder().decode(encoded)) as { v?: unknown; id?: unknown; iat?: unknown };
      if (payload.v !== 1 || typeof payload.id !== "string" || payload.id.length < 16 || payload.id.length > 128) return null;
      const issuedAt = Number(payload.iat);
      const currentTime = now();
      if (!Number.isFinite(payload.iat) || issuedAt > currentTime + 300_000
        || currentTime - issuedAt >= OWNER_TOKEN_LIFETIME_SECONDS * 1_000) return null;
      return payload.id;
    } catch {
      return null;
    }
  };

  return { issue, verify };
}
