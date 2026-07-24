import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm"],
  clean: true,
  noExternal: [/.*/],
  banner: { js: "#!/usr/bin/env node" },
});
