import { ConnectedAccount } from "../models";
import { decryptSecret, encryptSecret } from "../lib/crypto";
import type { CloudProvider, ProviderCredentials, ProviderId } from "./types";
import { googleDriveProvider } from "./googleDrive";
import { oneDriveProvider } from "./oneDrive";
import { dropboxProvider } from "./dropbox";

export const PROVIDERS: Record<ProviderId, CloudProvider> = {
  "google-drive": googleDriveProvider,
  onedrive: oneDriveProvider,
  dropbox: dropboxProvider,
};

export const PROVIDER_IDS = Object.keys(PROVIDERS) as ProviderId[];

export function getProvider(id: string): CloudProvider | undefined {
  return PROVIDERS[id as ProviderId];
}

// A 60s buffer avoids racing a token that expires mid-request.
const EXPIRY_BUFFER_MS = 60_000;

/**
 * Loads a user's connection for a provider, refreshing the access token first if it's
 * expired (or close to it). Returns null if the user never completed OAuth for this
 * provider. This is the single choke point where encrypted tokens are decrypted and,
 * after a refresh, re-encrypted and persisted - callers only ever see a bare access token.
 */
export async function getAuthorizedProvider(
  userId: string,
  providerId: string,
): Promise<{ provider: CloudProvider; creds: ProviderCredentials; account: any } | null> {
  const provider = getProvider(providerId);
  if (!provider) return null;

  const account = await ConnectedAccount.findOne({ userId, provider: providerId });
  if (!account || !account.connected || !account.accessTokenEnc) return null;

  const accessToken = decryptSecret(account.accessTokenEnc);
  const refreshToken = decryptSecret(account.refreshTokenEnc);
  if (!accessToken) return null;

  const isExpired = account.tokenExpiresAt && account.tokenExpiresAt.getTime() - EXPIRY_BUFFER_MS < Date.now();

  if (isExpired && refreshToken) {
    const refreshed = await provider.refreshAccessToken(refreshToken);
    account.accessTokenEnc = encryptSecret(refreshed.accessToken);
    if (refreshed.refreshToken) account.refreshTokenEnc = encryptSecret(refreshed.refreshToken);
    account.tokenExpiresAt = refreshed.expiresAt;
    await account.save();
    return { provider, creds: { accessToken: refreshed.accessToken }, account };
  }

  return { provider, creds: { accessToken }, account };
}

export * from "./types";
