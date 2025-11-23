import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// ✅ Vite configuration for React + Electron
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    strictPort: true,
  },
});
