import { Google, MicrosoftEntraId } from "arctic";
import { env } from "../core/config";

/**
 * Supported external SSO providers.
 */
export type SupportedAuthProvider = "google" | "entra";

/**
 * Canonical list of supported external SSO providers.
 */
export const SUPPORTED_AUTH_PROVIDERS = ["google", "entra"] as const;

/**
 * Checks whether a provider string maps to a supported SSO provider.
 */
export function isSupportedAuthProvider(value: string): value is SupportedAuthProvider {
  return (SUPPORTED_AUTH_PROVIDERS as readonly string[]).includes(value);
}

/**
 * Returns the OAuth scopes needed for the selected provider.
 */
export function getProviderScopes(provider: SupportedAuthProvider) {
  if (provider === "google") {
    return [
      "openid",
      "profile",
      "email",
      "https://www.googleapis.com/auth/calendar.readonly",
    ];
  }

  return ["openid", "profile", "email", "Calendars.Read", "User.Read"];
}

/**
 * Creates a Google OAuth provider using the tenant-specific callback URL.
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
 * Creates a Microsoft Entra OAuth provider using the tenant-specific callback URL.
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
