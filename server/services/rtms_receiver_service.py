import asyncio
import base64
import json
import os
import uuid
from datetime import datetime

from fastapi import (
    APIRouter,
    Depends,
    Header,
    WebSocket,
    WebSocketDisconnect,
    WebSocketException,
    status,
)

from .audio_processing_service import AudioProcessingService
from .correction_service import CorrectionService
from .debug_service import (
    log_pipeline_step,
    log_utterance_end,
    log_utterance_start,
    save_audio_to_wav,
)
from .soniox_service import SonioxResult, SonioxService
from .timestamp_service import TimestampService

try:
    APP_SECRET_TOKEN = os.environ["WS_TRANSCRIBE_SECRET_TOKEN"]
    log_pipeline_step(
        "SYSTEM", f"Successfully loaded 'WS_TRANSCRIBE_SECRET_TOKEN'.", detailed=True
    )
except KeyError:
    log_pipeline_step(
        "SYSTEM",
        "FATAL: 'WS_TRANSCRIBE_SECRET_TOKEN' environment variable is not set. Application cannot start.",
        detailed=False,
    )
    raise RuntimeError(
        "Required environment variable 'WS_TRANSCRIBE_SECRET_TOKEN' is not set."
    )


async def get_auth_token(
    authorization: str | None = Header(None),
) -> str:
    """
    Extracts the Bearer token from the Authorization header.
    """
    if not authorization:
        log_pipeline_step(
            "SESSION", "Auth failed: No Authorization header.", detailed=False
        )
        raise WebSocketException(
            code=status.WS_1008_POLICY_VIOLATION, reason="Missing Authorization header"
        )

    parts = authorization.split()
    if len(parts) != 2 or parts[0] != "Bearer":
        log_pipeline_step(
            "SESSION", "Auth failed: Invalid header format.", detailed=False
        )
        raise WebSocketException(
            code=status.WS_1008_POLICY_VIOLATION,
            reason="Invalid Authorization header format. Expected 'Bearer <token>'",
        )

    return parts[1]


async def validate_token(token: str = Depends(get_auth_token)):
    """
    Validates the extracted token.
    For this simple case, we just check our shared secret.
    """
    if token != APP_SECRET_TOKEN:
        log_pipeline_step("SESSION", "Auth failed: Invalid token.", detailed=False)
        raise WebSocketException(
            code=status.WS_1008_POLICY_VIOLATION, reason="Invalid or expired token"
        )

    return True


def create_transcribe_router(viewer_manager, DEBUG_MODE):
    router = APIRouter()

    # TODO:
    # only accept first attempt per meetingid?
    @router.websocket("/ws/transcribe")
    async def websocket_transcribe_endpoint(
        websocket: WebSocket, is_authenticated: bool = Depends(validate_token)
    ):
        await websocket.accept()
        log_pipeline_step("SESSION", "Transcription client connected.", detailed=False)

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
                detailed=False,
            )
            correction_service = CorrectionService(
                ollama_url=ollama_url, viewer_manager=viewer_manager
            )
        except KeyError:
            log_pipeline_step(
                "SYSTEM",
                "WARNING: The 'OLLAMA_URL' environment variable is not set. Contextual corrections will be disabled.",
                detailed=False,
            )

        current_message_id = None
        is_new_utterance = True
        current_speaker = "Unknown"

        session_debug_dir = None
        if DEBUG_MODE:
            timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
            session_debug_dir = os.path.join("debug", timestamp)
            session_raw_audio = []
            session_processed = []
            log_pipeline_step(
                "SESSION",
                "Debug session directory initialized.",
                extra={"path": session_debug_dir},
                detailed=True,
            )

        async def on_service_error(error_message: str):
            log_pipeline_step(
                "SONIOX",
                f"Transcription Error: {error_message}",
                detailed=False,
            )
            await websocket.close(
                code=1011, reason=f"Transcription Error: {error_message}"
            )

        async def on_transcription_message_local(
            result: SonioxResult,
        ):
            """
            Handles all T&T results from the single Soniox service.
            Manages message_id state based on is_final.
            """
            nonlocal current_message_id, is_new_utterance, current_speaker

            if is_new_utterance and not result.is_final:
                current_message_id = str(uuid.uuid4())
                is_new_utterance = False
                log_utterance_start(current_message_id, current_speaker)

            if not current_message_id:
                log_pipeline_step(
                    "SONIOX",
                    "Received result with no active utterance, dropping.",
                    extra={"is_final": result.is_final},
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
                await viewer_manager.broadcast(payload)
            else:
                log_pipeline_step(
                    "SONIOX",
                    "Dropping empty partial result.",
                    speaker=current_speaker,
                    extra={
                        "message_id": current_message_id,
                    },
                    detailed=True,
                )

            if result.is_final:
                log_utterance_end(current_message_id, current_speaker)

                if (
                    correction_service
                    and result.transcription
                    and result.transcription.strip()
                    # Only send Chinese to correction model
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
            """
            Handles the Soniox service closing unexpectedly.
            """
            log_pipeline_step(
                "SONIOX",
                f"Transcription service closed. Code: {code}, Reason: {reason}",
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
                detailed=True,
            )

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
                    session_raw_audio.append(audio_chunk)

                # BUG: Send processed_audio once new noise filtering is emplemented
                # processed_audio = await loop.run_in_executor(
                #     None, audio_processor.process, audio_chunk
                # )
                # if DEBUG_MODE:
                #     session_processed.append(processed_audio)

                # BUG: Send processed_audio once that is fixed
                await loop.run_in_executor(
                    None, transcription_service.send_chunk, audio_chunk
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
            if transcription_service:
                log_pipeline_step(
                    "SESSION",
                    "Client disconnected. Finalizing Soniox stream...",
                    detailed=True,
                )
                await loop.run_in_executor(None, transcription_service.finalize_stream)

            if transcription_service:
                log_pipeline_step(
                    "SESSION",
                    "Waiting for Soniox connection to fully close...",
                    detailed=True,
                )
                try:
                    await asyncio.wait_for(final_message_processed.wait(), timeout=5.0)
                    log_pipeline_step(
                        "SESSION",
                        "Soniox connection closed.",
                        detailed=True,
                    )
                except asyncio.TimeoutError:
                    log_pipeline_step(
                        "SESSION",
                        "Warning: Timeout waiting for Soniox to close. Proceeding anyway.",
                        detailed=False,
                    )
            else:
                await asyncio.sleep(0.1)

            if correction_service:
                log_pipeline_step(
                    "SESSION",
                    "Running final correction check on remaining utterances.",
                    detailed=False,
                )
                await correction_service.finalize_session()

            if active_correction_tasks:
                log_pipeline_step(
                    "SESSION",
                    f"Waiting for {len(active_correction_tasks)} outstanding correction task(s) to complete...",
                    detailed=True,
                )
                await asyncio.gather(*active_correction_tasks)
                log_pipeline_step(
                    "SESSION",
                    "All correction tasks complete.",
                    detailed=True,
                )

            if DEBUG_MODE and session_debug_dir:
                log_pipeline_step(
                    "SESSION",
                    "Session ended. Saving debug audio files...",
                    detailed=False,
                )
                save_audio_to_wav(
                    session_raw_audio,
                    session_debug_dir,
                    "raw_audio.wav",
                )
                save_audio_to_wav(
                    session_processed,
                    session_debug_dir,
                    "processed.wav",
                )

            viewer_manager.cache.save_history_and_clear("session_history")

    return router
