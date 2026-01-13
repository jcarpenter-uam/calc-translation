import sys

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """
    Defines the application's configuration settings.

    Pydantic will automatically read from the environment or a .env file.
    """

    model_config = SettingsConfigDict(
        env_file=".env", env_file_encoding="utf-8", extra="ignore"
    )

    APP_BASE_URL: str = "http://localhost:8000"

    SONIOX_API_KEY: str

    ALIBABA_API_KEY: str = ""

    MAX_CACHE_MB: int = 10

    DATABASE_URL: str

    ENCRYPTION_KEY: str

    JWT_SECRET_KEY: str

    ZM_PUBLIC_KEY: str

    ZM_RTMS_CLIENT: str

    ZM_RTMS_SECRET: str

    ZM_METRICS_URL: str = "http://localhost:8080/metrics"

    SMTP_HOST: str = "smtp.gmail.com"

    SMTP_PORT: int = 587

    SMTP_USER: str

    SMTP_PASSWORD: str

    SYSTEM_MAILER_EMAIL: str

    LOGGING_LEVEL: str = "INFO"


try:
    settings = Settings()

except Exception as e:
    print(f"FATAL: Failed to load application settings: {e}", file=sys.stderr)
    sys.exit("Failed to load configuration. Exiting.")
