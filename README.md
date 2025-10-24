# Zoom Real-time Translation

## About This Project

This project develops a real-time translation pipeline that integrates directly with Zoom meetings using its RTMS functionality. It captures live audio and processes it through an automated workflow that transcribes, translates, and corrects the content in real time. The final output is displayed on an intuitive frontend where visual indicators clearly highlight any corrections, ensuring participants can follow the conversation accurately and seamlessly.

## How It Works

```mermaid
graph TD
    A["Zoom RTMS WebSocket<br>(raw 16-bit PCM chunks)"] --> B["RTMS Receiver (WS server)<br>- accept websocket frames<br>- speaker-id"];
    B --> C["Audio Preprocessing<br>- Noise suppression<br>- Volume Normalize"];
    C --> D["Soniox Output"];

    D --> I["Immediate (low-lat) pipeline<br>- short-context (~0)<br>- Produce initial translation"];
    D --> J["Correction pipeline (LLM)<br>- rolling context window<br>- disambiguate tone-based confusions<br>- output: corrected translation"];

    I --> K["Publish (low-latency)"];
    J --> L["Re-translate corrected text<br>- Seperate Local Model"];
    L --> M["Publish correction event to frontend<br>(edit/update message)"];

    K --> N["Frontend (Zoom embed / url)<br>- display live transcription/translation<br>- apply inline replacements"];
    M -- "WebSocket updates" --> N;

    N --> O["( User sees immediate translation → then corrected revision )"];
```

## Prerequisites

- **Ollama:** Used to handle the text correction logic. To enable this feature, you must train a model using the colab notebook and dataset [here](https://github.com/jcarpenter-uam/zoom-translation/tree/master/extras/ollama/correction)
- **Soniox:** Used as the current transcription/translation model. An API key can be obtained [here](https://soniox.com/docs/)
- **Qwen-MT-Turbo:** Used as the current retranslation model. An API key can be obtained [here](https://www.alibabacloud.com/help/en/model-studio/stream)

## Installation

**1. Create your .env**

```bash
cp .env.example .env
```

**2. Run the Server**

```bash
docker compose up -d
```

## Bugs:

- The zoom-rtms sdk should work for joining and hosting meetings alike
- Play with cache size, we want full history but at what point is too long? Once the limit is reached, the oldest utterance should be stored on disk. Where we append to the file at the end so we store the full meeting transcription.
- Dont show name on frontend as soon as connection is accpeted, wait until something is transcribed

## Inprovements:

- Update install instructions
- Denoising and Normalizing audio needs improvements. Though for zoom calls a simple noise floor should do the trick
- IaC for datacrunch GPU server based on zoom meeting calender?
- Send final transcript to all meeting participants
- Keep tweaking the fine tuned model to get the best results
