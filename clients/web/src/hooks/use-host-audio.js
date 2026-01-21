import { useState, useRef, useEffect } from "react";

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

function downsampleBuffer(buffer, inputSampleRate, outputSampleRate) {
  if (outputSampleRate === inputSampleRate) {
    return buffer;
  }
  const sampleRateRatio = inputSampleRate / outputSampleRate;
  const newLength = Math.round(buffer.length / sampleRateRatio);
  const result = new Float32Array(newLength);
  let offsetResult = 0;
  let offsetBuffer = 0;

  while (offsetResult < result.length) {
    const nextOffsetBuffer = Math.round((offsetResult + 1) * sampleRateRatio);
    let accum = 0,
      count = 0;

    for (let i = offsetBuffer; i < nextOffsetBuffer && i < buffer.length; i++) {
      accum += buffer[i];
      count++;
    }

    result[offsetResult] = count > 0 ? accum / count : 0;
    offsetResult++;
    offsetBuffer = nextOffsetBuffer;
  }
  return result;
}

const SILENCE_SAMPLES = new Float32Array(4096).fill(0);
const SILENCE_PCM = floatTo16BitPCM(SILENCE_SAMPLES);
const SILENCE_BASE64 = arrayBufferToBase64(SILENCE_PCM);

export function useHostAudio(sessionId, integration) {
  const [isAudioInitialized, setIsAudioInitialized] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const [status, setStatus] = useState("disconnected");

  const wsRef = useRef(null);
  const audioContextRef = useRef(null);
  const processorRef = useRef(null);
  const sourceRef = useRef(null);
  const streamRef = useRef(null);
  const analyserRef = useRef(null);
  const canvasRef = useRef(null);
  const animationFrameRef = useRef(null);

  const isMutedRef = useRef(false);
  const isAudioInitializedRef = useRef(false);
  const hasConnectedOnceRef = useRef(false);

  useEffect(() => {
    if (!sessionId || !integration) return;

    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const wsUrl = `${protocol}//${window.location.host}/ws/transcribe/${integration}/${sessionId}`;

    console.log("Host connecting to:", wsUrl);
    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;

    const keepAliveInterval = setInterval(() => {
      if (
        wsRef.current?.readyState === WebSocket.OPEN &&
        !isAudioInitializedRef.current
      ) {
        wsRef.current.send(
          JSON.stringify({
            audio: SILENCE_BASE64,
          }),
        );
      }
    }, 250);

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
      stopAudio();
    };

    return () => {
      clearInterval(keepAliveInterval);
      if (ws.readyState === WebSocket.OPEN) {
        ws.close();
      }
      stopAudio();
    };
  }, [integration, sessionId]);

  useEffect(() => {
    if (isAudioInitialized && canvasRef.current && analyserRef.current) {
      drawVisualizer();
    }
    return () => {
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }
    };
  }, [isAudioInitialized]);

  const drawVisualizer = () => {
    if (!canvasRef.current || !analyserRef.current) return;

    const canvas = canvasRef.current;
    const canvasCtx = canvas.getContext("2d");
    const analyser = analyserRef.current;

    analyser.smoothingTimeConstant = 0.8;
    analyser.fftSize = 32;

    const bufferLength = analyser.frequencyBinCount;
    const dataArray = new Uint8Array(bufferLength);

    const draw = () => {
      animationFrameRef.current = requestAnimationFrame(draw);
      analyser.getByteFrequencyData(dataArray);
      canvasCtx.clearRect(0, 0, canvas.width, canvas.height);

      if (isMutedRef.current) {
        canvasCtx.fillStyle = "rgba(239, 68, 68, 0.1)";
        canvasCtx.fillRect(0, canvas.height / 2 - 1, canvas.width, 2);
        return;
      }

      const barWidth = (canvas.width / bufferLength) * 0.6;
      const gap = (canvas.width / bufferLength) * 0.4;
      let x = 0;

      for (let i = 0; i < bufferLength; i++) {
        const percent = dataArray[i] / 255;
        const barHeight = Math.max(4, percent * canvas.height);
        const y = (canvas.height - barHeight) / 2;

        canvasCtx.fillStyle = `rgba(255, 255, 255, ${0.3 + percent * 0.7})`;

        canvasCtx.beginPath();
        canvasCtx.roundRect(x, y, barWidth, barHeight, 10);
        canvasCtx.fill();

        x += barWidth + gap;
      }
    };
    draw();
  };

  const startAudio = async () => {
    try {
      if (wsRef.current?.readyState === WebSocket.OPEN) {
        const type = hasConnectedOnceRef.current
          ? "session_reconnected"
          : "session_start";

        const meta = {
          meeting_uuid: sessionId,
          streamId: "browser-guest",
          workerPid: "browser",
        };

        console.log(`Sending ${type} to backend...`);
        wsRef.current.send(
          JSON.stringify({
            type: type,
            payload: meta,
          }),
        );
        hasConnectedOnceRef.current = true;
      }

      const AudioContext = window.AudioContext || window.webkitAudioContext;
      const ctx = new AudioContext();
      audioContextRef.current = ctx;

      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
        },
      });
      streamRef.current = stream;
      const source = ctx.createMediaStreamSource(stream);
      sourceRef.current = source;

      const analyser = ctx.createAnalyser();
      analyser.fftSize = 64;
      source.connect(analyser);
      analyserRef.current = analyser;

      const processor = ctx.createScriptProcessor(4096, 1, 1);
      processorRef.current = processor;

      processor.onaudioprocess = (e) => {
        if (wsRef.current?.readyState === WebSocket.OPEN) {
          let inputData;
          if (isMutedRef.current) {
            inputData = new Float32Array(4096).fill(0);
          } else {
            inputData = e.inputBuffer.getChannelData(0);
          }

          const downsampledData = downsampleBuffer(
            inputData,
            ctx.sampleRate,
            16000,
          );

          const pcmBuffer = floatTo16BitPCM(downsampledData);
          const base64Audio = arrayBufferToBase64(pcmBuffer);

          wsRef.current.send(
            JSON.stringify({
              audio: base64Audio,
            }),
          );
        }
      };

      source.connect(processor);
      processor.connect(ctx.destination);

      setIsAudioInitialized(true);
      isAudioInitializedRef.current = true;
      setIsMuted(false);
      isMutedRef.current = false;
    } catch (err) {
      console.error("Failed to start microphone", err);
      alert("Could not access microphone.");
    }
  };

  const stopAudio = () => {
    if (animationFrameRef.current) {
      cancelAnimationFrame(animationFrameRef.current);
    }
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
    setIsAudioInitialized(false);
    isAudioInitializedRef.current = false;
  };

  const toggleMute = () => {
    const nextState = !isMuted;
    setIsMuted(nextState);
    isMutedRef.current = nextState;
  };

  const disconnectSession = () => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      console.log("Sending session_end to backend...");
      wsRef.current.send(JSON.stringify({ type: "session_end" }));
    }
    if (wsRef.current) {
      wsRef.current.close(1000, "User ended session");
    }
    stopAudio();
    setStatus("disconnected");
  };

  return {
    isAudioInitialized,
    isMuted,
    status,
    canvasRef,
    startAudio,
    toggleMute,
    disconnectSession,
  };
}
