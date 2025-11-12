import asyncio
import json
import logging
import os
from collections import deque
from typing import AsyncGenerator

import ollama
from core.config import settings
from core.logging_setup import log_step, message_id_var, speaker_var
from openai import APIError, AsyncOpenAI

logger = logging.getLogger(__name__)


class RetranslationService:
    """
    Handles retranslation by making REST API calls to Alibaba's Qwen model
    via the DashScope service in an OpenAI-compatible mode.
    """

    def __init__(self):
        self.client = AsyncOpenAI(
            api_key=settings.ALIBABA_API_KEY,
            base_url="https://dashscope-intl.aliyuncs.com/compatible-mode/v1",
        )
        with log_step("RETRANSLATION"):
            logger.debug("Initialized Qwen retranslation client.")

    async def translate_stream(
        self, text_to_translate: str, session_id: str = "unknown"
    ) -> AsyncGenerator[str, None]:
        """
        Retranslates a block of text using the Qwen model and streams the results.
        """
        user_prompt = (
            "You are a Chinese-to-English translator. Your task is to translate the text in the [TEXT TO TRANSLATE] section. "
            "Your response must contain ONLY the English translation of the [TEXT TO TRANSLATE] and nothing else. Do not include any other text in your response."
        )

        user_prompt += f"\n\n[TEXT TO TRANSLATE]\n{text_to_translate}"

        with log_step("RETRANSLATION"):
            logger.info(
                f"Submitting text for retranslation. Characters: {len(text_to_translate)}"
            )

        try:
            stream = await self.client.chat.completions.create(
                model="qwen-mt-turbo",
                messages=[
                    {"role": "user", "content": user_prompt},
                ],
                stream=True,
                extra_body={
                    "translation_options": {
                        "source_lang": "zh",
                        "target_lang": "en",
                    }
                },
            )
            async for chunk in stream:
                content = chunk.choices[0].delta.content or ""
                if content:
                    with log_step("RETRANSLATION"):
                        logger.debug(
                            f"Received retranslation delta. Length: {len(content)}"
                        )
                    yield content
            with log_step("RETRANSLATION"):
                logger.info("Retranslation stream completed successfully.")
        except APIError as e:
            error_message = f"[Translation Error: {e.message}]"
            with log_step("RETRANSLATION"):
                logger.error(f"Alibaba Qwen API error: {e}", exc_info=True)
            yield error_message
        except Exception as e:
            with log_step("RETRANSLATION"):
                logger.error(
                    f"An unexpected error occurred during retranslation: {e}",
                    exc_info=True,
                )
            yield "[Translation Error]"


