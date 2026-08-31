import { Router, type IRouter } from "express";
import { randomBytes, createHash } from "node:crypto";
import bcrypt from "bcryptjs";
import rateLimit, { ipKeyGenerator } from "express-rate-limit";
import multer from "multer";
import { ActivityLog, ConnectedAccount, FileModel, Folder, ShareLink } from "../models";
import { requireAuth, type AuthRequest } from "../middleware/auth";
import { isMongoConnected } from "../db";
import { getAuthorizedProvider, getProvider, PROVIDER_IDS } from "../providers";
import { createOAuthState, consumeOAuthState } from "../lib/oauthState";
import { chooseProviderForUpload, recommendProviderForFile } from "../services/storageAllocation";
import { ensureCategoryFolder, CATEGORIES } from "../services/categoryFolder";
import { categorizeFile } from "../services/ai";
import { extractText } from "../services/textExtraction";
import { syncProviderFiles } from "../services/cloudSync";
import { queueDuplicateProcessing, queueMetadataSync } from "../workers";

const router: IRouter = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 200 * 1024 * 1024 } });

const databaseRequired = (_req: AuthRequest, res: any, next: any) => {
  if (!isMongoConnected()) return res.status(503).json({ error: "Database is not connected. Set MONGODB_URI to continue." });
  return next();
};
const secure = [databaseRequired, requireAuth];
const activity = (userId: string, action: string, description: string, provider?: string) =>
  ActivityLog.create({ userId, action, description, provider });

const PROVIDER_DISPLAY: Record<string, { name: string; envKey: string }> = {
  "google-drive": { name: "Google Drive", envKey: "GOOGLE_CLIENT_ID" },
  onedrive: { name: "OneDrive", envKey: "MICROSOFT_CLIENT_ID" },
  dropbox: { name: "Dropbox", envKey: "DROPBOX_APP_KEY" },
};

// -----------------------------------------------------------------------
// Dashboard
// -----------------------------------------------------------------------
router.get("/dashboard", ...secure, async (req: AuthRequest, res) => {
  const userId = req.userId!;
const userFiles = await FileModel.find({ userId }).sort({ modifiedAt: -1 }).lean();
  const logs = await ActivityLog.find({ userId }).sort({ createdAt: -1 }).limit(5).lean();
  const byProvider = new Map<string, number>(); const byType = new Map<string, number>();
  for (const file of userFiles) { byProvider.set(file.provider, (byProvider.get(file.provider) ?? 0) + file.size); byType.set(file.mimeType ?? "Other", (byType.get(file.mimeType ?? "Other") ?? 0) + 1); }
  return res.json({
    totalFiles: userFiles.length, totalStorage: userFiles.reduce((sum, file) => sum + file.size, 0),
    connectedProviders: await ConnectedAccount.countDocuments({ userId, connected: true }), duplicateCount: userFiles.filter((file) => file.isDuplicate).length,
    recentFiles: userFiles.slice(0, 5), providerStorage: [...byProvider].map(([label, value]) => ({ label, value })),
    typeDistribution: [...byType].map(([label, value]) => ({ label, value })),
    recentActivity: logs.map((log) => ({ id: String(log._id), action: log.action, description: log.description, provider: log.provider ?? null, createdAt: String(log.createdAt) })),
  });
});

// -----------------------------------------------------------------------
// Files
// -----------------------------------------------------------------------
router.get("/files", ...secure, async (req: AuthRequest, res) => {
  const filter: Record<string, unknown> = { userId: req.userId };

  if (req.query.provider) filter.provider = req.query.provider;
  if (req.query.category) filter.category = req.query.category;

  if (req.query.search) {
    const term = String(req.query.search);

    filter.$or = [
      { name: { $regex: term, $options: "i" } },
      { category: { $regex: term, $options: "i" } },
      { provider: { $regex: term, $options: "i" } },
      { mimeType: { $regex: term, $options: "i" } },
    ];
  }

  const files = await FileModel
    .find(filter)
    .sort({ modifiedAt: -1 })
    .lean();

  return res.json(
    files.map((file) => ({
      ...file,
      id: String(file._id),
    }))
  );
});

router.get("/files/:id", ...secure, async (req: AuthRequest, res) => {
  const file = await FileModel
    .findOne({
      _id: req.params.id,
      userId: req.userId,
    })
    .lean();

  if (!file) {
    return res.status(404).json({ error: "File not found" });
  }

  return res.json({
    ...file,
    id: String(file._id),
  });
});

