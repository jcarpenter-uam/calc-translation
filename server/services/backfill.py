import asyncio
import logging
import random
from typing import AsyncGenerator, List, Optional

from core.config import settings
from core.logging_setup import log_step, session_id_var
from openai import APIStatusError, APITimeoutError, AsyncOpenAI

logger = logging.getLogger(__name__)

GLOBAL_REQUEST_SEMAPHORE = asyncio.Semaphore(2)


class BackfillService:
    """
    Handles the backfilling of translation history for new language subscribers.
    Uses Alibaba's Qwen model to translate existing English transcripts.
    """

    def __init__(self):
        self.client = AsyncOpenAI(
            api_key=settings.ALIBABA_API_KEY,
            base_url="https://dashscope-intl.aliyuncs.com/compatible-mode/v1",
            max_retries=0,
        )
        with log_step("BACKFILL"):
            logger.debug("Initialized BackfillService with Qwen client.")

    async def _translate_text(
        self, text: str, source_lang: str, target_lang: str
    ) -> str:
        """
        Translates a single string using Qwen-MT-Turbo with robust rate limiting.
        """
        max_retries = 8
        base_delay = 2.0

        async with GLOBAL_REQUEST_SEMAPHORE:
            for attempt in range(1, max_retries + 1):
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

                except (APIStatusError, APITimeoutError) as e:
                    is_rate_limit = (
                        isinstance(e, APIStatusError) and e.status_code == 429
                    )
                    is_server_error = (
                        isinstance(e, APIStatusError) and e.status_code >= 500
                    )
                    is_timeout = isinstance(e, APITimeoutError)

                    if (
                        is_rate_limit or is_server_error or is_timeout
                    ) and attempt < max_retries:
                        jitter = random.uniform(0, 0.5)
                        sleep_time = (base_delay * (2 ** (attempt - 1))) + jitter

                        error_type = "Rate Limit" if is_rate_limit else "Server Error"
                        with log_step("BACKFILL"):
                            logger.warning(
                                f"{error_type} hit for text '{text[:15]}...'. "
                                f"Retrying in {sleep_time:.2f}s (Attempt {attempt}/{max_retries})."
                            )

                        await asyncio.sleep(sleep_time)
                        continue

                    with log_step("BACKFILL"):
                        logger.error(
                            f"Translation permanently failed for text '{text[:20]}...' "
                            f"after {attempt} attempts. Error: {e}"
                        )
                    return ""

                except Exception as e:
                    with log_step("BACKFILL"):
                        logger.error(f"Unexpected error for text '{text[:20]}...': {e}")
                    return ""

            return ""

    async def run_session_backfill(
        self,
        session_id: str,
        target_lang: str,
        viewer_manager,
        upto_count: int,
    ):
        """
        Retrieves the 'en' history and translates items up to 'upto_count'.
        Ensures strict completeness by waiting for missing items if necessary.
        """
        session_token = session_id_var.set(session_id)
        try:
            await viewer_manager.broadcast_to_session(
                session_id, {"type": "backfill_start", "target_language": target_lang}
            )

            with log_step("BACKFILL"):
                logger.info(
                    f"Starting deterministic backfill for '{target_lang}' "
                    f"covering utterances 1 to {upto_count}."
                )

            for i in range(1, upto_count + 1):
                target_msg_id = f"{i}_en"
                item = await self._fetch_or_wait_for_item(
                    session_id, target_msg_id, viewer_manager
                )

                if item:
                    await self._process_backfill_item(
                        item, session_id, target_lang, viewer_manager
                    )
                else:
                    with log_step("BACKFILL"):
                        logger.warning(
                            f"Backfill skipped missing utterance {target_msg_id} "
                            "after waiting."
                        )

            await viewer_manager.broadcast_to_session(
                session_id, {"type": "backfill_end", "target_language": target_lang}
            )

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

    async def _fetch_or_wait_for_item(self, session_id, message_id, viewer_manager):
        """
        Helper to find a specific message ID in history.
        If not found immediately, waits briefly (handling the race condition).
        """
        history = viewer_manager.cache.get_history(session_id, "en")
        item = next((x for x in history if x.get("message_id") == message_id), None)
        if item:
            return item

        for _ in range(10):
            await asyncio.sleep(0.25)
            history = viewer_manager.cache.get_history(session_id, "en")
            item = next((x for x in history if x.get("message_id") == message_id), None)
            if item:
                return item

        return None

    async def backfill_gap(
        self,
        session_id: str,
        target_lang: str,
        gap_utterance_count: int,
        viewer_manager,
    ):
        """
        Waits for a specific English utterance (the 'gap') to appear in history,
        then translates and broadcasts it.
        """
        session_token = session_id_var.set(session_id)
        gap_message_id = f"{gap_utterance_count}_en"

        with log_step("BACKFILL"):
            logger.info(
                f"Monitoring for gap utterance: {gap_message_id} to translate to {target_lang}"
            )

        try:
            found_item = None
            for _ in range(60):
                history = viewer_manager.cache.get_history(session_id, "en")
                found_item = next(
                    (
                        item
                        for item in history
                        if item.get("message_id") == gap_message_id
                    ),
                    None,
                )
                if found_item:
                    break
                await asyncio.sleep(1.0)

            if found_item:
                with log_step("BACKFILL"):
                    logger.debug(
                        f"Gap utterance found. Translating {gap_message_id} -> {target_lang}"
                    )
                await self._process_backfill_item(
                    found_item, session_id, target_lang, viewer_manager
                )
            else:
                with log_step("BACKFILL"):
                    logger.warning(
                        f"Gap utterance {gap_message_id} never finalized. Skipping."
                    )

        except Exception as e:
            with log_step("BACKFILL"):
                logger.error(f"Error bridging gap for {session_id}: {e}")
        finally:
            session_id_var.reset(session_token)

    async def _process_backfill_item(
        self, item, session_id, target_lang, viewer_manager
    ):
        """Helper to translate and broadcast a single history item."""
        if not item.get("isfinalize") or item.get("type") not in (
            "final",
            "correction",
        ):
            return

        original_text = item.get("transcription")
        if not original_text:
            return

        try:
            utterance_num = item["message_id"].split("_")[0]
            new_message_id = f"{utterance_num}_{target_lang}"
        except IndexError:
            return

        translated_text = await self._translate_text(
            text=original_text, source_lang="en", target_lang=target_lang
        )

        if not translated_text:
            return

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
            "is_backfill": True,
        }

        await viewer_manager.broadcast_to_session(session_id, payload)
