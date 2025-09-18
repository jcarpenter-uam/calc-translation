import os
import sys

import dashscope
from dashscope.audio.asr import Recognition, RecognitionCallback, RecognitionResult
from dotenv import load_dotenv

load_dotenv()

dashscope.api_key = os.getenv("DASHSCOPE_API_KEY")

is_recognition_active = False


class Callback(RecognitionCallback):
    def on_open(self) -> None:
        global is_recognition_active
        is_recognition_active = True
        print("Recognition service connected. Ready to receive audio from stdin...")

    def on_close(self) -> None:
        global is_recognition_active
        is_recognition_active = False
        print("Recognition service closed.")

    def on_event(self, result: RecognitionResult) -> None:
        sentence = result.get_sentence()
        if sentence:
            print(f"Transcript: {sentence}")


print("Starting real-time speech recognition...")
callback = Callback()
recognition = Recognition(
    model="paraformer-realtime-v2", format="pcm", sample_rate=16000, callback=callback
)

recognition.start()

try:
    while True:
        audio_data = sys.stdin.buffer.read(3200)
        if not audio_data:
            print("End of audio stream from stdin.")
            break

        if is_recognition_active:
            recognition.send_audio_frame(audio_data)
        else:
            break

except (KeyboardInterrupt, BrokenPipeError):
    print("\nStopping recognition.")
except Exception as e:
    print(f"An error occurred: {e}")
finally:
    if is_recognition_active:
        recognition.stop()

print("Program finished.")
