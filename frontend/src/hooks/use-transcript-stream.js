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
 * isFinalized: boolean,
 * type: 'update' | 'final' | 'correction',
 * original?: { translation: string, transcription: string }
 * }>;
 * }}
 */
function resolveWebSocketUrl(target) {
  if (typeof target !== "string" || target.length === 0) {
    return null;
  }

  if (/^wss?:\/\//i.test(target)) {
    return target;
  }

  if (typeof window === "undefined" || !window.location) {
    return null;
  }

  const protocol = window.location.protocol === "https:" ? "wss" : "ws";
  const path = target.startsWith("/") ? target : `/${target}`;
  return `${protocol}://${window.location.host}${path}`;
}

export function useTranscriptStream(url) {
  const [status, setStatus] = useState("connecting");
  const [transcripts, setTranscripts] = useState([]);
  const ws = useRef(null);

  useEffect(() => {
    let reconnectTimeoutId;

    function connect() {
      const resolvedUrl = resolveWebSocketUrl(url);

      if (!resolvedUrl) {
        setStatus("disconnected");
        return;
      }
      if (ws.current && ws.current.readyState !== WebSocket.CLOSED) {
        ws.current.close();
      }
      ws.current = new WebSocket(resolvedUrl);
      setStatus("connecting");

      ws.current.onopen = () => {
        console.log(`✅ WebSocket connected to ${resolvedUrl}`);
        setStatus("connected");
      };

      ws.current.onclose = () => {
        console.log(`WebSocket disconnected. Reconnecting in 3 seconds...`);
        setStatus("disconnected");
        reconnectTimeoutId = setTimeout(connect, 3000);
      };

      ws.current.onerror = (error) => {
        console.error(`WebSocket error on ${resolvedUrl}:`, error);
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

            // Handle Correction: Find the existing message and update it
            if (data.type === "correction") {
              if (existingIndex !== -1) {
                const originalTranscript = prevTranscripts[existingIndex];
                const updatedTranscript = {
                  ...originalTranscript,
                  original: {
                    // Store the old text
                    transcription: originalTranscript.transcription,
                    translation: originalTranscript.translation,
                  },
                  transcription: data.transcription, // Set the new text
                  translation: data.translation,
                  type: "correction",
                };

                const newTranscripts = [...prevTranscripts];
                newTranscripts[existingIndex] = updatedTranscript;
                return newTranscripts;
              }
              return prevTranscripts;
            }

            // Handle Update or Final: Update existing or add new
            if (existingIndex !== -1) {
              // Update an existing transcript (e.g., streaming updates)
              const updatedTranscript = {
                ...prevTranscripts[existingIndex],
                transcription: data.transcription,
                translation: data.translation,
                isFinalized: data.isfinalize,
                type: data.type,
              };
              const newTranscripts = [...prevTranscripts];
              newTranscripts[existingIndex] = updatedTranscript;
              return newTranscripts;
            } else {
              // Add a new transcript
              const newTranscript = {
                id: data.message_id,
                speaker: data.speaker,
                translation: data.translation,
                transcription: data.transcription,
                isFinalized: data.isfinalize,
                type: data.type,
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
