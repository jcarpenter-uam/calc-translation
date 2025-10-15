from models.transcription import IFlyTekTranscriptionService, TranscriptionResult

# TODO:
# For now, we are hard-coding the iFlyTek model.
# In the future, this could be a factory function that chooses a model
# based on configuration.
TranscriptionService = IFlyTekTranscriptionService
