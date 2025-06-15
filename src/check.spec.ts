import type { Page } from "@playwright/test";
import { test } from "@playwright/test";
import { getUserLineID, sendLineMessage } from "../src/sendLineMessage";
import { config } from "../src/config";

test.describe.configure({ mode: "serial" });

let page: Page;

test("Test Line Messaging", async () => {
  await sendLineMessage("Hello, LINE Group!");
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

  const checkAreaTime = async (area) => {
    const areaAvailability: string[] = [];
    // Check current month and next 3 months (total 4 months)
    for (let i = 0; i < 4; i++) {
      await test.step(`Check availability for month ${i + 1}`, async () => {
        const currentMonth = await page
          .locator("th.month-cal-head")
          .textContent();
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
            const date = dateMatch ? dateMatch[1].slice(6, 8) : ""; // Get the day part (DD)
            // Click on the cell to see available time slots
            await cell.click();
            await page.waitForLoadState("domcontentloaded");

            // Define time ranges
            const timeMap = ["9-12", "12-15", "15-18", "18-21"];

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
                  availableTimeSlots.push(timeMap[k]);
                }
              }
            }

            // Format the time slots information
            const formattedTimeSlots = availableTimeSlots.join(", ");

            if (formattedTimeSlots) {
              monthTimeSlots.push(`${date}日: ${formattedTimeSlots}`);
            }

            // Go back to the calendar view
            await page.getByRole("link", { name: "戻る" }).click();
            await page.waitForLoadState("domcontentloaded");
          }

          if (monthTimeSlots.length > 0) {
            areaAvailability.push(
              `${currentMonth} (${monthTimeSlots.join(" | ")})`
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
  // Check availability for all main areas
  for (const area of areaList) {
    await test.step(`Select area: ${area}`, async () => {
      console.log(`Checking availability for: ${area}`);
      await page.getByRole("link", { name: area }).click();
      await page.waitForLoadState("domcontentloaded");

      await checkAreaTime(area);

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

      await checkAreaTime(area);

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
        messageContent += `${info.area}:\n`;
        for (const month of info.months) {
          messageContent += `- ${month}\n`;
        }
        messageContent += "\n";
      }

      messageContent +=
        "\n詳細はこちら: https://yoyaku.sumidacity-gym.com/index.php";

      await sendLineMessage(messageContent);
      console.log("LINE notification sent with available areas:");
      availabilityInfo.forEach((info) => {
        console.log(`- ${info.area}:`);
        info.months.forEach((month) => console.log(`  ${month}`));
      });
    });
  } else {
    console.log("No availability found in any areas.");
  }
});
