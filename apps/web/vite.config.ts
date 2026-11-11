import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// The dev server for the SyncBoard web app. The sync server runs
// separately on its own port (see apps/sync-server).
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
  },
});
