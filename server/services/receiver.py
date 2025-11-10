# TODO: Need a way to allow N:N sessions so that multiple meetings can use the app at a time
# This will come with additions to security using zoom meeting ID and pass

import asyncio
import base64
import json
import os
import uuid
from datetime import datetime

from fastapi import WebSocket

from .audio_processing import AudioProcessingService
from .correction import CorrectionService
from .debug import log_pipeline_step, log_utterance_end, log_utterance_start
from .soniox import SonioxResult, SonioxService
from .vtt import TimestampService


async def handle_receiver_session(
    websocket: WebSocket, integration: str, session_id: str, viewer_manager
):
    """
    Contains all the business logic for handling a single
    transcription/interpretation WebSocket session.
    """
    await websocket.accept()
    viewer_manager.register_transcription_session(session_id, integration)
    log_pipeline_step(
        "SESSION",
        f"Client connected for session: {session_id}",
        extra={"session": session_id, "integration": integration},
        detailed=False,
    )

    timestamp_service = TimestampService()

    loop = asyncio.get_running_loop()
    audio_processor = AudioProcessingService()
    transcription_service = None
    correction_service = None
    active_correction_tasks = set()
    final_message_processed = asyncio.Event()

    try:
        ollama_url = os.environ["OLLAMA_URL"]
        log_pipeline_step(
            "SYSTEM",
            f"Ollama Correction Service URL: {ollama_url}",
            extra={"session": session_id},
            detailed=False,
        )
        correction_service = CorrectionService(
            ollama_url=ollama_url, viewer_manager=viewer_manager, session_id=session_id
        )
    except KeyError:
        log_pipeline_step(
            "SYSTEM",
            "WARNING: 'OLLAMA_URL' not set. Corrections disabled.",
            extra={"session": session_id},
            detailed=False,
        )

    current_message_id = None
    is_new_utterance = True
    current_speaker = "Unknown"

    async def on_service_error(error_message: str):
        log_pipeline_step(
            "SONIOX",
            f"Transcription Error: {error_message}",
            extra={"session": session_id},
            detailed=False,
        )
        await websocket.close(code=1011, reason=f"Transcription Error: {error_message}")

    async def on_transcription_message_local(
        result: SonioxResult,
    ):
        nonlocal current_message_id, is_new_utterance, current_speaker

        if is_new_utterance and not result.is_final:
            current_message_id = str(uuid.uuid4())
            is_new_utterance = False
            log_utterance_start(current_message_id, current_speaker, session_id)

        if not current_message_id:
            log_pipeline_step(
                "SONIOX",
                "Received result with no active utterance, dropping.",
                extra={"is_final": result.is_final, "session": session_id},
                detailed=True,
            )
            if result.is_final:
                is_new_utterance = True
            return

        log_pipeline_step(
            "SONIOX",
            "Received consolidated T&T chunk.",
            speaker=current_speaker,
            extra={
                "message_id": current_message_id,
                "is_final": result.is_final,
                "transcription": result.transcription,
                "translation": result.translation,
                "session": session_id,
            },
            detailed=True,
        )

        has_text = (result.transcription and result.transcription.strip()) or (
            result.translation and result.translation.strip()
        )

        if has_text:
            payload_type = "final" if result.is_final else "partial"

            vtt_timestamp = None
            if payload_type == "partial":
                timestamp_service.mark_utterance_start(current_message_id)

            if payload_type == "final":
                vtt_timestamp = timestamp_service.complete_utterance(current_message_id)

            payload = {
                "message_id": current_message_id,
                "transcription": result.transcription,
                "translation": result.translation,
                "source_language": result.source_language,
                "target_language": result.target_language,
                "speaker": current_speaker,
                "type": payload_type,
                "isfinalize": result.is_final,
                "vtt_timestamp": vtt_timestamp,
            }
            await viewer_manager.broadcast_to_session(session_id, payload)
        else:
            log_pipeline_step(
                "SONIOX",
                "Dropping empty partial result.",
                speaker=current_speaker,
                extra={"message_id": current_message_id, "session": session_id},
                detailed=True,
            )

        if result.is_final:
            log_utterance_end(current_message_id, current_speaker, session_id)

            if (
                correction_service
                and result.transcription
                and result.transcription.strip()
                and result.source_language == "zh"
            ):
                utterance_to_store = {
                    "message_id": current_message_id,
                    "speaker": current_speaker,
                    "transcription": result.transcription,
                }
                task = asyncio.create_task(
                    correction_service.process_final_utterance(utterance_to_store)
                )
                active_correction_tasks.add(task)
                task.add_done_callback(active_correction_tasks.discard)

            is_new_utterance = True
            current_message_id = None

    async def on_service_close_local(code: int, reason: str):
        log_pipeline_step(
            "SONIOX",
            f"Transcription service closed. Code: {code}, Reason: {reason}",
            extra={"session": session_id},
            detailed=False,
        )
        final_message_processed.set()

    try:
        transcription_service = SonioxService(
            on_message_callback=on_transcription_message_local,
            on_error_callback=on_service_error,
            on_close_callback=on_service_close_local,
            loop=loop,
        )
        await loop.run_in_executor(None, transcription_service.connect)
        log_pipeline_step(
            "SESSION",
            "Transcription service connected for session.",
            extra={"session": session_id},
            detailed=True,
        )

        while True:
            raw_message = await websocket.receive_text()
            message = json.loads(raw_message)
            current_speaker = message.get("userName", "Unknown")
            audio_chunk = base64.b64decode(message.get("audio"))

            # BUG: Send processed_audio once new noise filtering is emplemented
            # processed_audio = await loop.run_in_executor(
            #     None, audio_processor.process, audio_chunk
            # )
            # await loop.run_in_executor(
            #     None, transcription_service.send_chunk, processed_audio
            # )

            await loop.run_in_executor(
                None, transcription_service.send_chunk, audio_chunk
            )

    except asyncio.CancelledError:
        log_pipeline_step(
            "SESSION",
            "Client disconnected (CancelledError).",
            extra={"session": session_id},
            detailed=False,
        )
    except Exception as e:
        log_pipeline_step(
            "SESSION",
            f"An unexpected error occurred in transcribe endpoint: {e}",
            extra={"session": session_id},
            detailed=False,
        )
    finally:
        if transcription_service:
            log_pipeline_step(
                "SESSION",
                "Client disconnected. Finalizing Soniox stream...",
                extra={"session": session_id},
                detailed=True,
            )
            await loop.run_in_executor(None, transcription_service.finalize_stream)

        if transcription_service:
            log_pipeline_step(
                "SESSION",
                "Waiting for Soniox connection to fully close...",
                extra={"session": session_id},
                detailed=True,
            )
            try:
                await asyncio.wait_for(final_message_processed.wait(), timeout=5.0)
                log_pipeline_step(
                    "SESSION",
                    "Soniox connection closed.",
                    extra={"session": session_id},
                    detailed=True,
                )
            except asyncio.TimeoutError:
                log_pipeline_step(
                    "SESSION",
                    "Warning: Timeout waiting for Soniox to close.",
                    extra={"session": session_id},
                    detailed=False,
                )
        else:
            await asyncio.sleep(0.1)

        if correction_service:
            log_pipeline_step(
                "SESSION",
                "Running final correction check on remaining utterances.",
                extra={"session": session_id},
                detailed=False,
            )
            await correction_service.finalize_session()

        if active_correction_tasks:
            log_pipeline_step(
                "SESSION",
                f"Waiting for {len(active_correction_tasks)} outstanding correction task(s)...",
                extra={"session": session_id},
                detailed=True,
            )
            await asyncio.gather(*active_correction_tasks)
            log_pipeline_step(
                "SESSION",
                "All correction tasks complete.",
                extra={"session": session_id},
                detailed=True,
            )

        viewer_manager.cache.save_history_and_clear(session_id, integration)

        log_pipeline_step(
            "SESSION",
            "Broadcasting session_end event to viewers.",
            extra={"session": session_id},
            detailed=False,
        )
        end_payload = {
            "type": "session_end",
            "message": "The transcription session has concluded.",
        }
        await viewer_manager.broadcast_to_session(session_id, end_payload)
        viewer_manager.deregister_transcription_session(session_id)
