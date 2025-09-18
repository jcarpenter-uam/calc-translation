import base64
import contextlib
import os
import queue
import signal
import subprocess
import sys
import threading
import time

import dashscope
from dashscope.audio.qwen_omni import *
from dotenv import load_dotenv

load_dotenv()

dashscope.api_key = os.getenv("DASHSCOPE_API_KEY")
voice = "Chelsie"
conversation = None
b64_player = None

TRANSLATION_PROMPT = (
    "You are a real-time translator. Translate any Chinese you receive into English."
)


class SubprocessPCMPlayer:
    def __init__(self, sample_rate=24000, chunk_size_ms=100):
        self.sample_rate = sample_rate
        self.chunk_size_bytes = chunk_size_ms * sample_rate * 2 // 1000
        command = ["aplay", "-r", str(self.sample_rate), "-f", "S16_LE", "-t", "raw"]
        self.player_process = subprocess.Popen(
            command,
            stdin=subprocess.PIPE,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )
        self.raw_audio_buffer: queue.Queue = queue.Queue()
        self.b64_audio_buffer: queue.Queue = queue.Queue()
        self.status = "playing"
        self.decoder_thread = threading.Thread(target=self.decoder_loop)
        self.player_thread = threading.Thread(target=self.player_loop)
        self.decoder_thread.start()
        self.player_thread.start()
        self.complete_event: threading.Event = None

    def decoder_loop(self):
        while self.status != "stop":
            try:
                recv_audio_b64 = self.b64_audio_buffer.get(timeout=0.1)
                recv_audio_raw = base64.b64decode(recv_audio_b64)
                for i in range(0, len(recv_audio_raw), self.chunk_size_bytes):
                    chunk = recv_audio_raw[i : i + self.chunk_size_bytes]
                    self.raw_audio_buffer.put(chunk)
            except queue.Empty:
                continue

    def player_loop(self):
        while self.status != "stop":
            try:
                recv_audio_raw = self.raw_audio_buffer.get(timeout=0.1)
                if self.player_process.stdin:
                    self.player_process.stdin.write(recv_audio_raw)
                    self.player_process.stdin.flush()
            except queue.Empty:
                if self.complete_event:
                    self.complete_event.set()
                continue
            except (BrokenPipeError, AttributeError):
                print("Player process terminated.")
                break

    def cancel_playing(self):
        self.b64_audio_buffer.queue.clear()
        self.raw_audio_buffer.queue.clear()

    def add_data(self, data):
        self.b64_audio_buffer.put(data)

    def wait_for_complete(self):
        self.complete_event = threading.Event()
        self.complete_event.wait()
        self.complete_event = None

    def shutdown(self):
        self.status = "stop"
        self.decoder_thread.join()
        self.player_thread.join()
        if self.player_process:
            self.player_process.terminate()
            self.player_process.wait()


class MyCallback(OmniRealtimeCallback):
    def on_close(self, close_status_code, close_msg) -> None:
        print(f"Connection closed with code: {close_status_code}, msg: {close_msg}")
        sys.exit(0)

    def on_event(self, response: str) -> None:
        try:
            global conversation
            global b64_player
            type = response["type"]
            if "session.created" == type:
                print(f"Start session: {response['session']['id']}")
            if "conversation.item.input_audio_transcription.completed" == type:
                print(f"Source (Chinese): {response['transcript']}")
            if "response.audio_transcript.delta" == type:
                print(f"Translation (English): {response['delta']}", end="", flush=True)
            if "response.audio.delta" == type:
                b64_player.add_data(response["delta"])
            if "input_audio_buffer.speech_started" == type:
                print("\n======VAD Speech Start======")
                b64_player.cancel_playing()
            if "response.done" == type:
                print("\n======TRANSLATION DONE======")
        except Exception as e:
            print(f"[Error] {e}")
            return


if __name__ == "__main__":
    print("Initializing Chinese -> English translation bot...")
    b64_player = SubprocessPCMPlayer()
    callback = MyCallback()
    conversation = OmniRealtimeConversation(
        model="qwen-omni-turbo-realtime-latest",
        callback=callback,
        url="wss://dashscope-intl.aliyuncs.com/api-ws/v1/realtime",
    )
    conversation.connect()

    conversation.update_session(
        system_prompt=TRANSLATION_PROMPT,
        input_language="zh",
        output_modalities=[MultiModality.AUDIO, MultiModality.TEXT],
        voice=voice,
        input_audio_format=AudioFormat.PCM_16000HZ_MONO_16BIT,
        output_audio_format=AudioFormat.PCM_24000HZ_MONO_16BIT,
        enable_input_audio_transcription=True,
        input_audio_transcription_model="gummy-realtime-v1",
        enable_turn_detection=True,
        turn_detection_type="server_vad",
    )

    def signal_handler(sig, frame):
        print("Ctrl+C pressed, stopping translation...")
        conversation.close()
        b64_player.shutdown()
        print("Translation stopped.")
        sys.exit(0)

    signal.signal(signal.SIGINT, signal_handler)
    print("Starting audio capture. Speak Chinese into your microphone.")
    print("Press 'Ctrl+C' to stop...")

    while True:
        try:
            audio_data = sys.stdin.buffer.read(3200)
            if not audio_data:
                print("Audio input pipe closed.")
                break
            audio_b64 = base64.b64encode(audio_data).decode("ascii")
            conversation.append_audio(audio_b64)
        except (KeyboardInterrupt, BrokenPipeError):
            print("Stopping...")
            break
    signal_handler(None, None)
