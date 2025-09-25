import asyncio
import base64
import json
import os
import uuid
from collections import deque
from typing import Dict, Optional
from datetime import datetime

from fastapi import APIRouter, WebSocket, WebSocketDisconnect

from .audio_processing_service import AudioProcessingService
from .buffer_service import AudioBufferService
from .correction_service import CorrectionService
from .debug_service import save_audio_to_wav
from .transcription_service import TranscriptionResult, TranscriptionService
from .translation_service import TranslationService
from .vad_service import VADService


class TranslationChunkAccumulator:
    """Accumulate streamed translation chunks while filtering prompt leakage."""

    PROMPT_MARKERS = (
        "You are a Chinese-to-English translator",
        "Your task is to translate the text",
        "Your response must contain ONLY the English translation",
        "[TEXT TO TRANSLATE]",
    )

    def __init__(self) -> None:
        self._translation = ""

    @staticmethod
    def _sanitize(chunk: str) -> str:
        return chunk.replace("\r", "")

    @staticmethod
    def _contains_prompt(text: str) -> bool:
        return any(marker in text for marker in TranslationChunkAccumulator.PROMPT_MARKERS)

    @staticmethod
    def _trim_repeated_prefix(remainder: str, previous: str) -> str:
        while remainder:
            stripped = remainder.lstrip()
            if not stripped:
                return remainder
            if stripped.startswith(previous):
                remainder = stripped[len(previous) :]
                continue
            return remainder
        return remainder

    @property
    def value(self) -> str:
        return self._translation

    def push(self, chunk: str) -> Optional[str]:
        cleaned_chunk = self._sanitize(chunk)
        if not cleaned_chunk or not cleaned_chunk.strip():
            return None

        if not self._translation:
            if self._contains_prompt(cleaned_chunk):
                return None
            self._translation = cleaned_chunk
            return self._translation

        previous = self._translation
        candidate = cleaned_chunk

        if len(candidate) < len(previous) and previous.startswith(candidate.strip()):
            return None

        if candidate.startswith(previous):
            remainder = candidate[len(previous) :]
            remainder = self._trim_repeated_prefix(remainder, previous)
            new_value = previous + remainder
        else:
            overlap = 0
            max_overlap = min(len(previous), len(candidate))
            for i in range(max_overlap, 0, -1):
                if previous.endswith(candidate[:i]):
                    overlap = i
                    break
            new_value = previous + candidate[overlap:]

        if new_value == previous:
            return None

        if self._contains_prompt(new_value):
            return None

        self._translation = new_value
        return self._translation


