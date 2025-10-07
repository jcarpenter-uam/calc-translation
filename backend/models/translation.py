import os
from typing import AsyncGenerator

from dotenv import load_dotenv
from openai import APIError, AsyncOpenAI
from services.debug_service import log_pipeline_step


class QwenTranslationModel:
    """
    Handles translation by making REST API calls to Alibaba's Qwen model
    via the DashScope service in an OpenAI-compatible mode.
    """

    def __init__(self):
        load_dotenv()
        try:
            self.client = AsyncOpenAI(
                api_key=os.environ["DASHSCOPE_API_KEY"],
                base_url="https://dashscope-intl.aliyuncs.com/compatible-mode/v1",
            )
        except KeyError:
            raise ValueError("The 'DASHSCOPE_API_KEY' environment variable is not set.")
        log_pipeline_step(
            "TRANSLATION",
            "Initialized Qwen translation client.",
            extra={
                "base_url": "https://dashscope-intl.aliyuncs.com/compatible-mode/v1"
            },
            detailed=True,
        )

    async def translate_stream(
        self, text_to_translate: str
    ) -> AsyncGenerator[str, None]:
        """
        Translates a block of text using the Qwen model and streams the results.
        """
        user_prompt = (
            "You are a Chinese-to-English translator. Your task is to translate the text in the [TEXT TO TRANSLATE] section. "
            "Your response must contain ONLY the English translation of the [TEXT TO TRANSLATE] and nothing else. Do not include any other text in your response."
        )

        user_prompt += f"\n\n[TEXT TO TRANSLATE]\n{text_to_translate}"

        log_pipeline_step(
            "TRANSLATION",
            "Submitting text for translation.",
            extra={"characters": len(text_to_translate)},
            detailed=False,
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
                    log_pipeline_step(
                        "TRANSLATION",
                        "Received translation delta from Qwen.",
                        extra={
                            "delta_length": len(content),
                            "has_more": not chunk.choices[0].finish_reason,
                        },
                        detailed=True,
                    )
                    yield content
            log_pipeline_step(
                "TRANSLATION",
                "Translation stream completed successfully.",
                detailed=False,
            )
        except APIError as e:
            error_message = f"[Translation Error: {e.message}]"
            log_pipeline_step(
                "TRANSLATION",
                f"Alibaba Qwen API error: {e}",
                detailed=False,
            )
            yield error_message
        except Exception as e:
            log_pipeline_step(
                "TRANSLATION",
                f"An unexpected error occurred during translation: {e}",
                detailed=False,
            )
            yield "[Translation Error]"
