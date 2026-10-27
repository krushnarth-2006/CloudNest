import type {
  CloudFileMeta, CloudFolderMeta, CloudProvider, OAuthTokens,
  ProviderCredentials, StorageInfo, UploadInput,
} from "./types";
import { assertOk } from "./types";

const AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const DRIVE_API = "https://www.googleapis.com/drive/v3";
const DRIVE_UPLOAD_API = "https://www.googleapis.com/upload/drive/v3";
const FOLDER_MIME = "application/vnd.google-apps.folder";
const GOOGLE_EXPORT_MIME_TYPES: Record<string, string> = {
  "application/vnd.google-apps.document": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.google-apps.spreadsheet": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
};

const clientId = () => process.env.GOOGLE_CLIENT_ID;
const clientSecret = () => process.env.GOOGLE_CLIENT_SECRET;

function authHeaders(creds: ProviderCredentials) {
  return { authorization: `Bearer ${creds.accessToken}` };
}

export const googleDriveProvider: CloudProvider = {
  id: "google-drive",
  displayName: "Google Drive",

  isConfigured() {
    return Boolean(clientId() && clientSecret());
  },

  buildAuthorizeUrl({ redirectUri, state }) {
    const params = new URLSearchParams({
      client_id: clientId()!,
      redirect_uri: redirectUri,
      response_type: "code",
      access_type: "offline",
      prompt: "consent",
      scope: "https://www.googleapis.com/auth/drive",
      state,
    });
    return `${AUTH_URL}?${params}`;
  },

  async exchangeCode({ code, redirectUri }): Promise<OAuthTokens> {
    const body = new URLSearchParams({
      code,
      client_id: clientId()!,
      client_secret: clientSecret()!,
      redirect_uri: redirectUri,
      grant_type: "authorization_code",
    });
    const response = await fetch(TOKEN_URL, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body });
    await assertOk("google-drive", response, "token exchange");
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
    });
    const response = await fetch(TOKEN_URL, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body });
    await assertOk("google-drive", response, "token refresh");
    const json = await response.json() as { access_token: string; expires_in?: number };
    return { accessToken: json.access_token, refreshToken, expiresAt: json.expires_in ? new Date(Date.now() + json.expires_in * 1000) : undefined };
  },

  async disconnect(creds) {
    try {
      await fetch(`https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(creds.accessToken)}`, { method: "POST" });
    } catch {
      // best effort
    }
  },

  async listFiles(creds, opts) {
  const q = opts?.folderId
    ? `'${opts.folderId}' in parents and trashed = false`
    : "trashed = false";

  const allFiles: Array<{
    id: string;
    name: string;
    mimeType: string;
    size?: string;
    modifiedTime?: string;
    parents?: string[];
  }> = [];

  let pageToken: string | undefined;

  do {
    const params = new URLSearchParams({
      q,
      fields: "nextPageToken,files(id,name,mimeType,size,modifiedTime,parents)",
      pageSize: "100",
    });

    if (pageToken) {
      params.set("pageToken", pageToken);
    }

    const response = await fetch(
      `${DRIVE_API}/files?${params}`,
      { headers: authHeaders(creds) }
    );

    await assertOk("google-drive", response, "list files");

    const json = await response.json() as {
      files: Array<{
        id: string;
        name: string;
        mimeType: string;
        size?: string;
        modifiedTime?: string;
        parents?: string[];
      }>;
      nextPageToken?: string;
    };

    allFiles.push(...json.files);
    pageToken = json.nextPageToken;
  } while (pageToken);

  return allFiles.map((f) => ({
    id: f.id,
    name: f.name,
    mimeType: f.mimeType,
    size: Number(f.size ?? 0),
    modifiedAt: f.modifiedTime,
    parentId: f.parents?.[0] ?? null,
  }));
},

  async searchFiles(creds, query) {
    const escaped = query.replace(/'/g, "\\'");
    const q = `name contains '${escaped}' and trashed = false`;
    const params = new URLSearchParams({ q, fields: "files(id,name,mimeType,size,modifiedTime,parents)", pageSize: "50" });
    const response = await fetch(`${DRIVE_API}/files?${params}`, { headers: authHeaders(creds) });
    await assertOk("google-drive", response, "search files");
    const json = await response.json() as { files: Array<{ id: string; name: string; mimeType: string; size?: string; modifiedTime?: string; parents?: string[] }> };
    return json.files.map((f) => ({ id: f.id, name: f.name, mimeType: f.mimeType, size: Number(f.size ?? 0), modifiedAt: f.modifiedTime, parentId: f.parents?.[0] ?? null }));
  },

  async uploadFile(creds, input: UploadInput): Promise<CloudFileMeta> {
    const metadata: Record<string, unknown> = { name: input.name };
    if (input.folderId) metadata.parents = [input.folderId];
    const boundary = "cloudnest-" + Math.random().toString(16).slice(2);
    const body = Buffer.concat([
      Buffer.from(`--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n`),
      Buffer.from(`--${boundary}\r\nContent-Type: ${input.mimeType || "application/octet-stream"}\r\n\r\n`),
      input.buffer,
      Buffer.from(`\r\n--${boundary}--`),
    ]);
    const response = await fetch(`${DRIVE_UPLOAD_API}/files?uploadType=multipart&fields=id,name,mimeType,size,modifiedTime,parents`, {
      method: "POST",
      headers: { ...authHeaders(creds), "content-type": `multipart/related; boundary=${boundary}` },
      body,
    });
    await assertOk("google-drive", response, "upload file");
    const f = await response.json() as { id: string; name: string; mimeType: string; size?: string; modifiedTime?: string; parents?: string[] };
    return { id: f.id, name: f.name, mimeType: f.mimeType, size: Number(f.size ?? input.buffer.length), modifiedAt: f.modifiedTime, parentId: f.parents?.[0] ?? input.folderId ?? null };
  },

  async downloadFile(creds, fileId) {
    const metaResponse = await fetch(`${DRIVE_API}/files/${fileId}?fields=name,mimeType`, { headers: authHeaders(creds) });
    await assertOk("google-drive", metaResponse, "get file metadata");
    const meta = await metaResponse.json() as { name: string; mimeType: string };
    const exportMimeType = GOOGLE_EXPORT_MIME_TYPES[meta.mimeType];
    const url = exportMimeType
      ? `${DRIVE_API}/files/${fileId}/export?mimeType=${encodeURIComponent(exportMimeType)}`
      : `${DRIVE_API}/files/${fileId}?alt=media`;
    const response = await fetch(url, { headers: authHeaders(creds) });
    await assertOk("google-drive", response, exportMimeType ? "export Google Workspace file" : "download file");
    const buffer = Buffer.from(await response.arrayBuffer());
    const extension = exportMimeType?.includes("wordprocessingml") ? ".docx" : exportMimeType?.includes("spreadsheetml") ? ".xlsx" : "";
    const name = extension && !meta.name.toLowerCase().endsWith(extension) ? `${meta.name}${extension}` : meta.name;
    return { buffer, mimeType: exportMimeType ?? meta.mimeType, name };
  },

  async deleteFile(creds, fileId) {
    const response = await fetch(`${DRIVE_API}/files/${fileId}`, { method: "DELETE", headers: authHeaders(creds) });
    if (response.status !== 404) await assertOk("google-drive", response, "delete file");
  },

  async renameFile(creds, fileId, newName): Promise<CloudFileMeta> {
    const response = await fetch(`${DRIVE_API}/files/${fileId}?fields=id,name,mimeType,size,modifiedTime,parents`, {
      method: "PATCH",
      headers: { ...authHeaders(creds), "content-type": "application/json" },
      body: JSON.stringify({ name: newName }),
    });
    await assertOk("google-drive", response, "rename file");
    const f = await response.json() as { id: string; name: string; mimeType: string; size?: string; modifiedTime?: string; parents?: string[] };
    return { id: f.id, name: f.name, mimeType: f.mimeType, size: Number(f.size ?? 0), modifiedAt: f.modifiedTime, parentId: f.parents?.[0] ?? null };
  },

  async copyFile(creds, fileId, newName, folderId): Promise<CloudFileMeta> {
    const body: Record<string, unknown> = { name: newName };
    if (folderId) body.parents = [folderId];
    const response = await fetch(`${DRIVE_API}/files/${fileId}/copy?fields=id,name,mimeType,size,modifiedTime,parents`, {
      method: "POST",
      headers: { ...authHeaders(creds), "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    await assertOk("google-drive", response, "copy file");
    const f = await response.json() as { id: string; name: string; mimeType: string; size?: string; modifiedTime?: string; parents?: string[] };
    return { id: f.id, name: f.name, mimeType: f.mimeType, size: Number(f.size ?? 0), modifiedAt: f.modifiedTime, parentId: f.parents?.[0] ?? null };
  },

  async createFolder(creds, name, parentId) {
    const body: Record<string, unknown> = { name, mimeType: FOLDER_MIME };
    if (parentId) body.parents = [parentId];
    const response = await fetch(`${DRIVE_API}/files?fields=id,name`, {
      method: "POST",
      headers: { ...authHeaders(creds), "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    await assertOk("google-drive", response, "create folder");
    const f = await response.json() as { id: string; name: string };
    return { id: f.id, name: f.name };
  },

  async findFolder(creds, name, parentId): Promise<CloudFolderMeta | null> {
    const escaped = name.replace(/'/g, "\\'");
    const parentClause = parentId ? ` and '${parentId}' in parents` : "";
    const q = `name = '${escaped}' and mimeType = '${FOLDER_MIME}' and trashed = false${parentClause}`;
    const params = new URLSearchParams({ q, fields: "files(id,name)", pageSize: "1" });
    const response = await fetch(`${DRIVE_API}/files?${params}`, { headers: authHeaders(creds) });
    await assertOk("google-drive", response, "find folder");
    const json = await response.json() as { files: Array<{ id: string; name: string }> };
    return json.files[0] ? { id: json.files[0].id, name: json.files[0].name } : null;
  },

  async moveFile(creds, fileId, newParentId) {
    const currentResponse = await fetch(`${DRIVE_API}/files/${fileId}?fields=parents`, { headers: authHeaders(creds) });
    await assertOk("google-drive", currentResponse, "get file parents");
    const current = await currentResponse.json() as { parents?: string[] };
    const params = new URLSearchParams({ addParents: newParentId, removeParents: (current.parents ?? []).join(",") });
    const response = await fetch(`${DRIVE_API}/files/${fileId}?${params}`, { method: "PATCH", headers: authHeaders(creds) });
    await assertOk("google-drive", response, "move file");
  },

  async getStorageInfo(creds): Promise<StorageInfo> {
    const response = await fetch(`${DRIVE_API}/about?fields=storageQuota`, { headers: authHeaders(creds) });
    await assertOk("google-drive", response, "get storage quota");
    const json = await response.json() as { storageQuota: { limit?: string; usage?: string } };
    const totalBytes = json.storageQuota.limit ? Number(json.storageQuota.limit) : 15 * 1024 ** 3; // Google reports no `limit` for unlimited plans
    return { usedBytes: Number(json.storageQuota.usage ?? 0), totalBytes };
  },

  async listAllFiles(creds): Promise<CloudFileMeta[]> {
    // Drive's model is flat (parent references, not real folder scoping), so one query
    // excluding folders returns every real file in the account regardless of where it's
    // nested - no recursive folder walk needed.
    const results: CloudFileMeta[] = [];
    let pageToken: string | undefined;
    const MAX_PAGES = 20; // 20 * 1000 = up to 20k files per sync, generous for a course project
    for (let page = 0; page < MAX_PAGES; page++) {
      const params = new URLSearchParams({
        q: `trashed = false and mimeType != '${FOLDER_MIME}'`,
        fields: "nextPageToken, files(id,name,mimeType,size,modifiedTime,parents)",
        pageSize: "1000",
      });
      if (pageToken) params.set("pageToken", pageToken);
      const response = await fetch(`${DRIVE_API}/files?${params}`, { headers: authHeaders(creds) });
      await assertOk("google-drive", response, "list all files");
      const json = await response.json() as { files: Array<{ id: string; name: string; mimeType: string; size?: string; modifiedTime?: string; parents?: string[] }>; nextPageToken?: string };
      results.push(...json.files.map((f) => ({ id: f.id, name: f.name, mimeType: f.mimeType, size: Number(f.size ?? 0), modifiedAt: f.modifiedTime, parentId: f.parents?.[0] ?? null })));
      if (!json.nextPageToken) break;
      pageToken = json.nextPageToken;
    }
    return results;
  },
};
