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

            if settings.OLLAMA_API_KEY and settings.OLLAMA_API_KEY.strip():
                client_kwargs["headers"] = {
                    "Authorization": f"Bearer {settings.OLLAMA_API_KEY.strip()}"
                }
                logger.debug("Ollama Client initialized with Bearer Auth.")

            self.client = ollama.AsyncClient(**client_kwargs)
            self.model = settings.OLLAMA_MODEL

    def _clean_vtt_content(self, vtt_content: str) -> str:
        lines = vtt_content.splitlines()
        formatted_lines = []
        current_timestamp = None
        
        for line in lines:
            line = line.strip()
            
            if not line or line == "WEBVTT":
                continue
                
            if "-->" in line:
                try:
                    start_time = line.split("-->")[0].strip()
                    current_timestamp = start_time.split(".")[0]
                except Exception:
                    pass
                continue
            
            if line.isdigit():
                continue

            time_prefix = f"*{current_timestamp}* - " if current_timestamp else ""

            if ": " in line:
                parts = line.split(": ", 1)
                speaker = parts[0]
                text = parts[1]
                formatted_lines.append(f"{time_prefix}**{speaker}:** {text}")
            else:
                formatted_lines.append(f"{time_prefix}{line}")
                
        return "\n\n".join(formatted_lines)

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
                    f"Your task is to analyze the provided meeting transcript and generate a structured summary corresponding to this language code '{target_lang}'.\n\n"
                    "Do NOT include timestamps or preamble. Your job is to only provide the summary in the target language."
                )

                response = await self.client.chat(
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
                    two_way_path = os.path.join(output_dir, "transcript_two_way.vtt")
                    if os.path.exists(two_way_path):
                        source_vtt_path = two_way_path
                    else:
                        logger.warning(
                            f"No supported source transcript found (checked transcript_en.vtt and transcript_two_way.vtt) in {output_dir}. Cannot generate summaries."
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
