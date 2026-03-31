import { and, eq } from "drizzle-orm";
import { Google, MicrosoftEntraId } from "arctic";
import { db } from "../core/database";
import { logger } from "../core/logger";
import { tenantAuthConfigs } from "../models/tenantModel";
import {
  createEntraProvider,
  createGoogleProvider,
  type SupportedAuthProvider,
} from "../utils/authProviders";
import { decrypt } from "../utils/fernet";

export type TenantOAuthProvider = Google | MicrosoftEntraId;

/**
 * Loads the configured OAuth provider client for a tenant/provider pair.
 */
export async function getTenantAuthProvider(
  tenantId: string,
  providerType: SupportedAuthProvider,
  callbackBaseUrl?: string,
): Promise<TenantOAuthProvider> {
  logger.debug("Looking up auth config.", {
    tenantId,
    provider: providerType,
  });

  const [config] = await db
    .select()
    .from(tenantAuthConfigs)
    .where(
      and(
        eq(tenantAuthConfigs.tenantId, tenantId),
        eq(tenantAuthConfigs.providerType, providerType),
      ),
    );

  if (!config) {
    logger.warn("Auth config not found.", {
      tenantId,
      provider: providerType,
    });
    throw new Error(
      `Auth config not found for tenant ${tenantId} and provider ${providerType}`,
    );
  }

  const decryptedSecret = decrypt(config.clientSecretEncrypted);

  if (providerType === "google") {
    return createGoogleProvider(config.clientId, decryptedSecret, callbackBaseUrl);
  }

  return createEntraProvider(
    config.tenantHint || "common",
    config.clientId,
    decryptedSecret,
    callbackBaseUrl,
  );
}
