import { useState, useEffect, useRef } from "react";

/**
 * A custom hook to manage a WebSocket connection for live transcripts.
 * @param {string} wsUrl The WebSocket URL to connect to.
 * @param {string} sessionId The session ID (used for dependencies).
 * @param {function} onUnauthorized Callback to trigger when auth fails (403/1008).
 * @returns {{
 * transcripts: Array<Object>;
 * isDownloadable: boolean;
 * }}
 */
export function useTranscriptStream(wsUrl, sessionId, onUnauthorized) {
  const [transcripts, setTranscripts] = useState([]);
  const [isDownloadable, setIsDownloadable] = useState(false);
  const hideTimerRef = useRef(null);

  const ws = useRef(null);

  useEffect(() => {
    if (!wsUrl) {
      return;
    }

    let reconnectTimeoutId;

    function connect() {
      if (typeof wsUrl !== "string") {
        return;
      }
      if (ws.current && ws.current.readyState !== WebSocket.CLOSED) {
        ws.current.close();
      }

      setTranscripts([]);
      ws.current = new WebSocket(wsUrl);

      ws.current.onopen = () => {
        console.log(`WebSocket connected to ${wsUrl}`);
      };

      ws.current.onclose = (event) => {
        const code = event.code;

        // BUG: code = 1006 should be fixed
        if (code === 1008 || code === 403) {
          console.warn("WebSocket authorization failed.");
          if (onUnauthorized) {
            onUnauthorized();
          }
          return;
        }

        if (code === 4001 || code === 4008) {
          console.error(
            `WebSocket connection failed permanently: ${event.reason} (${code})`,
          );
          return;
        }

        if (code === 1000) {
          console.log("WebSocket closed normally.");
          return;
        }

        console.log(
          `WebSocket disconnected (Code: ${code}). Reconnecting in 3 seconds...`,
        );
        reconnectTimeoutId = setTimeout(connect, 3000);
      };

      ws.current.onerror = (error) => {
        console.error(`WebSocket error on ${wsUrl}:`, error);
        ws.current.close();
      };

      ws.current.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);

          if (data.type === "session_end") {
            setIsDownloadable(true);
            return;
          }

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
  }, [wsUrl, sessionId, onUnauthorized]);

  return { transcripts, isDownloadable };
}
