import type { Page, Locator } from "@playwright/test";
import { test, expect } from "@playwright/test";
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
  "第１競技場（全面）",
  "第１競技場（半面Ａ）",
  "第１競技場（半面Ｂ）",
  "第２競技場",
];

test("查詢台東設施的晚上時段可用性", async ({ browser }) => {
  // 檢查是否應該在當前時間執行測試
  const now = new Date();
  const japanHour = (now.getUTCHours() + 9) % 24;
  const japanMinute = now.getUTCMinutes();
  console.log(
    `當前時間: ${now.toLocaleString()}, ${japanHour}:${japanMinute
      .toString()
      .padStart(2, "0")}`
  );

  const shouldRunTest = () => {
    return true;
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

  if (!shouldRunTest()) {
    console.log(
      `當前時間不在指定的優先時間 [${config.priorityHours.join(
        ", "
      )}] 的前後15分鐘內，跳過執行`
    );
    test.skip();
    return;
  }

  console.log(
    `當前時間在指定的優先時間 [${config.priorityHours.join(
      ", "
    )}] 的前後15分鐘內，開始執行測試`
  );

  page = await browser.newPage();
  // 設定較長的導航超時時間
  page.setDefaultTimeout(600000);

  await page.goto("https://shisetsu.city.taito.lg.jp/");
  await page.waitForLoadState("domcontentloaded");

  // 步驟 1：登入系統
  await test.step("登入", async () => {
    console.log("正在登入預約系統...");
    await page.getByRole("button", { name: "ログインする" }).click();
    await page.waitForLoadState("domcontentloaded");

    await page.locator("#txtID").fill(config.taiUserId as string);
    await page.locator("#txtPass").fill(config.taiPassword as string);
    await page.getByRole("button", { name: "ログイン" }).click();
    await page.waitForLoadState("domcontentloaded");
    console.log("登入成功");
  });

  // 步驟 2：導航到目標設施頁面
  await test.step("導航到設施頁面", async () => {
    await page.getByRole("button", { name: "運動施設" }).click();
    await page.waitForLoadState("domcontentloaded");
    await page
      .getByRole("button", { name: "台東リバーサイドＳＣ体育館" })
      .click();
    await page.getByRole("button", { name: "次へ >>" }).click();
    await page.waitForLoadState("domcontentloaded");
    await page.getByRole("button", { name: "1ヶ月" }).click();
    await page.getByRole("button", { name: "横表示" }).click();
    await page.getByRole("button", { name: "次へ >>" }).click();
    await page.waitForLoadState("domcontentloaded");
    console.log("已導航到可用性日曆");
  });

  // 步驟 3：搜尋晚上時段可用性並報告
  await test.step("搜尋晚上時段可用性", async () => {
    // 尋找並選擇晚上時段（18:00～21:00）有○的位置
    console.log("正在尋找晚上時段（18:00～21:00）有○的位置...");
    const eveningSlots = await selectAvailableSlots();

    // 如果找到晚上時段，報告這些位置
    if (eveningSlots.length > 0) {
      console.log(`找到 ${eveningSlots.length} 個晚上時段可用位置`);

      // 依日期分組位置以便更好地可視化
      const slotsByDate = groupSlotsByDate(eveningSlots);
      console.log("依日期顯示可用位置：");

      // 準備要發送的訊息內容
      const title = `🏸 台東施設情報（晚上時段）`;
      const contents = [`找到 ${eveningSlots.length} 個晚上時段可用位置`];

      for (const [date, slots] of Object.entries(slotsByDate)) {
        // 添加間隔行，而不是空字符串
        contents.push(" "); // 空格代替空字符串作為間隔
        contents.push(`📅 ${date}: ${slots.length}`);

        for (const slot of slots) {
          const weekdayInfo = slot.weekday ? ` (${slot.weekday})` : "";
          console.log(`  - ${slot.facility}: ${slot.timeSlot}${weekdayInfo}`);
          contents.push(`  - ${slot.facility}: ${slot.timeSlot}${weekdayInfo}`);
        }
      }

      // 發送摘要通知
      const buttonUrl = "https://shisetsu.city.taito.lg.jp/";
      const buttonLabel = "予約サイトへ";
      console.log("🚀 ~ awaittest.step ~ contents:", contents);

      // 確保沒有空字符串
      const filteredContents = contents.filter((item) => item !== "");

      // await sendLineFlexMessage(
      //   title,
      //   filteredContents,
      //   buttonUrl,
      //   buttonLabel
      // );
    } else {
      console.log("未找到晚上時段可用位置");
      // 發送無可用位置的通知
      const title = `🏸 台東施設情報`;
      const contents = ["目前沒有晚上時段可用位置"];
      const buttonUrl = "https://shisetsu.city.taito.lg.jp/";
      const buttonLabel = "予約サイトへ";

      // 確保沒有空字符串
      const filteredContents = contents.filter((item) => item !== "");

      // await sendLineFlexMessage(
      //   title,
      //   filteredContents,
      //   buttonUrl,
      //   buttonLabel
      // );
    }
  });
});

/**
 * 按日期對位置進行分組，以便更好地組織和報告
 */
function groupSlotsByDate(slots: SlotInfo[]): SlotsByDateMap {
  const slotsByDate: SlotsByDateMap = {};

  for (const slot of slots) {
    if (!slotsByDate[slot.date]) {
      slotsByDate[slot.date] = [];
    }
    slotsByDate[slot.date].push(slot);
  }

  return slotsByDate;
}

/**
 * 格式化日期字符串，將日本格式日期（如：2025年6月24日）轉換為YYYY/MM/DD格式
 */
function formatDate(dateStr: string): string {
  if (!dateStr) return dateStr;

  // 解析日期
  const dateMatch = dateStr.match(/(20\d{2})年(\d{1,2})月(\d{1,2})日/) || [];
  if (dateMatch.length >= 4) {
    const year = dateMatch[1];
    const month = dateMatch[2].padStart(2, "0");
    const day = dateMatch[3].padStart(2, "0");
    return `${year}/${month}/${day}`;
  }

  // 如果是YYYYMMDD格式
  if (dateStr.length === 8 && !isNaN(Number(dateStr))) {
    const year = dateStr.substring(0, 4);
    const month = dateStr.substring(4, 6);
    const day = dateStr.substring(6, 8);
    return `${year}/${month}/${day}`;
  }

  return dateStr;
}

/**
 * 一列一列選擇有○或△的位置，然後點擊下一頁查看詳情頁面
 * 在詳情頁面記錄晚上時段有○的位置，然後返回上一頁
 * 取消選擇後繼續處理下一列
 */
async function selectAvailableSlots(): Promise<SlotInfo[]> {
  const allEveningSlots: SlotInfo[] = [];
  // 用於追蹤已經添加的元素ID，防止重複
  const addedElementIds = new Set<string>();

  // 設定要處理的頁數，預設為2頁
  const pagesToProcess = 3;

  for (let pageNum = 0; pageNum < pagesToProcess; pageNum++) {
    console.log(`正在處理第 ${pageNum + 1} 頁`);

    // 遍歷每個設施類型
    for (const facility of facilityTypes) {
      console.log(`正在處理設施: ${facility}`);

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
        console.log(`正在點擊設施行: ${actualFacilityName}`);

        // 找到所有可用的標記（△和○）
        const availableMarkers = await facilityRow
          .locator('a:has-text("△"), a:has-text("○")')
          .all();

        console.log(`找到 ${availableMarkers.length} 個可用標記`);

        if (availableMarkers.length === 0) {
          console.log(`該行沒有可用標記，跳過`);
          continue;
        }

        // 一次最多只選擇10個標記
        const markersToSelect = availableMarkers.slice(0, 10);
        console.log(
          `一次最多只能選擇10個標記，將選擇 ${markersToSelect.length} 個標記`
        );

        // 點擊該行可用標記（最多10個）
        for (const marker of markersToSelect) {
          const markerText = await marker.textContent();
          console.log(`點擊標記: ${markerText}`);
          await page.mouse.wheel(0, 100);
          await page.waitForTimeout(200);
          await marker.click();
          await page.waitForTimeout(300);
        }

        // 點擊下一步按鈕前進到詳情頁面
        console.log(`點擊"次へ >>"按鈕前進到詳情頁面`);
        const nextButton = page.locator("#ucPCFooter_pnlNextBtn");
        await page.mouse.wheel(0, 100);
        await page.waitForTimeout(200);
        await nextButton.click();
        await page.waitForLoadState("domcontentloaded");
        await page.waitForTimeout(500);

        // 在詳情頁面記錄晚上時段可用的位置
        console.log(`正在詳情頁面尋找晚上時段可用的位置`);

        // 基於您提供的HTML結構直接查找包含設施名稱的行
        console.log(`正在檢查設施: ${actualFacilityName} 的晚上時段`);

        const tables = await page.locator("table#Table1").all();

        for (const table of tables) {
          // 獲取當前日期信息
          const dateText =
            (await table.locator("tr.TitleColor td").first().textContent()) ||
            "";
          console.log(`詳情頁面日期: ${dateText}`);
          const formattedDate = formatDate(dateText);
          const weekday = new Date(formattedDate).toLocaleDateString("ja-JP", {
            weekday: "short",
          });

          // 獲取所有單元格
          const cells = await table
            .locator("table tbody tr")
            .nth(2)
            .locator("td")
            .all();

          // 確保有足夠的單元格（至少5個：設施名稱、定員、上午、下午、晚上）
          if (cells.length < 5) {
            console.log(`行格式不正確，單元格數量不足: ${cells.length}`);
            continue;
          }

          const isEveningAvailable = await cells[4]
            .locator("a:has-text('○')")
            .or(cells[3].locator("a:has-text('△')"))
            .isVisible();

          if (isEveningAvailable) {
            console.log(`找到晚上時段可用: ${actualFacilityName}-${dateText}`);

            // 生成唯一識別碼
            const elementUniqueKey = `${actualFacilityName}-${dateText}-evening`;

            // 檢查是否重複
            if (addedElementIds.has(elementUniqueKey)) {
              console.log(`跳過重複的晚上時段: ${elementUniqueKey}`);
              continue;
            }

            // 將元素添加到結果列表
            addedElementIds.add(elementUniqueKey);
            allEveningSlots.push({
              facility: actualFacilityName,
              marker: cells[4].locator("a:has-text('○')").first(),
              text: "○",
              date: formattedDate,
              weekday,
              timeSlot: "18:00～21:00",
              isEvening: true,
            });
          } else {
            console.log(`設施 ${actualFacilityName} 的晚上時段沒有可用標記`);
          }
        }

        // 返回上一頁
        console.log(`go back 返回上一頁`);
        await page.mouse.wheel(0, 200);
        await page.waitForTimeout(200);

        try {
          // 截圖返回操作前的頁面狀態
          const beforeScreenshotPath = path.join(
            process.cwd(),
            "e2e-result",
            `before-back-${Date.now()}.png`
          );
          await page.screenshot({ path: beforeScreenshotPath, fullPage: true });
          console.log(`已保存返回前的截圖: ${beforeScreenshotPath}`);

          // 嘗試點擊返回按鈕
          await page.locator("#ucPCFooter_btnBack").click({ timeout: 30000 });
          await page.waitForLoadState("domcontentloaded");
          await page.waitForTimeout(1000);

          // 截圖返回操作後的頁面狀態
          const afterScreenshotPath = path.join(
            process.cwd(),
            "e2e-result",
            `after-back-${Date.now()}.png`
          );
          await page.screenshot({ path: afterScreenshotPath, fullPage: true });
          console.log(`已保存返回後的截圖: ${afterScreenshotPath}`);
        } catch (error) {
          console.error(`點擊返回按鈕失敗: ${error.message}`);

          // 出錯時截圖並保存
          const errorScreenshotPath = path.join(
            process.cwd(),
            "e2e-result",
            `back-error-${Date.now()}.png`
          );
          await page.screenshot({ path: errorScreenshotPath, fullPage: true });
          console.log(`已保存錯誤截圖: ${errorScreenshotPath}`);

          // 使用瀏覽器的返回功能作為備用方案
          console.log(`嘗試使用瀏覽器返回功能作為備用方案`);
          await page.goBack();
          await page.waitForLoadState("domcontentloaded");
          await page.waitForTimeout(1000);
        }

        // 取消所有選擇，再次點擊之前選擇的標記取消選擇
        console.log(`取消所有選擇`);
        for (const marker of markersToSelect) {
          await page.mouse.wheel(0, 100);
          await page.waitForTimeout(200);
          await marker.click();
          await page.waitForTimeout(300);
        }
      }
    }

    // 如果不是最後一頁，則點擊右箭頭進入下一頁
    if (pageNum < pagesToProcess - 1) {
      console.log(`點擊右箭頭進入下一頁`);

      await page.mouse.wheel(1200, 500);
      await page.waitForTimeout(1000);

      // 改進: 使用更可靠的定位器並添加調試信息
      try {
        // 記錄當前頁面URL和標題，幫助調試
        const currentUrl = page.url();
        const currentTitle = await page.title();
        console.log(`目前頁面URL: ${currentUrl}`);
        console.log(`目前頁面標題: ${currentTitle}`);

        // 檢查並輸出所有可能的下一頁按鈕
        const allInputs = await page.locator('input[type="submit"]').all();
        console.log(`頁面上找到 ${allInputs.length} 個提交按鈕`);

        for (let i = 0; i < allInputs.length; i++) {
          const inputValue = await allInputs[i].getAttribute("value");
          const inputId = await allInputs[i].getAttribute("id");
          const isVisible = await allInputs[i].isVisible();
          console.log(
            `按鈕 ${
              i + 1
            }: id="${inputId}", value="${inputValue}", 可見=${isVisible}`
          );
        }

        // 嘗試多種可能的定位方式
        const nextRightButton = await page
          .locator(
            "input[value='次の月へ'], input[value='次の週へ'], input[value='次の日へ'], input:has-text('次の')"
          )
          .first();

        // 檢查元素是否存在
        const isVisible = await nextRightButton.isVisible();
        console.log(`下一頁按鈕是否可見: ${isVisible}`);

        if (!isVisible) {
          // 截圖並保存，方便調試
          const screenshotPath = path.join(
            process.cwd(),
            "e2e-result",
            `next-button-not-found-${Date.now()}.png`
          );
          await page.screenshot({ path: screenshotPath, fullPage: true });
          console.log(`已保存找不到下一頁按鈕的截圖: ${screenshotPath}`);

          // 記錄頁面HTML，幫助調試
          const html = await page.content();
          console.log(`頁面HTML開始 ==================`);
          console.log(html.substring(0, 2000) + "..."); // 只輸出前2000個字符，避免日誌過長
          console.log(`頁面HTML結束 ==================`);

          const htmlPath = path.join(
            process.cwd(),
            "e2e-result",
            `page-html-${Date.now()}.html`
          );
          fs.writeFileSync(htmlPath, html);
          console.log(`已保存頁面HTML: ${htmlPath}`);

          // 嘗試通過XPath查找按鈕
          console.log(`嘗試通過XPath查找下一頁按鈕`);
          const xpathButtons = await page
            .locator("//input[contains(@value, '次')]")
            .all();
          console.log(`XPath找到 ${xpathButtons.length} 個可能的下一頁按鈕`);

          if (xpathButtons.length > 0) {
            console.log(`使用XPath找到的第一個按鈕`);
            await xpathButtons[0].click();
          } else {
            throw new Error("無法找到下一頁按鈕");
          }
        } else {
          await nextRightButton.click();
        }

        await page.waitForLoadState("domcontentloaded");
        await page.waitForTimeout(1000); // 稍微等待久一點確保頁面加載完成
      } catch (error) {
        console.error(`點擊下一頁按鈕失敗: ${error.message}`);

        // 出錯時截圖並保存
        const errorScreenshotPath = path.join(
          process.cwd(),
          "e2e-result",
          `error-${Date.now()}.png`
        );
        await page.screenshot({ path: errorScreenshotPath, fullPage: true });
        console.log(`已保存錯誤截圖: ${errorScreenshotPath}`);

        // 記錄頁面HTML，幫助調試
        const html = await page.content();
        const htmlPath = path.join(
          process.cwd(),
          "e2e-result",
          `error-html-${Date.now()}.html`
        );
        fs.writeFileSync(htmlPath, html);
        console.log(`已保存錯誤頁面HTML: ${htmlPath}`);

        // 繼續執行下一個頁面的處理
        console.log("因錯誤跳過此頁面，繼續處理其他頁面");
      }

      console.log(`已進入下一頁`);
    } else {
      console.log(`沒有更多頁面，提前結束`);
      break; // 如果沒有下一頁按鈕則跳出循環
    }
  }
  console.log(`總共找到 ${allEveningSlots.length} 個晚上時段可用位置`);
  return allEveningSlots;
}
