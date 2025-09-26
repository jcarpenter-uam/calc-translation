from models.corrections import OllamaCorrectionService

# TODO:
# For now, we are hard-coding the iFlyTek model.
# In the future, this could be a factory function that chooses a model
# based on configuration.
CorrectionService = OllamaCorrectionService
