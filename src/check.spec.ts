import type { Page } from "@playwright/test";
import { test } from "@playwright/test";
import { sendLineFlexMessage } from "../src/sendLineMessage";
import { config, isPriorityTime } from "../src/config";

let page: Page;

// test("Test Line Messaging", async () => {
//   // 发送普通文本消息
//   await sendLineMessage("Hello, LINE Group! 我是 2 號 Bot 🤖");

//   // 测试 Flex 消息
//   const title = "🧪 测试 Flex 消息";
//   const contents = [
//     "这是一条测试消息 📝",
//     "Flex 消息格式更美观 ✨",
//     "可以包含表情符号 😊",
//   ];
//   const buttonUrl = "https://line.me";
//   const buttonLabel = "访问 LINE";

//   await sendLineFlexMessage(title, contents, buttonUrl, buttonLabel);
// });

const sportAreaList = [
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
const sportNextAreaList = ["サブアリーナ １／２面①", "サブアリーナ １／２面②"];

const nightAreaList = [
  "メインアリーナ夜間（２１時～２２時３０分） コート（１／３面）①",
  "メインアリーナ夜間（２１時～２２時３０分） コート（１／３面）②",
  "メインアリーナ夜間（２１時～２２時３０分） コート（１／３面）③",
  "メインアリーナ夜間（２１時～２２時３０分） コート（１／４面）①",
  "メインアリーナ夜間（２１時～２２時３０分） コート（１／４面）②",
  "メインアリーナ夜間（２１時～２２時３０分） コート（１／４面）③",
  "メインアリーナ夜間（２１時～２２時３０分） コート（１／４面）④",
];
const nightNextAreaList = [
  "サブアリーナ夜間（２１時～２２時３０分） １／２面①",
  "サブアリーナ夜間（２１時～２２時３０分） １／２面②",
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
    console.log("Navigated to reservation page");
  });

  // Array to collect availability information
  const availabilityInfo: { area: string; months: string[] }[] = [];
  // 标记是否找到了黄金时段（18-21）
  let hasPrimeTime = false;
  // 标记是否找到了周末时段
  let hasWeekendSlot = false;

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

  await test.step("check スポーツ施設 area", async () => {
    await page.getByRole("link", { name: "スポーツ施設" }).click();
    await page.waitForLoadState("domcontentloaded");

    await test.step("Check スポーツ施設 first page", async () => {
      // Check availability for all main areas
      for (const area of sportAreaList) {
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
    });

    // Move to next list for sub-arenas
    await test.step("Go to next list of areas", async () => {
      await page.getByRole("link", { name: "次の一覧" }).click();
      await page.waitForLoadState("domcontentloaded");
    });

    await test.step("Check スポーツ施設 second page", async () => {
      // Check availability for all sub-arena areas
      for (const area of sportNextAreaList) {
        await test.step(`Select area: ${area}`, async () => {
          console.log(`Checking availability for: ${area}`);
          await page.getByRole("link", { name: area }).click();
          await page.waitForLoadState("domcontentloaded");

          await checkAreaTime(area);

          // Go back to the area selection page
          await page.getByRole("link", { name: "戻る" }).click();
          await page.waitForLoadState("domcontentloaded");

          await page.getByRole("link", { name: "次の一覧" }).click();
          await page.waitForLoadState("domcontentloaded");
        });
      }
    });
  });

  await page.getByRole("link", { name: "戻る" }).click();
  await page.waitForLoadState("domcontentloaded");

  // Check if it's priority time (20:00 ±15 minutes)
  const isReportRoutineTime = isPriorityTime();

  // only check 夜間アリーナ if it's a priority time
  if (isReportRoutineTime) {
    await test.step("check 夜間アリーナ area", async () => {
      await page.getByRole("link", { name: "夜間アリーナ" }).click();
      await page.waitForLoadState("domcontentloaded");

      await test.step("Check 夜間アリーナ first page", async () => {
        // Check availability for all main areas
        for (const area of nightAreaList) {
          await test.step(`Select area: ${area}`, async () => {
            console.log(`Checking availability for: ${area}`);
            await page.getByRole("link", { name: area }).click();
            await page.waitForLoadState("domcontentloaded");

            await checkAreaTime(area, "night");

            // Go back to the area selection page
            await page.getByRole("link", { name: "戻る" }).click();
            await page.waitForLoadState("domcontentloaded");
          });
        }
      });

      // Move to next list for sub-arenas
      await test.step("Go to next list of areas", async () => {
        await page.getByRole("link", { name: "次の一覧" }).click();
        await page.waitForLoadState("domcontentloaded");
      });

      await test.step("Check 夜間アリーナ second page", async () => {
        // Check availability for all sub-arena areas
        for (const area of nightNextAreaList) {
          await test.step(`Select area: ${area}`, async () => {
            console.log(`Checking availability for: ${area}`);
            await page.getByRole("link", { name: area }).click();
            await page.waitForLoadState("domcontentloaded");

            await checkAreaTime(area, "night");

            // Go back to the area selection page
            await page.getByRole("link", { name: "戻る" }).click();
            await page.waitForLoadState("domcontentloaded");

            await page.getByRole("link", { name: "次の一覧" }).click();
            await page.waitForLoadState("domcontentloaded");
          });
        }
      });
    });
  }

  // Send LINE notification if any availability was found
  if (availabilityInfo.length > 0) {
    await test.step("Check notification timing", async () => {
      // Determine if we should send a notification
      const shouldNotify =
        isReportRoutineTime || hasPrimeTime || hasWeekendSlot;

      console.log(`Current time in Japan: ${japanHour}:${japanMinute}`);
      console.log(`Is priority time: ${isReportRoutineTime}`);
      console.log(`Has prime time slots: ${hasPrimeTime}`);
      console.log(`Has weekend slots: ${hasWeekendSlot}`);
      console.log(`Should send notification: ${shouldNotify}`);

      if (shouldNotify) {
        // 准备Flex消息的标题
        let title = "🏸 墨田施設情報";
        if (hasPrimeTime && hasWeekendSlot) {
          title = "🏸 墨田晚上時段 & 假日時段釋出🔥";
        } else if (hasPrimeTime) {
          title = "🏸 墨田晚上時段釋出🔥";
        } else if (hasWeekendSlot) {
          title = "🏸 假日時段釋出🔥";
        }

        // 准备Flex消息的内容数组
        const contents: string[] = [];

        for (const info of availabilityInfo) {
          contents.push(`${info.area}:`);
          for (const month of info.months) {
            contents.push(`${month}`);
          }
          contents.push(" "); // 添加空行作为分隔
        }

        // 设置按钮URL和标签
        const buttonUrl = "https://yoyaku.sumidacity-gym.com/index.php";
        const buttonLabel = "予約サイトへ";

        // 发送Flex消息
        await sendLineFlexMessage(title, contents, buttonUrl, buttonLabel);

        console.log("LINE notification sent with available areas:");
        availabilityInfo.forEach((info) => {
          console.log(`- ${info.area}:`);
          info.months.forEach((month) => console.log(`  ${month}`));
        });
      } else {
        console.log(
          "Availability found, but not sending notification at this time."
        );
        availabilityInfo.forEach((info) => {
          console.log(`- ${info.area}:`);
          info.months.forEach((month) => console.log(`  ${month}`));
        });
      }
    });
  } else {
    console.log("No availability found in any areas.");
  }
});
