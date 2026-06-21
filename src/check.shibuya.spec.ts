import type { Page } from "@playwright/test";
import { test } from "@playwright/test";
import { sendLineFlexMessage } from "../src/sendLineMessage";
import { config, isPriorityTime } from "../src/config";

let page: Page;

const favoriteAreas = [
  "ひがし健康プラザ",
  "地域交流センター代々木の杜 多目的ホール",
  "文化総合センター大和田（学習室・アリーナ） 多目的アリーナ",
];

const targetHour = "17";

test("Check shibuya availability", async ({ browser }) => {
  page = await browser.newPage();
  await page.goto("https://yoyaku.city.shibuya.tokyo.jp/favorite");
  await page.waitForLoadState("domcontentloaded");

  await test.step("Login", async () => {
    console.log("Logging in to the reservation system...");
    await page.locator("#loginId").fill(config.shibuyaId as string);
    await page.locator("#password").fill(config.shibuyaPassword as string);
    await page.getByRole("button", { name: "ログインする" }).click();
    await page.waitForLoadState("domcontentloaded");
    console.log("Logged in successfully and redirect to favorite page");
  });

  // Collect all availability data across all areas and months
  const allAvailability: Array<{
    area: string;
    month: string;
    dates: string[];
  }> = [];

  await test.step("Check お気に入り facilities", async () => {
    for (const area of favoriteAreas) {
      await test.step(`Check area: ${area}`, async () => {
        console.log(`Checking availability for: ${area}`);

        // Find the list item containing this area name and click its 移動する button
        const listItem = page
          .locator(".list_item_kosein")
          .filter({ hasText: area });
        await listItem
          .locator(".list_item-jump", { hasText: "移動する" })
          .first()
          .click();
        await page.waitForLoadState("domcontentloaded");

        // Loop through the first 3 months in dropdown
        for (let i = 0; i < 3; i++) {
          await test.step(`Check month index: ${i}`, async () => {
            // Click to open the 利用月 dropdown
            await page
              .locator(".ant-form-item-control-input-content", {
                has: page.getByLabel("利用月"),
              })
              .click();

            await page.waitForSelector(".ant-select-dropdown");

            // Scroll using mouse wheel inside the dropdown
            const monthDropdown = page.locator(".rc-virtual-list-holder");
            // Click the i-th option
            await monthDropdown.locator('[role="listbox"]').nth(i).click();

            await page.waitForTimeout(300);

            // Click to open the 時間帯 dropdown (開始時間)
            await page
              .locator(".ant-form-item-control-input-content", {
                has: page.getByLabel("開始時間"),
              })
              .click();

            await page.waitForTimeout(300);

            // Scroll using mouse wheel inside the dropdown
            const hourDropdown = page.locator(".rc-virtual-list-holder", {
              hasText: "7:00",
            });
            await hourDropdown.hover();
            await page.mouse.wheel(0, 300); // Scroll down

            await page.waitForTimeout(100);

            await page.locator(`[aria-label="${targetHour}:00"]`).click();

            await page.waitForTimeout(500);
            await page.waitForLoadState("domcontentloaded");

            await page.getByRole("button", { name: "検索する" }).click();
            // Go back to favorites page
            await page.waitForLoadState("domcontentloaded");
            await page.waitForTimeout(10000);
            // Find all TDs containing "予約申込可" and get their dates
            const availableDates = await page
              .locator("td:has(span.vacant)")
              .evaluateAll((tds) => tds.map((td) => td.id));

            // 過濾掉排除日期
            // 日期格式假設為 YYYYMMDD，需要轉換為 YYYY/MM/DD 來比對
            const filteredDates = availableDates.filter((dateId) => {
              // 嘗試從 ID 中提取日期（假設格式為 YYYYMMDD 或類似格式）
              const dateMatch = dateId.match(/(\d{4})(\d{2})(\d{2})/);
              if (dateMatch) {
                const formattedDate = `${dateMatch[1]}/${dateMatch[2]}/${dateMatch[3]}`;
                if (config.excludedDates.includes(formattedDate)) {
                  console.log(`跳過排除日期: ${formattedDate}`);
                  return false;
                }
              }
              return true;
            });

            console.log(
              `[${area}][month ${i + 1}] Available dates:`,
              filteredDates
            );

            // Store results for later processing
            if (filteredDates.length > 0) {
              allAvailability.push({
                area,
                month: `month ${i + 1}`,
                dates: filteredDates,
              });
            }

            await page
              .getByRole("button", { name: "違う条件で検索する" })
              .click();
            await page.waitForLoadState("domcontentloaded");
          });
        }

        await page.goto("https://yoyaku.city.shibuya.tokyo.jp/favorite");
        await page.waitForLoadState("domcontentloaded");
      });
    }
  });

  // Process all collected availability data and send notification
  await test.step("發送通知", async () => {
    console.log("=== All Availability Summary ===");
    console.log(`Total records with availability: ${allAvailability.length}`);

    if (allAvailability.length > 0) {
      // Format contents for LINE message
      const contents: string[] = [];
      for (const record of allAvailability) {
        // Format: "ひがし健康プラザ (month 1): date1, date2"
        const dateList = record.dates.join(", ");
        contents.push(`${record.area} : ${dateList}`);
        console.log(`[${record.area}][${record.month}]: ${dateList}`);
      }

      // Send LINE notification
      const title = `🏸 澀谷 ${targetHour} 點後時段釋出🔥 `;
      const buttonUrl = "https://yoyaku.city.shibuya.tokyo.jp/login";
      const buttonLabel = "予約サイトへ";

      // Filter out empty strings
      const filteredContents = contents.filter((item) => item !== "");

      await sendLineFlexMessage(
        title,
        filteredContents,
        buttonUrl,
        buttonLabel
      );
      console.log("LINE notification sent successfully");
    } else {
      console.log("澀谷 - 未找到可用位置");
    }
  });
});
