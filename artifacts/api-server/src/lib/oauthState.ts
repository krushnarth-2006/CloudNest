import { randomBytes } from "node:crypto";
import { OAuthState } from "../models";

const STATE_TTL_MS = 10 * 60 * 1000; // 10 minutes to complete the OAuth round trip

/** Creates a random, single-use state token tied server-side to this user + provider. */
export async function createOAuthState(userId: string, provider: string): Promise<string> {
  const state = randomBytes(32).toString("base64url");
  await OAuthState.create({ state, userId, provider, expiresAt: new Date(Date.now() + STATE_TTL_MS) });
  return state;
}

/** Validates and consumes a state token. Returns the userId it was issued for, or null if
 * the token is unknown, expired, already used, or was issued for a different provider. */
export async function consumeOAuthState(state: string, provider: string): Promise<string | null> {
  const record = await OAuthState.findOne({ state, provider });
  if (!record) return null;
  if (record.usedAt) return null;
  if (record.expiresAt.getTime() < Date.now()) return null;
  record.usedAt = new Date();
  await record.save();
  return String(record.userId);
}
