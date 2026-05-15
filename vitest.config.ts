import { defineWorkersConfig } from "@cloudflare/vitest-pool-workers/config";

export default defineWorkersConfig({
  test: {
    poolOptions: {
      workers: {
        singleWorker: true,
        miniflare: {
          compatibilityDate: "2025-01-01",
          compatibilityFlags: ["nodejs_compat"],
          kvNamespaces: ["STATE"],
          bindings: {
            ANTHROPIC_BASE_URL: "",
            ACCESS_JWKS_URL_OVERRIDE: "",
            ANTHROPIC_TIMEOUT_MS: "30000",
          },
        },
      },
    },
  },
});
