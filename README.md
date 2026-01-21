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