// Real multipart upload pipeline: buffer -> hash -> duplicate check -> AI category ->
// provider selection -> category folder -> upload bytes to the cloud -> persist metadata.
router.post("/files/upload", ...secure, upload.single("file"), async (req: AuthRequest, res) => {
  const userId = req.userId!;
  const file = req.file;
  if (!file) return res.status(400).json({ error: "No file was uploaded. Attach it under the 'file' field." });

  const requestedProvider = typeof req.body.provider === "string" && req.body.provider ? req.body.provider : undefined;
  const requestedCategory = typeof req.body.category === "string" && req.body.category ? req.body.category : undefined;

  const hash = createHash("sha256").update(file.buffer).digest("hex");
  const duplicate = await FileModel.findOne({ userId, hash }).lean();

  const text = await extractText(file.buffer, file.mimetype);
  const classification = requestedCategory && CATEGORIES.includes(requestedCategory as any)
    ? { category: requestedCategory, confidence: 1, reason: "Category chosen manually by the user." }
    : await categorizeFile({ filename: file.originalname, mimeType: file.mimetype, text });

  let providerId = requestedProvider;
  let allocationReason: string | undefined;
  if (!providerId) {
    try {
      const allocation = await chooseProviderForUpload(userId, file.size);
      providerId = allocation.provider;
      allocationReason = allocation.reason;
    } catch (error) {
      return res.status(409).json({ error: error instanceof Error ? error.message : "Could not choose a storage provider" });
    }
  }

  const authorized = await getAuthorizedProvider(userId, providerId);
  if (!authorized) return res.status(400).json({ error: `${providerId} is not connected. Connect it before uploading.` });

  let folderId: string;
  try {
    const folder = await ensureCategoryFolder(userId, providerId, classification.category);
    folderId = folder.folderId;
    if (folder.created) await activity(userId, "Folder created", `Created "${classification.category}" folder on ${PROVIDER_DISPLAY[providerId]?.name ?? providerId}`, providerId);
  } catch (error) {
    return res.status(502).json({ error: error instanceof Error ? error.message : "Could not prepare the category folder" });
  }

  let uploaded;
  try {
    uploaded = await authorized.provider.uploadFile(authorized.creds, {
      name: file.originalname,
      mimeType: file.mimetype,
      buffer: file.buffer,
      folderId,
    });
  } catch (error) {
    return res.status(502).json({ error: error instanceof Error ? error.message : "Cloud upload failed" });
  }

  const created = await FileModel.create({
    userId, provider: providerId, cloudFileId: uploaded.id,
    name: file.originalname, originalName: file.originalname, mimeType: file.mimetype, size: file.size,
    path: `/${classification.category}/${file.originalname}`, category: classification.category,
    categoryConfidence: classification.confidence, categoryReason: classification.reason,
    hash, isDuplicate: Boolean(duplicate), aiProcessed: true, modifiedAt: new Date(uploaded.modifiedAt ?? Date.now()),
  });

  await activity(userId, "File uploaded", `${file.originalname} uploaded to ${PROVIDER_DISPLAY[providerId]?.name ?? providerId}${allocationReason ? " (auto-selected)" : ""}`, providerId);
  await activity(userId, "Categorization", `${file.originalname} categorized as ${classification.category} (${Math.round(classification.confidence * 100)}% confidence)`, providerId);
  if (duplicate) await activity(userId, "Duplicate detected", `${file.originalname} matches existing file ${duplicate.name}`, providerId);

  queueDuplicateProcessing(userId).catch(() => {});
  queueMetadataSync(userId, providerId).catch(() => {});

  return res.status(201).json(created.toObject());
});

router.get("/files/:id/download", ...secure, async (req: AuthRequest, res) => {
  const file = await FileModel.findOne({ _id: req.params.id, userId: req.userId }).lean();
  if (!file) return res.status(404).json({ error: "File not found" });
  const authorized = await getAuthorizedProvider(req.userId!, file.provider);
  if (!authorized || !file.cloudFileId) return res.status(409).json({ error: "The source provider is not connected; cannot fetch file contents." });
  try {
    const { buffer, mimeType, name } = await authorized.provider.downloadFile(authorized.creds, file.cloudFileId);
    await activity(req.userId!, "Download", `${file.name} downloaded`, file.provider);
    res.setHeader("content-type", mimeType || file.mimeType || "application/octet-stream");
    res.setHeader("content-disposition", `attachment; filename="${encodeURIComponent(name || file.name)}"`);
    return res.send(buffer);
  } catch (error) {
    return res.status(502).json({ error: error instanceof Error ? error.message : "Download failed" });
  }
});