class CorrectionService:
    """
    Handles transcription correction using a local Ollama model.
    This service is stateful and manages the utterance history.
    """

    def __init__(
        self,
        viewer_manager,
        session_id: str,
        model: str = "correction",
    ):
        """
        Initializes the service.

        Args:
            ollama_url (str): The base URL for the Ollama API.
            viewer_manager: The WebSocket manager for broadcasting updates.
            session_id (str): The unique ID for this session.
            model (str): The name of the model to use for corrections.
        """
        with log_step("CORRECTION"):
            logger.info(
                f"Initializing Stateful Correction Service with model '{model}'..."
            )
        self.model = model
        self.client = ollama.AsyncClient(host=settings.OLLAMA_URL)
        self.viewer_manager = viewer_manager
        self.session_id = session_id
        self.retranslation_service = RetranslationService()
        self.utterance_history = deque(maxlen=5)
        self.CORRECTION_CONTEXT_THRESHOLD = 5

        with log_step("CORRECTION"):
            logger.debug(f"Ollama correction client initialized. Model: {model}")

    async def correct_with_context(
        self, text_to_correct: str, context_history: list[str]
    ) -> dict:
        """
        Sends a transcript to the custom correction model and returns the parsed JSON response.
        """
        prompt_data = {
            "context": " ".join(context_history),
            "target_sentence": text_to_correct,
        }
        prompt = json.dumps(prompt_data, ensure_ascii=False)
        response_content = ""
        with log_step("CORRECTION"):
            logger.info("Sending prompt to Ollama.")
            logger.debug(f"Ollama prompt: {prompt}")

        try:
            response = await self.client.chat(
                model=self.model,
                messages=[{"role": "user", "content": prompt}],
            )
            response_content = response["message"]["content"]
            with log_step("CORRECTION"):
                logger.debug(
                    f"Received raw correction response. Length: {len(response_content)}"
                )

            json_start_index = response_content.find("{")
            json_end_index = response_content.rfind("}")

            if json_start_index != -1:
                if json_end_index != -1 and json_end_index > json_start_index:
                    json_string = response_content[
                        json_start_index : json_end_index + 1
                    ]
                else:
                    json_string = response_content[json_start_index:] + "}"

                response_data = json.loads(json_string)
                with log_step("CORRECTION"):
                    logger.info(
                        f"Parsed correction response. Needed: {response_data.get('is_correction_needed', False)}"
                    )
                    logger.debug(f"Full parsed JSON: {response_data}")
                return response_data
            else:
                raise json.JSONDecodeError(
                    "No JSON object found in response", response_content, 0
                )
        except json.JSONDecodeError:
            with log_step("CORRECTION"):
                logger.error(
                    f"Could not extract valid JSON from response. RAW_RESPONSE: '{response_content}'",
                    exc_info=True,
                )
            return {
                "is_correction_needed": False,
                "corrected_sentence": text_to_correct,
                "reasoning": "JSON decode error.",
            }
        except Exception as e:
            with log_step("CORRECTION"):
                logger.error(f"Error calling Ollama: {e}", exc_info=True)
            return {
                "is_correction_needed": False,
                "corrected_sentence": text_to_correct,
                "reasoning": "Ollama API error.",
            }

    async def _perform_correction(self, target_utterance: dict):
        """Performs correction logic on a specific target utterance."""
        msg_id_token = message_id_var.set(target_utterance.get("message_id"))
        speaker_token = speaker_var.set(target_utterance.get("speaker"))

        try:
            with log_step("CORRECTION"):
                logger.debug(
                    f"Running contextual correction on: '{target_utterance['transcription']}'. "
                    f"History size: {len(self.utterance_history)}"
                )

            history_as_list = list(self.utterance_history)
            context_list = []
            try:
                target_index = next(
                    i
                    for i, u in enumerate(history_as_list)
                    if u["message_id"] == target_utterance["message_id"]
                )
                context_utterances = history_as_list[
                    target_index + 1 : target_index + 3
                ]
                context_list = [u["transcription"] for u in context_utterances]
            except StopIteration:
                with log_step("CORRECTION"):
                    logger.warning(
                        "Target utterance not found in history; sending without context."
                    )

            response_data = await self.correct_with_context(
                text_to_correct=target_utterance["transcription"],
                context_history=context_list,
            )

            is_needed = response_data.get("is_correction_needed", False)
            reason = response_data.get("reasoning", "No reason provided.")
            corrected_transcription = response_data.get("corrected_sentence")

            if (
                is_needed
                and corrected_transcription
                and corrected_transcription.strip()
                != target_utterance["transcription"].strip()
            ):
                await self.viewer_manager.broadcast_to_session(
                    self.session_id,
                    {
                        "message_id": target_utterance["message_id"],
                        "type": "status_update",
                        "correction_status": "correcting",
                    },
                )
                with log_step("CORRECTION"):
                    logger.info(
                        f"Correction applied. Reason: {reason}. "
                        f"Old: '{target_utterance['transcription']}' | "
                        f"New: '{corrected_transcription}'"
                    )

                full_corrected_translation = ""
                async for chunk in self.retranslation_service.translate_stream(
                    text_to_translate=corrected_transcription
                ):
                    full_corrected_translation = chunk

                payload = {
                    "message_id": target_utterance["message_id"],
                    "transcription": corrected_transcription,
                    "translation": full_corrected_translation,
                    "speaker": target_utterance["speaker"],
                    "type": "correction",
                    "isfinalize": True,
                }
                await self.viewer_manager.broadcast_to_session(self.session_id, payload)
                with log_step("CORRECTION"):
                    logger.info("Correction broadcast complete.")
            else:
                log_reason = (
                    reason
                    if not is_needed
                    else "Model suggested a correction, but it was empty or identical to the original."
                )
                with log_step("CORRECTION"):
                    logger.info(f"No correction applied. Reason: {log_reason}")

        finally:
            message_id_var.reset(msg_id_token)
            speaker_var.reset(speaker_token)

    async def _run_contextual_correction(self):
        """Internal helper to check and run correction on the target utterance."""
        if len(self.utterance_history) < self.CORRECTION_CONTEXT_THRESHOLD:
            return

        target_utterance = self.utterance_history[-self.CORRECTION_CONTEXT_THRESHOLD]
        await self._perform_correction(target_utterance)

    async def process_final_utterance(self, utterance: dict):
        """
        Public method to receive a new final utterance, store it,
        and trigger the correction pipeline.
        """
        msg_id_token = message_id_var.set(utterance.get("message_id"))
        speaker_token = speaker_var.set(utterance.get("speaker"))
        try:
            with log_step("CORRECTION"):
                logger.debug(
                    f"Received final utterance for history. "
                    f"History size: {len(self.utterance_history)}"
                )
        finally:
            message_id_var.reset(msg_id_token)
            speaker_var.reset(speaker_token)

        self.utterance_history.append(utterance)
        asyncio.create_task(self._run_contextual_correction())

    async def finalize_session(self):
        """
        Public method to be called on session end.
        Processes the last few utterances that didn't get a chance to be corrected.
        """
        num_final_to_check = self.CORRECTION_CONTEXT_THRESHOLD - 1

        if len(self.utterance_history) >= self.CORRECTION_CONTEXT_THRESHOLD:
            final_targets = list(self.utterance_history)[-num_final_to_check:]
            with log_step("SESSION"):
                logger.info(
                    f"Performing final correction check on last {len(final_targets)} utterance(s)."
                )
            for utterance in final_targets:
                await self._perform_correction(utterance)
        elif len(self.utterance_history) > 0:
            with log_step("SESSION"):
                logger.info(
                    f"Performing final correction check on all {len(self.utterance_history)} utterance(s)."
                )
            for utterance in list(self.utterance_history):
                await self._perform_correction(utterance)
        else:
            with log_step("SESSION"):
                logger.info(
                    f"Not enough history ({len(self.utterance_history)}) for final corrections check."
                )
