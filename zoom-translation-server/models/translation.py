import asyncio
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


class HuggingFaceTranslationModel:
    """
    Handles translation by loading and running a local Hugging Face
    model using the 'transformers' library.
    """

    def __init__(self):
        load_dotenv()
        try:
            from transformers import pipeline
        except ImportError:
            log_pipeline_step(
                "TRANSLATION",
                "Error: 'transformers' or 'torch' not installed.",
                detailed=False,
            )
            raise ImportError(
                "Please install 'transformers' and 'torch' to use HuggingFaceLocalTranslationModel."
            )

        # https://huggingface.co/tencent/Hunyuan-MT-7B
        self.model_id = "tencent/Hunyuan-MT-7B"

        try:
            log_pipeline_step(
                "TRANSLATION",
                f"Loading local Hugging Face model: {self.model_id}. This may take a moment...",
                detailed=True,
            )
            self.translator = pipeline(model=self.model_id)
            log_pipeline_step(
                "TRANSLATION",
                "Initialized Hugging Face *local* translation client.",
                extra={"model_id": self.model_id},
                detailed=True,
            )
        except Exception as e:
            log_pipeline_step(
                "TRANSLATION",
                f"Failed to load local HF model '{self.model_id}': {e}",
                detailed=False,
            )
            raise

    async def translate_stream(
        self, text_to_translate: str
    ) -> AsyncGenerator[str, None]:
        """
        Translates text using a local Hugging Face model.
        NOTE: This is NOT streaming. It runs the synchronous model in a
        thread and yields the single, full result.
        """
        log_pipeline_step(
            "TRANSLATION",
            "Submitting text for *local* translation.",
            extra={"characters": len(text_to_translate)},
            detailed=False,
        )

        try:
            result_list = await asyncio.to_thread(self.translator, text_to_translate)

            if (
                isinstance(result_list, list)
                and result_list
                and "translation_text" in result_list[0]
            ):
                translated_text = result_list[0]["translation_text"]
                log_pipeline_step(
                    "TRANSLATION",
                    "Received full translation from local HF model.",
                    extra={"delta_length": len(translated_text), "has_more": False},
                    detailed=True,
                )
                yield translated_text
                log_pipeline_step(
                    "TRANSLATION",
                    "Local translation 'stream' (single yield) completed.",
                    detailed=False,
                )
            else:
                raise ValueError(
                    f"Unexpected local model response format: {result_list}"
                )

        except Exception as e:
            log_pipeline_step(
                "TRANSLATION",
                f"An unexpected error occurred during local translation: {e}",
                detailed=False,
            )
            yield "[Translation Error]"
