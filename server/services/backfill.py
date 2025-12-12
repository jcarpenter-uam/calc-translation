import logging
from typing import AsyncGenerator

from core.config import settings
from core.logging_setup import log_step, session_id_var
from openai import AsyncOpenAI

logger = logging.getLogger(__name__)


class BackfillService:
    """
    Handles the backfilling of translation history for new language subscribers.
    Uses Alibaba's Qwen model to translate existing English transcripts.
    """

    def __init__(self):
        self.client = AsyncOpenAI(
            api_key=settings.ALIBABA_API_KEY,
            base_url="https://dashscope-intl.aliyuncs.com/compatible-mode/v1",
        )
        with log_step("BACKFILL"):
            logger.debug("Initialized BackfillService with Qwen client.")

    async def _translate_text(
        self, text: str, source_lang: str, target_lang: str
    ) -> str:
        """
        Translates a single string using Qwen-MT-Turbo.
        """
        try:
            response = await self.client.chat.completions.create(
                model="qwen-mt-turbo",
                messages=[
                    {
                        "role": "user",
                        "content": (
                            f"Translate this {source_lang} text to {target_lang}. "
                            "Output ONLY the translation, no other text:\n\n"
                            f"{text}"
                        ),
                    }
                ],
                extra_body={
                    "translation_options": {
                        "source_lang": source_lang,
                        "target_lang": target_lang,
                    }
                },
            )
            return response.choices[0].message.content.strip()
        except Exception as e:
            with log_step("BACKFILL"):
                logger.error(f"Translation failed for text '{text[:20]}...': {e}")
            return ""

    async def run_session_backfill(
        self,
        session_id: str,
        target_lang: str,
        viewer_manager,
    ):
        """
        Retrieves the 'en' history, translates it to target_lang,
        and broadcasts the result to the session.
        """
        session_token = session_id_var.set(session_id)
        try:
            master_history = viewer_manager.cache.get_history(session_id, "en")

            if not master_history:
                with log_step("BACKFILL"):
                    logger.debug("No English history found to backfill.")
                return

            with log_step("BACKFILL"):
                logger.info(
                    f"Starting backfill for language '{target_lang}'. "
                    f"Items to process: {len(master_history)}"
                )

            for item in master_history:
                if not item.get("isfinalize") or item.get("type") not in (
                    "final",
                    "correction",
                ):
                    continue

                original_text = item.get("transcription")
                if not original_text:
                    continue

                try:
                    utterance_num = item["message_id"].split("_")[0]
                    new_message_id = f"{utterance_num}_{target_lang}"
                except IndexError:
                    logger.warning(
                        f"Skipping malformed ID during backfill: {item.get('message_id')}"
                    )
                    continue

                translated_text = await self._translate_text(
                    text=original_text, source_lang="en", target_lang=target_lang
                )

                if not translated_text:
                    continue

                payload = {
                    "message_id": new_message_id,
                    "transcription": original_text,
                    "translation": translated_text,
                    "source_language": "en",
                    "target_language": target_lang,
                    "speaker": item.get("speaker", "Unknown"),
                    "type": "final",
                    "isfinalize": True,
                    "vtt_timestamp": item.get("vtt_timestamp"),
                }

                await viewer_manager.broadcast_to_session(session_id, payload)

            with log_step("BACKFILL"):
                logger.info(f"Completed backfill for '{target_lang}'.")

        except Exception as e:
            with log_step("BACKFILL"):
                logger.error(
                    f"Error during backfill for session {session_id}: {e}",
                    exc_info=True,
                )
        finally:
            session_id_var.reset(session_token)
