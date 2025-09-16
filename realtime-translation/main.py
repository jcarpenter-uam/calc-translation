import asyncio
import json
from typing import List

import uvicorn
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from services.transcription_service import (
    STATUS_CONTINUE_FRAME,
    STATUS_FIRST_FRAME,
    TranscriptionService,
)
from services.translation_service import QwenTranslationService

app = FastAPI(
    title="Real-Time Transcription and Translation API",
    description="A WebSocket API to stream audio for real-time transcription (iFlyTek) and translation (Alibaba Qwen).",
)


class ConnectionManager:
    """Manages active WebSocket connections."""

    def __init__(self):
        self.active_connections: List[WebSocket] = []

    async def connect(self, websocket: WebSocket):
        await websocket.accept()
        self.active_connections.append(websocket)
        print(f"Viewer connected. Total viewers: {len(self.active_connections)}")

    def disconnect(self, websocket: WebSocket):
        self.active_connections.remove(websocket)
        print(f"Viewer disconnected. Total viewers: {len(self.active_connections)}")

    async def broadcast(self, message: str):
        """Broadcasts a message to all connected viewers."""
        if self.active_connections:
            tasks = [conn.send_text(message) for conn in self.active_connections]
            await asyncio.gather(*tasks)


# Managers for transcription and translation viewer endpoints
transcription_manager = ConnectionManager()
translation_manager = ConnectionManager()


@app.websocket("/ws/view_transcription")
async def websocket_viewer_endpoint(websocket: WebSocket):
    await transcription_manager.connect(websocket)
    try:
        while True:
            await websocket.receive_text()
    except WebSocketDisconnect:
        transcription_manager.disconnect(websocket)


@app.websocket("/ws/view_translation")
async def websocket_translation_viewer_endpoint(websocket: WebSocket):
    await translation_manager.connect(websocket)
    try:
        while True:
            await websocket.receive_text()
    except WebSocketDisconnect:
        translation_manager.disconnect(websocket)


@app.websocket("/ws/transcribe")
async def websocket_transcribe_endpoint(websocket: WebSocket):
    await websocket.accept()
    print("Transcription client connected.")

    loop = asyncio.get_running_loop()
    translation_service = QwenTranslationService()
    # This buffer will now hold text that is waiting for a delimiter.
    transcription_buffer = ""

    async def handle_translation(text_to_translate: str):
        """
        A coroutine that streams translation for a sentence and broadcasts it.
        """
        print(f"Translating: '{text_to_translate}'")
        full_translation = ""
        # The new service returns an async generator that streams translated chunks
        async for translated_chunk in translation_service.translate_stream(
            text_to_translate
        ):
            # Broadcast each chunk to viewers for a real-time effect
            await translation_manager.broadcast(translated_chunk)
            full_translation = translated_chunk

        # Once streaming is complete, send the final full translation back to the audio client
        await websocket.send_text(
            json.dumps({"type": "full_translation", "data": full_translation})
        )
        print(f"Translation complete: '{full_translation}'")

    async def on_transcription_message(data: dict):
        """
        Callback to process messages from iFlyTek. It now triggers translation
        on commas (，) and periods (。) in addition to the end-of-speech flag.
        """
        nonlocal transcription_buffer
        result_data = data.get("result", {})

        # Reconstruct the current sentence from the transcription service's response
        current_text = "".join(
            cw.get("w", "") for w in result_data.get("ws", []) for cw in w.get("cw", [])
        )

        # This logic correctly reconstructs the full sentence being transcribed
        if result_data.get("pgs") == "rpl":
            full_sentence = transcription_buffer[: -len(current_text)] + current_text
        else:
            full_sentence = transcription_buffer + current_text

        # Always broadcast the live, updating transcription to the viewers
        await transcription_manager.broadcast(full_sentence)

        # Update the main buffer with the latest text
        transcription_buffer = full_sentence

        # Check for delimiters to trigger translation
        delimiters = ["，", "。"]
        sentence_to_process = ""

        # Find the earliest delimiter in the buffer
        first_delimiter_pos = -1
        for delim in delimiters:
            pos = transcription_buffer.find(delim)
            if pos != -1 and (first_delimiter_pos == -1 or pos < first_delimiter_pos):
                first_delimiter_pos = pos

        # If a delimiter is found, split the buffer and translate the first part
        if first_delimiter_pos != -1:
            # Extract the sentence, including the delimiter
            sentence_to_process = transcription_buffer[: first_delimiter_pos + 1]
            # The new buffer is whatever remains after the processed sentence
            transcription_buffer = transcription_buffer[first_delimiter_pos + 1 :]

            final_sentence = sentence_to_process.strip()
            print(f"Delimiter-based sentence detected: '{final_sentence}'")
            await websocket.send_text(
                json.dumps({"type": "final_transcription", "data": final_sentence})
            )
            if final_sentence:
                asyncio.create_task(handle_translation(final_sentence))

        # --- FALLBACK LOGIC: Handle the end of the entire utterance ---
        if result_data.get("ls"):
            final_chunk = transcription_buffer.strip()
            # If there's any text left in the buffer, translate it
            if final_chunk:
                print(f"Final sentence detected (ls=True): '{final_chunk}'")
                await websocket.send_text(
                    json.dumps({"type": "final_transcription", "data": final_chunk})
                )
                asyncio.create_task(handle_translation(final_chunk))

            # Reset buffer for the next time the user starts speaking
            transcription_buffer = ""

    # Callbacks for errors and closing
    async def on_service_error(error_message: str):
        print(f"Transcription Error: {error_message}")
        await websocket.close(code=1011, reason=f"Transcription Error: {error_message}")

    async def on_service_close():
        print("Transcription service closed the connection.")

    # Initialize and connect the transcription service
    transcription_service = TranscriptionService(
        on_message_callback=on_transcription_message,
        on_error_callback=on_service_error,
        on_close_callback=on_service_close,
        loop=loop,
    )

    try:
        transcription_service.connect()
        status = STATUS_FIRST_FRAME
        while True:
            audio_chunk = await websocket.receive_bytes()
            transcription_service.send_audio(audio_chunk, status)
            if status == STATUS_FIRST_FRAME:
                status = STATUS_CONTINUE_FRAME
    except WebSocketDisconnect:
        print("Transcription client disconnected.")
    except Exception as e:
        print(f"An unexpected error occurred in transcribe endpoint: {e}")
    finally:
        transcription_service.close()
        print("Cleaned up transcription service.")


if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=8000)
