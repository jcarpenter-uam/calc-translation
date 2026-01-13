# CALC Translation

[Checkout the Desktop App](https://github.com/jcarpenter-uam/calc-translation-desktop)

## About This Project

This project develops a real-time translation pipeline that integrates directly with Zoom meetings using its RTMS functionality. It captures live audio and processes it through an automated workflow that transcribes and translates the content in real time. The final output is displayed on an intuitive frontend, ensuring participants can follow the conversation accurately and seamlessly.

## How It Works

```mermaid
graph TD
    A["Zoom RTMS WebSocket<br>(raw 16-bit PCM chunks)"] --> B["RTMS Receiver (WS server)<br>- accept websocket frames<br>- speaker-id"];
    B --> D["Soniox WS Connection"];

    D --> E["Immediate (low-lat) pipeline<br>- Produce initial translation"];

    E --> G["Publish (low-latency)"];

    G --> J["Frontend (web/desktop)<br>- display live transcription/translation"];
```

## Prerequisites

- **Soniox:** Used as the current transcription/translation model. An API key can be obtained [here](https://soniox.com/docs/)
- **Qwen-MT-Turbo:** Used as the current backfill model. An API key can be obtained [here](https://www.alibabacloud.com/help/en/model-studio/stream)

## Installation

**Docker Compose**

```bash
services:
  translation-server:
    image: ghcr.io/jcarpenter-uam/calc-translation/translation-server:latest
    container_name: translation-server
    restart: unless-stopped
    ports:
      - "8000:8000"
    environment:
      - APP_BASE_URL=${APP_BASE_URL}
      - SONIOX_API_KEY=${SONIOX_API_KEY}
      - ALIBABA_API_KEY=${ALIBABA_API_KEY}
      - MAX_CACHE_MB=${MAX_CACHE_MB}
      - DATABASE_URL=${DATABASE_URL}
      - ENCRYPTION_KEY=${ENCRYPTION_KEY}
      - JWT_SECRET_KEY=${JWT_SECRET_KEY}
      - ZM_PUBLIC_KEY=${ZM_PUBLIC_KEY}
      - ZM_RTMS_CLIENT=${ZM_RTMS_CLIENT}
      - ZM_RTMS_SECRET=${ZM_RTMS_SECRET}
      - ZM_METRICS_URL=http://zoom-rtms:8080/metrics
      - LOGGING_LEVEL=${LOGGING_LEVEL}
    volumes:
      - translation-logs:/app/logs
      - translation-vtts:/app/output
    networks:
      - calc-translation

  zoom-rtms:
    image: ghcr.io/jcarpenter-uam/calc-translation/zoom-rtms:latest
    container_name: zoom-rtms
    restart: unless-stopped
    ports:
      - "8080:8080"
    environment:
      - ZM_RTMS_CLIENT=${ZM_RTMS_CLIENT}
      - ZM_RTMS_SECRET=${ZM_RTMS_SECRET}
      - ZM_WEBHOOK_SECRET=${ZM_WEBHOOK_SECRET}
      - ZM_PRIVATE_KEY=${ZM_PRIVATE_KEY}
      - BASE_SERVER_URL=ws://translation-server:8000/ws/transcribe
    depends_on:
      - translation-server
    networks:
      - calc-translation

volumes:
  translation-logs:
  translation-vtts:

networks:
  calc-translation:
    driver: bridge
```

**Expected Variables**

```bash
### ------ ZOOM INTEGRATION ------
## Core Configuration (Required)
#
# Get these for your app in the zoom dev interface
# These are used for both containers
ZM_RTMS_CLIENT=
ZM_RTMS_SECRET=
ZM_WEBHOOK_SECRET=
#
# Private key pair
# openssl genrsa -out private-key.pem 2048
ZM_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n<KEY_BODY>\n-----END PRIVATE KEY-----"
#
# The URL for the integration to reach the server
BASE_SERVER_URL="ws://localhost:8000/ws/transcribe" # Default if not set
#
# Port the server runs on
PORT=8080 # Default if not set

### ------ SERVER ------
## Core Configuration (Required)
#
# The base URL for your application
APP_BASE_URL="http://localhost:8000" # Default if not set
#
# Get this from your Soniox account dashboard.
SONIOX_API_KEY=
#
# API Key for Alibaba DashScope (for Qwen-MT-Turbo Backfill)
ALIBABA_API_KEY=
#
# Encryption key for storing secrets
# python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"
ENCRYPTION_KEY=""
#
# A secret token to authenticate incoming WebSocket connections.
# This should be a long, random string.
JWT_SECRET_KEY="a-very-long-and-random-secret-string-that-you-generate"
#
# Public key pair
# openssl rsa -in private-key.pem -pubout -out public-key.pem
ZM_PUBLIC_KEY="-----BEGIN PUBLIC KEY-----\n<KEY_BODY>\n-----END PUBLIC KEY-----"
#
# Database URL
DATABASE_URL="postgresql://user:password@localhost:5432/calc-translation"

## General Settings
#
# Log level for the console. Options: DEBUG, INFO, ERROR
# Session log files are always saved at a detailed level.
LOGGING_LEVEL=INFO # Default if not set
#
# The max size (in MB) for each session's in-memory transcript cache.
# Once exceeded, the oldest entries are evicted.
MAX_CACHE_MB=10 # Default if not set
#
# Endpoint for the zoom microservice metrics
# This fetches the metrics and returns them for the admin page
ZM_METRICS_URL="http://localhost:8080/metrics" # Default if not set
```
