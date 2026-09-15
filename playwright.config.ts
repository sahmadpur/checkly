import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "e2e",
  timeout: 60_000,
  use: { baseURL: "http://localhost:3100", locale: "en", trace: "retain-on-failure" },
  webServer: {
    command: "pnpm db:push:test && dotenv -e .env -- sh -c 'DATABASE_URL=$DATABASE_URL_TEST APP_URL=http://localhost:3100 pnpm dev -p 3100'",
    url: "http://localhost:3100/login",
    reuseExistingServer: false,
    stdout: "pipe",
    timeout: 120_000,
  },
});
