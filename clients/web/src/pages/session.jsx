import React from "react";
import { useParams, useNavigate, useLocation } from "react-router-dom";
import { useState, useEffect, useCallback, useRef } from "react";
import DownloadVttButton from "../components/session/vtt-download.jsx";
import Transcript from "../components/session/transcript.jsx";
import Unauthorized from "../components/auth/unauthorized.jsx";
import Notification from "../components/misc/notification.jsx";
import BackfillLoading from "../components/session/backfill-loading.jsx";
import WaitingRoom from "../components/session/waiting.jsx";
import { useTranscriptStream } from "../hooks/use-transcript-stream.js";
import { useSmartScroll } from "../hooks/use-smart-scroll.js";
import { useLanguage } from "../context/language.jsx";
import { useTranslation } from "react-i18next";
import { BiMicrophone, BiMicrophoneOff, BiCopy, BiCheck } from "react-icons/bi";
import { useAuth } from "../context/auth.jsx";

function useQuery() {
  return new URLSearchParams(useLocation().search);
}

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

function HostAudioSender({ sessionId, integration }) {
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

function ReadableIdDisplay({ id }) {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);

  const copyToClipboard = () => {
    navigator.clipboard.writeText(id);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="mb-4 p-4 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg flex items-center justify-between">
      <div>
        <p className="text-xs text-blue-600 dark:text-blue-400 font-bold uppercase tracking-wide">
          {t("share_meeting_id") || "Share Meeting ID"}
        </p>
        <p className="text-2xl font-mono font-semibold text-zinc-900 dark:text-zinc-100">
          {id}
        </p>
      </div>
      <button
        onClick={copyToClipboard}
        className="p-2 text-blue-600 dark:text-blue-400 hover:bg-blue-100 dark:hover:bg-blue-800 rounded-full transition-colors"
        title={t("copy_to_clipboard")}
      >
        {copied ? (
          <BiCheck className="w-6 h-6" />
        ) : (
          <BiCopy className="w-6 h-6" />
        )}
      </button>
    </div>
  );
}

export default function SessionPage() {
  const params = useParams();
  const integration = params.integration;
  const sessionId = params["*"];
  const navigate = useNavigate();
  const location = useLocation();

  const query = useQuery();
  const token = query.get("token");

  const isHost = query.get("isHost") === "true";
  const readableId = location.state?.readableId;

  const [isAuthorized, setIsAuthorized] = useState(!!token);
  const [showUnauthorized, setShowUnauthorized] = useState(false);
  const { language } = useLanguage();
  const { t } = useTranslation();

  const handleAuthFailure = useCallback(() => {
    setIsAuthorized(false);
    setShowUnauthorized(true);
  }, []);

  useEffect(() => {
    if (!isAuthorized) {
      setShowUnauthorized(true);
      const timer = setTimeout(() => {
        navigate("/");
      }, 5000);

      return () => clearTimeout(timer);
    }
  }, [isAuthorized, navigate]);

  const encodedSessionId = isAuthorized ? encodeURIComponent(sessionId) : null;

  const wsUrl = isAuthorized
    ? `/ws/view/${integration}/${encodedSessionId}?token=${token}&language=${language}`
    : null;

  const { transcripts, isDownloadable, isBackfilling, sessionStatus } =
    useTranscriptStream(wsUrl, sessionId, handleAuthFailure);

  const lastTopTextRef = React.useRef(null);
  const notification = useSmartScroll(transcripts, lastTopTextRef);

  if (showUnauthorized) {
    return <Unauthorized message={t("access_denied_session_message")} />;
  }

  if (!isAuthorized) {
    return null;
  }

  if (sessionStatus === "waiting" && !isHost) {
    return (
      <div className="max-w-3xl mx-auto w-full">
        <WaitingRoom />
      </div>
    );
  }

  return (
    <>
      <div className="max-w-3xl mx-auto w-full relative pb-24">
        {/* Host Controls */}
        {isHost && readableId && <ReadableIdDisplay id={readableId} />}
        {isHost && (
          <HostAudioSender sessionId={sessionId} integration={integration} />
        )}

        {isBackfilling && <BackfillLoading />}
        {transcripts
          .filter((t) => !isBackfilling || !t.isBackfill)
          .map((t, index, array) => (
            <Transcript
              key={t.id}
              {...t}
              topTextRef={index === array.length - 1 ? lastTopTextRef : null}
            />
          ))}
        {isDownloadable && (
          <div className="mt-8 mb-12 mx-4 sm:mx-0 p-6 rounded-lg bg-white dark:bg-zinc-800 border border-gray-200 dark:border-zinc-700 shadow-sm text-center">
            <div className="flex flex-col items-center justify-center space-y-3">
              <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
                {t("meeting_ended")}
              </h3>

              <p className="text-sm text-gray-600 dark:text-gray-400 max-w-md leading-snug">
                {t("meeting_ended_description")}
              </p>

              <div className="pt-2">
                <DownloadVttButton
                  isDownloadable={isDownloadable}
                  integration={integration}
                  sessionId={sessionId}
                  token={token}
                />
              </div>
            </div>
          </div>
        )}
      </div>
      <Notification
        message={notification.message}
        visible={notification.visible}
      />
    </>
  );
}
