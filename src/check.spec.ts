import type { Page } from "@playwright/test";
import { test } from "@playwright/test";
import { getUserLineID, sendLineMessage } from "../src/sendLineMessage";
import { config } from "../src/config";

test.describe.configure({ mode: "serial" });

let page: Page;

test("Get user LINE ID", async () => {
  await getUserLineID();
});

const areaList = [
  "メインアリーナ コート（１／２面）①",
  "メインアリーナ コート（１／２面）②",
  "メインアリーナ コート（１／３面）①",
  "メインアリーナ コート（１／３面）②",
  "メインアリーナ コート（１／３面）③",
  "メインアリーナ コート（１／４面）①",
  "メインアリーナ コート（１／４面）②",
  "メインアリーナ コート（１／４面）③",
  "メインアリーナ コート（１／４面）④",
];
const nextAreaList = [
  "サブアリーナ 全面",
  "サブアリーナ １／２面①",
  "サブアリーナ １／２面②",
];

test("Check availability", async ({ browser }) => {
  page = await browser.newPage();
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
    console.log("Navigated to reservation page");
  });

  // Array to collect availability information
  const availabilityInfo: { area: string; months: string[] }[] = [];
  const nextListButton = page.getByRole("link", { name: "次の一覧" });

  // Check availability for all main areas
  for (const area of areaList) {
    await test.step(`Select area: ${area}`, async () => {
      console.log(`Checking availability for: ${area}`);
      await page.getByRole("link", { name: area }).click();
      await page.waitForLoadState("domcontentloaded");

      const areaAvailability: string[] = [];

      // Check current month and next 3 months (total 4 months)
      for (let i = 0; i < 4; i++) {
        await test.step(`Check availability for month ${i + 1}`, async () => {
          const currentMonth = await page
            .locator("th.month-cal-head")
            .textContent();
          const calendar = await page.locator("table.calendar");
          const triangleCount = await calendar
            .locator('td:has-text("△")')
            .count();
          const circleCount = await calendar
            .locator('td:has-text("○")')
            .count();
          const hasAvailability = triangleCount > 0 || circleCount > 0;

          if (hasAvailability && currentMonth) {
            areaAvailability.push(currentMonth);
          }

          console.log(
            `${area} - ${currentMonth} ${hasAvailability ? "有空時段" : "滿"}`
          );

          // Go to next month if not the last iteration
          if (i < 3) {
            await page.locator("a.day-next").click();
            await page.waitForLoadState("domcontentloaded");
          }
        });
      }

      if (areaAvailability.length > 0) {
        availabilityInfo.push({ area, months: areaAvailability });
      }

      // Go back to the area selection page
      await page.getByRole("link", { name: "戻る" }).click();
      await page.waitForLoadState("domcontentloaded");
    });
  }

  // Move to next list for sub-arenas
  await test.step("Go to next list of areas", async () => {
    await nextListButton.click();
    await page.waitForLoadState("domcontentloaded");
  });

  // Check availability for all sub-arena areas
  for (const area of nextAreaList) {
    await test.step(`Select area: ${area}`, async () => {
      console.log(`Checking availability for: ${area}`);
      await page.getByRole("link", { name: area }).click();
      await page.waitForLoadState("domcontentloaded");

      const areaAvailability: string[] = [];

      // Check current month and next 3 months (total 4 months)
      for (let i = 0; i < 4; i++) {
        await test.step(`Check availability for month ${i + 1}`, async () => {
          const currentMonth = await page
            .locator("th.month-cal-head")
            .textContent();
          const calendar = await page.locator("table.calendar");

          // Check if any availability exists using count() instead of isVisible() to handle multiple elements
          const triangleCount = await calendar
            .locator('td:has-text("△")')
            .count(); // Triangle symbol for available dates
          const circleCount = await calendar
            .locator('td:has-text("○")')
            .count(); // Circle symbol for available dates
          const hasAvailability = triangleCount > 0 || circleCount > 0;

          if (hasAvailability && currentMonth) {
            areaAvailability.push(currentMonth);
          }

          console.log(
            `${currentMonth} - ${area}  ${hasAvailability ? "有空時段" : "滿"}`
          );

          // Go to next month if not the last iteration
          if (i < 3) {
            await page.locator("a.day-next").click();
            await page.waitForLoadState("domcontentloaded");
          }
        });
      }

      if (areaAvailability.length > 0) {
        availabilityInfo.push({ area, months: areaAvailability });
      }

      // Go back to the area selection page
      await page.getByRole("link", { name: "戻る" }).click();
      await page.waitForLoadState("domcontentloaded");

      await nextListButton.click();
      await page.waitForLoadState("domcontentloaded");
    });
  }

  // Send LINE notification if any availability was found
  if (availabilityInfo.length > 0) {
    await test.step("Send LINE notification", async () => {
      let messageContent = "すみだスポーツ施設予約情報:\n";

      for (const info of availabilityInfo) {
        messageContent += `${info.area}: ${info.months.join(", ")}\n`;
      }

      messageContent +=
        "\n詳細はこちら: https://yoyaku.sumidacity-gym.com/index.php";

      await sendLineMessage(messageContent);
      console.log("LINE notification sent with available areas:");
      availabilityInfo.forEach((info) => {
        console.log(`- ${info.area}: ${info.months.join(", ")}`);
      });
    });
  } else {
    console.log("No availability found in any areas.");
  }
});
