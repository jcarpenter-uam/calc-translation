import { useState, useEffect, useRef } from "react";

/**
 * A custom hook to manage a WebSocket connection for live transcripts.
 * @param {string} url The WebSocket URL to connect to.
 * @returns {{
 * status: 'connecting' | 'connected' | 'disconnected';
 * transcripts: Array<{id: number, speaker: string, translation: string, transcription: string, isFinalized: boolean}>;
 * }}
 */
export function useTranscriptStream(url) {
  const [status, setStatus] = useState("connecting");
  const [transcripts, setTranscripts] = useState([]);
  const ws = useRef(null);
  const utteranceId = useRef(0);

  useEffect(() => {
    let reconnectTimeoutId;

    function connect() {
      if (typeof url !== "string") {
        setStatus("disconnected");
        return;
      }
      if (ws.current && ws.current.readyState !== WebSocket.CLOSED) {
        ws.current.close();
      }
      ws.current = new WebSocket(url);
      setStatus("connecting");

      ws.current.onopen = () => {
        console.log(`✅ WebSocket connected to ${url}`);
        setStatus("connected");
      };

      ws.current.onclose = () => {
        console.log(`WebSocket disconnected. Reconnecting in 3 seconds...`);
        setStatus("disconnected");
        reconnectTimeoutId = setTimeout(connect, 3000);
      };

      ws.current.onerror = (error) => {
        console.error(`WebSocket error on ${url}:`, error);
        ws.current.close();
      };

      ws.current.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);

          setTranscripts((prevTranscripts) => {
            const lastTranscript = prevTranscripts[prevTranscripts.length - 1];

            if (lastTranscript && !lastTranscript.isFinalized) {
              const updatedTranscript = {
                id: lastTranscript.id,
                speaker: data.speaker,
                translation: data.translation,
                transcription: data.transcription,
                isFinalized: data.isfinalize,
              };
              const updatedTranscripts = [...prevTranscripts];
              updatedTranscripts[prevTranscripts.length - 1] =
                updatedTranscript;
              return updatedTranscripts;
            } else {
              utteranceId.current++;
              const newTranscript = {
                id: utteranceId.current,
                speaker: data.speaker,
                translation: data.translation,
                transcription: data.transcription,
                isFinalized: data.isfinalize,
              };
              return [...prevTranscripts, newTranscript];
            }
          });
        } catch (error) {
          console.error("Failed to parse WebSocket message:", error);
        }
      };
    }

    connect();

    return () => {
      clearTimeout(reconnectTimeoutId);
      if (ws.current) {
        ws.current.onclose = null;
        ws.current.close();
      }
    };
  }, [url]);

  return { status, transcripts };
}
