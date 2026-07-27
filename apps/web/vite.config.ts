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
      port: 5173,
      strictPort: true,
    },
    build: {
      outDir: options?.outDir ?? resolve(webRoot, "dist"),
      emptyOutDir: true,
      ...(options?.input
        ? {
            rollupOptions: {
              input: options.input,
            },
          }
        : {}),
    },
  };
}

export default defineConfig(createWebViteConfig());
