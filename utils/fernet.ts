import fernet from "fernet";
import { env } from "../core/config";
import { logger } from "../core/logger";

const secret = new fernet.Secret(env.ENCRYPTION_KEY);

export function encrypt(plaintext: string): string {
  try {
    const token = new fernet.Token({
      secret: secret,
    });
    return token.encode(plaintext);
  } catch (err) {
    logger.error("Encryption failed:", err);
    throw new Error("Encryption failed");
  }
}

export function decrypt(ciphertext: string): string {
  try {
    const token = new fernet.Token({
      secret: secret,
      token: ciphertext,
      ttl: 0, // Python's base .decrypt() doesn't enforce TTL, so we disable it here
    });

    // token.decode() validates the HMAC signature and extracts the original string
    return token.decode();
  } catch (err) {
    logger.error("Decryption failed:", err);
    throw new Error("Internal configuration error.");
  }
}
