import { Google, MicrosoftEntraId } from "arctic";
import { env } from "../core/config";

/**
 * Creates a Google OAuth provider for a tenant.
 */
export const createGoogleProvider = (
  clientId: string,
  clientSecret: string,
  callbackBaseUrl?: string,
) => {
  const redirectBaseUrl = callbackBaseUrl || env.BASE_URL;
  const redirectUrl = `${redirectBaseUrl}/api/auth/callback/google`;
  return new Google(clientId, clientSecret, redirectUrl);
};

/**
 * Creates a Microsoft Entra OAuth provider for a tenant.
 */
export const createEntraProvider = (
  entraTenantId: string,
  clientId: string,
  clientSecret: string,
  callbackBaseUrl?: string,
) => {
  const redirectBaseUrl = callbackBaseUrl || env.BASE_URL;
  const redirectUrl = `${redirectBaseUrl}/api/auth/callback/entra`;
  return new MicrosoftEntraId(
    entraTenantId,
    clientId,
    clientSecret,
    redirectUrl,
  );
};
