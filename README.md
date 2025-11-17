# CALC Translation

[Checkout the Desktop App](https://github.com/jcarpenter-uam/calc-translation-desktop)

## About This Project

This project develops a real-time translation pipeline that integrates directly with Zoom meetings using its RTMS functionality. It captures live audio and processes it through an automated workflow that transcribes, translates, and corrects the content in real time. The final output is displayed on an intuitive frontend where visual indicators clearly highlight any corrections, ensuring participants can follow the conversation accurately and seamlessly.

## How It Works

```mermaid
graph TD
    A["Zoom RTMS WebSocket<br>(raw 16-bit PCM chunks)"] --> B["RTMS Receiver (WS server)<br>- accept websocket frames<br>- speaker-id"];
    B --> C["Audio Preprocessing<br>- Noise suppression<br>- Volume Normalize"];
    C --> D["Soniox WS Connection"];

    D --> E["Immediate (low-lat) pipeline<br>- Produce initial translation"];
    D --> F["Correction pipeline (future context)<br>- rolling context window<br>- disambiguate tone-based confusions<br>- output: correction_needed: true or false "];

    E --> G["Publish (low-latency)"];
    F --> H["Re-translate corrected text<br>- Qwen-MT-Turbo"];
    H --> I["Publish correction event to frontend<br>(edit/update message)"];

    G --> J["Frontend (web/desktop)<br>- display live transcription/translation<br>- apply inline replacements"];
    I -- "WebSocket updates" --> J;

    J --> K["( User sees immediate translation → then corrected revision )"];
```

## Prerequisites

- **Ollama:** Used to handle the text correction logic. To enable this feature, you must train a model using the colab notebook and dataset [here](https://github.com/jcarpenter-uam/zoom-translation/tree/master/extras/ollama/correction)
- **Soniox:** Used as the current transcription/translation model. An API key can be obtained [here](https://soniox.com/docs/)
- **Qwen-MT-Turbo:** Used as the current retranslation model. An API key can be obtained [here](https://www.alibabacloud.com/help/en/model-studio/stream)

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
      - SONIOX_API_KEY=${SONIOX_API_KEY}
      - ALIBABA_API_KEY=${ALIBABA_API_KEY}
      - OLLAMA_URL=${OLLAMA_URL}
      - MAX_CACHE_MB=${MAX_CACHE_MB}
      - JWT_SECRET_KEY=${JWT_SECRET_KEY}
      - ZM_PUBLIC_KEY=${ZM_PUBLIC_KEY}
      - LOGGING_LEVEL=${LOGGING_LEVEL}
    volumes:
      - translation-data:/app/logs
      - translation-data:/app/output
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
      - BASE_SERVER_URL="ws://translation-server:8000/ws/transcribe"
    volumes:
      - zoom_rtms-data:/app/logs
    depends_on:
      - translation-server
    networks:
      - calc-translation

volumes:
  translation-data:
  zoom_rtms-data:

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
# Get this from your Soniox account dashboard.
SONIOX_API_KEY=
#
# A secret token to authenticate incoming WebSocket connections.
# This should be a long, random string.
JWT_SECRET_KEY="a-very-long-and-random-secret-string-that-you-generate"
#
# Public key pair
# openssl rsa -in private-key.pem -pubout -out public-key.pem
ZM_PUBLIC_KEY="-----BEGIN PUBLIC KEY-----\n<KEY_BODY>\n-----END PUBLIC KEY-----"

## General Settings
#
# Log level for the console. Options: DEBUG, INFO, ERROR
# Session log files are always saved at a detailed level.
LOGGING_LEVEL=INFO # Default if not set
#
# The max size (in MB) for each session's in-memory transcript cache.
# Once exceeded, the oldest entries are evicted.
MAX_CACHE_MB=10 # Default if not set

## Optional: Transcription Correction & Retranslation
#
# This feature enables real-time correction of transcripts using a local
# Ollama model, followed by re-translation of the corrected text using
# Alibaba Qwen-MT.
#
# This entire feature is DISABLED unless BOTH of the following variables
# are set.
#
# URL for your local Ollama instance (e.g., http://localhost:11434)
OLLAMA_URL=
#
# API Key for Alibaba DashScope (for Qwen-MT retranslation)
ALIBABA_API_KEY=
```
