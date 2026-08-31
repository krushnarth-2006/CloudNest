import { ConnectedAccount } from "../models";
import { getAuthorizedProvider } from "../providers";

export const CATEGORIES = ["Career", "Education", "Finance", "Identity", "Personal", "Work", "Other"] as const;
export type Category = (typeof CATEGORIES)[number];

/**
 * Returns the cloud-side folder id for a category, creating the folder on the provider
 * only if it doesn't already exist. Each ConnectedAccount caches category -> folderId
 * so repeat uploads never re-list the provider or create a duplicate folder.
 */
export async function ensureCategoryFolder(
  userId: string,
  providerId: string,
  category: string,
): Promise<{ folderId: string; created: boolean }> {
  const authorized = await getAuthorizedProvider(userId, providerId);
  if (!authorized) throw new Error(`Provider ${providerId} is not connected.`);
  const { provider, creds, account } = authorized;

  const cached = account.categoryFolderIds?.[category];
  if (cached) return { folderId: cached, created: false };

  const existing = await provider.findFolder(creds, category, null);
  const created = !existing;
  const folderId = existing ? existing.id : (await provider.createFolder(creds, category, null)).id;

  await ConnectedAccount.updateOne(
    { _id: account._id },
    { $set: { [`categoryFolderIds.${category}`]: folderId } },
  );

  return { folderId, created };
}
