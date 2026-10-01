import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
export default defineConfig({
  plugins: [react()],
  server: { proxy: { "/api": "http://127.0.0.1:3001" } },
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (
            id.includes("/node_modules/@radix-ui/") ||
            id.includes("/node_modules/cmdk/")
          )
            return "interface-controls";
          if (id.includes("/node_modules/echarts/")) return "research-charts";
          if (id.includes("/node_modules/zrender/")) return "chart-renderer";
        },
      },
    },
  },
  test: { include: ["tests/**/*.test.ts"], fileParallelism: false },
} as Parameters<typeof defineConfig>[0]);