router.delete("/files/:id", ...secure, async (req: AuthRequest, res) => {
  const file = await FileModel.findOneAndDelete({ _id: req.params.id, userId: req.userId });
  if (!file) return res.status(404).json({ error: "File not found" });
  const authorized = await getAuthorizedProvider(req.userId!, file.provider);
  if (authorized && file.cloudFileId) {
    try { await authorized.provider.deleteFile(authorized.creds, file.cloudFileId); } catch { /* metadata is already gone; surface nothing blocking */ }
  }
  await activity(req.userId!, "File deleted", `${file.name} deleted`, file.provider);
  return res.status(204).send();
});

// Renames the actual file on its cloud provider, then mirrors the new name into Mongo.
// If the cloud call fails, Mongo is left untouched so the two never drift out of sync.
router.patch("/files/:id/rename", ...secure, async (req: AuthRequest, res) => {
  const name = typeof req.body.name === "string" ? req.body.name.trim() : "";
  if (!name) return res.status(400).json({ error: "A non-empty name is required" });
  const file = await FileModel.findOne({ _id: req.params.id, userId: req.userId });
  if (!file) return res.status(404).json({ error: "File not found" });
  const authorized = await getAuthorizedProvider(req.userId!, file.provider);
  if (!authorized || !file.cloudFileId) return res.status(409).json({ error: `${file.provider} is not connected; cannot rename the file there.` });
  try {
    await authorized.provider.renameFile(authorized.creds, file.cloudFileId, name);
  } catch (error) {
    return res.status(502).json({ error: error instanceof Error ? error.message : "Rename failed on the cloud provider" });
  }
  const oldName = file.name;
  file.name = name;
  file.path = file.path ? file.path.replace(/[^/]+$/, name) : file.path;
  await file.save();
  await activity(req.userId!, "File renamed", `${oldName} renamed to ${name}`, file.provider);
  return res.json(file.toObject());
});

// Moves the file into a different category folder on the SAME provider (creating the
// folder if needed, same find-or-create logic as upload) and updates the category.
router.post("/files/:id/move", ...secure, async (req: AuthRequest, res) => {
  const category = typeof req.body.category === "string" ? req.body.category : "";
  if (!CATEGORIES.includes(category as any)) return res.status(400).json({ error: `category must be one of ${CATEGORIES.join(", ")}` });
  const file = await FileModel.findOne({ _id: req.params.id, userId: req.userId });
  if (!file) return res.status(404).json({ error: "File not found" });
  const authorized = await getAuthorizedProvider(req.userId!, file.provider);
  if (!authorized || !file.cloudFileId) return res.status(409).json({ error: `${file.provider} is not connected; cannot move the file there.` });
  if (file.category === category) return res.json(file.toObject());
  try {
    const folder = await ensureCategoryFolder(req.userId!, file.provider, category);
    await authorized.provider.moveFile(authorized.creds, file.cloudFileId, folder.folderId);
  } catch (error) {
    return res.status(502).json({ error: error instanceof Error ? error.message : "Move failed on the cloud provider" });
  }
  const previousCategory = file.category;
  file.category = category;
  file.path = `/${category}/${file.name}`;
  file.categoryReason = "Moved manually by the user.";
  file.categoryConfidence = 1;
  await file.save();
  await activity(req.userId!, "File moved", `${file.name} moved from ${previousCategory} to ${category}`, file.provider);
  return res.json(file.toObject());
});

