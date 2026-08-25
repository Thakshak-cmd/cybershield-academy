import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      // The API runs separately in development. Proxying keeps the browser on one
      // origin, so there is no CORS configuration to get wrong locally and then
      // get wrong differently in production.
      "/api": { target: "http://localhost:3001", changeOrigin: true }
    }
  }
});
