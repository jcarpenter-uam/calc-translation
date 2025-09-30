import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import tailwindcss from "@tailwindcss/vite";

// https://vite.dev/config/
export default defineConfig({
  server: {
    proxy: {
      "/ws": "ws://localhost:8000",
    },
  },
  preview: {
    allowedHosts: ["translator.my-uam.com", "translator.home.my-uam.com"],
  },
  plugins: [react(), tailwindcss()],
});
