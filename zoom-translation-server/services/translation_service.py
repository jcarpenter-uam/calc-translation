from models.translation import HuggingFaceTranslationModel, QwenTranslationModel

# TODO:
# For now, we are hard-coding the Qwen model.
# In the future, this could be a factory function that chooses a model
# based on configuration.
TranslationService = HuggingFaceTranslationModel
