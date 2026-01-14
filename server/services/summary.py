import asyncio
import logging
import os
import urllib.parse

import ollama
from core import database
from core.config import settings
from core.database import SQL_GET_MEETING_ATTENDEES_DETAILS, SQL_INSERT_SUMMARY
from core.logging_setup import log_step

logger = logging.getLogger(__name__)

LOG_STEP = "SUMMARY"


class SummaryService:
    def __init__(self):
        with log_step(LOG_STEP):
            client_kwargs = {"host": settings.OLLAMA_BASE_URL}

            if settings.OLLAMA_API_KEY:
                client_kwargs["headers"] = {
                    "Authorization": f"Bearer {settings.OLLAMA_API_KEY}"
                }
                logger.debug("Ollama Client initialized with Bearer Auth.")

            self.client = ollama.Client(**client_kwargs)
            self.model = settings.OLLAMA_MODEL

    def _clean_vtt_content(self, vtt_content: str) -> str:
        """Removes VTT headers and timestamps to extract pure dialogue."""
        lines = vtt_content.splitlines()
        cleaned_lines = []
        for line in lines:
            if (
                line.startswith("WEBVTT")
                or "-->" in line
                or line.strip().isdigit()
                or not line.strip()
            ):
                continue
            cleaned_lines.append(line)
        return "\n".join(cleaned_lines)

    async def _generate_single_summary(
        self, source_text: str, target_lang: str, output_dir: str, session_id: str
    ):
        """Helper to run one Ollama generation task."""
        with log_step(LOG_STEP):
            try:
                logger.info(
                    f"Generating {target_lang} summary for session {session_id} using {self.model}..."
                )

                system_prompt = (
                    "You are a professional meeting secretary. "
                    "Your task is to analyze the provided English meeting transcript and generate a structured summary.\n\n"
                    "### STRICT OUTPUT REQUIREMENTS:\n"
                    f"1. **Language:** The ENTIRE output must be written in the language corresponding to the code '{target_lang}'. "
                    "If the target language is NOT English, you must translate the summary content and the section headers.\n"
                    "2. **Structure:** Your response must use the following structure (translated if necessary):\n"
                    "   - **Key Points**\n"
                    "   - **Decisions Made**\n"
                    "   - **Action Items**\n"
                    "3. **Tone:** Professional, concise, and objective.\n"
                    "4. **Format:** Do NOT include timestamps or preamble. Start directly with the summary."
                )

                response = self.client.chat(
                    model=self.model,
                    messages=[
                        {
                            "role": "system",
                            "content": system_prompt,
                        },
                        {
                            "role": "user",
                            "content": f"TRANSCRIPT:\n{source_text}",
                        },
                    ],
                )

                summary_text = response["message"]["content"]

                filename = f"summary_{target_lang}.txt"
                path = os.path.join(output_dir, filename)

                with open(path, "w", encoding="utf-8") as f:
                    f.write(summary_text)

                if database.DB_POOL:
                    async with database.DB_POOL.acquire() as conn:
                        await conn.execute(
                            SQL_INSERT_SUMMARY, session_id, target_lang, filename
                        )

                logger.info(f"Completed {target_lang} summary for {session_id}.")
                return True

            except Exception as e:
                logger.error(f"Failed to generate {target_lang} summary: {e}")
                return False

    async def generate_summaries_for_attendees(self, session_id: str, integration: str):
        """
        Orchestrates summary generation based on attendee language preferences.
        Always uses the English transcript as the source.
        """
        with log_step(LOG_STEP):
            try:
                async with database.DB_POOL.acquire() as conn:
                    attendees = await conn.fetch(
                        SQL_GET_MEETING_ATTENDEES_DETAILS, session_id
                    )

                if not attendees:
                    logger.info("No attendees found. Skipping summary generation.")
                    return

                needed_languages = set()
                for row in attendees:
                    lang = row.get("language_code")
                    needed_languages.add(lang if lang else "en")

                needed_languages.add("en")

                safe_session_id = urllib.parse.quote(session_id, safe="")
                output_dir = os.path.join("output", integration, safe_session_id)
                source_vtt_path = os.path.join(output_dir, "transcript_en.vtt")

                if not os.path.exists(source_vtt_path):
                    logger.warning(
                        f"English transcript missing at {source_vtt_path}. Cannot generate summaries."
                    )
                    return

                with open(source_vtt_path, "r", encoding="utf-8") as f:
                    raw_content = f.read()

                clean_source_text = self._clean_vtt_content(raw_content)
                if not clean_source_text:
                    logger.warning("English transcript was empty after cleaning.")
                    return

                logger.info(f"Generating summaries for languages: {needed_languages}")

                tasks = [
                    self._generate_single_summary(
                        clean_source_text, lang, output_dir, session_id
                    )
                    for lang in needed_languages
                ]

                if tasks:
                    await asyncio.gather(*tasks)

            except Exception as e:
                logger.error(f"Error in summary generation process: {e}", exc_info=True)