// Copies the file to a different provider (download from source, upload to destination),
// creating a NEW file record. The original is never touched or deleted - this is a copy,
// matching the "never automatically delete the original" requirement for migrations.
router.post("/files/:id/migrate", ...secure, async (req: AuthRequest, res) => {
  const toProvider = typeof req.body.toProvider === "string" ? req.body.toProvider : "";
  const file = await FileModel.findOne({ _id: req.params.id, userId: req.userId });
  if (!file) return res.status(404).json({ error: "File not found" });
  if (toProvider === file.provider) return res.status(400).json({ error: "Destination provider must be different from the current provider" });
  const source = await getAuthorizedProvider(req.userId!, file.provider);
  const destination = await getAuthorizedProvider(req.userId!, toProvider);
  if (!source || !file.cloudFileId) return res.status(409).json({ error: `${file.provider} is not connected; cannot read the source file.` });
  if (!destination) return res.status(409).json({ error: `${toProvider} is not connected; connect it before migrating this file.` });

  let bytes;
  try {
    bytes = await source.provider.downloadFile(source.creds, file.cloudFileId);
  } catch (error) {
    return res.status(502).json({ error: error instanceof Error ? error.message : "Could not read the file from its current provider" });
  }

  let folderId: string;
  try {
    folderId = (await ensureCategoryFolder(req.userId!, toProvider, file.category)).folderId;
  } catch (error) {
    return res.status(502).json({ error: error instanceof Error ? error.message : "Could not prepare the category folder on the destination" });
  }

  let uploaded;
  try {
    uploaded = await destination.provider.uploadFile(destination.creds, { name: file.name, mimeType: file.mimeType ?? "application/octet-stream", buffer: bytes.buffer, folderId });
  } catch (error) {
    return res.status(502).json({ error: error instanceof Error ? error.message : "Upload to the destination provider failed" });
  }

  const migrated = await FileModel.create({
    userId: req.userId, provider: toProvider, cloudFileId: uploaded.id,
    name: file.name, originalName: file.originalName ?? file.name, mimeType: file.mimeType, size: file.size,
    path: `/${file.category}/${file.name}`, category: file.category, categoryConfidence: file.categoryConfidence,
    categoryReason: file.categoryReason, hash: file.hash, isDuplicate: true, aiProcessed: true,
    modifiedAt: new Date(uploaded.modifiedAt ?? Date.now()),
  });
  await queueDuplicateProcessing(String(req.userId)).catch(() => {});
  await activity(req.userId!, "Migration", `${file.name} copied from ${file.provider} to ${toProvider}`, toProvider);
  return res.status(201).json(migrated.toObject());
});

// Copies the file within the SAME provider (distinct from /migrate, which crosses
// providers). Creates a new File record; the original is untouched either way.
router.post("/files/:id/copy", ...secure, async (req: AuthRequest, res) => {
  const file = await FileModel.findOne({ _id: req.params.id, userId: req.userId });
  if (!file) return res.status(404).json({ error: "File not found" });
  const authorized = await getAuthorizedProvider(req.userId!, file.provider);
  if (!authorized || !file.cloudFileId) return res.status(409).json({ error: `${file.provider} is not connected; cannot copy the file there.` });

  const requestedName = typeof req.body.name === "string" && req.body.name.trim() ? req.body.name.trim() : null;
  const ext = file.name.includes(".") ? file.name.slice(file.name.lastIndexOf(".")) : "";
  const base = ext ? file.name.slice(0, -ext.length) : file.name;
  const newName = requestedName ?? `${base} copy${ext}`;

  let folderId: string;
  try {
    folderId = (await ensureCategoryFolder(req.userId!, file.provider, file.category)).folderId;
  } catch (error) {
    return res.status(502).json({ error: error instanceof Error ? error.message : "Could not prepare the destination folder" });
  }

  let copied;
  try {
    copied = await authorized.provider.copyFile(authorized.creds, file.cloudFileId, newName, folderId);
  } catch (error) {
    return res.status(502).json({ error: error instanceof Error ? error.message : "Copy failed on the cloud provider" });
  }

  const created = await FileModel.create({
    userId: req.userId, provider: file.provider, cloudFileId: copied.id,
    name: copied.name, originalName: copied.name, mimeType: file.mimeType, size: copied.size || file.size,
    path: `/${file.category}/${copied.name}`, category: file.category, categoryConfidence: file.categoryConfidence,
    categoryReason: file.categoryReason, hash: file.hash, isDuplicate: true, aiProcessed: true,
    modifiedAt: new Date(copied.modifiedAt ?? Date.now()),
  });
  await queueDuplicateProcessing(String(req.userId)).catch(() => {});
  await activity(req.userId!, "File copied", `${file.name} copied to ${copied.name} on ${file.provider}`, file.provider);
  return res.status(201).json(created.toObject());
});

// User-initiated folder creation (as opposed to the automatic category-folder creation
// during upload). Persists a Folder record too so it can be browsed/reused.
router.post("/folders", ...secure, async (req: AuthRequest, res) => {
  const { provider: providerId, name } = req.body as { provider?: string; name?: string };
  if (!providerId || !name?.trim()) return res.status(400).json({ error: "provider and name are required" });
  const authorized = await getAuthorizedProvider(req.userId!, providerId);
  if (!authorized) return res.status(409).json({ error: `${providerId} is not connected.` });
  try {
    const folder = await authorized.provider.createFolder(authorized.creds, name.trim(), null);
    await Folder.create({ userId: req.userId, provider: providerId, name: name.trim(), cloudFolderId: folder.id });
    await activity(req.userId!, "Folder created", `Created "${name.trim()}" folder on ${PROVIDER_DISPLAY[providerId]?.name ?? providerId}`, providerId);
    return res.status(201).json({ id: folder.id, name: folder.name, provider: providerId });
  } catch (error) {
    return res.status(502).json({ error: error instanceof Error ? error.message : "Could not create the folder" });
  }
});

