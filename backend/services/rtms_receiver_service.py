import asyncio
import base64
import json
import os
from datetime import datetime, timezone

from fastapi import APIRouter, WebSocket, WebSocketDisconnect

from .audio_processing_service import AudioProcessingService
from .buffer_service import AudioBufferService
from .debug_service import save_audio_to_wav
from .transcription_service import TranscriptionResult, TranscriptionService
from .translation_service import TranslationService
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
        translation_service = TranslationService()

        # Global state variables
        global_sentence_id_counter = 0
        translation_sentence_id = 0
        utterance_queue = asyncio.Queue()

        # Session-based Debugging
        session_debug_dir = None
        session_raw_audio_chunks = [] if DEBUG_MODE else None
        session_before_utterances = [] if DEBUG_MODE else None
        session_after_utterances = [] if DEBUG_MODE else None

        if DEBUG_MODE:
            timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
            session_debug_dir = os.path.join("debug", timestamp)

        async def on_service_error(error_message: str):
            print(f"Transcription Error: {error_message}")
            await websocket.close(
                code=1011, reason=f"Transcription Error: {error_message}"
            )

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

        async def transcription_worker():
            nonlocal global_sentence_id_counter
            while True:
                try:
                    audio_data, speaker_name = await utterance_queue.get()

                    local_transcription_buffer = ""
                    global_sentence_id_counter += 1
                    local_sentence_id = global_sentence_id_counter
                    transcription_done = asyncio.Event()

                    async def on_transcription_message_local(
                        result: TranscriptionResult,
                    ):
                        nonlocal local_transcription_buffer
                        current_text = result.text

                        if result.is_replace:
                            local_transcription_buffer = (
                                local_transcription_buffer[: -len(current_text)]
                                + current_text
                            )
                        else:
                            local_transcription_buffer += current_text

                        interim_message = {
                            "type": "interim",
                            "id": f"t-{local_sentence_id}",
                            "data": local_transcription_buffer,
                            "userName": speaker_name,
                        }
                        await transcription_manager.broadcast(
                            json.dumps(interim_message)
                        )

                        if result.is_final:
                            final_chunk = local_transcription_buffer.strip()
                            if final_chunk:
                                print(
                                    f"VAD-based final sentence detected for {speaker_name}: '{final_chunk}'"
                                )
                                final_message = {
                                    "type": "final",
                                    "id": f"t-{local_sentence_id}",
                                    "data": final_chunk,
                                    "timestamp": datetime.now(timezone.utc).isoformat(),
                                    "userName": speaker_name,
                                }
                                await transcription_manager.broadcast(
                                    json.dumps(final_message)
                                )
                                asyncio.create_task(
                                    handle_translation(final_chunk, speaker_name)
                                )

                            if not transcription_done.is_set():
                                transcription_done.set()

                            local_transcription_buffer = ""

                    async def on_service_close_local():
                        if not transcription_done.is_set():
                            transcription_done.set()

                    transcription_service = TranscriptionService(
                        on_message_callback=on_transcription_message_local,
                        on_error_callback=on_service_error,
                        on_close_callback=on_service_close_local,
                        loop=loop,
                    )

                    await loop.run_in_executor(None, transcription_service.connect)

                    chunk_size = 1280
                    if len(audio_data) > 0:
                        for i in range(0, len(audio_data), chunk_size):
                            chunk = audio_data[i : i + chunk_size]
                            transcription_service.send_chunk(chunk)
                            await asyncio.sleep(0.04)

                    transcription_service.finalize_utterance()

                    await transcription_done.wait()
                    utterance_queue.task_done()
                except asyncio.CancelledError:
                    break
                except Exception as e:
                    print(f"Error in transcription worker: {e}")

        worker_task = asyncio.create_task(transcription_worker())
        current_speaker = "Unknown"
        try:
            while True:
                raw_message = await websocket.receive_text()
                message = json.loads(raw_message)
                current_speaker = message.get("userName", "Unknown")
                audio_chunk = base64.b64decode(message.get("audio"))

                if DEBUG_MODE:
                    session_raw_audio_chunks.append(audio_chunk)

                for frame in buffer_service.process_audio(audio_chunk):
                    for event, data in vad_service.process_audio(frame):
                        if event == "end":
                            print("VAD: Speech ended. Post-processing...")
                            processed_audio = audio_processor.process(data)

                            if DEBUG_MODE:
                                session_before_utterances.append(data)
                                session_after_utterances.append(processed_audio)

                            await utterance_queue.put(
                                (processed_audio, current_speaker)
                            )

        except WebSocketDisconnect:
            print("Transcription client disconnected.")
        except Exception as e:
            print(f"An unexpected error occurred in transcribe endpoint: {e}")
        finally:
            worker_task.cancel()
            await asyncio.sleep(0.1)

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
