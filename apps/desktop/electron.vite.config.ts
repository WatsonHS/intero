import { resolve } from "node:path";

import { createWebViteConfig } from "@intero/web/vite-config";
import { defineConfig, externalizeDepsPlugin } from "electron-vite";

export default defineConfig({
  main: {
    plugins: [
      externalizeDepsPlugin({
        exclude: ["@intero/domain", "@intero/integrations"],
      }),
    ],
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        output: {
          format: "cjs",
          entryFileNames: "[name].cjs",
        },
      },
    },
  },
  renderer: createWebViteConfig({
    input: resolve("../web/index.html"),
    outDir: resolve("out/renderer"),
  }),
});
