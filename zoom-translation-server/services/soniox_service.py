import asyncio
import json
import os
from dataclasses import dataclass
from typing import Awaitable, Callable

from websockets import ConnectionClosedOK
from websockets.sync.client import connect

from .debug_service import log_pipeline_step


@dataclass
class SonioxResult:
    """
    Holds the consolidated transcription and translation from a Soniox message.
    """

    transcription: str
    translation: str
    is_final: bool


class SonioxService:
    """
    Connects to the Soniox streaming API and provides consolidated
    real-time transcription and translation.
    """

    def __init__(
        self,
        on_message_callback: Callable[[SonioxResult], Awaitable[None]],
        on_error_callback: Callable[[str], Awaitable[None]],
        on_close_callback: Callable[[int, str], Awaitable[None]],
        loop: asyncio.AbstractEventLoop,
    ):
        self.api_key = os.environ.get("SONIOX_API_KEY")
        if not self.api_key:
            raise ValueError("The 'SONIOX_API_KEY' environment variable is not set.")

        self.on_message_callback = on_message_callback
        self.on_error_callback = on_error_callback
        self.on_close_callback = on_close_callback
        self.loop = loop
        self.ws = None
        self.receive_task = None
        self.SONIOX_WEBSOCKET_URL = "wss://stt-rt.soniox.com/transcribe-websocket"

        self.final_transcription_tokens = []
        self.final_translation_tokens = []

    def _get_config(self) -> dict:
        """
        Generates the configuration for the Soniox websocket connection.
        """
        return {
            "api_key": self.api_key,
            #
            # Select the model to use.
            # See: soniox.com/docs/stt/models
            "model": "stt-rt-v3",
            #
            # Enable language identification. Each token will include a "language" field.
            # See: soniox.com/docs/stt/concepts/language-identification
            "enable_language_identification": True,
            #
            # Enable speaker diarization. Each token will include a "speaker" field.
            # See: soniox.com/docs/stt/concepts/speaker-diarization
            "enable_speaker_diarization": False,
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
                # Translates all languages into the target language.
                "type": "one_way",
                "source_languages": ["*"],
                "target_language": "en",
            },
            #
            # Set language hints when possible to significantly improve accuracy.
            # See: soniox.com/docs/stt/concepts/language-hints
            "language_hints": ["en", "zh"],
        }

    async def _receive_loop(self):
        """
        Runs in a separate task to receive and process messages from Soniox.
        """
        try:
            while True:
                message = await self.loop.run_in_executor(None, self.ws.recv)
                res = json.loads(message)

                if res.get("error_code") is not None:
                    error_msg = f"{res['error_code']} - {res['error_message']}"
                    log_pipeline_step("TRANSCRIPTION", error_msg, detailed=False)
                    await self.on_error_callback(error_msg)
                    break

                non_final_transcription_tokens = []
                non_final_translation_tokens = []
                is_end_token = False

                for token in res.get("tokens", []):
                    text = token.get("text")
                    if not text:
                        continue

                    if text == "<end>" and token.get("is_final"):
                        is_end_token = True
                        continue

                    is_translation = token.get("translation_status") == "translation"

                    if token.get("is_final"):
                        if is_translation:
                            self.final_translation_tokens.append(text)
                        else:
                            self.final_transcription_tokens.append(text)
                    else:
                        if is_translation:
                            non_final_translation_tokens.append(text)
                        else:
                            non_final_transcription_tokens.append(text)

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

                await self.on_message_callback(
                    SonioxResult(
                        transcription=full_transcription,
                        translation=full_translation,
                        is_final=False,
                    )
                )

                if is_end_token:
                    log_pipeline_step(
                        "SONIOX",
                        "Received <end> token, sending final utterance result.",
                        detailed=True,
                    )
                    await self.on_message_callback(
                        SonioxResult(
                            transcription="".join(
                                self.final_transcription_tokens
                            ).strip(),
                            translation="".join(self.final_translation_tokens).strip(),
                            is_final=True,
                        )
                    )
                    self.final_transcription_tokens = []
                    self.final_translation_tokens = []

                if res.get("finished"):
                    log_pipeline_step(
                        "SONIOX",
                        "Soniox signaled session finished.",
                        detailed=True,
                    )
                    await self.on_message_callback(
                        SonioxResult(
                            transcription="".join(
                                self.final_transcription_tokens
                            ).strip(),
                            translation="".join(self.final_translation_tokens).strip(),
                            is_final=True,
                        )
                    )
                    break

        except ConnectionClosedOK:
            log_pipeline_step(
                "SONIOX", "Soniox connection closed normally.", detailed=True
            )
            await self.on_message_callback(
                SonioxResult(
                    transcription="".join(self.final_transcription_tokens).strip(),
                    translation="".join(self.final_translation_tokens).strip(),
                    is_final=True,
                )
            )
            await self.on_close_callback(1000, "Normal closure")
        except Exception as e:
            log_pipeline_step("SONIOX", f"Receive loop error: {e}", detailed=False)
            await self.on_error_callback(str(e))
        finally:
            if self.ws:
                self.ws.close()

    def connect(self):
        """
        Connects to the websocket and starts the receive loop.
        This is synchronous, but it starts an async task.
        """
        try:
            config = self._get_config()
            self.ws = connect(self.SONIOX_WEBSOCKET_URL)
            self.ws.send(json.dumps(config))
            self.receive_task = self.loop.create_task(self._receive_loop())
            log_pipeline_step("SONIOX", "Soniox service connected.", detailed=True)
        except Exception as e:
            log_pipeline_step("SONIOX", f"Soniox connection error: {e}", detailed=False)
            raise

    def send_chunk(self, chunk: bytes):
        """
        * Sends a chunk of audio data to the websocket.
        * This is run in an executor by the caller.
        """
        if self.ws:
            self.ws.send(chunk)

    def finalize_stream(self):
        """
        * Signals the end of the *entire* audio stream (session end).
        * This is run in an executor by the caller.
        """
        if self.ws:
            self.ws.send("")
            log_pipeline_step(
                "SONIOX",
                "Soniox stream finalized (session end).",
                detailed=True,
            )
