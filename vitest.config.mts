import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    setupFiles: ["./vitest.setup.ts"],
    fileParallelism: false,
    server: { deps: { inline: ["next-auth", "@auth/core"] } },
  },
  resolve: { alias: { "@": path.resolve(import.meta.dirname, ".") } },
});
