import { defineConfig } from "vite/dist/node";
import react from "@vitejs/plugin-react-swc";
import tailwindcss from "@tailwindcss/vite";

// https://vite.dev/config/
export default defineConfig({
  server: {
    proxy: {
      "/ws": "ws://localhost:8000",
    },
  },
  plugins: [react(), tailwindcss()],
});
