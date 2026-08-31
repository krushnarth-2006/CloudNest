import type {
  CloudFileMeta, CloudFolderMeta, CloudProvider, OAuthTokens,
  ProviderCredentials, StorageInfo, UploadInput,
} from "./types";
import { assertOk } from "./types";

const tenant = () => process.env.MICROSOFT_TENANT_ID ?? "common";
const authUrl = () => `https://login.microsoftonline.com/${tenant()}/oauth2/v2.0/authorize`;
const tokenUrl = () => `https://login.microsoftonline.com/${tenant()}/oauth2/v2.0/token`;
const GRAPH_API = "https://graph.microsoft.com/v1.0";
const SCOPES = "offline_access Files.ReadWrite.All User.Read";

const clientId = () => process.env.MICROSOFT_CLIENT_ID;
const clientSecret = () => process.env.MICROSOFT_CLIENT_SECRET;

function authHeaders(creds: ProviderCredentials) {
  return { authorization: `Bearer ${creds.accessToken}` };
}

type DriveItem = { id: string; name: string; size?: number; file?: { mimeType?: string }; folder?: unknown; lastModifiedDateTime?: string; parentReference?: { id?: string } };

function toFileMeta(item: DriveItem): CloudFileMeta {
  return {
    id: item.id,
    name: item.name,
    mimeType: item.file?.mimeType,
    size: item.size ?? 0,
    modifiedAt: item.lastModifiedDateTime,
    parentId: item.parentReference?.id ?? null,
  };
}