// -----------------------------------------------------------------------
// Providers / OAuth
// -----------------------------------------------------------------------
router.get("/providers", ...secure, async (req: AuthRequest, res) => {
  const accounts = await ConnectedAccount.find({ userId: req.userId }).lean();
  return res.json(PROVIDER_IDS.map((id) => {
    const meta = PROVIDER_DISPLAY[id];
    const account = accounts.find((a) => a.provider === id);
    const configured = getProvider(id)?.isConfigured() ?? false;
    const connected = Boolean(account?.connected);
    return {
      id, name: meta.name, connected, configured,
      statusMessage: connected ? "Connected" : configured ? "Ready to connect" : `${meta.name} is not configured.`,
      usedBytes: account?.usedBytes ?? 0, totalBytes: account?.totalBytes ?? 0,
    };
  }));
});

router.post("/providers/:provider/connect", ...secure, async (req: AuthRequest, res) => {
  const meta = PROVIDER_DISPLAY[String(req.params.provider)];
  const provider = getProvider(String(req.params.provider));
  if (!meta || !provider) return res.status(404).json({ error: "Provider not supported" });
  if (!provider.isConfigured()) return res.status(400).json({ error: `${meta.name} is not configured.` });
  // Real connection only happens through the OAuth redirect below; this endpoint just
  // reports configuration status for the "Check configuration" button state.
  return res.json({ id: String(req.params.provider), name: meta.name, connected: false, configured: true, statusMessage: "Use the connect button to complete OAuth authorization.", usedBytes: 0, totalBytes: 0 });
});

router.get("/providers/:provider/connect", requireAuth, async (req: AuthRequest, res) => {
  const meta = PROVIDER_DISPLAY[String(req.params.provider)];
  const provider = getProvider(String(req.params.provider));
  if (!meta || !provider) return res.status(404).json({ error: "Provider not supported" });
  if (!provider.isConfigured()) return res.status(400).json({ error: `${meta.name} is not configured.` });
  const redirectUri = process.env[`${String(req.params.provider) === "google-drive" ? "GOOGLE" : String(req.params.provider) === "onedrive" ? "MICROSOFT" : "DROPBOX"}_REDIRECT_URI`]
    ?? `${process.env.BACKEND_URL}/api/providers/${String(req.params.provider)}/callback`;
  const state = await createOAuthState(req.userId!, String(req.params.provider));
  return res.redirect(provider.buildAuthorizeUrl({ redirectUri, state }));
});

router.get("/providers/:provider/callback", async (req, res) => {
  if (!isMongoConnected()) return res.status(503).send("Database is not connected");
  const meta = PROVIDER_DISPLAY[String(req.params.provider)];
  const provider = getProvider(String(req.params.provider));
  if (!meta || !provider) return res.status(404).send("Provider not supported");

  const { code, state, error: oauthError } = req.query;
  if (oauthError) return res.redirect(`${process.env.FRONTEND_URL ?? "/"}/providers?error=${encodeURIComponent(String(oauthError))}`);
  if (!code || !state) return res.status(400).send("OAuth authorization code or state is missing");

  const userId = await consumeOAuthState(String(state), String(req.params.provider));
  if (!userId) return res.status(400).send("OAuth state is invalid, expired, or already used. Please try connecting again.");

  const redirectUri = process.env[`${String(req.params.provider) === "google-drive" ? "GOOGLE" : String(req.params.provider) === "onedrive" ? "MICROSOFT" : "DROPBOX"}_REDIRECT_URI`]
    ?? `${process.env.BACKEND_URL}/api/providers/${String(req.params.provider)}/callback`;

  let tokens;
  try {
    tokens = await provider.exchangeCode({ code: String(code), redirectUri });
  } catch {
    return res.status(502).send("OAuth token exchange failed");
  }

  const { encryptSecret } = await import("../lib/crypto");
  const account = await ConnectedAccount.findOneAndUpdate(
    { userId, provider: String(req.params.provider) },
    {
      userId, provider: String(req.params.provider), connected: true,
      providerAccountId: tokens.providerAccountId,
      accessTokenEnc: encryptSecret(tokens.accessToken),
      refreshTokenEnc: encryptSecret(tokens.refreshToken),
      scopes: tokens.scope?.split(" ") ?? [],
      tokenExpiresAt: tokens.expiresAt,
    },
    { upsert: true, new: true },
  );

  // Pull real quota immediately so the Providers page shows accurate numbers right away.
  try {
    const info = await provider.getStorageInfo({ accessToken: tokens.accessToken });
    account.usedBytes = info.usedBytes; account.totalBytes = info.totalBytes; account.storageSyncedAt = new Date();
    await account.save();
  } catch { /* non-fatal; a later sync will pick this up */ }

  await activity(userId, "Provider connected", `${meta.name} connected`, String(req.params.provider));
  return res.redirect(`${process.env.FRONTEND_URL ?? "/"}/providers?connected=${String(req.params.provider)}`);
});

