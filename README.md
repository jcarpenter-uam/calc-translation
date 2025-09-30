# Zoom Real-time Translation

```mermaid
graph TD
    A["Zoom RTMS WebSocket<br>(raw 16-bit PCM chunks)"] --> B["RTMS Receiver (WS server)<br>- accept websocket frames<br>- speaker-id"];
    B --> C["Buffer<br>- normalize chunk sizes<br>- output fixed 20-30ms frames"];
    C --> D["VAD (voice activity detect)<br>- drop non-speech frames"];
    D --> E["Audio Preprocessing<br>- Noise suppression<br>- Volume Normalize"];
    E --> G["STT Router<br>- abstraction layer for easy changing of models"];
    G --> H["STT Output"];

    H --> I["Immediate (low-lat) pipeline<br>- short-context (~0)<br>- Produce initial translation"];
    H --> J["Correction pipeline (LLM)<br>- rolling context window<br>- disambiguate tone-based confusions<br>- output: corrected translation"];

    I --> K["Publish (low-latency)"];
    J --> L["Re-translate corrected text<br>- Seperate Local Model"];
    L --> M["Publish correction event to frontend<br>(edit/update message)"];

    K --> N["Frontend (Zoom embed / url)<br>- display live transcription/translation<br>- apply inline replacements"];
    M -- "WebSocket updates" --> N;

    N --> O["( User sees immediate translation → then corrected revision )"];
```

## Todo:

- Better model, or system prompt to improve the correction pipeline
- Play with cache size, we want full history but at what point is too long?
- Clean up seperation of concerns between files: logging, connection-manager, etc..
- On session end, process the final utterances for correction before clearing cache and saving .json file
- Serve frontend build files from backend, take into account zoom security headers
