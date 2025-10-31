import { useState, useEffect, useRef } from "react";
import log from "electron-log/renderer";

/**
 * A custom hook to manage a WebSocket connection for live transcripts.
 */
export function useTranscriptStream(url) {
  const [status, setStatus] = useState("connecting");
  const [transcripts, setTranscripts] = useState([]);
  const ws = useRef(null);

  useEffect(() => {
    let reconnectTimeoutId;

    function connect() {
      if (typeof url !== "string") {
        log.warn("useTranscriptStream: No URL provided, disconnecting.");
        setStatus("disconnected");
        return;
      }
      if (ws.current && ws.current.readyState !== WebSocket.CLOSED) {
        log.info("useTranscriptStream: Closing existing WebSocket.");
        ws.current.close();
      }

      log.info(`useTranscriptStream: Connecting to ${url}...`);
      setTranscripts([]);
      ws.current = new WebSocket(url);
      setStatus("connecting");

      ws.current.onopen = () => {
        log.info(`useTranscriptStream: WebSocket connected to ${url}.`);
        setStatus("connected");
      };

      ws.current.onclose = () => {
        log.warn(
          `useTranscriptStream: WebSocket disconnected. Reconnecting in 3 seconds...`,
        );
        setStatus("disconnected");
        reconnectTimeoutId = setTimeout(connect, 3000);
      };

      ws.current.onerror = (error) => {
        log.error(`useTranscriptStream: WebSocket error:`, error);
        ws.current.close();
      };

      ws.current.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);

          if (!data.message_id || !data.type) return;
          log.debug(
            "useTranscriptStream: Received message",
            data.type,
            data.message_id,
          );

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
          log.error(
            "useTranscriptStream: Failed to parse WebSocket message:",
            error,
          );
        }
      };
    }

    connect();

    return () => {
      log.info("useTranscriptStream: Cleaning up WebSocket effect.");
      clearTimeout(reconnectTimeoutId);
      if (ws.current) {
        ws.current.onclose = null;
        ws.current.close();
      }
    };
  }, [url]);

  return { status, transcripts };
}