router.delete("/providers/:provider/disconnect", ...secure, async (req: AuthRequest, res) => {
  const authorized = await getAuthorizedProvider(req.userId!, String(req.params.provider));
  if (authorized) { try { await authorized.provider.disconnect(authorized.creds); } catch { /* best effort */ } }
  await ConnectedAccount.deleteOne({ userId: req.userId, provider: String(req.params.provider) });
  await activity(req.userId!, "Provider disconnected", `${String(req.params.provider)} disconnected`, String(req.params.provider));
  return res.status(204).send();
});

// Real cloud sync: imports/indexes files that already exist on the provider (uploaded
// outside CloudNest, or from before this account was connected) into the Mongo file index -
// not just a quota refresh. Runs the same hash -> AI-categorize pipeline a fresh upload gets
// for anything under the size cutoff (see services/cloudSync.ts).
router.post("/providers/:provider/sync", ...secure, async (req: AuthRequest, res) => {
  try {
    const summary = await syncProviderFiles(String(req.userId), String(req.params.provider));
    if (summary.imported > 0 || summary.hashed > 0) await queueDuplicateProcessing(String(req.userId)).catch(() => {});
    await activity(req.userId!, "Provider synced", `${summary.imported} new file(s) indexed, ${summary.updated} updated from ${req.params.provider} (${summary.totalRemote} total found)`, String(req.params.provider));
    return res.json(summary);
  } catch (error) {
    return res.status(502).json({ error: error instanceof Error ? error.message : "Sync failed" });
  }
});

// -----------------------------------------------------------------------
// Analytics / activity / duplicates
// -----------------------------------------------------------------------
router.get("/analytics", ...secure, async (req: AuthRequest, res) => {
  const files = await FileModel.find({ userId: req.userId }).sort({ size: -1 }).limit(1000).lean();
  // "providerStorage" is bytes consumed per provider; fileTypes/categories are file counts.
  // Keeping these separate (rather than one generic "count everything" helper) avoids
  // silently mislabeling counts as bytes on the Analytics page.
  const sumBy = (key: "provider") => [...files.reduce((map, file) => map.set(file[key] ?? "Other", (map.get(file[key] ?? "Other") ?? 0) + file.size), new Map<string, number>())].map(([label, value]) => ({ label, value }));
  const countBy = (key: "category" | "mimeType") => [...files.reduce((map, file) => map.set(file[key] ?? "Other", (map.get(file[key] ?? "Other") ?? 0) + 1), new Map<string, number>())].map(([label, value]) => ({ label, value }));
  return res.json({ totalStorage: files.reduce((sum, file) => sum + file.size, 0), duplicateCount: files.filter((f) => f.isDuplicate).length, providerStorage: sumBy("provider"), fileTypes: countBy("mimeType"), categories: countBy("category"), largestFiles: files.slice(0, 5) });
});

router.get("/activity", ...secure, async (req: AuthRequest, res) => res.json((await ActivityLog.find({ userId: req.userId }).sort({ createdAt: -1 }).limit(100).lean()).map((log) => ({ id: String(log._id), action: log.action, description: log.description, provider: log.provider ?? null, createdAt: String(log.createdAt) }))));

router.get("/duplicates", ...secure, async (req: AuthRequest, res) => {
  const files = await FileModel.find({ userId: req.userId, isDuplicate: true, hash: { $exists: true } }).lean();
  const grouped = new Map<string, typeof files>();
  files.forEach((file) => grouped.set(file.hash!, [...(grouped.get(file.hash!) ?? []), file]));
  return res.json([...grouped].map(([hash, groupedFiles]) => ({ hash, files: groupedFiles, totalSize: groupedFiles.reduce((sum, file) => sum + file.size, 0) })));
});

router.post("/storage/allocate", ...secure, async (req: AuthRequest, res) => {
  const size = Number(req.body.size ?? 0);
  try {
    const allocation = await chooseProviderForUpload(req.userId!, size);
    return res.json({ provider: allocation.provider, reason: allocation.reason });
  } catch (error) {
    return res.status(409).json({ error: error instanceof Error ? error.message : "Could not allocate storage" });
  }
});

