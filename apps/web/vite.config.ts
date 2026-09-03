import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig, type UserConfig } from "vite";

const webRoot = fileURLToPath(new URL(".", import.meta.url));

export function createWebViteConfig(options?: {
  input?: string;
  outDir?: string;
}): UserConfig {
  return {
    root: webRoot,
    plugins: [react(), tailwindcss()],
    server: {
      host: "0.0.0.0",
      port: 5173,
      strictPort: true,
    },
    build: {
      outDir: options?.outDir ?? resolve(webRoot, "dist"),
      emptyOutDir: true,
      chunkSizeWarningLimit: 550,
      rollupOptions: {
        ...(options?.input ? { input: options.input } : {}),
        output: {
          manualChunks(id) {
            if (!id.includes("node_modules")) return undefined;
            if (id.includes("@tanstack/")) return "vendor-tanstack";
            if (id.includes("/@uiw/react-codemirror/")) {
              return "vendor-editor-react";
            }
            if (id.includes("/@lezer/")) return "vendor-editor-parser";
            if (id.includes("/@codemirror/")) return "vendor-editor-core";
            if (id.includes("/@livekit/components-react/")) {
              return "vendor-livekit-react";
            }
            if (id.includes("/livekit-client/")) {
              return "vendor-livekit-client";
            }
            if (
              id.includes("/@livekit/protocol/") ||
              id.includes("/@bufbuild/protobuf/")
            ) {
              return "vendor-livekit-protocol";
            }
            if (
              id.includes("@phosphor-icons/") ||
              id.includes("/phosphor-react/")
            ) {
              return "vendor-icons";
            }
            if (id.includes("/better-auth/") || id.includes("/@better-auth/")) {
              return "vendor-auth";
            }
            if (
              id.includes("/react/") ||
              id.includes("/react-dom/") ||
              id.includes("/scheduler/")
            ) {
              return "vendor-react";
            }
            if (id.includes("/centrifuge/")) return "vendor-realtime";
            if (id.includes("/zod/")) return "vendor-validation";
            return undefined;
          },
        },
      },
    },
  };
}

export default defineConfig(createWebViteConfig());
