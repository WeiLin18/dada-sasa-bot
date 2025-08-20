import type { Page, Locator } from "@playwright/test";
import { test } from "@playwright/test";
import { config } from "../src/config";
import { sendLineFlexMessage } from "./sendLineMessage";
import * as fs from "fs";
import * as path from "path";

let page: Page;

// 定義資料結構類型
// 每個可選位置的資訊
interface SlotInfo {
  facility: string; // 設施名稱
  marker: Locator; // 頁面上的標記元素（△ 或 ○）
  text: string | null; // 標記內容
  date: string; // 日期
  href?: string; // 標記連結
  id?: string; // 元素ID
  weekday?: string; // 星期幾
  timeSlot?: string; // 時間段
  isEvening?: boolean; // 是否為晚上時段
}

// 依日期分組的位置映射表
interface SlotsByDateMap {
  [key: string]: SlotInfo[];
}

// 定義需要選擇的設施類型
const facilityTypes = [
  "第１競技場（半面Ａ）",
  "第１競技場（半面Ｂ）",
  "第２競技場",
];

// 在測試最開始增加錯誤收集功能
test("查詢台東設施的晚上時段可用性", async ({ browser }) => {
  // 收集測試過程中的警告和錯誤，用於最終報告
  const testIssues: string[] = [];

  // 確保截圖目錄存在
  const screenshotDir = path.join(process.cwd(), "e2e-result");
  if (!fs.existsSync(screenshotDir)) {
    fs.mkdirSync(screenshotDir, { recursive: true });
    console.log(`已創建截圖目錄: ${screenshotDir}`);
  }

  // 檢查是否應該在當前時間執行測試
  const now = new Date();
  const japanHour = (now.getUTCHours() + 9) % 24;
  const japanMinute = now.getUTCMinutes();
  console.log(
    `當前時間: ${now.toLocaleString()}, ${japanHour}:${japanMinute
      .toString()
      .padStart(2, "0")}`
  );

  const isPriorityTime = () => {
    return config.priorityHours.some((hour) => {
      // 如果當前小時就是優先小時，只在前15分鐘內執行
      if (japanHour === hour) {
        return japanMinute <= config.rangeMinutes;
      }
      // 如果是優先小時的前一小時，只在後15分鐘內執行
      else if (japanHour === hour - 1 || (japanHour === 23 && hour === 0)) {
        return japanMinute >= 60 - config.rangeMinutes;
      }
      return false;
    });
  };

  page = await browser.newPage();
  await page.goto("https://shisetsu.city.taito.lg.jp/");
  await page.waitForLoadState("domcontentloaded");

  // // 步驟 1：登入系統
  // await test.step("登入", async () => {
  //   console.log("正在登入預約系統...");
  //   await page.getByRole("button", { name: "ログインする" }).click();
  //   await page.waitForLoadState("domcontentloaded");

  //   await page.locator("#txtID").fill(config.taiUserId as string);
  //   await page.locator("#txtPass").fill(config.taiPassword as string);
  //   await page.getByRole("button", { name: "ログイン" }).click();
  //   await page.waitForLoadState("domcontentloaded");
  //   console.log("登入成功");
  // });

  // 步驟 2：導航到目標設施頁面
  await test.step("導航到設施頁面", async () => {
    await page.getByRole("button", { name: "運動施設" }).click();
    await page.waitForLoadState("domcontentloaded");
    await page
      .getByRole("button", { name: "台東リバーサイドＳＣ体育館" })
      .click();
    await page.getByRole("button", { name: "次へ >>" }).click();
    await page.waitForLoadState("domcontentloaded");
    await page.waitForTimeout(1000);
    await page.getByRole("button", { name: "1ヶ月" }).click();
    await page.getByRole("button", { name: "夜間" }).click();
    await page.getByRole("button", { name: "横表示" }).click();
    await page.getByRole("button", { name: "次へ >>" }).click();
    await page.waitForLoadState("domcontentloaded");
    console.log("已導航到可用性日曆");
  });

  // 步驟 3：搜尋晚上時段可用性並報告
  await test.step("搜尋晚上時段可用性", async () => {
    // 尋找並選擇晚上時段（18:00～21:00）有○的位置
    console.log("正在尋找晚上時段（18:00～21:00）有○的位置...");
    await page.waitForTimeout(1000);

    const eveningSlots = await getAvailableSlots();

    // 如果找到晚上時段，報告這些位置
    if (eveningSlots.length > 0) {
      console.log(`台東 - 找到 ${eveningSlots.length} 個晚上時段可用位置`);

      console.log("台東 - 依日期顯示可用位置：");

      // 準備要發送的訊息內容
      const title = `🏸 台東時段釋出🔥`;
      const contents = eveningSlots;

      // 發送摘要通知
      const buttonUrl = "https://shisetsu.city.taito.lg.jp/";
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
    } else {
      if (!isPriorityTime()) return;
      console.log("台東 - 未找到晚上時段可用位置");
      // 發送無可用位置的通知
      const title = `🏸 台東施設情報`;
      const contents = ["目前沒有晚上時段可用位置"];
      const buttonUrl = "https://shisetsu.city.taito.lg.jp/";
      const buttonLabel = "予約サイトへ";

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

/**
 * 一列一列找有○或△，回傳對應日期
 */
async function getAvailableSlots(): Promise<string[]> {
  // 設定要處理的頁數，預設為2頁
  const date: string[] = [];
  const pagesToProcess = 2;

  for (let pageNum = 0; pageNum < pagesToProcess; pageNum++) {
    console.log(`台東 - 正在處理第 ${pageNum + 1} 頁`);

    // 遍歷每個設施類型
    for (const facility of facilityTypes) {
      console.log(`台東 - 正在處理設施: ${facility}`);

      await page.waitForTimeout(1000);
      // 先檢查整個表格結構
      const table = await page.locator("table#dlRepeat_ctl00_tpItem_dgTable");

      // 在當前表格中找到包含設施名稱的行
      const facilityRows = await table
        .locator(`tr:has-text("${facility}")`)
        .all();

      for (let rowIndex = 0; rowIndex < facilityRows.length; rowIndex++) {
        const facilityRow = facilityRows[rowIndex];

        // 獲取設施名稱，確認是否完全匹配
        const facilityNameCell = await facilityRow.locator("td").first();
        const actualFacilityName =
          (await facilityNameCell.textContent())?.trim() || "";

        // 點擊當前設施行
        console.log(`台東 - 正在確認設施: ${actualFacilityName}`);

        // 找到所有可用的標記（△和○）
        const availableMarkers = await facilityRow
          .locator('a:has-text("△"), a:has-text("○")')
          .all()
          .then(async (markers) => {
            const results: { href: string; text: string; date: string }[] = [];
            for (const marker of markers) {
              const href = await marker.getAttribute("href");
              const text = await marker.textContent();
              if (href) {
                // 從 href 解析日期，格式如：b20250823
                const dateMatch = href.match(/b(\d{8})/);
                if (dateMatch) {
                  const dateStr = dateMatch[1];
                  const year = dateStr.substring(0, 4);
                  const month = dateStr.substring(4, 6);
                  const day = dateStr.substring(6, 8);
                  const formattedDate = `${year}/${month}/${day}`;

                  results.push({
                    href,
                    text: text?.trim() || "",
                    date: formattedDate,
                  });
                }
              }
            }
            return results;
          });

        console.log(`台東 - 找到 ${availableMarkers.length} 個可用標記`);

        if (availableMarkers.length === 0) {
          console.log(`台東 - 該行沒有可用標記，跳過`);
          continue;
        }

        // 處理找到的可用時段
        for (const marker of availableMarkers) {
          const slotInfo = `${actualFacilityName} - ${marker.date} - ${marker.text}`;
          date.push(slotInfo);
          console.log(`找到可用時段: ${slotInfo}`);
        }
      }
    }

    // 如果不是最後一頁，則點擊右箭頭進入下一頁
    if (pageNum < pagesToProcess - 1) {
      console.log(`點擊右箭頭進入下一頁`);

      const tableFooter = await page.locator("#TableFoot");
      const nextRightButton = await tableFooter.locator(
        "a:has-text('次の期間を表示')"
      );
      await nextRightButton.click();
      await page.waitForLoadState("domcontentloaded");
      await page.waitForTimeout(3000); // 稍微等待久一點確保頁面加載完成

      console.log(`已進入下一頁`);
    } else {
      console.log(`沒有更多頁面，提前結束`);
      break; // 如果沒有下一頁按鈕則跳出循環
    }
  }
  return date;
}
