import type {
  CloudFileMeta, CloudFolderMeta, CloudProvider, OAuthTokens,
  ProviderCredentials, StorageInfo, UploadInput,
} from "./types";
import { assertOk } from "./types";

const AUTH_URL = "https://www.dropbox.com/oauth2/authorize";
const TOKEN_URL = "https://api.dropboxapi.com/oauth2/token";
const API = "https://api.dropboxapi.com/2";
const CONTENT_API = "https://content.dropboxapi.com/2";

const appKey = () => process.env.DROPBOX_APP_KEY;
const appSecret = () => process.env.DROPBOX_APP_SECRET;

function authHeaders(creds: ProviderCredentials) {
  return { authorization: `Bearer ${creds.accessToken}` };
}

// Dropbox uses folder paths, not opaque folder ids, so we treat "id" and "path" as the
// same string to keep the CloudProvider interface uniform across all three vendors.
function toFileMeta(entry: { id: string; name: string; size?: number; server_modified?: string; path_lower?: string }): CloudFileMeta {
  return { id: entry.path_lower ?? entry.id, name: entry.name, size: entry.size ?? 0, modifiedAt: entry.server_modified, parentId: null };
}

export const dropboxProvider: CloudProvider = {
  id: "dropbox",
  displayName: "Dropbox",

  isConfigured() {
    return Boolean(appKey() && appSecret());
  },

  buildAuthorizeUrl({ redirectUri, state }) {
    const params = new URLSearchParams({
      client_id: appKey()!,
      redirect_uri: redirectUri,
      response_type: "code",
      token_access_type: "offline",
      state,
    });
    return `${AUTH_URL}?${params}`;
  },

  async exchangeCode({ code, redirectUri }): Promise<OAuthTokens> {
    const body = new URLSearchParams({
      code,
      client_id: appKey()!,
      client_secret: appSecret()!,
      redirect_uri: redirectUri,
      grant_type: "authorization_code",
    });
    const response = await fetch(TOKEN_URL, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body });
    await assertOk("dropbox", response, "token exchange");
    const json = await response.json() as { access_token: string; refresh_token?: string; expires_in?: number; scope?: string; account_id?: string };
    return {
      accessToken: json.access_token,
      refreshToken: json.refresh_token,
      expiresAt: json.expires_in ? new Date(Date.now() + json.expires_in * 1000) : undefined,
      scope: json.scope,
      providerAccountId: json.account_id,
    };
  },

  async refreshAccessToken(refreshToken): Promise<OAuthTokens> {
    const body = new URLSearchParams({
      refresh_token: refreshToken,
      client_id: appKey()!,
      client_secret: appSecret()!,
      grant_type: "refresh_token",
    });
    const response = await fetch(TOKEN_URL, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body });
    await assertOk("dropbox", response, "token refresh");
    const json = await response.json() as { access_token: string; expires_in?: number };
    return { accessToken: json.access_token, refreshToken, expiresAt: json.expires_in ? new Date(Date.now() + json.expires_in * 1000) : undefined };
  },

  async disconnect(creds) {
    try {
      await fetch(`${API}/auth/token/revoke`, { method: "POST", headers: authHeaders(creds) });
    } catch {
      // best effort
    }
  },

  async listFiles(creds, opts) {
    const response = await fetch(`${API}/files/list_folder`, {
      method: "POST",
      headers: { ...authHeaders(creds), "content-type": "application/json" },
      body: JSON.stringify({ path: opts?.folderId ?? "" }),
    });
    await assertOk("dropbox", response, "list files");
    const json = await response.json() as { entries: Array<{ ".tag": string; id: string; name: string; size?: number; server_modified?: string; path_lower?: string }> };
    return json.entries.filter((e) => e[".tag"] === "file").map(toFileMeta);
  },

  async searchFiles(creds, query) {
    const response = await fetch(`${API}/files/search_v2`, {
      method: "POST",
      headers: { ...authHeaders(creds), "content-type": "application/json" },
      body: JSON.stringify({ query, options: { file_status: "active", filename_only: true } }),
    });
    await assertOk("dropbox", response, "search files");
    const json = await response.json() as { matches: Array<{ metadata: { metadata: { ".tag": string; id: string; name: string; size?: number; server_modified?: string; path_lower?: string } } }> };
    return json.matches.map((m) => m.metadata.metadata).filter((e) => e[".tag"] === "file").map(toFileMeta);
  },

  async uploadFile(creds, input: UploadInput): Promise<CloudFileMeta> {
    const folder = input.folderId ?? "";
    const path = `${folder}/${input.name}`.replace(/\/+/g, "/");
    const response = await fetch(`${CONTENT_API}/files/upload`, {
      method: "POST",
      headers: {
        ...authHeaders(creds),
        "content-type": "application/octet-stream",
        "dropbox-api-arg": JSON.stringify({ path, mode: "add", autorename: true, mute: false }),
      },
      body: input.buffer,
    });
    await assertOk("dropbox", response, "upload file");
    return toFileMeta(await response.json() as { id: string; name: string; size?: number; server_modified?: string; path_lower?: string });
  },

  async downloadFile(creds, fileId) {
    const response = await fetch(`${CONTENT_API}/files/download`, {
      method: "POST",
      headers: { ...authHeaders(creds), "dropbox-api-arg": JSON.stringify({ path: fileId }) },
    });
    await assertOk("dropbox", response, "download file");
    const apiResultHeader = response.headers.get("dropbox-api-result");
    const meta = apiResultHeader ? JSON.parse(apiResultHeader) as { name: string } : { name: fileId.split("/").pop() };
    const buffer = Buffer.from(await response.arrayBuffer());
    return { buffer, mimeType: undefined, name: meta.name };
  },

  async deleteFile(creds, fileId) {
    const response = await fetch(`${API}/files/delete_v2`, {
      method: "POST",
      headers: { ...authHeaders(creds), "content-type": "application/json" },
      body: JSON.stringify({ path: fileId }),
    });
    if (response.status !== 409) await assertOk("dropbox", response, "delete file"); // 409 = path already gone
  },

  async renameFile(creds, fileId, newName): Promise<CloudFileMeta> {
    const parent = fileId.split("/").slice(0, -1).join("/");
    const toPath = `${parent}/${newName}`.replace(/\/+/g, "/");
    const response = await fetch(`${API}/files/move_v2`, {
      method: "POST",
      headers: { ...authHeaders(creds), "content-type": "application/json" },
      body: JSON.stringify({ from_path: fileId, to_path: toPath, autorename: true }),
    });
    await assertOk("dropbox", response, "rename file");
    const json = await response.json() as { metadata: { id: string; name: string; size?: number; server_modified?: string; path_lower: string } };
    return toFileMeta(json.metadata);
  },

  async copyFile(creds, fileId, newName, folderId): Promise<CloudFileMeta> {
    const toPath = `${folderId ?? fileId.split("/").slice(0, -1).join("/")}/${newName}`.replace(/\/+/g, "/");
    const response = await fetch(`${API}/files/copy_v2`, {
      method: "POST",
      headers: { ...authHeaders(creds), "content-type": "application/json" },
      body: JSON.stringify({ from_path: fileId, to_path: toPath, autorename: true }),
    });
    await assertOk("dropbox", response, "copy file");
    const json = await response.json() as { metadata: { id: string; name: string; size?: number; server_modified?: string; path_lower: string } };
    return toFileMeta(json.metadata);
  },

  async createFolder(creds, name, parentId): Promise<CloudFolderMeta> {
    const path = `${parentId ?? ""}/${name}`.replace(/\/+/g, "/");
    const response = await fetch(`${API}/files/create_folder_v2`, {
      method: "POST",
      headers: { ...authHeaders(creds), "content-type": "application/json" },
      body: JSON.stringify({ path, autorename: false }),
    });
    await assertOk("dropbox", response, "create folder");
    const json = await response.json() as { metadata: { id: string; name: string; path_lower: string } };
    return { id: json.metadata.path_lower, name: json.metadata.name };
  },

  async findFolder(creds, name, parentId): Promise<CloudFolderMeta | null> {
    const response = await fetch(`${API}/files/list_folder`, {
      method: "POST",
      headers: { ...authHeaders(creds), "content-type": "application/json" },
      body: JSON.stringify({ path: parentId ?? "" }),
    });
    if (response.status === 409) return null; // parent path doesn't exist yet
    await assertOk("dropbox", response, "find folder");
    const json = await response.json() as { entries: Array<{ ".tag": string; name: string; path_lower: string }> };
    const match = json.entries.find((e) => e[".tag"] === "folder" && e.name === name);
    return match ? { id: match.path_lower, name: match.name } : null;
  },

  async moveFile(creds, fileId, newParentId) {
    const name = fileId.split("/").pop();
    const toPath = `${newParentId}/${name}`.replace(/\/+/g, "/");
    const response = await fetch(`${API}/files/move_v2`, {
      method: "POST",
      headers: { ...authHeaders(creds), "content-type": "application/json" },
      body: JSON.stringify({ from_path: fileId, to_path: toPath, autorename: true }),
    });
    await assertOk("dropbox", response, "move file");
  },

  async getStorageInfo(creds): Promise<StorageInfo> {
    const response = await fetch(`${API}/users/get_space_usage`, { method: "POST", headers: authHeaders(creds) });
    await assertOk("dropbox", response, "get storage quota");
    const json = await response.json() as { used: number; allocation: { allocated?: number; ".tag": string } };
    return { usedBytes: json.used, totalBytes: json.allocation.allocated ?? 0 };
  },

  async listAllFiles(creds): Promise<CloudFileMeta[]> {
    // list_folder with recursive:true walks the whole tree from root in one traversal,
    // following the cursor via list_folder/continue for pagination.
    const results: CloudFileMeta[] = [];
    let response = await fetch(`${API}/files/list_folder`, {
      method: "POST",
      headers: { ...authHeaders(creds), "content-type": "application/json" },
      body: JSON.stringify({ path: "", recursive: true, limit: 1000 }),
    });
    await assertOk("dropbox", response, "list all files");
    const MAX_PAGES = 20;
    for (let page = 0; page < MAX_PAGES; page++) {
      const json = await response.json() as { entries: Array<{ ".tag": string; id: string; name: string; size?: number; server_modified?: string; path_lower?: string }>; has_more: boolean; cursor: string };
      results.push(...json.entries.filter((e) => e[".tag"] === "file").map(toFileMeta));
      if (!json.has_more) break;
      response = await fetch(`${API}/files/list_folder/continue`, {
        method: "POST",
        headers: { ...authHeaders(creds), "content-type": "application/json" },
        body: JSON.stringify({ cursor: json.cursor }),
      });
      await assertOk("dropbox", response, "continue listing all files");
    }
    return results;
  },
};
