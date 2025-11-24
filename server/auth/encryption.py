import logging

from core.config import settings
from cryptography.fernet import Fernet, InvalidToken
from fastapi import HTTPException

logger = logging.getLogger(__name__)

if not settings.ENCRYPTION_KEY:
    logger.error("ENCRYPTION_KEY is not set. Cannot proceed with encryption.")
    raise ValueError("ENCRYPTION_KEY is not set in settings.")

try:
    _cipher_suite = Fernet(settings.ENCRYPTION_KEY.encode())
except Exception as e:
    logger.error(f"Failed to initialize Fernet cipher: {e}. Is ENCRYPTION_KEY valid?")
    raise


def encrypt(plaintext: str) -> str:
    """
    Encrypts a plaintext string.
    """
    try:
        token = _cipher_suite.encrypt(plaintext.encode())
        return token.decode()
    except Exception as e:
        logger.error(f"Encryption failed: {e}")
        raise


def decrypt(ciphertext: str) -> str:
    """
    Decrypts a ciphertext string.
    """
    try:
        decrypted_bytes = _cipher_suite.decrypt(ciphertext.encode())
        return decrypted_bytes.decode()
    except InvalidToken:
        logger.error("Decryption failed: Invalid token or key.")
        raise HTTPException(status_code=500, detail="Internal configuration error.")
    except Exception as e:
        logger.error(f"Decryption failed: {e}")
        raise
