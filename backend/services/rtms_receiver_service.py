import asyncio
import base64
import json
import os
from datetime import datetime, timezone

from fastapi import APIRouter, WebSocket, WebSocketDisconnect

from .audio_processing_service import AudioProcessingService
from .buffer_service import AudioBufferService
from .debug_service import save_audio_to_wav
from .transcription_service import (
    STATUS_CONTINUE_FRAME,
    STATUS_FIRST_FRAME,
    STATUS_LAST_FRAME,
    TranscriptionService,
)
from .translation_service import QwenTranslationService
from .vad_service import VADService


def create_transcribe_router(transcription_manager, translation_manager, DEBUG_MODE):
    router = APIRouter()

    @router.websocket("/ws/transcribe")
    async def websocket_transcribe_endpoint(websocket: WebSocket):
        await websocket.accept()
        print("Transcription client connected.")

        loop = asyncio.get_running_loop()

        # Instantiate services
        audio_processor = AudioProcessingService()
        vad_service = VADService(aggressiveness=1, padding_duration_ms=550)
        buffer_service = AudioBufferService(frame_duration_ms=30)
        translation_service = QwenTranslationService()

        # State variables
        transcription_buffer = ""
        transcription_sentence_id = 0
        translation_sentence_id = 0
        current_speaker = "Unknown"

        # --- Session-based Debugging ---
        session_debug_dir = None
        # This list captures ALL incoming audio for the session
        session_raw_audio_chunks = [] if DEBUG_MODE else None
        # These lists capture only the detected utterances
        session_before_utterances = [] if DEBUG_MODE else None
        session_after_utterances = [] if DEBUG_MODE else None

        if DEBUG_MODE:
            timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
            session_debug_dir = os.path.join("debug", timestamp)

        async def stream_processed_audio(audio_data: bytes, user_name: str):
            """Chunks and streams the processed audio to the transcription service."""
            nonlocal transcription_buffer

            transcription_service = TranscriptionService(
                on_message_callback=on_transcription_message,
                on_error_callback=on_service_error,
                on_close_callback=on_service_close,
                loop=loop,
            )
            transcription_service.connect()
            print(
                f"Streaming {len(audio_data)} bytes of processed audio for transcription."
            )

            chunk_size = 1280
            first_chunk = audio_data[:chunk_size]
            transcription_service.send_audio(first_chunk, STATUS_FIRST_FRAME)

            for i in range(chunk_size, len(audio_data), chunk_size):
                chunk = audio_data[i : i + chunk_size]
                transcription_service.send_audio(chunk, STATUS_CONTINUE_FRAME)
                await asyncio.sleep(0.04)

            transcription_service.send_audio(b"", STATUS_LAST_FRAME)

        async def handle_translation(sentence_to_translate: str, speaker_name: str):
            nonlocal translation_sentence_id
            translation_sentence_id += 1
            current_translation_id = f"tr-{translation_sentence_id}"
            print(f"Translating for {speaker_name}: '{sentence_to_translate}'")
            full_translation = ""
            async for translated_chunk in translation_service.translate_stream(
                text_to_translate=sentence_to_translate
            ):
                full_translation = translated_chunk
                interim_message = {
                    "type": "interim",
                    "id": current_translation_id,
                    "data": full_translation,
                    "userName": speaker_name,
                }
                await translation_manager.broadcast(json.dumps(interim_message))
            final_message = {
                "type": "final",
                "id": current_translation_id,
                "data": full_translation,
                "timestamp": datetime.now(timezone.utc).isoformat(),
                "userName": speaker_name,
            }
            await translation_manager.broadcast(json.dumps(final_message))
            print(f"Translation complete: '{full_translation}'")

        async def on_transcription_message(data: dict):
            nonlocal transcription_buffer, transcription_sentence_id
            result_data = data.get("result", {})
            is_new_utterance = (
                not transcription_buffer and result_data.get("pgs") != "rpl"
            )
            if is_new_utterance:
                transcription_sentence_id += 1
            current_text = "".join(
                cw.get("w", "")
                for w in result_data.get("ws", [])
                for cw in w.get("cw", [])
            )
            if result_data.get("pgs") == "rpl":
                full_sentence = (
                    transcription_buffer[: -len(current_text)] + current_text
                )
            else:
                full_sentence = transcription_buffer + current_text
            interim_message = {
                "type": "interim",
                "id": f"t-{transcription_sentence_id}",
                "data": full_sentence,
                "userName": current_speaker,
            }
            await transcription_manager.broadcast(json.dumps(interim_message))
            transcription_buffer = full_sentence
            if result_data.get("ls"):
                final_chunk = transcription_buffer.strip()
                if final_chunk:
                    print(
                        f"VAD-based final sentence detected for {current_speaker}: '{final_chunk}'"
                    )
                    final_message = {
                        "type": "final",
                        "id": f"t-{transcription_sentence_id}",
                        "data": final_chunk,
                        "timestamp": datetime.now(timezone.utc).isoformat(),
                        "userName": current_speaker,
                    }
                    await transcription_manager.broadcast(json.dumps(final_message))
                    asyncio.create_task(
                        handle_translation(final_chunk, current_speaker)
                    )
                transcription_buffer = ""

        async def on_service_error(error_message: str):
            print(f"Transcription Error: {error_message}")
            await websocket.close(
                code=1011, reason=f"Transcription Error: {error_message}"
            )

        async def on_service_close():
            print("Transcription service connection closed as expected.")

        try:
            is_first_chunk = True
            while True:
                raw_message = await websocket.receive_text()
                message = json.loads(raw_message)

                current_speaker = message.get("userName", "Unknown")
                audio_chunk = base64.b64decode(message.get("audio"))

                if DEBUG_MODE:
                    session_raw_audio_chunks.append(audio_chunk)

                    if is_first_chunk and session_debug_dir:
                        session_debug_dir = f"{session_debug_dir}"
                        is_first_chunk = False

                for frame in buffer_service.process_audio(audio_chunk):
                    for event, data in vad_service.process_audio(frame):
                        if event == "end":
                            print("VAD: Speech ended. Post-processing...")

                            processed_audio = audio_processor.process(data)

                            if DEBUG_MODE:
                                session_before_utterances.append(data)
                                session_after_utterances.append(processed_audio)

                            transcription_buffer = ""
                            asyncio.create_task(
                                stream_processed_audio(processed_audio, current_speaker)
                            )

        except WebSocketDisconnect:
            print("Transcription client disconnected.")
        except Exception as e:
            print(f"An unexpected error occurred in transcribe endpoint: {e}")
        finally:
            if DEBUG_MODE and session_debug_dir:
                print("Session ended. Saving full audio files...")
                save_audio_to_wav(
                    session_raw_audio_chunks, session_debug_dir, "raw_session_audio.wav"
                )
                save_audio_to_wav(
                    session_before_utterances,
                    session_debug_dir,
                    "before_processing_utterances.wav",
                )
                save_audio_to_wav(
                    session_after_utterances,
                    session_debug_dir,
                    "after_processing_utterances.wav",
                )

    return router
