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
  const [isBackfilling, setIsBackfilling] = useState(false);
  const [sessionStatus, setSessionStatus] = useState("connecting");
  const [isSharedTwoWayMode, setIsSharedTwoWayMode] = useState(false);
  const [isStopped, setIsStopped] = useState(false);

  const ws = useRef(null);

  useEffect(() => {
    if (!wsUrl || isStopped) return;

    let reconnectTimeoutId;

    function connect() {
      if (isStopped || !wsUrl) return;

      if (typeof wsUrl !== "string") {
        return;
      }
      if (ws.current && ws.current.readyState !== WebSocket.CLOSED) {
        ws.current.onclose = null;
        ws.current.close();
      }

      setTranscripts([]);
      setSessionStatus("connecting");
      ws.current = new WebSocket(wsUrl);

      ws.current.onclose = (event) => {
        const code = event.code;

        if (code === 1008 || code === 403 || code === 1006) {
          console.warn("WebSocket authorization failed.");
          setIsStopped(true);
          if (onUnauthorized) onUnauthorized();
          return;
        }

        if (code === 4004) {
          console.warn("Session not found (4004). It has likely ended.");
          setIsDownloadable(true);
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

          if (data.type === "status") {
            setSessionStatus(data.status);
            if (typeof data.shared_two_way_mode === "boolean") {
              setIsSharedTwoWayMode(data.shared_two_way_mode);
            }
            return;
          }

          if (data.type === "session_start") {
            setSessionStatus("active");
            return;
          }

          if (data.type === "session_end") {
            setIsDownloadable(true);
            return;
          }

          if (data.type === "backfill_start") {
            setIsBackfilling(true);
            return;
          }
          if (data.type === "backfill_end") {
            setIsBackfilling(false);
            return;
          }

          if (!data.message_id || !data.type) return;

          setTranscripts((prevTranscripts) => {
            let newTranscripts = [...prevTranscripts];
            const existingIndex = newTranscripts.findIndex(
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
                isBackfill: data.is_backfill || false,
              };
              newTranscripts.push(newTranscript);
            } else {
              const originalTranscript = newTranscripts[existingIndex];
              const updatedTranscript = {
                ...originalTranscript,
                transcription: data.transcription,
                translation: data.translation,
                source_language: data.source_language,
                target_language: data.target_language,
                isFinalized: data.isfinalize,
                type: data.type,
              };
              newTranscripts[existingIndex] = updatedTranscript;
            }

            newTranscripts.sort((a, b) => {
              const numA = parseInt(a.id.split("_")[0], 10) || 0;
              const numB = parseInt(b.id.split("_")[0], 10) || 0;
              return numA - numB;
            });

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
  }, [wsUrl, sessionId, onUnauthorized, isStopped]);

  return {
    transcripts,
    isDownloadable,
    isBackfilling,
    sessionStatus,
    isSharedTwoWayMode,
  };
}
