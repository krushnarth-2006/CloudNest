import { createHash } from "node:crypto";
import { FileModel } from "../models";
import { getAuthorizedProvider } from "../providers";
import type { CloudFileMeta, CloudProvider, ProviderCredentials } from "../providers/types";
import { categorizeFile } from "./ai";
import { extractText } from "./textExtraction";

// Files at or under this size get downloaded during sync so we can compute a real SHA-256
// hash (needed for duplicate detection) and extract text for AI categorization - the same
// pipeline a fresh upload gets. Above this size we still index the file (name, size,
// provider, mimeType, modified date all become searchable/browsable immediately) but skip
// the download: hashing a multi-hundred-MB file on every sync isn't worth the bandwidth for
// a course project, and such files simply won't be duplicate-matched by content until they're
// re-uploaded through CloudNest directly. This tradeoff is applied consistently, not silently.
const HASH_SIZE_LIMIT_BYTES = 25 * 1024 * 1024;

export interface SyncSummary {
  provider: string;
  totalRemote: number;
  imported: number;
  updated: number;
  unchanged: number;
  hashed: number;
}

export async function syncProviderFiles(userId: string, providerId: string): Promise<SyncSummary> {
  const authorized = await getAuthorizedProvider(userId, providerId);
  if (!authorized) throw new Error(`${providerId} is not connected.`);
  const { provider, creds } = authorized;

  const remoteFiles: CloudFileMeta[] = await provider.listAllFiles(creds);
  const existing = await FileModel.find({ userId, provider: providerId, cloudFileId: { $in: remoteFiles.map((f) => f.id) } })
    .select("cloudFileId size modifiedAt hash")
    .lean();
  const existingByCloudId = new Map(existing.map((f) => [f.cloudFileId, f]));

  let imported = 0, updated = 0, unchanged = 0, hashed = 0;

  for (const remote of remoteFiles) {
    const current = existingByCloudId.get(remote.id);
    const remoteModified = remote.modifiedAt ? new Date(remote.modifiedAt) : new Date();

    if (current) {
      // Already indexed - only touch it if the provider says it actually changed, to avoid
      // needless writes (and needless re-hashing) on every repeat sync.
      const sizeChanged = current.size !== remote.size;
      const modifiedChanged = current.modifiedAt && Math.abs(+current.modifiedAt - +remoteModified) > 1000;
      if (!sizeChanged && !modifiedChanged) { unchanged++; continue; }
      let hashUpdate: { hash?: string } = {};
      if (sizeChanged && remote.size <= HASH_SIZE_LIMIT_BYTES) {
        const rehashed = await hashRemoteFile(provider, creds, remote.id);
        if (rehashed) { hashUpdate = { hash: rehashed }; hashed++; }
      }
      await FileModel.updateOne(
        { userId, provider: providerId, cloudFileId: remote.id },
        { $set: { name: remote.name, mimeType: remote.mimeType, size: remote.size, modifiedAt: remoteModified, ...hashUpdate } },
      );
      updated++;
      continue;
    }

    // New to CloudNest: run it through the same hash -> text -> AI categorize pipeline a
    // fresh upload gets, so synced files are just as searchable, dedup-checked, and
    // categorized as anything uploaded through CloudNest directly.
    let hash: string | undefined;
    let text = "";
    if (remote.size <= HASH_SIZE_LIMIT_BYTES) {
      const result = await hashAndExtract(provider, creds, remote.id, remote.mimeType ?? "");
      if (result) { hash = result.hash; text = result.text; hashed++; }
    }
    const classification = await categorizeFile({ filename: remote.name, mimeType: remote.mimeType ?? "application/octet-stream", text });

    await FileModel.create({
      userId, provider: providerId, cloudFileId: remote.id,
      name: remote.name, originalName: remote.name, mimeType: remote.mimeType, size: remote.size,
      path: `/${classification.category}/${remote.name}`, category: classification.category,
      categoryConfidence: classification.confidence, categoryReason: classification.reason,
      hash, aiProcessed: true, modifiedAt: remoteModified,
    });
    imported++;
  }

  return { provider: providerId, totalRemote: remoteFiles.length, imported, updated, unchanged, hashed };
}

async function hashAndExtract(provider: CloudProvider, creds: ProviderCredentials, fileId: string, mimeType: string): Promise<{ hash: string; text: string } | null> {
  try {
    const { buffer } = await provider.downloadFile(creds, fileId);
    const hash = createHash("sha256").update(buffer).digest("hex");
    const text = await extractText(buffer, mimeType);
    return { hash, text };
  } catch {
    // A single unreadable file (permissions, transient network issue) shouldn't fail the
    // whole sync - it just gets indexed without a hash and can be re-checked next sync.
    return null;
  }
}

async function hashRemoteFile(provider: CloudProvider, creds: ProviderCredentials, fileId: string): Promise<string | null> {
  try {
    const { buffer } = await provider.downloadFile(creds, fileId);
    return createHash("sha256").update(buffer).digest("hex");
  } catch {
    return null;
  }
}
