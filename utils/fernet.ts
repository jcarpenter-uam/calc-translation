import fernet from "fernet";
import { env } from "../core/config";
import { logger } from "../core/logger";

const secret = new fernet.Secret(env.ENCRYPTION_KEY);

/**
 * Encrypts provider secrets using Fernet.
 */
export function encrypt(plaintext: string): string {
  try {
    const token = new fernet.Token({
      secret: secret,
    });
    return token.encode(plaintext);
  } catch (err) {
    logger.error("Encryption failed.", { err });
    throw new Error("Encryption failed");
  }
}

/**
 * Decrypts provider secrets using Fernet.
 */
export function decrypt(ciphertext: string): string {
  try {
    const token = new fernet.Token({
      secret: secret,
      token: ciphertext,
      // Secrets are configuration data, not expiring session tokens, so decryption keeps Fernet's
      // TTL check disabled to mirror the existing Python behavior.
      ttl: 0,
    });

    return token.decode();
  } catch (err) {
    logger.error("Decryption failed.", { err });
    throw new Error("Internal configuration error.");
  }
}
