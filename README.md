# CALC Translation

[**Desktop App**](https://github.com/jcarpenter-uam/calc-translation-desktop) | [**Deployment Guide**](./HOW-TO.md)

## About This Project
This project is a comprehensive real-time transcription and translation platform designed to bridge communication gaps in meetings. Unlike traditional bots, it integrates directly with data streams to provide low-latency, accurate captions in multiple languages.

## Features

* **Dual Operation Modes:**
    * **Zoom Integration:** Connects seamlessly via Zoom RTMS (Real-time Media Stream) to capture high-quality meeting audio without a "ghost" participant.
    * **Standalone Mode:** Allows hosts to stream audio directly from their local microphone, making it perfect for in-person presentations or non-Zoom calls.
* **Smart Backfill:** Utilizing Alibaba's Qwen LLM, the system instantly translates the entire session history when a user joins late or switches their target language, ensuring no context is lost.
* **AI Summaries:** Using the meeting transcript a meeting summary is emailed to each meeting attendee at the end of a meeting.
* **Calendar Sync:** Integrates with Microsoft 365 to automatically fetch upcoming meetings and generate one-click join links.

## How It Works

```mermaid
graph LR
    subgraph Inputs
        style Inputs fill:#ffffff,stroke:#333,stroke-dasharray: 5 5
        A["Zoom RTMS<br>(WebSocket 16-bit PCM)"]:::input
        B["Standalone Mode<br>(Browser Microphone)"]:::input
    end

    subgraph Core_Server
        style Core_Server fill:#f0f4c3,stroke:#827717,stroke-width:2px
        C{"Audio Receiver"}:::core
        D["Soniox Service<br>(Live Transcription)"]:::core
        E[("Transcript Cache<br>(Session History)")]:::db
        F["Backfill Service<br>(Qwen LLM)"]:::ai
    end

    subgraph Output
        style Output fill:#ffffff,stroke:#333,stroke-dasharray: 5 5
        G["Connection Manager<br>(WS Broadcast)"]:::core
        H["Frontend Client<br>(Web / Desktop)"]:::client
    end

    %% Data Flow
    A --> C
    B --> C
    C --> D
    D --> G
    D -- "Save" --> E

    %% Client Interactions
    H -. "1. Listen" .-> G
    H -- "2. Switch Lang" --> F
    F -- "Fetch" --> E
    F -- "Translate" --> G

    %% High Visibility Styling
    classDef input fill:#ffccbc,stroke:#bf360c,stroke-width:2px,color:#000;
    classDef core fill:#b3e5fc,stroke:#01579b,stroke-width:2px,color:#000;
    classDef db fill:#c8e6c9,stroke:#1b5e20,stroke-width:2px,color:#000;
    classDef ai fill:#e1bee7,stroke:#4a148c,stroke-width:2px,color:#000;
    classDef client fill:#f5f5f5,stroke:#212121,stroke-width:2px,color:#000;
```