def create_transcribe_router(viewer_manager, DEBUG_MODE):
    router = APIRouter()

    @router.websocket("/ws/transcribe")
    async def websocket_transcribe_endpoint(websocket: WebSocket):
        await websocket.accept()
        print("Transcription client connected.")

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

        async def on_service_error(error_message: str):
            print(f"Transcription Error: {error_message}")
            await websocket.close(
                code=1011, reason=f"Transcription Error: {error_message}"
            )

        async def run_contextual_correction():
            CORRECTION_CONTEXT_THRESHOLD = 3

            if len(utterance_history) < CORRECTION_CONTEXT_THRESHOLD:
                return

            target_utterance = utterance_history[-CORRECTION_CONTEXT_THRESHOLD]

            if target_utterance.get("correction_complete"):
                return

            print(
                f"Running contextual correction for: '{target_utterance['transcription']}'"
            )

            context_list = [u["transcription"] for u in utterance_history]

            response_data = await correction_service.correct_with_context(
                text_to_correct=target_utterance["transcription"],
                context_history=context_list,
            )

            is_needed = response_data.get("is_correction_needed", False)

            reason = response_data.get("reasoning", "No reason provided.")

            if is_needed:
                print(f"Model decided a correction is needed. Reason: {reason}")

                corrected_transcription = response_data.get("corrected_sentence")

                if (
                    corrected_transcription
                    and corrected_transcription != target_utterance["transcription"]
                ):
                    print(
                        "Re-translating contextually corrected text for message_id: "
                        f"{target_utterance['message_id']}"
                    )
                    accumulator = TranslationChunkAccumulator()
                    async for chunk in translation_service.translate_stream(
                        text_to_translate=corrected_transcription
                    ):
                        accumulator.push(chunk)

                    full_corrected_translation = (
                        accumulator.value or target_utterance.get("translation", "")
                    )

                    print(
                        f"Updated translation complete: '{full_corrected_translation}'"
                    )

                    target_utterance["transcription"] = corrected_transcription
                    target_utterance["translation"] = full_corrected_translation
                    payload = {
                        "message_id": target_utterance["message_id"],
                        "transcription": corrected_transcription,
                        "translation": full_corrected_translation,
                        "speaker": target_utterance["speaker"],
                        "type": "correction",
                        "isfinalize": True,
                    }
                    await viewer_manager.broadcast(payload)
                    print(
                        f"Correction broadcasted for message_id: {target_utterance['message_id']}"
                    )
            else:
                print(
                    "Model decided no correction was needed. Reason: "
                    f"{reason}. Skipping broadcast."
                )

            target_utterance["correction_complete"] = True

        async def handle_translation(
            sentence_to_translate: str,
            speaker_name: str,
            message_id: str,
        ):
            print(f"Translating for {speaker_name}: '{sentence_to_translate}'")
            normalized_sentence = sentence_to_translate.strip()

            if not normalized_sentence or not any(
                ch.isalnum() for ch in normalized_sentence
            ):
                print(
                    "Skipping translation for non-linguistic input; broadcasting empty translation."
                )
                payload = {
                    "message_id": message_id,
                    "transcription": sentence_to_translate,
                    "translation": "",
                    "speaker": speaker_name,
                    "type": "final",
                    "isfinalize": True,
                }
                await viewer_manager.broadcast(payload)

                utterance_history.append(
                    {
                        "message_id": message_id,
                        "speaker": speaker_name,
                        "transcription": sentence_to_translate,
                        "translation": "",
                        "correction_complete": True,
                    }
                )

                asyncio.create_task(run_contextual_correction())
                return

            accumulator = TranslationChunkAccumulator()
            last_broadcasted_translation = ""

            async for translated_chunk in translation_service.translate_stream(
                text_to_translate=sentence_to_translate
            ):
                accumulated_translation = accumulator.push(translated_chunk)
                if not accumulated_translation:
                    continue

                if accumulated_translation == last_broadcasted_translation:
                    continue

                last_broadcasted_translation = accumulated_translation

                payload = {
                    "message_id": message_id,
                    "transcription": sentence_to_translate,
                    "translation": accumulated_translation,
                    "speaker": speaker_name,
                    "type": "update",
                    "isfinalize": False,
                }
                await viewer_manager.broadcast(payload)

            payload = {
                "message_id": message_id,
                "transcription": sentence_to_translate,
                "translation": accumulator.value,
                "speaker": speaker_name,
                "type": "final",
                "isfinalize": True,
            }
            await viewer_manager.broadcast(payload)
            print(f"Translation complete: '{accumulator.value}'")

            utterance_history.append(
                {
                    "message_id": message_id,
                    "speaker": speaker_name,
                    "transcription": sentence_to_translate,
                    "translation": accumulator.value,
                    "correction_complete": False,
                }
            )

            asyncio.create_task(run_contextual_correction())

        async def transcription_worker():
            while True:
                try:
                    audio_data, speaker_name = await utterance_queue.get()
                    message_id = str(uuid.uuid4())
                    local_transcription_buffer = ""
                    transcription_segments: Dict[int, str] = {}
                    next_sequence_fallback = 0
                    transcription_done = asyncio.Event()

                    async def on_transcription_message_local(
                        result: TranscriptionResult,
                    ):
                        nonlocal local_transcription_buffer, transcription_segments, next_sequence_fallback
                        current_text = result.text

                        sequence_number = result.sequence_number
                        if sequence_number is None:
                            sequence_number = next_sequence_fallback
                            next_sequence_fallback += 1
                        else:
                            next_sequence_fallback = max(
                                next_sequence_fallback, sequence_number + 1
                            )

                        if result.is_replace:
                            start, end = result.replacement_range or (
                                sequence_number,
                                sequence_number,
                            )
                            if start > end:
                                start, end = end, start
                            for sn in range(start, end + 1):
                                transcription_segments.pop(sn, None)

                        if current_text:
                            transcription_segments[sequence_number] = current_text
                        else:
                            transcription_segments.pop(sequence_number, None)

                        local_transcription_buffer = "".join(
                            transcription_segments[sn]
                            for sn in sorted(transcription_segments.keys())
                        )

                        normalized_buffer = local_transcription_buffer.strip()
                        has_meaningful_text = any(
                            ch.isalnum() for ch in normalized_buffer
                        )

                        if not normalized_buffer:
                            if result.is_final:
                                normalized_buffer = ""
                            else:
                                return

                        if not has_meaningful_text and not result.is_final:
                            return

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
                                print(
                                    f"VAD-based final sentence ({message_id}) detected for {speaker_name}: '{final_chunk}'"
                                )

                                asyncio.create_task(
                                    handle_translation(
                                        final_chunk,
                                        speaker_name,
                                        message_id,
                                    )
                                )

                            if not transcription_done.is_set():
                                transcription_done.set()
                            local_transcription_buffer = ""
                            transcription_segments.clear()
                            next_sequence_fallback = 0

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