export const oneDriveProvider: CloudProvider = {
  id: "onedrive",
  displayName: "OneDrive",

  isConfigured() {
    return Boolean(clientId() && clientSecret());
  },

  buildAuthorizeUrl({ redirectUri, state }) {
    const params = new URLSearchParams({
      client_id: clientId()!,
      redirect_uri: redirectUri,
      response_type: "code",
      response_mode: "query",
      scope: SCOPES,
      state,
    });
    return `${authUrl()}?${params}`;
  },

  async exchangeCode({ code, redirectUri }): Promise<OAuthTokens> {
    const body = new URLSearchParams({
      code,
      client_id: clientId()!,
      client_secret: clientSecret()!,
      redirect_uri: redirectUri,
      grant_type: "authorization_code",
      scope: SCOPES,
    });
    const response = await fetch(tokenUrl(), { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body });
    await assertOk("onedrive", response, "token exchange");
    const json = await response.json() as { access_token: string; refresh_token?: string; expires_in?: number; scope?: string };
    return {
      accessToken: json.access_token,
      refreshToken: json.refresh_token,
      expiresAt: json.expires_in ? new Date(Date.now() + json.expires_in * 1000) : undefined,
      scope: json.scope,
    };
  },

  async refreshAccessToken(refreshToken): Promise<OAuthTokens> {
    const body = new URLSearchParams({
      refresh_token: refreshToken,
      client_id: clientId()!,
      client_secret: clientSecret()!,
      grant_type: "refresh_token",
      scope: SCOPES,
    });
    const response = await fetch(tokenUrl(), { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body });
    await assertOk("onedrive", response, "token refresh");
    const json = await response.json() as { access_token: string; refresh_token?: string; expires_in?: number };
    return { accessToken: json.access_token, refreshToken: json.refresh_token ?? refreshToken, expiresAt: json.expires_in ? new Date(Date.now() + json.expires_in * 1000) : undefined };
  },

  async disconnect() {
    // Microsoft Graph has no simple token-revocation REST endpoint for this flow;
    // deleting our stored token (done by the caller) is sufficient for this app.
  },

  async listFiles(creds, opts) {
    const path = opts?.folderId ? `/me/drive/items/${opts.folderId}/children` : "/me/drive/root/children";
    const response = await fetch(`${GRAPH_API}${path}?$select=id,name,size,file,folder,lastModifiedDateTime,parentReference`, { headers: authHeaders(creds) });
    await assertOk("onedrive", response, "list files");
    const json = await response.json() as { value: DriveItem[] };
    return json.value.filter((i) => i.file).map(toFileMeta);
  },

  async searchFiles(creds, query) {
    const response = await fetch(`${GRAPH_API}/me/drive/root/search(q='${encodeURIComponent(query)}')?$select=id,name,size,file,folder,lastModifiedDateTime,parentReference`, { headers: authHeaders(creds) });
    await assertOk("onedrive", response, "search files");
    const json = await response.json() as { value: DriveItem[] };
    return json.value.filter((i) => i.file).map(toFileMeta);
  },

  async uploadFile(creds, input: UploadInput): Promise<CloudFileMeta> {
    const parent = input.folderId ? `items/${input.folderId}` : "root";
    const encodedName = encodeURIComponent(input.name);
    // Simple upload API supports files up to 4MB; larger course-project files would
    // need Graph's resumable upload session, kept out for simplicity per spec.
    const response = await fetch(`${GRAPH_API}/me/drive/${parent}:/${encodedName}:/content`, {
      method: "PUT",
      headers: { ...authHeaders(creds), "content-type": input.mimeType || "application/octet-stream" },
      body: input.buffer,
    });
    await assertOk("onedrive", response, "upload file");
    return toFileMeta(await response.json() as DriveItem);
  },

  async downloadFile(creds, fileId) {
    const metaResponse = await fetch(`${GRAPH_API}/me/drive/items/${fileId}?$select=name,file`, { headers: authHeaders(creds) });
    await assertOk("onedrive", metaResponse, "get file metadata");
    const meta = await metaResponse.json() as { name: string; file?: { mimeType?: string } };
    const response = await fetch(`${GRAPH_API}/me/drive/items/${fileId}/content`, { headers: authHeaders(creds) });
    await assertOk("onedrive", response, "download file");
    const buffer = Buffer.from(await response.arrayBuffer());
    return { buffer, mimeType: meta.file?.mimeType, name: meta.name };
  },

  async deleteFile(creds, fileId) {
    const response = await fetch(`${GRAPH_API}/me/drive/items/${fileId}`, { method: "DELETE", headers: authHeaders(creds) });
    if (response.status !== 404) await assertOk("onedrive", response, "delete file");
  },

  async renameFile(creds, fileId, newName): Promise<CloudFileMeta> {
    const response = await fetch(`${GRAPH_API}/me/drive/items/${fileId}`, {
      method: "PATCH",
      headers: { ...authHeaders(creds), "content-type": "application/json" },
      body: JSON.stringify({ name: newName }),
    });
    await assertOk("onedrive", response, "rename file");
    return toFileMeta(await response.json() as DriveItem);
  },

  // Graph's native /copy is asynchronous (202 + a monitor URL to poll), which adds real
  // complexity for a course project. Download+re-upload gives the same end result - a real,
  // independent copy on the same provider - through primitives we already have and trust.
  async copyFile(creds, fileId, newName, folderId): Promise<CloudFileMeta> {
    const metaResponse = await fetch(`${GRAPH_API}/me/drive/items/${fileId}?$select=file`, { headers: authHeaders(creds) });
    await assertOk("onedrive", metaResponse, "get file metadata for copy");
    const meta = await metaResponse.json() as { file?: { mimeType?: string } };
    const contentResponse = await fetch(`${GRAPH_API}/me/drive/items/${fileId}/content`, { headers: authHeaders(creds) });
    await assertOk("onedrive", contentResponse, "read file content for copy");
    const buffer = Buffer.from(await contentResponse.arrayBuffer());
    const parent = folderId ? `items/${folderId}` : "root";
    const encodedName = encodeURIComponent(newName);
    const uploadResponse = await fetch(`${GRAPH_API}/me/drive/${parent}:/${encodedName}:/content`, {
      method: "PUT",
      headers: { ...authHeaders(creds), "content-type": meta.file?.mimeType || "application/octet-stream" },
      body: buffer,
    });
    await assertOk("onedrive", uploadResponse, "upload copied file");
    return toFileMeta(await uploadResponse.json() as DriveItem);
  },

  async createFolder(creds, name, parentId) {
    const parent = parentId ? `items/${parentId}` : "root";
    const response = await fetch(`${GRAPH_API}/me/drive/${parent}/children`, {
      method: "POST",
      headers: { ...authHeaders(creds), "content-type": "application/json" },
      body: JSON.stringify({ name, folder: {}, "@microsoft.graph.conflictBehavior": "fail" }),
    });
    await assertOk("onedrive", response, "create folder");
    const item = await response.json() as { id: string; name: string };
    return { id: item.id, name: item.name };
  },

  async findFolder(creds, name, parentId): Promise<CloudFolderMeta | null> {
    const parent = parentId ? `items/${parentId}` : "root";
    const response = await fetch(`${GRAPH_API}/me/drive/${parent}/children?$select=id,name,folder`, { headers: authHeaders(creds) });
    await assertOk("onedrive", response, "find folder");
    const json = await response.json() as { value: Array<{ id: string; name: string; folder?: unknown }> };
    const match = json.value.find((i) => i.folder && i.name === name);
    return match ? { id: match.id, name: match.name } : null;
  },

  async moveFile(creds, fileId, newParentId) {
    const response = await fetch(`${GRAPH_API}/me/drive/items/${fileId}`, {
      method: "PATCH",
      headers: { ...authHeaders(creds), "content-type": "application/json" },
      body: JSON.stringify({ parentReference: { id: newParentId } }),
    });
    await assertOk("onedrive", response, "move file");
  },

  async getStorageInfo(creds): Promise<StorageInfo> {
    const response = await fetch(`${GRAPH_API}/me/drive?$select=quota`, { headers: authHeaders(creds) });
    await assertOk("onedrive", response, "get storage quota");
    const json = await response.json() as { quota: { used: number; total: number } };
    return { usedBytes: json.quota.used, totalBytes: json.quota.total };
  },

  async listAllFiles(creds): Promise<CloudFileMeta[]> {
    // Graph's delta endpoint returns the entire tree flattened in one traversal (following
    // @odata.nextLink for pagination), which is far more efficient than walking folders
    // one /children call at a time.
    const results: CloudFileMeta[] = [];
    let url: string | undefined = `${GRAPH_API}/me/drive/root/delta?$select=id,name,size,file,folder,lastModifiedDateTime,parentReference,deleted`;
    const MAX_PAGES = 40;
    for (let page = 0; page < MAX_PAGES && url; page++) {
      const response = await fetch(url, { headers: authHeaders(creds) });
      await assertOk("onedrive", response, "list all files");
      const json = await response.json() as { value: Array<DriveItem & { deleted?: unknown }>; "@odata.nextLink"?: string };
      results.push(...json.value.filter((i) => i.file && !i.deleted).map(toFileMeta));
      url = json["@odata.nextLink"];
    }
    return results;
  },
};
