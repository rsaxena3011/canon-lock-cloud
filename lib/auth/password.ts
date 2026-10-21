import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";

/**
 * Password hashing with Node's built-in scrypt. No native dependencies
 * and no external service: the hash string carries its own parameters
 * (scrypt:N:r:p:saltHex:hashHex) so they can be raised later without
 * invalidating existing hashes.
 */

const N = 16384;
const R = 8;
const P = 1;
const KEYLEN = 64;
const SALT_BYTES = 16;

export function hashPassword(password: string): string {
  const salt = randomBytes(SALT_BYTES);
  const hash = scryptSync(password, salt, KEYLEN, { N, r: R, p: P });
  return ["scrypt", N, R, P, salt.toString("hex"), hash.toString("hex")].join(
    ":"
  );
}

export function verifyPassword(password: string, stored: string): boolean {
  try {
    const parts = stored.split(":");
    if (parts.length !== 6 || parts[0] !== "scrypt") return false;
    const n = Number(parts[1]);
    const r = Number(parts[2]);
    const p = Number(parts[3]);
    const salt = Buffer.from(parts[4], "hex");
    const expected = Buffer.from(parts[5], "hex");
    if (!n || !r || !p || salt.length === 0 || expected.length === 0) {
      return false;
    }
    const actual = scryptSync(password, salt, expected.length, {
      N: n,
      r,
      p,
    });
    return (
      actual.length === expected.length && timingSafeEqual(actual, expected)
    );
  } catch {
    return false;
  }
}
