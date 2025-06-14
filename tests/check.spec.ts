import type { Page } from "@playwright/test";
import { expect, test } from "@playwright/test";

test.describe.configure({ mode: "serial" });

let page: Page;

test.beforeAll(async ({ browser }) => {
  page = await browser.newPage();
});

test.afterAll(async () => {
  // await page.close();
});

test("the first post in the result contains keyword", async ({ request }) => {
  await page.goto("https://yoyaku.sumidacity-gym.com/index.php");
  await page.waitForLoadState("domcontentloaded");

  await test.step("Login", async () => {
    await page.getByRole("link", { name: "マイページ" }).click();
    await page.waitForLoadState("domcontentloaded");

    await page.getByRole("textbox", { name: "利用者ID" }).fill("04265");
    await page.getByRole("textbox", { name: "パスワード" }).fill("1022");
    await page.getByRole("button", { name: "ログイン" }).click();
    await page.waitForLoadState("domcontentloaded");
  });

  await test.step("Go to Reservation", async () => {
    await page.getByRole("link", { name: "予約・抽選の申込" }).click();
    await page.waitForLoadState("domcontentloaded");
    await page.getByRole("link", { name: "施設で検索" }).click();
    await page.waitForLoadState("domcontentloaded");
    await page.getByRole("link", { name: "スポーツ施設" }).click();
    await page.waitForLoadState("domcontentloaded");
    await page.getByRole("link", { name: "メインアリーナ 全面" }).click();
  });

  await test.step("Check availability", async () => {
    const currentMonth = await page.locator("th.month-cal-head").textContent();
    const calendar = await page.locator("table.calendar");

    const hasAvailability = await calendar
      .locator('td:has-text("△")') // Triangle symbol for available dates
      .or(calendar.locator('td:has-text("選挙")')) // Circle symbol for available dates
      .isVisible();

    if (hasAvailability) {
      console.log(` ${currentMonth} 有空時段`);
    }
  });

  await test.step("Check next month", async () => {
    await page.locator("a.day-next").click();
  });
});

// await page.getByRole("link", { name: "×" }).nth(1).click();
// await page.getByRole("link", { name: "戻る" }).click();
// await page.getByRole("link", { name: "7月" }).click();
// await page.getByRole("link", { name: "8月" }).click();
// await page.getByRole("link", { name: "9月" }).click();
