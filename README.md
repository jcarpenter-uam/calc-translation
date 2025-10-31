# Zoom Real-time Translation

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
  zoom-translation-server:
    image: ghcr.io/jcarpenter-uam/zoom-translation/zoom-translation-server:latest
    container_name: zoom-translation-server
    restart: unless-stopped
    ports:
      - "8000:8000"
    environment:
      - SONIOX_API_KEY=${SONIOX_API_KEY}
      - ALIBABA_API_KEY=${ALIBABA_API_KEY}
      - OLLAMA_URL=${OLLAMA_URL}
      - MAX_CACHE_MB=${MAX_CACHE_MB}
      - WS_TRANSCRIBE_SECRET_TOKEN=${WS_TRANSCRIBE_SECRET_TOKEN}
      - DEBUG_MODE=${DEBUG_MODE}
    volumes:
      - zoom-translation-data:/app/session_history
      - zoom-translation-data:/app/debug
    networks:
      - zoom-translation

  zoom-rtms-server:
    image: ghcr.io/jcarpenter-uam/zoom-translation/zoom-translation-rtms:latest
    container_name: zoom-rtms-server
    restart: unless-stopped
    ports:
      - "8080:8080"
    environment:
      - ZM_RTMS_CLIENT=${ZM_RTMS_CLIENT}
      - ZM_RTMS_SECRET=${ZM_RTMS_SECRET}
      - ZOOM_WEBHOOK_SECRET_TOKEN=${ZOOM_WEBHOOK_SECRET_TOKEN}
      - ZOOM_TRANSLATION_SERVER_URL=${ZOOM_TRANSLATION_SERVER_URL}
      - WS_TRANSCRIBE_SECRET_TOKEN=${WS_TRANSCRIBE_SECRET_TOKEN}
    depends_on:
      - zoom-translation-server
    networks:
      - zoom-translation

volumes:
  zoom-translation-data:

networks:
  zoom-translation:
    driver: bridge
```

**Expected Variables**

```bash
ZM_RTMS_CLIENT=
ZM_RTMS_SECRET=
ZOOM_WEBHOOK_SECRET_TOKEN=

ZOOM_TRANSLATION_SERVER_URL="ws://zoom-translation-server:8000/ws/transcribe"

# Soniox API
SONIOX_API_KEY=

# QWEN-MT-Turbo Retranslation
ALIBABA_API_KEY=

#Ollama
OLLAMA_URL="http://localhost:11434"

# The max cache size for translations/transcriptions.
# Once exceeded the oldest entry is evicted
# Default is 10MB unless specified otherwise
MAX_CACHE_MB=

# Secure token for the /ws/transcibe endpoint
# REQUIRED
WS_TRANSCRIBE_SECRET_TOKEN=defaultwstoken

# Logging state
# True also saves audio files per session
DEBUG_MODE=False # True/False as options
```
