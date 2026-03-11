#!/bin/bash

API_URL="http://localhost:8000/api/meeting"
WS_URL="ws://localhost:8000/ws"
MP3_FILE="sample.mp3"
RAW_FILE="sample.raw"

echo "Downloading sample audio..."
curl -s -o $MP3_FILE https://soniox.com/media/examples/coffee_shop.mp3

echo "Converting MP3 to raw PCM (16kHz, 16-bit, mono)..."
# This perfectly matches the audio_format: 'pcm_s16le' and sample_rate: 16000
ffmpeg -y -i $MP3_FILE -f s16le -acodec pcm_s16le -ar 16000 -ac 1 $RAW_FILE > /dev/null 2>&1

echo "Starting meeting..."
MEETING_ID=$(curl -s -X POST "$API_URL/start" | jq -r '.id')

if [ -z "$MEETING_ID" ] || [ "$MEETING_ID" == "null" ]; then
  echo "Failed to start meeting! Is the server running on port 8000?"
  exit 1
fi

echo "Meeting started with ID: $MEETING_ID"

echo "Connecting to WS and streaming audio for 5 seconds..."
cat << 'EOF' > ws_test.mjs
import WebSocket from 'ws';
import fs from 'fs';

const wsUrl = process.argv[2];
const meetingId = process.argv[3];
const audioFile = process.argv[4];

const ws = new WebSocket(wsUrl);
const audioData = fs.readFileSync(audioFile);

ws.on('open', () => {
  console.log(' - WebSocket connected');
  
  ws.send(JSON.stringify({ 
    action: 'subscribe_meeting', 
    meetingId: meetingId,
    participantId: 'bash-tester'
  }));

  setTimeout(() => {
    console.log(' - Started streaming PCM audio chunks...');
    
    let offset = 0;
    // 16000 samples/sec * 2 bytes/sample = 32000 bytes/sec
    // 3200 bytes every 100ms is exactly real-time pace
    const chunkSize = 3200; 
    const intervalMs = 100; 
    const streamDuration = 5000; 
    
    const streamInterval = setInterval(() => {
      if (offset < audioData.length) {
        const end = Math.min(offset + chunkSize, audioData.length);
        ws.send(audioData.subarray(offset, end));
        offset += chunkSize;
      } else {
        offset = 0; 
      }
    }, intervalMs);

    setTimeout(() => {
      clearInterval(streamInterval);
      console.log('\n - 5 seconds reached. Finished streaming audio.');
      setTimeout(() => ws.close(), 1000);
    }, streamDuration);

  }, 500); 
});

ws.on('message', (data) => {
  const message = data.toString();
  try {
    const parsed = JSON.parse(message);
    if (parsed.type === 'transcription') {
      console.log(`\x1b[32m[Soniox Original]\x1b[0m ${parsed.text}`);
    } else if (parsed.type === 'translation') {
      const translated = parsed.translatedText || parsed.text || JSON.stringify(parsed);
      console.log(`\x1b[36m[Translation]\x1b[0m ${translated}`);
    } else {
      console.log(`[Server] ${message}`);
    }
  } catch (e) {
    console.log(`[Server] ${message}`);
  }
});

ws.on('close', () => {
  console.log(' - WebSocket disconnected');
});
EOF

if [ ! -d "node_modules/ws" ]; then
  npm install ws --no-save > /dev/null 2>&1
fi

# Pass the RAW_FILE instead of the MP3
node ws_test.mjs "$WS_URL" "$MEETING_ID" "$RAW_FILE"

echo "Ending meeting..."
curl -s -X POST "$API_URL/end/$MEETING_ID"

rm ws_test.mjs $MP3_FILE $RAW_FILE
echo -e "\nTest flow complete."
