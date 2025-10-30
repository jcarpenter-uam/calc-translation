import { resolve } from "path";
import { defineConfig, externalizeDepsPlugin } from "electron-vite";
import react from "@vitejs/plugin-react-swc";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
  },
  renderer: {
    server: {
      proxy: {
        "/ws": {
          target: "wss://translator.my-uam.com",
          ws: true,
          changeOrigin: true,
          secure: true,
        },
      },
    },
    plugins: [react(), tailwindcss()],

    resolve: {
      alias: {
        "@renderer": resolve("src/renderer/src"),
      },
    },
  },
});