// Recommendation only - never moves anything. The frontend must call /files/:id/migrate
// with explicit confirmation to actually act on this.
router.get("/allocation/recommend/:id", ...secure, async (req: AuthRequest, res) => {
  const file = await FileModel.findOne({ _id: req.params.id, userId: req.userId }).lean();
  if (!file) return res.status(404).json({ error: "File not found" });
  try {
    const recommendation = await recommendProviderForFile(req.userId!, file.provider, file.size);
    return res.json(recommendation);
  } catch (error) {
    return res.status(502).json({ error: error instanceof Error ? error.message : "Could not compute a recommendation" });
  }
});

// -----------------------------------------------------------------------
// Sharing
// -----------------------------------------------------------------------
router.get("/shares", ...secure, async (req: AuthRequest, res) => res.json(await ShareLink.aggregate([{ $match: { ownerId: req.userId } }, { $lookup: { from: "files", localField: "fileId", foreignField: "_id", as: "file" } }, { $unwind: "$file" }, { $project: { id: "$_id", fileId: 1, fileName: "$file.name", permission: 1, expiresAt: 1, token: 1, accessCount: 1, createdAt: 1 } }])));

router.post("/shares", ...secure, async (req: AuthRequest, res) => {
  const file = await FileModel.findOne({ _id: req.body.fileId, userId: req.userId });
  if (!file) return res.status(404).json({ error: "File not found" });
  if (!["READ", "WRITE"].includes(req.body.permission)) return res.status(400).json({ error: "Permission must be READ or WRITE" });
  const share = await ShareLink.create({ fileId: file._id, ownerId: req.userId, permission: req.body.permission, passwordHash: req.body.password ? await bcrypt.hash(req.body.password, 12) : undefined, expiresAt: new Date(req.body.expiresAt), token: randomBytes(32).toString("hex") });
  await activity(req.userId!, "File shared", `${file.name} shared with ${req.body.permission} access`, file.provider);
  return res.status(201).json({ id: share._id, fileId: file._id, fileName: file.name, permission: share.permission, expiresAt: share.expiresAt, token: share.token, accessCount: 0, createdAt: share.createdAt });
});

router.delete("/shares/:id", ...secure, async (req: AuthRequest, res) => { const share = await ShareLink.findOneAndUpdate({ _id: req.params.id, ownerId: req.userId }, { revokedAt: new Date() }); if (share) await activity(req.userId!, "Share revoked", "A sharing link was revoked"); return res.status(204).send(); });

router.get("/share/:token", async (req, res) => {
  if (!isMongoConnected()) return res.status(503).json({ error: "Database is not connected" });
  const share = await ShareLink.findOne({ token: req.params.token, revokedAt: { $exists: false } }).populate("fileId").lean();
  if (!share) return res.status(404).json({ error: "This sharing link is no longer available." });
  if (new Date(share.expiresAt) < new Date()) return res.status(410).json({ error: "This sharing link has expired." });
  const file = share.fileId as unknown as { name: string; mimeType?: string; size?: number };
  return res.json({ fileName: file.name, mimeType: file.mimeType, size: file.size, permission: share.permission, passwordProtected: Boolean(share.passwordHash) });
});

// Password verification is a guessing target, so it gets its own tight rate limit
// on top of anything applied elsewhere.
const shareVerifyLimit = rateLimit({ windowMs: 10 * 60 * 1000, limit: 10, standardHeaders: true, keyGenerator: (req) => `${ipKeyGenerator(req.ip ?? "unknown")}:${req.params.token}` });

router.post("/share/:token/verify", shareVerifyLimit, async (req, res) => {
  if (!isMongoConnected()) return res.status(503).json({ error: "Database is not connected" });
  const share = await ShareLink.findOne({ token: req.params.token, revokedAt: { $exists: false } });
  if (!share) return res.status(404).json({ error: "This sharing link is no longer available." });
  if (new Date(share.expiresAt) < new Date()) return res.status(410).json({ error: "This sharing link has expired." });
  if (share.passwordHash && !(await bcrypt.compare(String(req.body.password ?? ""), share.passwordHash))) return res.status(403).json({ error: "Incorrect share password" });
  await ShareLink.updateOne({ _id: share._id }, { $inc: { accessCount: 1 } });
  return res.json({ verified: true, permission: share.permission });
});

