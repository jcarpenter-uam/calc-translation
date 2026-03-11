import { env } from "./core/config";
import { db } from "./core/database";
import { sql } from "drizzle-orm"; // NOTE: Only for test query

// Test Database Connection ---
console.log("Testing database connection...");
try {
  // A simple query to check if the database is responding
  const result = await db.execute(sql`SELECT 1 AS connected`);
  console.log("Database connection successful!");
} catch (error) {
  console.error("Database connection failed:");
  console.error(error);
  process.exit(1); // Kill the server if we can't connect to the DB
}

// Define the custom data you want to attach to each WebSocket connection
type WebSocketData = {
  clientId: string;
};

const server = Bun.serve<WebSocketData>({
  port: env.PORT,

  // 1. Handle incoming HTTP requests and WebSocket upgrades
  fetch(req, server) {
    const url = new URL(req.url);

    // -- WebSocket Route --
    if (url.pathname === "/ws") {
      // Attempt to upgrade the HTTP connection to a WebSocket connection.
      // You can pass custom data here that will be available on the 'ws' object later.
      const upgraded = server.upgrade(req, {
        data: {
          clientId: crypto.randomUUID(),
        },
      });

      if (upgraded) {
        return; // Bun handles the response automatically if the upgrade succeeds
      }
      return new Response("WebSocket upgrade failed", { status: 400 });
    }

    // -- Standard API Route --
    if (url.pathname === "/api/status") {
      return Response.json({
        status: "Online",
        connections: server.pendingWebSockets,
      });
    }

    // -- Catch-all Route --
    return new Response("Not Found", { status: 404 });
  },

  // 2. Handle WebSocket events
  websocket: {
    open(ws) {
      console.log(`Client connected: ${ws.data.clientId}`);
      ws.send("Welcome to the server!");
    },
    message(ws, message) {
      console.log(`Received from ${ws.data.clientId}: ${message}`);

      // Echo the message back to the client
      ws.send(`Server received: ${message}`);
    },
    close(ws, code, message) {
      console.log(`Client disconnected: ${ws.data.clientId}`);
    },
  },
});

console.log(`Server running at http://localhost:${server.port}`);
console.log(`WebSocket endpoint at ws://localhost:${server.port}/ws`);
