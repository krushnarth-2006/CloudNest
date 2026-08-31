import mongoose, { Schema } from "mongoose";

const timestamps = true;

export const User = mongoose.models.User ?? mongoose.model("User", new Schema({
  name: { type: String, required: true, trim: true },
  email: { type: String, required: true, unique: true, lowercase: true, index: true },
  passwordHash: { type: String, required: true },
}, { timestamps }));

// Tokens are stored encrypted (see lib/crypto.ts) and are never sent to the frontend.
// `connected` only flips to true after a completed OAuth token exchange -
// having client credentials configured is not enough.
export const ConnectedAccount = mongoose.models.ConnectedAccount ?? mongoose.model("ConnectedAccount", new Schema({
  userId: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
  provider: { type: String, required: true, enum: ["google-drive", "onedrive", "dropbox"] },
  providerAccountId: String,
  connected: { type: Boolean, default: false },
  accessTokenEnc: String,
  refreshTokenEnc: String,
  scopes: [String],
  tokenExpiresAt: Date,
  categoryFolderIds: { type: Schema.Types.Mixed, default: {} }, // { Career: "cloud-folder-id", ... }
  usedBytes: { type: Number, default: 0 },
  totalBytes: { type: Number, default: 0 },
  storageSyncedAt: Date,
}, { timestamps }));
ConnectedAccount.schema.index({ userId: 1, provider: 1 }, { unique: true });

export const FileModel = mongoose.models.File ?? mongoose.model("File", new Schema({
  userId: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
  provider: { type: String, required: true, index: true },
  cloudFileId: String,
  name: { type: String, required: true, index: true },
  originalName: String,
  mimeType: String,
  size: { type: Number, required: true },
  path: String,
  folderId: Schema.Types.ObjectId,
  category: { type: String, default: "Other", index: true },
  categoryConfidence: Number,
  categoryReason: String,
  hash: { type: String, index: true },
  isDuplicate: Boolean,
  aiProcessed: Boolean,
  modifiedAt: Date,
  metadata: Schema.Types.Mixed,
}, { timestamps }));
FileModel.schema.index({ userId: 1, hash: 1 });
FileModel.schema.index({ userId: 1, name: "text" });

export const Folder = mongoose.models.Folder ?? mongoose.model("Folder", new Schema({
  userId: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
  provider: String,
  name: String,
  cloudFolderId: String,
}, { timestamps }));
Folder.schema.index({ userId: 1, provider: 1, name: 1 });

export const ShareLink = mongoose.models.ShareLink ?? mongoose.model("ShareLink", new Schema({
  fileId: { type: Schema.Types.ObjectId, ref: "File", required: true },
  ownerId: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
  permission: { type: String, enum: ["READ", "WRITE"], required: true },
  passwordHash: String,
  expiresAt: { type: Date, required: true },
  token: { type: String, required: true, unique: true, index: true },
  revokedAt: Date,
  accessCount: { type: Number, default: 0 },
}, { timestamps }));

export const ActivityLog = mongoose.models.ActivityLog ?? mongoose.model("ActivityLog", new Schema({
  userId: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
  action: String,
  description: String,
  provider: String,
}, { timestamps }));
ActivityLog.schema.index({ userId: 1, createdAt: -1 });

// Short-lived, single-use OAuth state records. The `state` query param we hand a
// provider is this document's random token, never the raw userId - the callback
// looks the record up, checks it hasn't expired/been used, and only then trusts
// the userId it stored server-side.
export const OAuthState = mongoose.models.OAuthState ?? mongoose.model("OAuthState", new Schema({
  state: { type: String, required: true, unique: true, index: true },
  userId: { type: Schema.Types.ObjectId, ref: "User", required: true },
  provider: { type: String, required: true },
  usedAt: Date,
  expiresAt: { type: Date, required: true },
}, { timestamps }));
OAuthState.schema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
