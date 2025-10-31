import { useState, useEffect, useRef } from "react";

/**
 * A custom hook to manage a WebSocket connection for live transcripts.
 * @param {string} url The WebSocket URL to connect to.
 * @returns {{
 * status: 'connecting' | 'connected' | 'disconnected';
 * transcripts: Array<{
 * id: string,
 * speaker: string,
 * translation: string,
 * transcription: string,
 * source_language: string,
 * target_language: string,
 * isFinalized: boolean,
 * type: 'update' | 'final' | 'correction' | 'status_update',
 * original?: { translation: string, transcription: string },
 * correctionStatus?: 'correcting' | 'corrected' | null
 * }>;
 * }}
 */
export function useTranscriptStream(url) {
  const [status, setStatus] = useState("connecting");
  const [transcripts, setTranscripts] = useState([]);
  const ws = useRef(null);

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

      setTranscripts([]);
      ws.current = new WebSocket(url);
      setStatus("connecting");

      ws.current.onopen = () => {
        console.log(`WebSocket connected`);
        setStatus("connected");
      };

      ws.current.onclose = () => {
        console.log(`WebSocket disconnected. Reconnecting in 3 seconds...`);
        setStatus("disconnected");
        reconnectTimeoutId = setTimeout(connect, 3000);
      };

      ws.current.onerror = (error) => {
        console.error(`WebSocket error on:`, error);
        ws.current.close();
      };

      ws.current.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);

          if (!data.message_id || !data.type) return;

          setTranscripts((prevTranscripts) => {
            const existingIndex = prevTranscripts.findIndex(
              (t) => t.id === data.message_id,
            );

            if (existingIndex === -1) {
              const newTranscript = {
                id: data.message_id,
                speaker: data.speaker,
                translation: data.translation,
                transcription: data.transcription,
                source_language: data.source_language,
                target_language: data.target_language,
                isFinalized: data.isfinalize,
                type: data.type,
                correctionStatus: data.correction_status || null,
              };
              return [...prevTranscripts, newTranscript];
            }

            const newTranscripts = [...prevTranscripts];
            const originalTranscript = prevTranscripts[existingIndex];
            let updatedTranscript;

            switch (data.type) {
              case "status_update":
                updatedTranscript = {
                  ...originalTranscript,
                  correctionStatus: data.correction_status,
                };
                break;

              case "correction":
                updatedTranscript = {
                  ...originalTranscript,
                  original: {
                    transcription: originalTranscript.transcription,
                    translation: originalTranscript.translation,
                  },
                  transcription: data.transcription,
                  translation: data.translation,
                  type: "correction",
                  correctionStatus: "corrected",
                };
                break;

              default:
                updatedTranscript = {
                  ...originalTranscript,
                  transcription: data.transcription,
                  translation: data.translation,
                  source_language: data.source_language,
                  target_language: data.target_language,
                  isFinalized: data.isfinalize,
                  type: data.type,
                };
                break;
            }

            newTranscripts[existingIndex] = updatedTranscript;
            return newTranscripts;
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
