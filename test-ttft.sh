#!/bin/bash

API_URL="http://localhost:8000/api/meeting"
WS_URL="ws://localhost:8000/ws"
MP3_FILE="sample.mp3"
RAW_FILE="sample.raw"

echo "Downloading sample audio..."
curl -s -o $MP3_FILE https://soniox.com/media/examples/coffee_shop.mp3

echo "Converting MP3 to raw PCM (16kHz, 16-bit, mono)..."
ffmpeg -y -i $MP3_FILE -f s16le -acodec pcm_s16le -ar 16000 -ac 1 $RAW_FILE > /dev/null 2>&1

echo "Generating stress test script..."

cat << 'EOF' > ws_test.mjs
import WebSocket from 'ws';
import fs from 'fs';
import { performance } from 'perf_hooks';

const apiUrl = process.argv[2];
const wsUrl = process.argv[3];
const audioFile = process.argv[4];

const audioData = fs.readFileSync(audioFile);

// The exponential stages of the stress test
// 100 concurrent is our limit from soniox
const concurrencyLevels = [1, 5, 10, 25, 50, 100]; 

async function startMeeting() {
  try {
    const res = await fetch(`${apiUrl}/start`, { method: 'POST' });
    const data = await res.json();
    return data.id;
  } catch (err) {
    console.error("Error starting meeting:", err);
    return null;
  }
}

async function endMeeting(id) {
  try {
    await fetch(`${apiUrl}/end/${id}`, { method: 'POST' });
  } catch (err) {}
}

async function runTest(concurrency) {
  console.log(`\n=================================================`);
  console.log(`\x1b[36mRunning Stress Test: ${concurrency} Concurrent Stream(s)\x1b[0m`);
  console.log(`=================================================`);
  
  const meetings = [];
  for (let i = 0; i < concurrency; i++) {
    const id = await startMeeting();
    if (id) meetings.push(id);
  }
  
  if (meetings.length !== concurrency) {
    console.error("Failed to create all required meetings. Aborting this step.");
    return;
  }

  return new Promise((resolve) => {
    let completed = 0;
    const ttfts = [];
    const sockets = [];
    const intervals = [];
    let isFinished = false;

    const finish = async () => {
      if (isFinished) return;
      isFinished = true;

      // Stop audio streaming and close all sockets
      intervals.forEach(clearInterval);
      sockets.forEach(ws => ws.close());
      
      // Clean up meetings on the backend
      for (const id of meetings) {
        await endMeeting(id);
      }
      
      // Calculate and print metrics
      if (ttfts.length > 0) {
        const avg = (ttfts.reduce((a, b) => a + b, 0) / ttfts.length).toFixed(2);
        const min = Math.min(...ttfts).toFixed(2);
        const max = Math.max(...ttfts).toFixed(2);
        
        console.log(`\n\x1b[35m[Results for ${concurrency} stream(s)]\x1b[0m`);
        console.log(`  Min TTFT: \x1b[33m${min} ms\x1b[0m`);
        console.log(`  Max TTFT: \x1b[33m${max} ms\x1b[0m`);
        console.log(`  Avg TTFT: \x1b[32m${avg} ms\x1b[0m\n`);
      } else {
         console.log(`\n\x1b[31m[Results for ${concurrency} stream(s)] No tokens received.\x1b[0m\n`);
      }
      
      setTimeout(resolve, 1500); // Take a short breather before the next exponential scale
    };

    meetings.forEach((meetingId, index) => {
      const ws = new WebSocket(wsUrl);
      sockets.push(ws);
      
      let firstChunkTime = null;
      let firstTokenTime = null;

      ws.on('open', () => {
        ws.send(JSON.stringify({ 
          action: 'subscribe_meeting', 
          meetingId: meetingId,
          participantId: `tester-${index}`
        }));

        setTimeout(() => {
          let offset = 0;
          const chunkSize = 3200; 
          const intervalMs = 100; 
          
          const streamInterval = setInterval(() => {
            if (offset < audioData.length) {
              if (offset === 0) {
                firstChunkTime = performance.now();
              }
              
              const end = Math.min(offset + chunkSize, audioData.length);
              ws.send(audioData.subarray(offset, end));
              offset += chunkSize;
            } else {
              offset = 0; 
            }
          }, intervalMs);
          intervals.push(streamInterval);
        }, 500); 
      });

      ws.on('message', (data) => {
        const message = data.toString();
        const now = performance.now();

        try {
          const parsed = JSON.parse(message);
          if (parsed.type === 'transcription' && !firstTokenTime) {
            firstTokenTime = now;
            const ttft = firstTokenTime - firstChunkTime;
            ttfts.push(ttft);
            
            console.log(`  Stream ${index + 1}/${concurrency} received token: \x1b[32m"${parsed.text}"\x1b[0m in ${ttft.toFixed(2)}ms`);
            
            completed++;
            // If all streams in this tier have received their first token, finish up
            if (completed === concurrency) {
              finish();
            }
          }
        } catch (e) { }
      });
      
      ws.on('error', () => {}); // Handle connection drops silently
    });
    
    // Safety timeout: End the test phase if Soniox stops responding after 10 seconds
    setTimeout(() => {
      if (!isFinished) {
        console.log(`\n\x1b[31m[Timeout]\x1b[0m Only ${completed}/${concurrency} streams responded within 10 seconds.`);
        finish();
      }
    }, 10000);
  });
}

async function main() {
  for (const level of concurrencyLevels) {
    await runTest(level);
  }
  console.log("\x1b[32mAll stress tests complete.\x1b[0m");
  process.exit(0);
}

main();
EOF

if [ ! -d "node_modules/ws" ]; then
  bun install ws --no-save > /dev/null 2>&1
fi

bun ws_test.mjs "$API_URL" "$WS_URL" "$RAW_FILE"

rm ws_test.mjs $MP3_FILE $RAW_FILE
