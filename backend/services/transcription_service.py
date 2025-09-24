from models.transcription import IFlyTekTranscriptionService, TranscriptionResult

STATUS_FIRST_FRAME = 0
STATUS_CONTINUE_FRAME = 1
STATUS_LAST_FRAME = 2

# TODO:
# For now, we are hard-coding the iFlyTek model.
# In the future, this could be a factory function that chooses a model
# based on configuration.
TranscriptionService = IFlyTekTranscriptionService
