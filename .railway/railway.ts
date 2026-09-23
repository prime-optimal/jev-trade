import {
  defineRailway,
  github,
  preserve,
  project,
  service,
} from "railway/iac";

export default defineRailway(() => {
  const bot = service("bot", {
    source: github("prime-optimal/jev-trade", { branch: "main" }),
    rootDirectory: "/",
    build: {
      builder: "RAILPACK",
      watchPatterns: ["/src/**", "/package.json", "/bun.lock", "/railpack.json"],
    },
    start: "bun run start",
    healthcheck: "/health",
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
      NODE_ENV: "production",
      WEB_ORIGINS: "https://www.jev-trade.com,https://jev-trade.com",
      OPENROUTER_API_KEY: preserve(),
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
      // Railway expands this at build time; the browser requires an absolute URL.
      NEXT_PUBLIC_API_URL: "https://${{bot.RAILWAY_PUBLIC_DOMAIN}}",
    },
  });

  return project("jev-trade", {
    resources: [bot, web],
  });
});
