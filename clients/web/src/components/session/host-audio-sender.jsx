import { useState, useRef, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { BiMicrophone, BiMicrophoneOff } from "react-icons/bi";
import { useAuth } from "../../context/auth.jsx";

function floatTo16BitPCM(input) {
  const output = new Int16Array(input.length);
  for (let i = 0; i < input.length; i++) {
    const s = Math.max(-1, Math.min(1, input[i]));
    output[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
  }
  return output.buffer;
}

function arrayBufferToBase64(buffer) {
  let binary = "";
  const bytes = new Uint8Array(buffer);
  const len = bytes.byteLength;
  for (let i = 0; i < len; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return window.btoa(binary);
}

export default function HostAudioSender({ sessionId, integration }) {
  const { t } = useTranslation();
  const [isRecording, setIsRecording] = useState(false);
  const [status, setStatus] = useState("disconnected");

  const wsRef = useRef(null);
  const audioContextRef = useRef(null);
  const processorRef = useRef(null);
  const sourceRef = useRef(null);
  const streamRef = useRef(null);

  const { user } = useAuth();

  useEffect(() => {
    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const wsUrl = `${protocol}//${window.location.host}/ws/transcribe/${integration}/${sessionId}`;

    console.log("Host connecting to:", wsUrl);
    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;

    ws.onopen = () => {
      console.log("Host Audio WS connected");
      setStatus("connected");
    };

    ws.onerror = (err) => {
      console.error("Host Audio WS error", err);
      setStatus("error");
    };

    ws.onclose = (event) => {
      console.log("Host Audio WS closed", event.code, event.reason);
      setStatus("disconnected");
      stopRecording();
    };

    return () => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.close();
      }
      stopRecording();
    };
  }, [integration, sessionId]);

  const startRecording = async () => {
    try {
      const AudioContext = window.AudioContext || window.webkitAudioContext;
      const ctx = new AudioContext({ sampleRate: 16000 });
      audioContextRef.current = ctx;

      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          sampleRate: 16000,
          echoCancellation: true,
          noiseSuppression: true,
        },
      });
      streamRef.current = stream;

      const source = ctx.createMediaStreamSource(stream);
      sourceRef.current = source;

      const processor = ctx.createScriptProcessor(4096, 1, 1);
      processorRef.current = processor;

      processor.onaudioprocess = (e) => {
        if (wsRef.current?.readyState === WebSocket.OPEN) {
          const inputData = e.inputBuffer.getChannelData(0);

          const pcmBuffer = floatTo16BitPCM(inputData);
          const base64Audio = arrayBufferToBase64(pcmBuffer);

          wsRef.current.send(
            JSON.stringify({
              audio: base64Audio,
              userName: user?.name || "Host",
            }),
          );
        }
      };

      source.connect(processor);
      processor.connect(ctx.destination);

      setIsRecording(true);
    } catch (err) {
      console.error("Failed to start microphone", err);
      alert(t("mic_access_error") || "Could not access microphone.");
    }
  };

  const stopRecording = () => {
    if (processorRef.current) {
      processorRef.current.disconnect();
      processorRef.current = null;
    }
    if (sourceRef.current) {
      sourceRef.current.disconnect();
      sourceRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }
    if (audioContextRef.current) {
      audioContextRef.current.close();
      audioContextRef.current = null;
    }
    setIsRecording(false);
  };

  const toggleRecording = () => {
    if (isRecording) {
      stopRecording();
    } else {
      startRecording();
    }
  };

  if (status === "error") {
    return (
      <div className="text-red-500 text-sm font-bold text-center mt-4">
        {t("audio_connection_error") || "Audio Connection Error"}
      </div>
    );
  }

  return (
    <div className="fixed bottom-6 left-1/2 transform -translate-x-1/2 z-50">
      <button
        onClick={toggleRecording}
        disabled={status !== "connected"}
        className={`flex items-center gap-2 px-6 py-3 rounded-full shadow-lg font-semibold transition-all transform hover:scale-105 ${
          isRecording
            ? "bg-red-500 hover:bg-red-600 text-white animate-pulse"
            : status !== "connected"
              ? "bg-zinc-400 cursor-not-allowed text-zinc-100"
              : "bg-blue-600 hover:bg-blue-700 text-white"
        }`}
      >
        {isRecording ? (
          <BiMicrophoneOff className="w-5 h-5" />
        ) : (
          <BiMicrophone className="w-5 h-5" />
        )}
        {isRecording
          ? t("stop_broadcast") || "Stop Broadcast"
          : t("start_broadcast") || "Start Broadcast"}
      </button>
    </div>
  );
}
