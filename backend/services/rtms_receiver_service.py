import asyncio
import base64
import json
import os
import uuid
from collections import deque
from datetime import datetime

from fastapi import APIRouter, WebSocket, WebSocketDisconnect

from .audio_processing_service import AudioProcessingService
from .buffer_service import AudioBufferService
from .correction_service import CorrectionService
from .debug_service import (
    log_pipeline_step,
    log_utterance_end,
    log_utterance_start,
    log_utterance_step,
    save_audio_to_wav,
)
from .transcription_service import TranscriptionResult, TranscriptionService
from .translation_service import TranslationService
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
        translation_service = TranslationService()
        correction_service = CorrectionService()
        utterance_queue = asyncio.Queue()

        utterance_history = deque(maxlen=5)

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

        async def run_contextual_correction():
            CORRECTION_CONTEXT_THRESHOLD = 3

            if len(utterance_history) < CORRECTION_CONTEXT_THRESHOLD:
                return

            target_utterance = utterance_history[-CORRECTION_CONTEXT_THRESHOLD]

            log_utterance_step(
                "CORRECTION",
                target_utterance["message_id"],
                "Running contextual correction.",
                speaker=target_utterance["speaker"],
                extra={
                    "target_transcription": target_utterance["transcription"],
                    "history_size": len(utterance_history),
                },
            )

            context_list = [u["transcription"] for u in utterance_history]

            response_data = await correction_service.correct_with_context(
                text_to_correct=target_utterance["transcription"],
                context_history=context_list,
            )

            is_needed = response_data.get("is_correction_needed", False)

            reason = response_data.get("reasoning", "No reason provided.")

            if is_needed:
                log_utterance_step(
                    "CORRECTION",
                    target_utterance["message_id"],
                    "Model decided a correction is needed.",
                    speaker=target_utterance["speaker"],
                    extra={"reason": reason},
                )

                corrected_transcription = response_data.get("corrected_sentence")

                if (
                    corrected_transcription
                    and corrected_transcription != target_utterance["transcription"]
                ):
                    log_utterance_step(
                        "CORRECTION",
                        target_utterance["message_id"],
                        "Re-translating contextually corrected text.",
                        speaker=target_utterance["speaker"],
                        detailed=False,
                    )
                    full_corrected_translation = ""
                    async for chunk in translation_service.translate_stream(
                        text_to_translate=corrected_transcription
                    ):
                        full_corrected_translation = chunk

                    log_utterance_step(
                        "CORRECTION",
                        target_utterance["message_id"],
                        "Updated translation complete.",
                        speaker=target_utterance["speaker"],
                        extra={
                            "corrected_transcription": corrected_transcription,
                            "updated_translation": full_corrected_translation,
                        },
                        detailed=False,
                    )
                    payload = {
                        "message_id": target_utterance["message_id"],
                        "transcription": corrected_transcription,
                        "translation": full_corrected_translation,
                        "speaker": target_utterance["speaker"],
                        "type": "correction",
                        "isfinalize": True,
                    }
                    await viewer_manager.broadcast(payload)
                    log_utterance_step(
                        "CORRECTION",
                        target_utterance["message_id"],
                        "Correction broadcast complete.",
                        speaker=target_utterance["speaker"],
                        detailed=False,
                    )
            else:
                log_utterance_step(
                    "CORRECTION",
                    target_utterance["message_id"],
                    "Model decided no correction was needed.",
                    speaker=target_utterance["speaker"],
                    extra={"reason": reason},
                    detailed=False,
                )

        async def handle_translation(
            sentence_to_translate: str,
            speaker_name: str,
            message_id: str,
        ):
            log_utterance_step(
                "TRANSLATION",
                message_id,
                "Starting translation for utterance.",
                speaker=speaker_name,
                extra={"text": sentence_to_translate},
                detailed=False,
            )
            full_translation = ""
            async for translated_chunk in translation_service.translate_stream(
                text_to_translate=sentence_to_translate
            ):
                full_translation = translated_chunk
                log_utterance_step(
                    "TRANSLATION",
                    message_id,
                    "Received translation chunk.",
                    speaker=speaker_name,
                    extra={"chunk": translated_chunk},
                )
                payload = {
                    "message_id": message_id,
                    "transcription": sentence_to_translate,
                    "translation": full_translation,
                    "speaker": speaker_name,
                    "type": "update",
                    "isfinalize": False,
                }
                await viewer_manager.broadcast(payload)

            payload = {
                "message_id": message_id,
                "transcription": sentence_to_translate,
                "translation": full_translation,
                "speaker": speaker_name,
                "type": "final",
                "isfinalize": True,
            }
            await viewer_manager.broadcast(payload)
            log_utterance_step(
                "TRANSLATION",
                message_id,
                "Translation complete.",
                speaker=speaker_name,
                extra={"translation": full_translation},
                detailed=False,
            )

            utterance_history.append(
                {
                    "message_id": message_id,
                    "speaker": speaker_name,
                    "transcription": sentence_to_translate,
                }
            )

            log_utterance_step(
                "TRANSLATION",
                message_id,
                "Queued utterance for contextual correction history.",
                speaker=speaker_name,
                detailed=True,
            )

            asyncio.create_task(run_contextual_correction())

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
                    local_transcription_buffer = ""
                    transcription_done = asyncio.Event()

                    log_utterance_start(message_id, speaker_name)

                    async def on_transcription_message_local(
                        result: TranscriptionResult,
                    ):
                        nonlocal local_transcription_buffer
                        current_text = result.text

                        log_utterance_step(
                            "TRANSCRIPTION",
                            message_id,
                            "Received transcription chunk.",
                            speaker=speaker_name,
                            extra={
                                "is_final": result.is_final,
                                "is_replace": result.is_replace,
                                "chunk": current_text,
                            },
                        )

                        if result.is_replace:
                            local_transcription_buffer = (
                                local_transcription_buffer[: -len(current_text)]
                                + current_text
                            )
                        else:
                            local_transcription_buffer += current_text

                        payload = {
                            "message_id": message_id,
                            "transcription": local_transcription_buffer,
                            "translation": "",
                            "speaker": speaker_name,
                            "type": "partial",
                            "isfinalize": False,
                        }
                        await viewer_manager.broadcast(payload)

                        if result.is_final:
                            final_chunk = local_transcription_buffer.strip()
                            if final_chunk:
                                log_utterance_step(
                                    "TRANSCRIPTION",
                                    message_id,
                                    "VAD-based final sentence detected.",
                                    speaker=speaker_name,
                                    extra={"final_chunk": final_chunk},
                                    detailed=False,
                                )

                                asyncio.create_task(
                                    handle_translation(
                                        final_chunk,
                                        speaker_name,
                                        message_id,
                                    )
                                )

                            if not transcription_done.is_set():
                                log_utterance_step(
                                    "TRANSCRIPTION",
                                    message_id,
                                    "Transcription marked complete by service.",
                                    speaker=speaker_name,
                                    detailed=True,
                                )
                                transcription_done.set()
                            local_transcription_buffer = ""

                    async def on_service_close_local(code: int, reason: str):
                        if not transcription_done.is_set():
                            log_utterance_step(
                                "TRANSCRIPTION",
                                f"Transcription service closed unexpectedly. Code: {code}, Reason: {reason}",
                                speaker=speaker_name,
                                detailed=False,
                            )
                            transcription_done.set()

                    transcription_service = TranscriptionService(
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

            if DEBUG_MODE and session_debug_dir:
                log_pipeline_step(
                    "SESSION",
                    "Session ended. Saving full audio files...",
                    detailed=False,
                )
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
