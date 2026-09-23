import { expect, test } from "bun:test";
import { createOwnerTokens, OWNER_TOKEN_LIFETIME_SECONDS } from "../src/owner-token";
import { ownerCookie } from "../web/src/lib/trading/session-gateway";

const OWNER_SECRET = "owner-expiry-test-secret-at-least-32-bytes";

test("owner signer rejects secrets shorter than 32 bytes", () => {
  expect(() => createOwnerTokens({ secret: "short" })).toThrow("at least 32 bytes");
});

test("owner identity expires exactly when its 365-day cookie expires", async () => {
  const issuedAt = 1_000_000;
  let now = issuedAt;
  const owners = createOwnerTokens({ secret: OWNER_SECRET, now: () => now });
  const owner = await owners.issue();
  expect(ownerCookie(owner.ownerToken)).toContain(`Max-Age=${OWNER_TOKEN_LIFETIME_SECONDS}`);
  now = issuedAt + OWNER_TOKEN_LIFETIME_SECONDS * 1_000 - 1;
  expect(await owners.verify(owner.ownerToken)).toBe(owner.ownerId);
  now++;
  expect(await owners.verify(owner.ownerToken)).toBeNull();
  now++;
  expect(await owners.verify(owner.ownerToken)).toBeNull();
  now = issuedAt - 300_000;
  expect(await owners.verify(owner.ownerToken)).toBe(owner.ownerId);
  now--;
  expect(await owners.verify(owner.ownerToken)).toBeNull();
});
