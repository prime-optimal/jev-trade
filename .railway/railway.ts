import {
  defineRailway,
  github,
  preserve,
  project,
  service,
  volume,
} from "railway/iac";

export default defineRailway(() => {
  const botData = volume("bot-data", { sizeMB: 512 });

  const bot = service("bot", {
    source: github("prime-optimal/jev-trade", { branch: "main" }),
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
      restartPolicyType: "ON_FAILURE",
      restartPolicyMaxRetries: 3,
      overlapSeconds: 0,
      drainingSeconds: 0,
    },
    env: {
      MODEL: "jev",
      JEV_PROVIDER: "openrouter",
      HL_TESTNET: "true",
      DRY_RUN: "true",
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
      restartPolicyType: "ON_FAILURE",
      restartPolicyMaxRetries: 3,
      overlapSeconds: 0,
      drainingSeconds: 0,
    },
    env: {
      NEXT_PUBLIC_API_URL: bot.env.RAILWAY_PUBLIC_DOMAIN,
    },
  });

  return project("jev-trade", {
    resources: [botData, bot, web],
  });
});
