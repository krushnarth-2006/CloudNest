// Every concrete provider (Google Drive, OneDrive, Dropbox) implements this
// interface. Routes and services talk to `CloudProvider` only - none of them
// know which vendor they're calling, so provider-specific REST quirks stay
// contained in providers/googleDrive.ts, providers/oneDrive.ts, providers/dropbox.ts.

export type ProviderId = "google-drive" | "onedrive" | "dropbox";

export interface OAuthTokens {
  accessToken: string;
  refreshToken?: string;
  expiresAt?: Date;
  scope?: string;
  /** Some providers (Dropbox) return a stable account id we should remember. */
  providerAccountId?: string;
}

export interface StorageInfo {
  usedBytes: number;
  totalBytes: number;
}

export interface CloudFileMeta {
  id: string;
  name: string;
  mimeType?: string;
  size: number;
  modifiedAt?: string;
  parentId?: string | null;
}

export interface CloudFolderMeta {
  id: string;
  name: string;
}

export interface UploadInput {
  name: string;
  mimeType: string;
  buffer: Buffer;
  folderId?: string | null;
}

/** A ready-to-use, already-fresh access token. Refreshing lives in providers/index.ts,
 * which is the only place that reads/writes the encrypted tokens in Mongo. */
export interface ProviderCredentials {
  accessToken: string;
}

export interface CloudProvider {
  readonly id: ProviderId;
  readonly displayName: string;

  /** Whether this provider has the client id/secret it needs configured via env vars. */
  isConfigured(): boolean;

  /** Builds the URL the browser is redirected to in order to start the OAuth consent flow. */
  buildAuthorizeUrl(params: { redirectUri: string; state: string }): string;

  /** Exchanges an authorization code for tokens. */
  exchangeCode(params: { code: string; redirectUri: string }): Promise<OAuthTokens>;

  /** Exchanges a refresh token for a new access token. Not every provider rotates the refresh token. */
  refreshAccessToken(refreshToken: string): Promise<OAuthTokens>;

  /** Best-effort revocation of the token with the provider. Never throws - disconnect always succeeds locally. */
  disconnect(creds: ProviderCredentials): Promise<void>;

  listFiles(creds: ProviderCredentials, opts?: { folderId?: string }): Promise<CloudFileMeta[]>;
  searchFiles(creds: ProviderCredentials, query: string): Promise<CloudFileMeta[]>;
  uploadFile(creds: ProviderCredentials, input: UploadInput): Promise<CloudFileMeta>;
  downloadFile(creds: ProviderCredentials, fileId: string): Promise<{ buffer: Buffer; mimeType?: string; name?: string }>;
  deleteFile(creds: ProviderCredentials, fileId: string): Promise<void>;
  renameFile(creds: ProviderCredentials, fileId: string, newName: string): Promise<CloudFileMeta>;
  /** Copies the file within the SAME provider (as opposed to migrateFile, which crosses providers). */
  copyFile(creds: ProviderCredentials, fileId: string, newName: string, folderId?: string | null): Promise<CloudFileMeta>;
  createFolder(creds: ProviderCredentials, name: string, parentId?: string | null): Promise<CloudFolderMeta>;
  findFolder(creds: ProviderCredentials, name: string, parentId?: string | null): Promise<CloudFolderMeta | null>;
  moveFile(creds: ProviderCredentials, fileId: string, newParentId: string): Promise<void>;
  getStorageInfo(creds: ProviderCredentials): Promise<StorageInfo>;
  /**
   * Lists every real file already in the user's cloud account (not just what CloudNest
   * uploaded), for the initial/repeat sync that backfills the MongoDB index. Each provider
   * implements this with whatever bulk-listing primitive it has (flat query, delta, or
   * recursive folder walk) rather than going through listFiles folder-by-folder, which
   * would be far slower and easy to accidentally cap too early. Capped internally per
   * provider to a sane page count so a huge Drive doesn't hang a sync request forever.
   */
  listAllFiles(creds: ProviderCredentials): Promise<CloudFileMeta[]>;
}

export class ProviderApiError extends Error {
  constructor(
    public provider: ProviderId,
    public status: number,
    message: string,
  ) {
    super(`[${provider}] ${message}`);
    this.name = "ProviderApiError";
  }
}

export async function assertOk(provider: ProviderId, response: Response, context: string): Promise<Response> {
  if (!response.ok) {
    let detail = "";
    try {
      detail = await response.text();
    } catch {
      // ignore
    }
    throw new ProviderApiError(provider, response.status, `${context} failed: ${detail.slice(0, 500)}`);
  }
  return response;
}
