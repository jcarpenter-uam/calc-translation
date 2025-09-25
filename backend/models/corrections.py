from collections import deque

import ollama


class OllamaCorrectionService:
    """
    Handles transcription correction using a local Ollama model.
    Manages a rolling context window to improve correction accuracy.
    """

    def __init__(self, model: str = "gemma3n:e4b", context_size: int = 5):
        """
        Initializes the service.

        Args:
            model (str): The name of the Ollama model to use.
            context_size (int): The number of previous utterances to keep for context.
        """
        print(f"Initializing Ollama Correction Service with model '{model}'...")
        self.model = model
        self.client = ollama.AsyncClient()
        self.context = deque(maxlen=context_size)

    def add_to_context(self, original_transcription: str):
        """Adds a finalized transcription to the context window."""
        self.context.append(original_transcription)

    async def correct_text(self, text_to_correct: str) -> str:
        """
        Corrects a given text using the Ollama model with conversation context.
        """
        context_str = "\n".join(self.context)

        prompt = f"""
        You are an expert in correcting Chinese speech-to-text transcription errors.
        
        First, review the recent conversation history for context:
        --- CONVERSATIONAL CONTEXT ---
        {context_str}
        --- END CONTEXT ---

        Now, correct the following single sentence. It may contain common STT errors like homophones.
        
        SENTENCE TO CORRECT: "{text_to_correct}"
        
        Your task is to respond with ONLY the corrected version of the "SENTENCE TO CORRECT". Do not include the context, any explanation, or quotation marks in your output.
        """

        try:
            response = await self.client.chat(
                model=self.model,
                messages=[{"role": "user", "content": prompt}],
                options={"temperature": 0.2},
            )
            corrected_text = response["message"]["content"].strip()

            if corrected_text and corrected_text != text_to_correct:
                print(f"Correction made: '{text_to_correct}' -> '{corrected_text}'")
                return corrected_text
            else:
                print("No correction needed.")
                return text_to_correct

        except Exception as e:
            print(f"Error calling Ollama: {e}")
            return text_to_correct
