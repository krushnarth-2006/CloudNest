import { ConnectedAccount } from "../models";
import { getAuthorizedProvider } from "../providers";

export interface AllocationCandidate {
  provider: string;
  freeBytes: number;
  usedBytes: number;
  totalBytes: number;
}

export interface AllocationResult {
  provider: string;
  reason: string;
  candidates: AllocationCandidate[];
}

/**
 * Picks the connected provider with the most free space that can still fit the file.
 * Always refreshes each provider's real quota first (rather than trusting a stale cache)
 * so the decision reflects current usage. Simple and explainable, per the course-project spec:
 * no ML, no fake numbers, just "biggest free bucket that fits."
 */
export async function chooseProviderForUpload(userId: string, fileSizeBytes: number): Promise<AllocationResult> {
  const accounts = await ConnectedAccount.find({ userId, connected: true });
  if (accounts.length === 0) {
    throw new Error("No connected cloud providers. Connect at least one provider before uploading.");
  }

  const candidates: AllocationCandidate[] = [];
  for (const account of accounts) {
    const authorized = await getAuthorizedProvider(userId, account.provider);
    if (!authorized) continue;
    try {
      const info = await authorized.provider.getStorageInfo(authorized.creds);
      authorized.account.usedBytes = info.usedBytes;
      authorized.account.totalBytes = info.totalBytes;
      authorized.account.storageSyncedAt = new Date();
      await authorized.account.save();
      candidates.push({ provider: account.provider, usedBytes: info.usedBytes, totalBytes: info.totalBytes, freeBytes: Math.max(0, info.totalBytes - info.usedBytes) });
    } catch {
      // Provider quota call failed (expired/revoked token, network blip); skip it as a candidate
      // rather than letting one bad provider fail the whole allocation decision.
    }
  }

  if (candidates.length === 0) {
    throw new Error("Could not read storage quota from any connected provider.");
  }

  const fitting = candidates.filter((c) => c.freeBytes >= fileSizeBytes);
  const pool = fitting.length > 0 ? fitting : candidates;
  const chosen = pool.reduce((best, c) => (c.freeBytes > best.freeBytes ? c : best), pool[0]);

  const reason = fitting.length > 0
    ? `${chosen.provider} has the most free space (${formatGB(chosen.freeBytes)} GB free) among providers that fit this ${formatGB(fileSizeBytes)} GB file.`
    : `No provider has ${formatGB(fileSizeBytes)} GB fully free; ${chosen.provider} has the most free space available (${formatGB(chosen.freeBytes)} GB).`;

  return { provider: chosen.provider, reason, candidates };
}

export interface FileAllocationRecommendation {
  currentProvider: string;
  recommendedProvider: string;
  reason: string;
  shouldMigrate: boolean;
  estimatedFreeAfter: number | null;
}

/**
 * Recommendation-only version of the allocation logic for a file that's already stored
 * somewhere: compares the current provider's free space against every other connected
 * provider and suggests a migration target when another provider is meaningfully better
 * off. Never moves anything itself - the route layer requires explicit user confirmation
 * before calling migrateFile.
 */
export async function recommendProviderForFile(userId: string, currentProvider: string, fileSizeBytes: number): Promise<FileAllocationRecommendation> {
  const accounts = await ConnectedAccount.find({ userId, connected: true });
  const candidates: AllocationCandidate[] = [];
  for (const account of accounts) {
    const authorized = await getAuthorizedProvider(userId, account.provider);
    if (!authorized) continue;
    try {
      const info = await authorized.provider.getStorageInfo(authorized.creds);
      candidates.push({ provider: account.provider, usedBytes: info.usedBytes, totalBytes: info.totalBytes, freeBytes: Math.max(0, info.totalBytes - info.usedBytes) });
    } catch {
      // Skip providers whose quota we can't currently read.
    }
  }

  const current = candidates.find((c) => c.provider === currentProvider);
  if (!current || candidates.length === 0) {
    return { currentProvider, recommendedProvider: currentProvider, reason: "Could not read live quota for the current provider, so no migration is recommended.", shouldMigrate: false, estimatedFreeAfter: null };
  }

  const alternatives = candidates.filter((c) => c.provider !== currentProvider);
  const best = alternatives.reduce((top, c) => (!top || c.freeBytes > top.freeBytes ? c : top), null as AllocationCandidate | null);

  const currentUsedPct = current.totalBytes ? (current.usedBytes / current.totalBytes) * 100 : 0;
  // Only recommend a move when the current provider is meaningfully fuller (>10 percentage
  // points) than the best alternative, and that alternative can actually fit the file -
  // otherwise churn-y "move it for 2% gain" suggestions aren't worth the user's attention.
  if (best && best.freeBytes >= fileSizeBytes) {
    const bestUsedPct = best.totalBytes ? (best.usedBytes / best.totalBytes) * 100 : 0;
    if (currentUsedPct - bestUsedPct > 10) {
      return {
        currentProvider,
        recommendedProvider: best.provider,
        reason: `${currentProvider} is ${currentUsedPct.toFixed(0)}% full. ${best.provider} has more headroom (${bestUsedPct.toFixed(0)}% full, ${formatGB(best.freeBytes)} GB free). Recommend moving this file to ${best.provider}.`,
        shouldMigrate: true,
        estimatedFreeAfter: best.freeBytes - fileSizeBytes,
      };
    }
  }

  return {
    currentProvider,
    recommendedProvider: currentProvider,
    reason: `${currentProvider} has enough room for this file (${currentUsedPct.toFixed(0)}% full). No other connected provider offers a meaningfully better fit.`,
    shouldMigrate: false,
    estimatedFreeAfter: current.freeBytes - fileSizeBytes,
  };
}

function formatGB(bytes: number): string {
  return (bytes / 1024 ** 3).toFixed(2);
}
