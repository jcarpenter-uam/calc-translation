import asyncio
import base64
import json
import os
import uuid
from datetime import datetime

from fastapi import APIRouter, WebSocket, WebSocketDisconnect

from .audio_processing_service import AudioProcessingService
from .buffer_service import AudioBufferService
from .debug_service import (
    log_pipeline_step,
    log_utterance_end,
    log_utterance_start,
    log_utterance_step,
    save_audio_to_wav,
)
from .soniox_transcription_service import (
    SonioxTranscriptionResult,
    SonioxTranscriptionService,
)
from .vad_service import VADService


def create_transcribe_router(viewer_manager, DEBUG_MODE):
    router = APIRouter()

    @router.websocket("/ws/transcribe")
    async def websocket_transcribe_endpoint(websocket: WebSocket):
        await websocket.accept()
        log_pipeline_step("SESSION", "Transcription client connected.", detailed=False)

        loop = asyncio.get_running_loop()
        audio_processor = AudioProcessingService()
        vad_service = VADService()
        buffer_service = AudioBufferService(frame_duration_ms=30)
        utterance_queue = asyncio.Queue()

        session_debug_dir = None
        if DEBUG_MODE:
            timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
            session_debug_dir = os.path.join("debug", timestamp)
            session_raw_audio_chunks = []
            session_before_utterances = []
            session_after_utterances = []
            log_pipeline_step(
                "SESSION",
                "Debug session directory initialized.",
                extra={"path": session_debug_dir},
                detailed=True,
            )

        async def on_service_error(error_message: str):
            log_pipeline_step(
                "TRANSCRIPTION",
                f"Transcription Error: {error_message}",
                detailed=False,
            )
            await websocket.close(
                code=1011, reason=f"Transcription Error: {error_message}"
            )

        async def transcription_worker():
            while True:
                try:
                    audio_data, speaker_name = await utterance_queue.get()
                    log_pipeline_step(
                        "QUEUE",
                        "Transcription worker dequeued utterance for processing.",
                        speaker=speaker_name,
                        extra={
                            "queue_depth": utterance_queue.qsize(),
                            "utterance_bytes": len(audio_data),
                        },
                        detailed=True,
                    )
                    message_id = str(uuid.uuid4())
                    transcription_done = asyncio.Event()

                    log_utterance_start(message_id, speaker_name)

                    async def on_transcription_message_local(
                        result: SonioxTranscriptionResult,
                    ):
                        """
                        Handles the consolidated T&T result from the Soniox service.
                        """
                        log_utterance_step(
                            "TRANSCRIPTION",
                            message_id,
                            "Received consolidated T&T chunk.",
                            speaker=speaker_name,
                            extra={
                                "is_final": result.is_final,
                                "transcription": result.transcription,
                                "translation": result.translation,
                            },
                        )

                        if result.is_final:
                            # Send final payload
                            payload = {
                                "message_id": message_id,
                                "transcription": result.transcription,
                                "translation": result.translation,
                                "speaker": speaker_name,
                                "type": "final",
                                "isfinalize": True,
                            }
                            await viewer_manager.broadcast(payload)

                            if not transcription_done.is_set():
                                log_utterance_step(
                                    "TRANSCRIPTION",
                                    message_id,
                                    "Transcription marked complete by service.",
                                    speaker=speaker_name,
                                    detailed=True,
                                )
                                transcription_done.set()
                        else:
                            # Send partial payload
                            payload = {
                                "message_id": message_id,
                                "transcription": result.transcription,
                                "translation": result.translation,
                                "speaker": speaker_name,
                                "type": "partial",
                                "isfinalize": False,
                            }
                            await viewer_manager.broadcast(payload)

                    async def on_service_close_local(code: int, reason: str):
                        if not transcription_done.is_set():
                            log_utterance_step(
                                "TRANSCRIPTION",
                                f"Transcription service closed unexpectedly. Code: {code}, Reason: {reason}",
                                speaker=speaker_name,
                                detailed=False,
                            )
                            transcription_done.set()

                    transcription_service = SonioxTranscriptionService(
                        on_message_callback=on_transcription_message_local,
                        on_error_callback=on_service_error,
                        on_close_callback=on_service_close_local,
                        loop=loop,
                    )

                    await loop.run_in_executor(None, transcription_service.connect)
                    log_utterance_step(
                        "TRANSCRIPTION",
                        message_id,
                        "Transcription service connected.",
                        speaker=speaker_name,
                        detailed=True,
                    )

                    chunk_size = 1280
                    if len(audio_data) > 0:
                        for i in range(0, len(audio_data), chunk_size):
                            chunk = audio_data[i : i + chunk_size]
                            log_utterance_step(
                                "TRANSCRIPTION",
                                message_id,
                                "Sending audio chunk to transcription engine.",
                                speaker=speaker_name,
                                extra={
                                    "offset": i,
                                    "chunk_bytes": len(chunk),
                                },
                                detailed=True,
                            )
                            await loop.run_in_executor(
                                None, transcription_service.send_chunk, chunk
                            )
                            await asyncio.sleep(0.04)
                    log_utterance_step(
                        "TRANSCRIPTION",
                        message_id,
                        "Signaling end of audio stream to transcription engine.",
                        speaker=speaker_name,
                        detailed=True,
                    )
                    await loop.run_in_executor(
                        None, transcription_service.finalize_utterance
                    )
                    await transcription_done.wait()
                    log_utterance_end(message_id, speaker_name)
                    utterance_queue.task_done()
                except asyncio.CancelledError:
                    break
                except Exception as e:
                    log_pipeline_step(
                        "TRANSCRIPTION",
                        f"Error in transcription worker: {e}",
                        detailed=False,
                    )

        worker_task = asyncio.create_task(transcription_worker())
        current_speaker = "Unknown"
        try:
            while True:
                raw_message = await websocket.receive_text()
                message = json.loads(raw_message)
                current_speaker = message.get("userName", "Unknown")
                audio_chunk = base64.b64decode(message.get("audio"))
                log_pipeline_step(
                    "SESSION",
                    "Received audio chunk from client.",
                    extra={
                        "speaker": current_speaker,
                        "chunk_bytes": len(audio_chunk),
                    },
                    detailed=True,
                )

                if DEBUG_MODE:
                    session_raw_audio_chunks.append(audio_chunk)

                for frame in buffer_service.process_audio(audio_chunk):
                    for event, data in vad_service.process_audio(frame):
                        if event == "start":
                            log_pipeline_step(
                                "VAD",
                                "VAD detected speech start.",
                                speaker=current_speaker,
                                extra={"buffered_bytes": len(data)},
                                detailed=False,
                            )
                        elif event == "speech":
                            log_pipeline_step(
                                "VAD",
                                "Accumulating speech frame for utterance.",
                                speaker=current_speaker,
                                extra={"frame_bytes": len(data)},
                                detailed=True,
                            )
                        elif event == "end":
                            processed_audio = audio_processor.process(data)
                            if DEBUG_MODE:
                                session_before_utterances.append(data)
                                session_after_utterances.append(processed_audio)
                            log_pipeline_step(
                                "VAD",
                                "Utterance end detected and queued for processing.",
                                speaker=current_speaker,
                                detailed=False,
                            )
                            await utterance_queue.put(
                                (processed_audio, current_speaker)
                            )
                            log_pipeline_step(
                                "QUEUE",
                                "Queued processed utterance for transcription worker.",
                                speaker=current_speaker,
                                extra={
                                    "queue_depth": utterance_queue.qsize(),
                                    "utterance_bytes": len(processed_audio),
                                },
                                detailed=True,
                            )

        except WebSocketDisconnect:
            log_pipeline_step(
                "SESSION",
                "Transcription client disconnected.",
                detailed=False,
            )
        except Exception as e:
            log_pipeline_step(
                "SESSION",
                f"An unexpected error occurred in transcribe endpoint: {e}",
                detailed=False,
            )
        finally:
            worker_task.cancel()
            await asyncio.sleep(0.1)

            # --- Save WAV files only in DEBUG_MODE ---
            if DEBUG_MODE and session_debug_dir:
                log_pipeline_step(
                    "SESSION",
                    "Session ended. Saving debug audio files...",
                    detailed=False,
                )
                save_audio_to_wav(
                    session_raw_audio_chunks,
                    session_debug_dir,
                    "raw_session_audio.wav",
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

            try:
                # Always save session history
                output_dir = "session_history"
                timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
                file_name = f"history_{timestamp}.json"

                # Ensure the directory exists
                os.makedirs(output_dir, exist_ok=True)
                cache_filepath = os.path.join(output_dir, file_name)

                # Get and write the history, if it's not empty
                transcript_history = viewer_manager.cache.get_history()
                if transcript_history:
                    with open(cache_filepath, "w", encoding="utf-8") as f:
                        json.dump(transcript_history, f, indent=4, ensure_ascii=False)

                    log_pipeline_step(
                        "SESSION",
                        "Transcript cache saved to file successfully.",
                        extra={
                            "path": cache_filepath,
                            "entries": len(transcript_history),
                        },
                        detailed=True,
                    )

                # --- ALWAYS CLEAR THE CACHE ---
                viewer_manager.cache.clear()

            except Exception as e:
                log_pipeline_step(
                    "SESSION",
                    f"Failed to save history or clear transcript cache: {e}",
                    detailed=False,
                )

    return router
