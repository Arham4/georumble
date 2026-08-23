import { defineConfig } from "vite";

export default defineConfig({
  // Shared asset root: pack artifacts live at /mappacks/*, brand at /brand/*.
  publicDir: "../assets",
  server: {
    proxy: {
      "/api": "http://localhost:8787",
    },
  },
});
