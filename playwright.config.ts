import type { PlaywrightTestConfig } from "@playwright/test";

/**
 * See https://playwright.dev/docs/test-configuration.
 */
const config: PlaywrightTestConfig = {
  testDir: "./tests",
  testMatch: "**/*.spec.ts",
  timeout: 30 * 1000,
  expect: {
    timeout: 5 * 1000,
  },
  /* Run tests in files in parallel */
  fullyParallel: true,
  /* Reporter to use. See https://playwright.dev/docs/test-reporters */
  reporter: "html",
  /* Shared settings for all the projects below. See https://playwright.dev/docs/api/class-testoptions. */
  use: {
    trace: "on-first-retry",
    screenshot: "only-on-failure",
  },

  outputDir: "e2e-result/",
  /* Configure projects for major browsers */
  projects: [
    {
      name: "chromium",
      use: {
        browserName: "chromium",
      },
    },
  ],
};

export default config;
