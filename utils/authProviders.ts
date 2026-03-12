import { Google, MicrosoftEntraId } from "arctic";
import { env } from "../core/config";

export const createGoogleProvider = (
  clientId: string,
  clientSecret: string,
) => {
  const redirectUrl = `${env.BASE_URL}/api/auth/callback/google`;
  return new Google(clientId, clientSecret, redirectUrl);
};

export const createEntraProvider = (
  entraTenantId: string,
  clientId: string,
  clientSecret: string,
) => {
  const redirectUrl = `${env.BASE_URL}/api/auth/callback/entra`;
  return new MicrosoftEntraId(
    entraTenantId,
    clientId,
    clientSecret,
    redirectUrl,
  );
};
