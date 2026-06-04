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
          .click();
        await page.waitForLoadState("domcontentloaded");

        // Click to open the 時間帯 dropdown (開始時間)
        await page
          .locator(".ant-form-item-control-input-content", {
            has: page.getByLabel("開始時間"),
          })
          .click();

        await page.waitForSelector(".ant-select-dropdown");

        // Scroll using mouse wheel inside the dropdown
        const dropdown = page.locator(".rc-virtual-list-holder");
        await dropdown.hover();
        await page.mouse.wheel(0, 300); // Scroll down

        await page.waitForTimeout(100);

        await page.locator('[aria-label="10:00"]').click();

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

        console.log("Available dates:", availableDates);

        await page.getByRole("button", { name: "違う条件で検索する" }).click();
      });
    }
  });

  const checkAreaTime = async (area, type?: "day" | "night") => {
    const areaAvailability: string[] = [];
    // Check current month and next 3 months (total 4 months)
    for (let i = 0; i < 4; i++) {
      await test.step(`Check availability for month ${i + 1}`, async () => {
        const monthText = await page.locator("th.month-cal-head").textContent();
        // 移除"令和X年"部分，只保留月份
        const currentMonth = monthText
          ? monthText.replace(/令和\s*\d+年\s*/, "")
          : "";
        const calendar = await page.locator("table.calendar");

        // Get all cells with availability symbols
        const availableCells = await calendar
          .locator('a:has-text("△"), a:has-text("○")')
          .all();

        const hasAvailability = availableCells.length > 0;
        const monthTimeSlots: string[] = [];

        // If there are available dates, check the time slots for each one
        if (hasAvailability && currentMonth) {
          // Store information about each available date
          for (let j = 0; j < Math.min(availableCells.length, 3); j++) {
            // Limit to 3 dates per month to avoid too many clicks
            const cell = availableCells[j];
            const dateURL = (await cell.getAttribute("href")) || ""; // index.php?op=daily&UseDate=20250709
            const dateMatch = dateURL.match(/UseDate=(\d{8})/); // Extract date from URL
            const dateStr = dateMatch ? dateMatch[1] : ""; // Get the full date (YYYYMMDD)
            const date = dateStr ? dateStr.slice(6, 8) : ""; // Get the day part (DD)

            // 获取星期几信息
            let weekday = "";
            if (dateStr) {
              const year = parseInt(dateStr.slice(0, 4));
              const month = parseInt(dateStr.slice(4, 6)) - 1; // JS月份从0开始
              const day = parseInt(dateStr.slice(6, 8));
              const dateObj = new Date(year, month, day);
              const weekdays = ["日", "一", "二", "三", "四", "五", "六"];
              weekday = weekdays[dateObj.getDay()];
            }

            // 检查日期是否在排除清单中
            const formattedDate = dateStr
              ? `${dateStr.slice(0, 4)}/${dateStr.slice(4, 6)}/${dateStr.slice(
                  6,
                  8
                )}`
              : "";
            if (formattedDate && config.excludedDates.includes(formattedDate)) {
              console.log(`跳過排除日期: ${formattedDate}`);
              continue;
            }

            // Click on the cell to see available time slots
            await cell.click();
            await page.waitForLoadState("domcontentloaded");

            // Define time ranges
            const dayTimeMap = ["9-12", "12-15", "15-18", "18-21🔥"];
            const nightTimeMap = ["21-22:30🌙"];

            const timeMap = type === "night" ? nightTimeMap : dayTimeMap;
            // Extract available time slots from the detailed view
            const timeSlots = await page.locator("td.f-sizeup").all();

            // Get available time slots based on their position in the table
            const availableTimeSlots: string[] = [];
            for (let k = 0; k < timeSlots.length; k++) {
              const text = (await timeSlots[k].textContent()) || "";
              // Check if this slot has the "○" or other availability symbol
              if (text && text.trim() === "○") {
                // Map the position to the timeMap (if within bounds)
                if (k < timeMap.length) {
                  const timeSlot = timeMap[k];
                  // Filter out unwanted time slots only on weekdays: "9-12", "12-15", "15-18"
                  const isWeekend = weekday === "六" || weekday === "日";
                  if (
                    isWeekend ||
                    (timeSlot !== "9-12" &&
                      timeSlot !== "12-15" &&
                      timeSlot !== "15-18")
                  ) {
                    availableTimeSlots.push(timeSlot);
                  }
                }
              }
            }

            // Format the time slots information
            const formattedTimeSlots = availableTimeSlots.join(", ");

            if (formattedTimeSlots) {
              // 检查是否包含黄金时段
              if (!hasPrimeTime && formattedTimeSlots.includes("18-21🔥")) {
                hasPrimeTime = true;
              }

              // 只在日间体育设施检查是否是周末 (排除夜间设施)
              if (
                type !== "night" &&
                !hasWeekendSlot &&
                (weekday === "六" || weekday === "日")
              ) {
                hasWeekendSlot = true;
                // 如果是周末，在时间前面添加周末标识，帮助用户识别
                const formattedWithWeekend = formattedTimeSlots
                  .split(", ")
                  .map((slot) => (!slot.includes("🔥") ? slot + "🔥" : slot))
                  .join(", ");
                monthTimeSlots.push(
                  `${date}日(${weekday}): ${formattedWithWeekend}`
                );
              } else {
                monthTimeSlots.push(
                  `${date}日(${weekday}): ${formattedTimeSlots}`
                );
              }
            }

            // Go back to the calendar view
            await page.getByRole("link", { name: "戻る" }).click();
            await page.waitForLoadState("domcontentloaded");
          }

          if (monthTimeSlots.length > 0) {
            areaAvailability.push(
              `${currentMonth} ${monthTimeSlots.join(" | ")}`
            );
          } else {
            areaAvailability.push(currentMonth);
          }
        }

        console.log(
          `${area} - ${currentMonth} ${hasAvailability ? "有空時段" : "滿"}`
        );
        if (monthTimeSlots.length > 0) {
          console.log(`  Available times: ${monthTimeSlots.join(" | ")}`);
        }

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
  };

  await test.step("發送通知", async () => {
    // 如果找到晚上時段，報告這些位置
    if (eveningSlots.length > 0) {
      console.log(`渋谷 - 找到 ${eveningSlots.length} 個晚上時段可用位置`);

      console.log("渋谷 - 依日期顯示可用位置：");

      // 準備要發送的訊息內容
      const title = `🏸 渋谷時段釋出🔥`;
      const contents = eveningSlots;

      // 發送摘要通知
      const buttonUrl = "https://yoyaku.city.shibuya.tokyo.jp/";
      const buttonLabel = "予約サイトへ";
      console.log("🚀 ~ awaittest.step ~ contents:", contents);

      // 確保沒有空字符串
      const filteredContents = contents.filter((item) => item !== "");

      await sendLineFlexMessage(
        title,
        filteredContents,
        buttonUrl,
        buttonLabel
      );
    }
  });
});
