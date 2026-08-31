import { Queue, Worker } from "bullmq";

import { logger } from "../lib/logger";
import { FileModel, ConnectedAccount } from "../models";
import { getAuthorizedProvider } from "../providers";
import { categorizeFile } from "../services/ai";
import { ensureCategoryFolder } from "../services/categoryFolder";

/*
 * Redis is OPTIONAL for CloudNest.
 *
 * If REDIS_URL points to localhost/127.0.0.1/::1, we deliberately
 * disable Redis workers because no local Redis server is required
 * for the main CloudNest application.
 *
 * A real/remote Redis URL will still enable the background workers.
 */

function getRedisConnection(): { url: string } | null {
  const rawUrl = process.env.REDIS_URL?.trim();

  if (!rawUrl) {
    return null;
  }

  try {
    const parsed = new URL(rawUrl);

    const hostname = parsed.hostname.toLowerCase();

    const isLocalRedis =
      hostname === "localhost" ||
      hostname === "127.0.0.1" ||
      hostname === "::1" ||
      hostname === "[::1]";

    if (isLocalRedis) {
      logger.info(
        "Local Redis detected; background workers disabled",
      );
      return null;
    }

    return { url: rawUrl };
  } catch (error) {
    logger.warn(
      { err: error },
      "Invalid REDIS_URL; background workers disabled",
    );

    return null;
  }
}

const connection = getRedisConnection();

export const queues = connection
  ? {
      aiCategorization: new Queue(
        "ai-categorization",
        { connection },
      ),

      duplicateProcessing: new Queue(
        "duplicate-processing",
        { connection },
      ),

      metadataSync: new Queue(
        "metadata-sync",
        { connection },
      ),
    }
  : null;

// The upload route already performs categorization/allocation/upload
// inline so the user receives an immediately accurate response.
//
// These queues are only for optional background reconciliation work:
// - re-scan duplicates
// - refresh provider quotas
// - background AI categorization
//
// When Redis is unavailable, the main application continues working
// without background workers.

interface AiCategorizationJob {
  userId: string;
  fileId: string;
}

interface DuplicateProcessingJob {
  userId: string;
}

interface MetadataSyncJob {
  userId: string;
  provider: string;
}

export async function queueAiCategorization(
  data: AiCategorizationJob,
) {
  if (!queues) {
    return;
  }

  try {
    await queues.aiCategorization.add(
      "categorize",
      data,
    );
  } catch (error) {
    logger.warn(
      { err: error },
      "Could not enqueue AI categorization job",
    );
  }
}

export async function queueDuplicateProcessing(
  userId: string,
) {
  if (!queues) {
    return;
  }

  try {
    await queues.duplicateProcessing.add(
      "recompute",
      { userId } satisfies DuplicateProcessingJob,
    );
  } catch (error) {
    logger.warn(
      { err: error },
      "Could not enqueue duplicate processing job",
    );
  }
}

export async function queueMetadataSync(
  userId: string,
  provider: string,
) {
  if (!queues) {
    return;
  }

  try {
    await queues.metadataSync.add(
      "sync",
      { userId, provider } satisfies MetadataSyncJob,
    );
  } catch (error) {
    logger.warn(
      { err: error },
      "Could not enqueue metadata sync job",
    );
  }
}

async function processAiCategorization(
  data: AiCategorizationJob,
) {
  const file = await FileModel.findOne({
    _id: data.fileId,
    userId: data.userId,
  });

  if (!file || file.aiProcessed) {
    return {
      processed: false,
    };
  }

  const result = await categorizeFile({
    filename: file.name,
    mimeType:
      file.mimeType ?? "application/octet-stream",
  });

  if (result.category !== file.category) {
    const folder = await ensureCategoryFolder(
      data.userId,
      file.provider,
      result.category,
    );

    const authorized = await getAuthorizedProvider(
      data.userId,
      file.provider,
    );

    if (authorized && file.cloudFileId) {
      await authorized.provider.moveFile(
        authorized.creds,
        file.cloudFileId,
        folder.folderId,
      );
    }
  }

  file.category = result.category;
  file.categoryConfidence = result.confidence;
  file.categoryReason = result.reason;
  file.aiProcessed = true;

  await file.save();

  return {
    processed: true,
    category: result.category,
  };
}

async function processDuplicateProcessing(
  data: DuplicateProcessingJob,
) {
  const files = await FileModel.find({
    userId: data.userId,
    hash: {
      $exists: true,
      $ne: null,
    },
  });

  const byHash = new Map<string, typeof files>();

  for (const file of files) {
    const list =
      byHash.get(file.hash!) ?? [];

    list.push(file);
    byHash.set(file.hash!, list);
  }

  let updated = 0;

  for (const [, group] of byHash) {
    const shouldBeDuplicate =
      group.length > 1;

    for (const file of group) {
      if (
        Boolean(file.isDuplicate) !==
        shouldBeDuplicate
      ) {
        file.isDuplicate =
          shouldBeDuplicate;

        await file.save();

        updated += 1;
      }
    }
  }

  return {
    processed: true,
    updated,
  };
}

async function processMetadataSync(
  data: MetadataSyncJob,
) {
  const authorized =
    await getAuthorizedProvider(
      data.userId,
      data.provider,
    );

  if (!authorized) {
    return {
      processed: false,
    };
  }

  const info =
    await authorized.provider.getStorageInfo(
      authorized.creds,
    );

  await ConnectedAccount.updateOne(
    {
      userId: data.userId,
      provider: data.provider,
    },
    {
      $set: {
        usedBytes: info.usedBytes,
        totalBytes: info.totalBytes,
        storageSyncedAt: new Date(),
      },
    },
  );

  return {
    processed: true,
    usedBytes: info.usedBytes,
    totalBytes: info.totalBytes,
  };
}

export function startWorkers() {
  /*
   * No Redis = no workers.
   *
   * This is completely normal for local development.
   * CloudNest's API and database functionality do not depend
   * on Redis.
   */
  if (!connection) {
    logger.info(
      "Redis not configured; background workers disabled",
    );
    return;
  }

  try {
    new Worker(
      "ai-categorization",
      async (job) => {
        try {
          return await processAiCategorization(
            job.data as AiCategorizationJob,
          );
        } catch (error) {
          logger.error(
            {
              err: error,
              jobId: job.id,
            },
            "ai-categorization job failed",
          );

          throw error;
        }
      },
      { connection },
    );

    new Worker(
      "duplicate-processing",
      async (job) => {
        try {
          return await processDuplicateProcessing(
            job.data as DuplicateProcessingJob,
          );
        } catch (error) {
          logger.error(
            {
              err: error,
              jobId: job.id,
            },
            "duplicate-processing job failed",
          );

          throw error;
        }
      },
      { connection },
    );

    new Worker(
      "metadata-sync",
      async (job) => {
        try {
          return await processMetadataSync(
            job.data as MetadataSyncJob,
          );
        } catch (error) {
          logger.error(
            {
              err: error,
              jobId: job.id,
            },
            "metadata-sync job failed",
          );

          throw error;
        }
      },
      { connection },
    );

    logger.info(
      "CloudNest background workers started",
    );
  } catch (error) {
    /*
     * Redis failure must NEVER prevent the main API
     * from starting.
     */
    logger.warn(
      { err: error },
      "Background workers could not start; continuing without Redis",
    );
  }
}