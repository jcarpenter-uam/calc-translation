# TODO: Need a way to allow N:N sessions so that multiple meetings can use the app at a time
# This will come with additions to security using zoom meeting ID and pass

import asyncio
import base64
import json
import logging
import os
import uuid
from datetime import datetime

from core.logging_setup import (
    add_session_log_handler,
    log_step,
    message_id_var,
    remove_session_log_handler,
    session_id_var,
    speaker_var,
)
from fastapi import WebSocket

from .audio_processing import AudioProcessingService
from .correction import CorrectionService
from .soniox import SonioxResult, SonioxService
from .vtt import TimestampService

logger = logging.getLogger(__name__)


async def handle_receiver_session(
    websocket: WebSocket, integration: str, session_id: str, viewer_manager
):
    """
    Contains all the business logic for handling a single
    transcription/interpretation WebSocket session.
    """
    session_token = session_id_var.set(session_id)
    transcription_service = None
    correction_service = None
    active_correction_tasks = set()
    final_message_processed = asyncio.Event()
    loop = asyncio.get_running_loop()
    session_log_handler = None

    try:
        await websocket.accept()
        viewer_manager.register_transcription_session(session_id, integration)
        session_log_handler = add_session_log_handler(session_id, integration)
        with log_step("SESSION"):
            logger.info(f"Client connected for integration: {integration}")

        timestamp_service = TimestampService()

        audio_processor = AudioProcessingService()

        correction_service = CorrectionService(
            viewer_manager=viewer_manager,
            session_id=session_id,
        )

        current_message_id = None
        is_new_utterance = True
        current_speaker = "Unknown"

        async def on_service_error(error_message: str):
            with log_step("SONIOX"):
                logger.error(f"Transcription Error: {error_message}")
            await websocket.close(
                code=1011, reason=f"Transcription Error: {error_message}"
            )

        async def on_transcription_message_local(
            result: SonioxResult,
        ):
            nonlocal current_message_id, is_new_utterance, current_speaker

            if is_new_utterance and not result.is_final:
                current_message_id = str(uuid.uuid4())
                is_new_utterance = False

                message_id_var.set(current_message_id)
                with log_step("UTTERANCE"):
                    logger.info("Starting pipeline for utterance.")

            if not current_message_id:
                with log_step("SONIOX"):
                    logger.debug(
                        f"Received result (is_final={result.is_final}) with no active utterance, dropping."
                    )
                if result.is_final:
                    is_new_utterance = True
                return

            with log_step("SONIOX"):
                logger.debug(
                    f"Received T&T chunk (is_final={result.is_final}). "
                    f"T: '{result.transcription}' | "
                    f"TL: '{result.translation}'"
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
                    vtt_timestamp = timestamp_service.complete_utterance(
                        current_message_id
                    )

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
                with log_step("SONIOX"):
                    logger.debug("Dropping empty partial result.")

            if result.is_final:
                with log_step("UTTERANCE"):
                    logger.info("Finished pipeline for utterance.")

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
                message_id_var.set(None)

        async def on_service_close_local(code: int, reason: str):
            with log_step("SONIOX"):
                logger.info(
                    f"Transcription service closed. Code: {code}, Reason: {reason}"
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
            with log_step("SESSION"):
                logger.debug("Transcription service connected.")

            while True:
                raw_message = await websocket.receive_text()
                message = json.loads(raw_message)
                current_speaker = message.get("userName", "Unknown")
                speaker_var.set(current_speaker)
                audio_chunk = base64.b64decode(message.get("audio"))

                await loop.run_in_executor(
                    None, transcription_service.send_chunk, audio_chunk
                )

        except asyncio.CancelledError:
            with log_step("SESSION"):
                logger.info("Client disconnected (CancelledError).")
        except Exception as e:
            with log_step("SESSION"):
                logger.error(
                    f"An unexpected error occurred in transcribe endpoint: {e}",
                    exc_info=True,
                )

    finally:
        if transcription_service:
            with log_step("SESSION"):
                logger.debug("Client disconnected. Finalizing Soniox stream...")
            await loop.run_in_executor(None, transcription_service.finalize_stream)

        if transcription_service:
            with log_step("SESSION"):
                logger.debug("Waiting for Soniox connection to fully close...")
            try:
                await asyncio.wait_for(final_message_processed.wait(), timeout=5.0)
                with log_step("SESSION"):
                    logger.debug("Soniox connection closed.")
            except asyncio.TimeoutError:
                with log_step("SESSION"):
                    logger.warning("Timeout waiting for Soniox to close.")
        else:
            await asyncio.sleep(0.1)

        if correction_service:
            with log_step("SESSION"):
                logger.info("Running final correction check on remaining utterances.")
            await correction_service.finalize_session()

        if active_correction_tasks:
            with log_step("SESSION"):
                logger.debug(
                    f"Waiting for {len(active_correction_tasks)} outstanding correction task(s)..."
                )
            await asyncio.gather(*active_correction_tasks)
            with log_step("SESSION"):
                logger.debug("All correction tasks complete.")

        viewer_manager.cache.save_history_and_clear(session_id, integration)

        with log_step("SESSION"):
            logger.info("Broadcasting session_end event to viewers.")
        end_payload = {
            "type": "session_end",
            "message": "The transcription session has concluded.",
        }
        await viewer_manager.broadcast_to_session(session_id, end_payload)
        viewer_manager.deregister_transcription_session(session_id)
        if session_log_handler:
            with log_step("SESSION"):
                logger.info(
                    f"Stopping session file logging: {session_log_handler.baseFilename}"
                )
            remove_session_log_handler(session_log_handler)
        session_id_var.reset(session_token)
