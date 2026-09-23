import {
  defineRailway,
  github,
  preserve,
  postgres,
  project,
  service,
  volume,
} from "railway/iac";

export default defineRailway(() => {
  const database = postgres("postgres", { region: "us-west2" });
  const botData = volume("bot-data", { sizeMB: 512, region: "us-west2" });

  const bot = service("bot", {
    source: github("prime-optimal/jev-trade", { branch: "main", checkSuites: true }),
    rootDirectory: "/",
    build: {
      builder: "RAILPACK",
      watchPatterns: ["/src/**", "/package.json", "/bun.lock", "/railpack.json"],
    },
    start: "bun run start",
    healthcheck: "/",
    healthcheckTimeout: 60,
    replicas: 1,
    deploy: {
      restartPolicyType: null,
      restartPolicyMaxRetries: 3,
      overlapSeconds: 0,
      drainingSeconds: 0,
      limitOverride: {
        containers: { cpu: 1, memoryBytes: 2_000_000_000 },
      },
    },
    env: {
      MODEL: "jev",
      JEV_PROVIDER: "openrouter",
      HL_TESTNET: "true",
      DRY_RUN: "true",
      DATABASE_URL: database.env.DATABASE_URL,
      DECISION_OWNER_SECRET: preserve(),
      OPENROUTER_API_KEY: preserve(),
      PRIVATE_KEY: preserve(),
      WALLETS_JSON: preserve(),
      HL_API_URL: preserve(),
      HL_WS_URL: preserve(),
      HL_RPC_URL: preserve(),
      HL_API_KEY: preserve(),
      HL_API_KEY_HEADER: preserve(),
      HL_API_KEY_SCHEME: preserve(),
      HL_FALLBACK_POLL_MS: preserve(),
    },
    volumeMounts: {
      "/data": botData,
    },
  });

  const web = service("web", {
    source: github("prime-optimal/jev-trade", {
      branch: "main",
      rootDirectory: "/web",
      checkSuites: true,
    }),
    build: {
      builder: "RAILPACK",
      buildCommand: "bun run build",
      watchPatterns: [
        "/web/src/**",
        "/web/public/**",
        "/web/package.json",
        "/web/bun.lock",
        "/web/next.config.ts",
      ],
    },
    start: "bun run start",
    healthcheck: "/",
    healthcheckTimeout: 60,
    replicas: 1,
    deploy: {
      restartPolicyType: null,
      restartPolicyMaxRetries: 3,
      overlapSeconds: 0,
      drainingSeconds: 0,
      limitOverride: {
        containers: { cpu: 4, memoryBytes: 4_000_000_000 },
      },
    },
    env: {
      NEXT_PUBLIC_API_URL: bot.env.RAILWAY_PUBLIC_DOMAIN,
    },
  });

  return project("jev-trade", {
    resources: [database, botData, bot, web],
  });
});
