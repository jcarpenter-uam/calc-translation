import json

import ollama
from services.debug_service import log_pipeline_step


class OllamaCorrectionService:
    """
    Handles transcription correction using a local Ollama model.
    """

    def __init__(self, ollama_url: str, model: str = "translation_correction"):
        """
        Initializes the service.

        Args:
            ollama_url (str): The base URL for the Ollama API.
            model (str): The name of the model to use for corrections.
        """
        log_pipeline_step(
            "CORRECTION",
            f"Initializing Ollama Correction Service with model '{model}' at {ollama_url}...",
            detailed=False,
        )
        self.model = model
        self.client = ollama.AsyncClient(host=ollama_url)
        log_pipeline_step(
            "CORRECTION",
            "Ollama correction client initialized.",
            extra={"model": model, "host": ollama_url},
            detailed=True,
        )

    async def correct_with_context(
        self, text_to_correct: str, context_history: list[str]
    ) -> dict:
        """
        Sends a transcript to the custom correction model and returns the parsed JSON response.
        """
        context_str = "\n".join(context_history)

        prompt = f"""
        --- CONVERSATION CONTEXT ---
        {context_str}
        --- TARGET SENTENCE ---
        {text_to_correct}
        """

        response_content = ""

        print(f"{prompt}")

        try:
            response = await self.client.chat(
                model=self.model,
                messages=[{"role": "user", "content": prompt}],
            )

            response_content = response["message"]["content"]
            log_pipeline_step(
                "CORRECTION",
                "Received raw correction response.",
                extra={"response_length": len(response_content)},
                detailed=True,
            )

            json_start_index = response_content.find("{")
            json_end_index = response_content.rfind("}")

            if json_start_index != -1:
                # If a closing brace is found, extract the substring.
                if json_end_index != -1 and json_end_index > json_start_index:
                    json_string = response_content[
                        json_start_index : json_end_index + 1
                    ]
                else:
                    # If no closing brace is found, assume it's missing and add it.
                    json_string = response_content[json_start_index:] + "}"

                response_data = json.loads(json_string)
                log_pipeline_step(
                    "CORRECTION",
                    "Parsed correction response JSON.",
                    extra={
                        "is_correction_needed": response_data.get(
                            "is_correction_needed", False
                        ),
                        "has_corrected_sentence": bool(
                            response_data.get("corrected_sentence")
                        ),
                    },
                    detailed=False,
                )
                return response_data
            else:
                raise json.JSONDecodeError(
                    "No JSON object found in response", response_content, 0
                )

        except json.JSONDecodeError:
            log_pipeline_step(
                "CORRECTION",
                f"Error: Could not extract valid JSON from response. RAW_RESPONSE: '{response_content}'",
                extra={"response": response_content},
                detailed=False,
            )
            return {
                "is_correction_needed": False,
                "corrected_sentence": text_to_correct,
                "reasoning": "JSON decode error.",
            }
        except Exception as e:
            log_pipeline_step(
                "CORRECTION",
                f"Error calling Ollama: {e}",
                detailed=False,
            )
            return {
                "is_correction_needed": False,
                "corrected_sentence": text_to_correct,
                "reasoning": "Ollama API error.",
            }