// Streams the actual file bytes through the owner's connected provider. Requires the
// same password check as /verify (kept here too, so this endpoint can't be used to
// bypass the password by skipping /verify) and never exposes the owner's tokens.
router.post("/share/:token/download", shareVerifyLimit, async (req, res) => {
  if (!isMongoConnected()) return res.status(503).json({ error: "Database is not connected" });
  const share = await ShareLink.findOne({ token: req.params.token, revokedAt: { $exists: false } }).populate("fileId");
  if (!share) return res.status(404).json({ error: "This sharing link is no longer available." });
  if (new Date(share.expiresAt) < new Date()) return res.status(410).json({ error: "This sharing link has expired." });
  if (share.passwordHash && !(await bcrypt.compare(String(req.body.password ?? ""), share.passwordHash))) return res.status(403).json({ error: "Incorrect share password" });

  const file = share.fileId as unknown as { name: string; mimeType?: string; provider: string; cloudFileId?: string };
  const authorized = await getAuthorizedProvider(String(share.ownerId), file.provider);
  if (!authorized || !file.cloudFileId) return res.status(409).json({ error: "The source provider is not connected; cannot fetch file contents." });

  try {
    const { buffer, mimeType, name } = await authorized.provider.downloadFile(authorized.creds, file.cloudFileId);
    await ShareLink.updateOne({ _id: share._id }, { $inc: { accessCount: 1 } });
    res.setHeader("content-type", mimeType || file.mimeType || "application/octet-stream");
    res.setHeader("content-disposition", `attachment; filename="${encodeURIComponent(name || file.name)}"`);
    return res.send(buffer);
  } catch (error) {
    return res.status(502).json({ error: error instanceof Error ? error.message : "Download failed" });
  }
});

// Genuine WRITE functionality: a share-link holder with WRITE permission can replace the
// file's content. This is implemented uniformly across all three providers (upload the new
// bytes, then delete the old cloud object) rather than relying on provider-specific "edit"
// APIs that don't exist for arbitrary file types - so advertising WRITE access is honest:
// it actually changes the file, for every provider, not just some of them.
router.post("/share/:token/upload", shareVerifyLimit, upload.single("file"), async (req, res) => {
  if (!isMongoConnected()) return res.status(503).json({ error: "Database is not connected" });
  const share = await ShareLink.findOne({ token: req.params.token, revokedAt: { $exists: false } }).populate("fileId");
  if (!share) return res.status(404).json({ error: "This sharing link is no longer available." });
  if (new Date(share.expiresAt) < new Date()) return res.status(410).json({ error: "This sharing link has expired." });
  if (share.permission !== "WRITE") return res.status(403).json({ error: "This share link is read-only." });
  if (share.passwordHash && !(await bcrypt.compare(String(req.body.password ?? ""), share.passwordHash))) return res.status(403).json({ error: "Incorrect share password" });
  if (!req.file) return res.status(400).json({ error: "No replacement file was uploaded. Attach it under the 'file' field." });

  const fileDoc = await FileModel.findById(share.fileId);
  if (!fileDoc) return res.status(404).json({ error: "The shared file no longer exists." });
  const authorized = await getAuthorizedProvider(String(share.ownerId), fileDoc.provider);
  if (!authorized) return res.status(409).json({ error: "The source provider is not connected; cannot update the file." });

  const previousCloudFileId = fileDoc.cloudFileId;
  let uploaded;
  try {
    const { folderId } = await ensureCategoryFolder(String(share.ownerId), fileDoc.provider, fileDoc.category);
    uploaded = await authorized.provider.uploadFile(authorized.creds, { name: fileDoc.name, mimeType: req.file.mimetype || fileDoc.mimeType || "application/octet-stream", buffer: req.file.buffer, folderId });
  } catch (error) {
    return res.status(502).json({ error: error instanceof Error ? error.message : "Could not upload the replacement file" });
  }
  if (previousCloudFileId) {
    try { await authorized.provider.deleteFile(authorized.creds, previousCloudFileId); } catch { /* old version orphaned but not fatal */ }
  }

  const hash = createHash("sha256").update(req.file.buffer).digest("hex");
  fileDoc.cloudFileId = uploaded.id;
  fileDoc.size = req.file.size;
  fileDoc.mimeType = req.file.mimetype || fileDoc.mimeType;
  fileDoc.hash = hash;
  fileDoc.modifiedAt = new Date(uploaded.modifiedAt ?? Date.now());
  await fileDoc.save();
  await ShareLink.updateOne({ _id: share._id }, { $inc: { accessCount: 1 } });
  await queueDuplicateProcessing(String(share.ownerId)).catch(() => {});
  await activity(String(share.ownerId), "File updated via share link", `${fileDoc.name} replaced through a WRITE share link`, fileDoc.provider);
  return res.status(200).json({ updated: true, size: fileDoc.size, modifiedAt: fileDoc.modifiedAt });
});

export default router;
