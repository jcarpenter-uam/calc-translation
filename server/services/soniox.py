import asyncio
import json
import logging
from dataclasses import dataclass
from typing import Awaitable, Callable, Optional, List

import websockets
from core.config import settings
from core.logging_setup import log_step, session_id_var, speaker_var
from websockets.exceptions import ConnectionClosedError, ConnectionClosedOK

logger = logging.getLogger(__name__)


class SonioxError(Exception):
    """Base exception for Soniox errors."""

    pass


class SonioxConnectionError(SonioxError):
    """
    Indicates a transient connection error that can be retried.
    e.g., "Connection reset by peer" or Soniox "503" error.
    """

    pass


class SonioxFatalError(SonioxError):
    """
    Indicates an unrecoverable error.
    e.g., Bad API key, invalid configuration.
    """

    pass


@dataclass
class SonioxResult:
    """
    Holds the consolidated transcription and translation from a Soniox message.
    """

    transcription: str
    translation: str
    is_final: bool
    source_language: Optional[str] = None
    target_language: Optional[str] = None
    speaker: Optional[str] = None


class SonioxService:
    """
    Connects to the Soniox streaming API and provides consolidated
    real-time transcription and translation.
    """

    def __init__(
        self,
        on_message_callback: Callable[[SonioxResult], Awaitable[None]],
        on_error_callback: Callable[[SonioxError], Awaitable[None]],
        on_close_callback: Callable[[int, str], Awaitable[None]],
        loop: asyncio.AbstractEventLoop,
        target_language: str = "en",
        session_id: Optional[str] = None,
        enable_speaker_diarization: bool = False,
        language_hints: Optional[List[str]] = None,
    ):
        self.api_key = settings.SONIOX_API_KEY

        self.on_message_callback = on_message_callback
        self.on_error_callback = on_error_callback
        self.on_close_callback = on_close_callback
        self.loop = loop
        self.target_language = target_language
        self.session_id = session_id
        self.enable_speaker_diarization = enable_speaker_diarization
        self.language_hints = language_hints if language_hints is not None else []
        self.current_speaker: Optional[str] = "Unknown"
        self.ws = None
        self.receive_task = None
        self._is_connected = False
        self.SONIOX_WEBSOCKET_URL = "wss://stt-rt.soniox.com/transcribe-websocket"

        self.final_transcription_tokens = []
        self.final_translation_tokens = []

        self.final_source_language: Optional[str] = None
        self.final_translation_language: Optional[str] = None
        self.final_speaker: Optional[str] = None

    def _get_config(self) -> dict:
        """
        Generates the configuration for the Soniox websocket connection.
        """
        return {
            "api_key": self.api_key,
            #
            # Select the model to use.
            # See: soniox.com/docs/stt/models
            "model": "stt-rt-v4",
            #
            # Enable language identification. Each token will include a "language" field.
            # See: soniox.com/docs/stt/concepts/language-identification
            "enable_language_identification": True,
            #
            # Enable speaker diarization. Each token will include a "speaker" field.
            # See: soniox.com/docs/stt/concepts/speaker-diarization
            "enable_speaker_diarization": self.enable_speaker_diarization,
            #
            # **IMPORTANT: Enable Soniox endpoint detection.**
            # This allows Soniox to detect utterances automatically.
            # See: soniox.com/docs/stt/rt/endpoint-detection
            "enable_endpoint_detection": True,
            # Audio format.
            # See: soniox.com/docs/stt/rt/real-time-transcription#audio-formats
            "audio_format": "pcm_s16le",
            "sample_rate": 16000,
            "num_channels": 1,
            # Translation options.
            # See: soniox.com/docs/stt/rt/real-time-translation#translation-modes
            "translation": {
                "type": "one_way",
                "target_language": self.target_language,
            },
            #
            # Set language hints when possible to significantly improve accuracy.
            # See: soniox.com/docs/stt/concepts/language-hints
            "language_hints": self.language_hints,
        }

    async def _receive_loop(self):
        """
        Runs in a separate task to receive and process messages from Soniox.
        """
        try:
            async for message in self.ws:
                spk_token = None
                if self.current_speaker:
                    spk_token = speaker_var.set(self.current_speaker)

                try:
                    res = json.loads(message)

                    if res.get("error_code") is not None:
                        error_msg = f"{res['error_code']} - {res['error_message']}"
                        with log_step("TRANSCRIPTION"):
                            logger.error(error_msg)

                        if "Cannot continue request" in error_msg:
                            await self.on_error_callback(
                                SonioxConnectionError(error_msg)
                            )
                        else:
                            await self.on_error_callback(SonioxFatalError(error_msg))
                        break

                    non_final_transcription_tokens = []
                    non_final_translation_tokens = []
                    is_end_token = False

                    non_final_source_lang: Optional[str] = None
                    non_final_target_lang: Optional[str] = None
                    non_final_speaker: Optional[str] = None

                    for token in res.get("tokens", []):
                        text = token.get("text")
                        if not text:
                            continue

                        if text == "<end>" and token.get("is_final"):
                            is_end_token = True
                            continue

                        is_translation = (
                            token.get("translation_status") == "translation"
                        )
                        lang = token.get("language")
                        spk = token.get("speaker")

                        if spk is not None and self.enable_speaker_diarization:
                            spk = f"Speaker {spk}"

                        if token.get("is_final"):
                            if is_translation:
                                self.final_translation_tokens.append(text)
                                if not self.final_translation_language and lang:
                                    self.final_translation_language = lang
                            else:
                                self.final_transcription_tokens.append(text)
                                if not self.final_source_language and lang:
                                    self.final_source_language = lang
                                if spk:
                                    self.final_speaker = str(spk)
                        else:
                            if is_translation:
                                non_final_translation_tokens.append(text)
                                if not non_final_target_lang and lang:
                                    non_final_target_lang = lang
                            else:
                                non_final_transcription_tokens.append(text)
                                if not non_final_source_lang and lang:
                                    non_final_source_lang = lang
                                if spk:
                                    non_final_speaker = str(spk)

                    final_transcription = "".join(self.final_transcription_tokens)
                    non_final_transcription = "".join(non_final_transcription_tokens)
                    full_transcription = (
                        f"{final_transcription} {non_final_transcription}".strip()
                    )

                    final_translation = "".join(self.final_translation_tokens)
                    non_final_translation = "".join(non_final_translation_tokens)
                    full_translation = (
                        f"{final_translation} {non_final_translation}".strip()
                    )

                    source_lang_to_send = (
                        self.final_source_language or non_final_source_lang
                    )
                    target_lang_to_send = (
                        self.final_translation_language or non_final_target_lang
                    )

                    if not target_lang_to_send:
                        target_lang_to_send = self.target_language

                    speaker_to_send = self.final_speaker or non_final_speaker

                    await self.on_message_callback(
                        SonioxResult(
                            transcription=full_transcription,
                            translation=full_translation,
                            is_final=False,
                            source_language=source_lang_to_send,
                            target_language=target_lang_to_send,
                            speaker=speaker_to_send,
                        )
                    )

                    if is_end_token:
                        with log_step("SONIOX"):
                            logger.debug(
                                "Received <end> token, sending final utterance result."
                            )

                        final_source_lang = self.final_source_language
                        final_target_lang = (
                            self.final_translation_language or self.target_language
                        )

                        await self.on_message_callback(
                            SonioxResult(
                                transcription="".join(
                                    self.final_transcription_tokens
                                ).strip(),
                                translation="".join(
                                    self.final_translation_tokens
                                ).strip(),
                                is_final=True,
                                source_language=final_source_lang,
                                target_language=final_target_lang,
                                speaker=self.final_speaker,
                            )
                        )
                        self.final_transcription_tokens = []
                        self.final_translation_tokens = []
                        self.final_source_language = None
                        self.final_translation_language = None
                        self.final_speaker = None

                    if res.get("finished"):
                        with log_step("SONIOX"):
                            logger.debug("Soniox signaled session finished.")
                        await self.on_message_callback(
                            SonioxResult(
                                transcription="".join(
                                    self.final_transcription_tokens
                                ).strip(),
                                translation="".join(
                                    self.final_translation_tokens
                                ).strip(),
                                is_final=True,
                                source_language=self.final_source_language,
                                target_language=self.final_translation_language
                                or self.target_language,
                                speaker=self.final_speaker,
                            )
                        )
                        break
                finally:
                    if spk_token:
                        speaker_var.reset(spk_token)

        except ConnectionClosedOK:
            with log_step("SONIOX"):
                logger.debug("Soniox connection closed normally.")
            await self.on_message_callback(
                SonioxResult(
                    transcription="".join(self.final_transcription_tokens).strip(),
                    translation="".join(self.final_translation_tokens).strip(),
                    is_final=True,
                    source_language=self.final_source_language,
                    target_language=self.final_translation_language
                    or self.target_language,
                )
            )
            await self.on_close_callback(1000, "Normal closure")

        except ConnectionClosedError as e:
            error_msg = str(e)
            with log_step("SONIOX"):
                logger.error(
                    f"Receive loop error (ConnectionClosedError): {e}", exc_info=True
                )
            await self.on_error_callback(SonioxConnectionError(error_msg))

        except Exception as e:
            error_msg = str(e)
            with log_step("SONIOX"):
                logger.error(f"Receive loop error (Exception): {e}", exc_info=True)

            if "Connection reset by peer" in error_msg:
                await self.on_error_callback(SonioxConnectionError(error_msg))
            else:
                await self.on_error_callback(SonioxFatalError(error_msg))
        finally:
            self._is_connected = False
            if self.ws:
                await self.ws.close()

    async def connect(self):
        """
        Connects to the websocket and starts the receive loop.
        """
        token = None
        if self.session_id:
            token = session_id_var.set(self.session_id)
        try:
            config = self._get_config()
            self.ws = await websockets.connect(
                self.SONIOX_WEBSOCKET_URL,
                ping_interval=20,
                ping_timeout=10,
            )
            await self.ws.send(json.dumps(config))
            self._is_connected = True
            self.receive_task = self.loop.create_task(self._receive_loop())
            with log_step("SONIOX"):
                logger.debug(
                    f"Soniox service connected (Target: {self.target_language}) | Hints: {self.language_hints}"
                )
        except Exception as e:
            self._is_connected = False
            with log_step("SONIOX"):
                logger.error(f"Soniox connection error: {e}", exc_info=True)
            raise
        finally:
            if token:
                session_id_var.reset(token)

    async def send_chunk(self, chunk: bytes):
        """
        * Sends a chunk of audio data to the websocket.
        * This is an async method to be awaited by the caller.
        """
        if self.ws and self._is_connected:
            try:
                await self.ws.send(chunk)
            except Exception as e:
                with log_step("SONIOX"):
                    logger.error(f"Send chunk error: {e}")
                self._is_connected = False

    async def send_json(self, data: dict):
        """Helper to send JSON control messages (like keepalives)."""
        if self.ws:
            await self.ws.send(json.dumps(data))

    async def finalize_stream(self):
        """
        * Signals the end of the *entire* audio stream (session end).
        * This is an async method to be awaited by the caller.
        """
        if self.ws and self._is_connected:
            try:
                await self.ws.send("")
                with log_step("SONIOX"):
                    logger.debug("Soniox stream finalized (session end).")
            except Exception as e:
                with log_step("SONIOX"):
                    logger.warning(
                        f"Finalize stream error (connection likely closed): {e}"
                    )
            finally:
                self._is_connected = False
        else:
            with log_step("SONIOX"):
                logger.debug("Skipping finalize_stream: connection already closed.")
