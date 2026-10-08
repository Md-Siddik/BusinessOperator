import bcrypt from "bcryptjs";
import crypto from "node:crypto";

const ROUNDS = 12;

export function hashPassword(password: string) {
  return bcrypt.hash(password, ROUNDS);
}

export function verifyPassword(password: string, hash: string) {
  return bcrypt.compare(password, hash);
}

/** Opaque random token (e.g. password reset) and its SHA-256 hash for storage. */
export function createOpaqueToken() {
  const token = crypto.randomBytes(32).toString("base64url");
  return { token, hash: hashToken(token) };
}

export function hashToken(token: string) {
  return crypto.createHash("sha256").update(token).digest("hex");
}

let dummyHash: Promise<string> | undefined;
/** Burn equivalent bcrypt time for unknown emails so login timing doesn't reveal accounts. */
export async function dummyPasswordCheck(password: string) {
  dummyHash ??= bcrypt.hash("timing-equalisation-placeholder", ROUNDS);
  await bcrypt.compare(password, await dummyHash);
  return false;
}
