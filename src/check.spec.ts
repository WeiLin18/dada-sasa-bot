import type { Page } from "@playwright/test";
import { test } from "@playwright/test";
import { sendLineMessage } from "../src/sendLineMessage";
import { config } from "../src/config";

test.describe.configure({ mode: "serial" });

let page: Page;

test.beforeAll(async ({ browser }) => {
  page = await browser.newPage();
});

test.afterAll(async () => {
  // await page.close();
});

test("Check availability", async () => {
  await page.goto("https://yoyaku.sumidacity-gym.com/index.php");
  await page.waitForLoadState("domcontentloaded");

  await test.step("Login", async () => {
    console.log("Logging in to the reservation system...");
    await page.getByRole("link", { name: "マイページ" }).click();
    await page.waitForLoadState("domcontentloaded");

    await page
      .getByRole("textbox", { name: "利用者ID" })
      .fill(config.userId as string);
    await page
      .getByRole("textbox", { name: "パスワード" })
      .fill(config.password as string);
    await page.getByRole("button", { name: "ログイン" }).click();
    await page.waitForLoadState("domcontentloaded");
    console.log("Logged in successfully");
  });

  await test.step("Go to Reservation", async () => {
    await page.getByRole("link", { name: "予約・抽選の申込" }).click();
    await page.waitForLoadState("domcontentloaded");
    await page.getByRole("link", { name: "施設で検索" }).click();
    await page.waitForLoadState("domcontentloaded");
    await page.getByRole("link", { name: "スポーツ施設" }).click();
    await page.waitForLoadState("domcontentloaded");
    await page.getByRole("link", { name: "メインアリーナ 全面" }).click();
    console.log("Navigated to Main Arena reservation page");
  });

  // Array to collect availability information
  const availabilityInfo: string[] = [];

  // Check current month and next 3 months (total 4 months)
  for (let i = 0; i < 4; i++) {
    await test.step(`Check availability for month ${i + 1}`, async () => {
      const currentMonth = await page
        .locator("th.month-cal-head")
        .textContent();
      const calendar = await page.locator("table.calendar");

      const hasAvailability = await calendar
        .locator('td:has-text("△")') // Triangle symbol for available dates
        .or(calendar.locator('td:has-text("31")')) // Circle symbol for available dates
        .isVisible();

      if (hasAvailability && currentMonth) {
        availabilityInfo.push(currentMonth);
      }

      console.log(
        `${currentMonth} ${hasAvailability ? "有空時段" : "無空時段"}`
      );

      // Go to next month if not the last iteration
      if (i < 3) {
        await page.locator("a.day-next").click();
        await page.waitForLoadState("domcontentloaded");
      }
    });
  }

  // Send LINE notification if any availability was found
  if (availabilityInfo.length > 0) {
    await test.step("Send LINE notification", async () => {
      const message = `
すみだスポーツ施設予約情報:
利用可能な月: ${availabilityInfo.join(", ")}
詳細はこちら: https://yoyaku.sumidacity-gym.com/index.php
      `;

      await sendLineMessage(message);
      console.log("LINE notification sent:");
    });
  }
});
