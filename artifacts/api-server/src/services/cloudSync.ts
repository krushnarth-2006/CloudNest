import { createHash } from "node:crypto";
import { FileModel } from "../models";
import { getAuthorizedProvider } from "../providers";
import type { CloudFileMeta, CloudProvider, ProviderCredentials } from "../providers/types";
import { categorizeFile } from "./ai";
import { extractText } from "./textExtraction";
import { detectMimeType } from "./mimeDetection";

// Files at or under this size get downloaded during sync so we can compute a real SHA-256
// hash (needed for duplicate detection) and extract text for AI categorization - the same
// pipeline a fresh upload gets. Above this size we still index the file (name, size,
// provider, mimeType, modified date all become searchable/browsable immediately) but skip
// the download: hashing a multi-hundred-MB file on every sync isn't worth the bandwidth for
// a course project, and such files simply won't be duplicate-matched by content until they're
// re-uploaded through CloudNest directly. This tradeoff is applied consistently, not silently.
const HASH_SIZE_LIMIT_BYTES = 25 * 1024 * 1024;
// Keep a small cap so large libraries sync faster without flooding Microsoft Graph
// or MongoDB with an unbounded number of concurrent requests.
const SYNC_CONCURRENCY = 4;

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
    .select("cloudFileId name size modifiedAt hash mimeType")
    .lean();
  const existingByCloudId = new Map(existing.map((f) => [f.cloudFileId, f]));

  let imported = 0, updated = 0, unchanged = 0, hashed = 0;

  const syncOne = async (remote: CloudFileMeta) => {
    const current = existingByCloudId.get(remote.id);
    const remoteModified = remote.modifiedAt ? new Date(remote.modifiedAt) : new Date();

    if (current) {
      // Already indexed - only touch it if the provider says it actually changed, to avoid
      // needless writes (and needless re-hashing) on every repeat sync.
      const sizeChanged = current.size !== remote.size;
      const modifiedChanged = current.modifiedAt && Math.abs(+current.modifiedAt - +remoteModified) > 1000;
      const nameChanged = current.name !== remote.name;
      const mimeChanged = (current.mimeType ?? "") !== (remote.mimeType ?? "");
      // A MIME-only provider metadata discrepancy should not overwrite a type that
      // was verified from the file bytes by the preview endpoint.
      if (!sizeChanged && !modifiedChanged && !nameChanged) { unchanged++; return; }
      let hashUpdate: { hash?: string } = {};
      const contentMetadataChanged = sizeChanged || modifiedChanged || mimeChanged;
      let actualMimeType = contentMetadataChanged ? (remote.mimeType ?? current.mimeType) : current.mimeType;
      if (contentMetadataChanged && remote.size <= HASH_SIZE_LIMIT_BYTES) {
        const inspected = await inspectRemoteFile(provider, creds, remote.id, actualMimeType);
        if (inspected) {
          actualMimeType = inspected.mimeType;
          if (inspected.hash !== current.hash) { hashUpdate = { hash: inspected.hash }; hashed++; }
        }
      }
      await FileModel.updateOne(
        { userId, provider: providerId, cloudFileId: remote.id },
        { $set: { name: remote.name, mimeType: actualMimeType, size: remote.size, modifiedAt: remoteModified, ...hashUpdate } },
      );
      updated++;
      return;
    }

    // New to CloudNest: run it through the same hash -> text -> AI categorize pipeline a
    // fresh upload gets, so synced files are just as searchable, dedup-checked, and
    // categorized as anything uploaded through CloudNest directly.
    let hash: string | undefined;
    let text = "";
    let mimeType = remote.mimeType ?? "application/octet-stream";
    if (remote.size <= HASH_SIZE_LIMIT_BYTES) {
      const result = await hashAndExtract(provider, creds, remote.id, mimeType);
      if (result) { hash = result.hash; text = result.text; mimeType = result.mimeType; hashed++; }
    }
    const classification = await categorizeFile({ filename: remote.name, mimeType, text });

    await FileModel.create({
      userId, provider: providerId, cloudFileId: remote.id,
      name: remote.name, originalName: remote.name, mimeType, size: remote.size,
      path: `/${classification.category}/${remote.name}`, category: classification.category,
      categoryConfidence: classification.confidence, categoryReason: classification.reason,
      hash, aiProcessed: true, modifiedAt: remoteModified,
    });
    imported++;
  };

  // Process a few files at once. Each small file may require a content download,
  // text extraction, and categorization request; serial processing made first syncs
  // unnecessarily slow for users with many files.
  for (let start = 0; start < remoteFiles.length; start += SYNC_CONCURRENCY) {
    const batch = remoteFiles.slice(start, start + SYNC_CONCURRENCY);
    const results = await Promise.allSettled(batch.map(syncOne));
    const failed = results.find((result): result is PromiseRejectedResult => result.status === "rejected");
    if (failed) throw failed.reason;
  }

  return { provider: providerId, totalRemote: remoteFiles.length, imported, updated, unchanged, hashed };
}

async function hashAndExtract(provider: CloudProvider, creds: ProviderCredentials, fileId: string, mimeType: string): Promise<{ hash: string; text: string; mimeType: string } | null> {
  try {
    const { buffer, mimeType: providerMimeType } = await provider.downloadFile(creds, fileId);
    const actualMimeType = detectMimeType(buffer, providerMimeType || mimeType);
    const hash = createHash("sha256").update(buffer).digest("hex");
    const text = await extractText(buffer, actualMimeType);
    return { hash, text, mimeType: actualMimeType };
  } catch {
    // A single unreadable file (permissions, transient network issue) shouldn't fail the
    // whole sync - it just gets indexed without a hash and can be re-checked next sync.
    return null;
  }
}

async function inspectRemoteFile(provider: CloudProvider, creds: ProviderCredentials, fileId: string, declaredMimeType?: string): Promise<{ hash: string; mimeType: string } | null> {
  try {
    const { buffer, mimeType } = await provider.downloadFile(creds, fileId);
    return {
      hash: createHash("sha256").update(buffer).digest("hex"),
      mimeType: detectMimeType(buffer, mimeType || declaredMimeType),
    };
  } catch {
    return null;
  }
}
