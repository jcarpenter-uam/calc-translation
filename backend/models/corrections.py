import json

import ollama


class OllamaCorrectionService:
    """
    Handles transcription correction using a local Ollama model.
    """

    def __init__(self, model: str = "translation_correction"):
        print(f"Initializing Ollama Correction Service with model '{model}'...")
        self.model = model
        self.client = ollama.AsyncClient()

    async def correct_with_context(
        self, text_to_correct: str, context_history: list[str]
    ) -> dict:
        """
        Sends a transcript to the custom correction model and returns the parsed JSON response.
        """
        formatted_context = []
        for sentence in context_history:
            if sentence == text_to_correct:
                formatted_context.append(f">> {sentence}")
            else:
                formatted_context.append(sentence)
        context_str = "\n".join(formatted_context)

        prompt = f"""
        --- CONVERSATION TRANSCRIPT ---
        {context_str}
        --- END TRANSCRIPT ---
        """

        try:
            response = await self.client.chat(
                model=self.model,
                messages=[{"role": "user", "content": prompt}],
            )

            response_content = response["message"]["content"]

            json_start_index = response_content.find("{")
            json_end_index = response_content.rfind("}")

            if json_start_index != -1 and json_end_index != -1:
                json_string = response_content[json_start_index : json_end_index + 1]
                response_data = json.loads(json_string)
                return response_data
            else:
                raise json.JSONDecodeError(
                    "No JSON object found in response", response_content, 0
                )

        except json.JSONDecodeError:
            print(
                f"Error: Could not extract valid JSON from response. Full response: {response_content}"
            )
            return {
                "is_correction_needed": False,
                "corrected_sentence": text_to_correct,
                "reasoning": "JSON decode error.",
            }
        except Exception as e:
            print(f"Error calling Ollama: {e}")
            return {
                "is_correction_needed": False,
                "corrected_sentence": text_to_correct,
                "reasoning": "Ollama API error.",
            }
