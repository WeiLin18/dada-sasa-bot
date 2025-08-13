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

      await sendLineFlexMessage(
        title,
        filteredContents,
        buttonUrl,
        buttonLabel
      );
    } else {
      console.log("未找到晚上時段可用位置");
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
          await page.waitForTimeout(500);
          await marker.click();
          await page.waitForTimeout(1000);
        }

        // 點擊下一步按鈕前進到詳情頁面
        console.log(`點擊"次へ >>"按鈕前進到詳情頁面`);

        const periodHtml = await page.content();
        console.log(
          `\n========== 詳情頁面HTML開始: ${actualFacilityName} ==========`
        );
        console.log(periodHtml.substring(0, 10000) + "..."); // 輸出前10000個字符，避免日誌過長
        console.log(`========== 詳情頁面HTML結束 ==========\n`);

        await page.mouse.wheel(0, 200);
        await page.waitForTimeout(1000);
        const nextButton = page.locator("#ucPCFooter_btnForward");
        await nextButton.click();
        await page.waitForLoadState("domcontentloaded");
        await page.waitForTimeout(1000);

        // 在詳情頁面記錄晚上時段可用的位置
        console.log(`正在詳情頁面尋找晚上時段可用的位置`);

        // 基於您提供的HTML結構直接查找包含設施名稱的行
        console.log(`正在檢查設施: ${actualFacilityName} 的晚上時段`);

        // 輸出頁面HTML，以便在控制台查看頁面結構
        const html = await page.content();
        console.log(
          `\n========== 詳情頁面HTML開始: ${actualFacilityName} ==========`
        );
        console.log(html.substring(0, 5000) + "..."); // 輸出前5000個字符，避免日誌過長
        console.log(`========== 詳情頁面HTML結束 ==========\n`);

        // 截圖詳情頁面，方便查看頁面結構
        const detailScreenshotPath = path.join(
          process.cwd(),
          "e2e-result",
          `detail-page-${actualFacilityName.replace(
            /[\/\s\(\)（）]/g,
            "_"
          )}-${Date.now()}.png`
        );
        await page.screenshot({ path: detailScreenshotPath, fullPage: true });
        console.log(`已保存詳情頁面截圖: ${detailScreenshotPath}`);

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

            // 輸出找到可用時段的表格HTML結構
            const tableHtml = await table.evaluate((node) => node.outerHTML);
            console.log(
              `\n========== 可用時段表格HTML開始: ${actualFacilityName}-${dateText} ==========`
            );
            console.log(tableHtml);
            console.log(`========== 可用時段表格HTML結束 ==========\n`);

            // 截圖記錄找到的可用時段
            const availableSlotScreenshotPath = path.join(
              process.cwd(),
              "e2e-result",
              `available-slot-${actualFacilityName.replace(
                /[\/\s\(\)（）]/g,
                "_"
              )}-${formattedDate}-${Date.now()}.png`
            );
            await page.screenshot({
              path: availableSlotScreenshotPath,
              fullPage: true,
            });
            console.log(`已保存可用時段截圖: ${availableSlotScreenshotPath}`);

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
        console.log(`嘗試返回上一頁`);
        try {
          // 截圖：返回按鈕點擊前
          const backButtonBeforeScreenshot = path.join(
            process.cwd(),
            "e2e-result",
            `back-button-before-${Date.now()}.png`
          );
          await page.screenshot({
            path: backButtonBeforeScreenshot,
            fullPage: true,
          });
          console.log(
            `已保存返回按鈕點擊前截圖: ${backButtonBeforeScreenshot}`
          );

          // 獲取按鈕HTML
          const backButtonHtml = await page
            .locator("#ucPCFooter_btnBack")
            .evaluate((node) => (node ? node.outerHTML : "未找到返回按鈕"));
          console.log(`返回按鈕HTML: ${backButtonHtml}`);

          // 滾動到按鈕位置
          await page.mouse.wheel(0, 200);
          await page.waitForTimeout(300);

          // 嘗試點擊返回按鈕
          await page.locator("#ucPCFooter_btnBack").click({ timeout: 5000 });
          await page.waitForTimeout(500);
          await page.waitForLoadState("domcontentloaded", { timeout: 10000 });

          // 截圖：返回按鈕點擊後
          const backButtonAfterScreenshot = path.join(
            process.cwd(),
            "e2e-result",
            `back-button-after-${Date.now()}.png`
          );
          await page.screenshot({
            path: backButtonAfterScreenshot,
            fullPage: true,
          });
          console.log(`已保存返回按鈕點擊後截圖: ${backButtonAfterScreenshot}`);
          console.log(`返回上一頁成功`);
        } catch (err) {
          console.error(`返回按鈕點擊失敗: ${err}`);
          // 保存錯誤截圖
          const backButtonErrorScreenshot = path.join(
            process.cwd(),
            "e2e-result",
            `back-button-error-${Date.now()}.png`
          );
          await page.screenshot({
            path: backButtonErrorScreenshot,
            fullPage: true,
          });
          console.log(`已保存返回按鈕錯誤截圖: ${backButtonErrorScreenshot}`);

          // 輸出當前頁面HTML幫助調試
          const pageHtml = await page.content();
          console.log(
            `頁面HTML(截取前5000字元): ${pageHtml.substring(0, 5000)}`
          );

          // 嘗試使用瀏覽器返回功能
          try {
            console.log(`嘗試使用瀏覽器goBack()功能返回上一頁`);
            await page.goBack({ timeout: 10000 });
            await page.waitForLoadState("domcontentloaded", { timeout: 10000 });
            console.log(`使用goBack()返回成功`);
          } catch (backErr) {
            console.error(`使用goBack()返回也失敗: ${backErr}`);
            testIssues.push(`返回按鈕點擊失敗: ${err}`);
          }
        }

        // 取消所有選擇，再次點擊之前選擇的標記取消選擇
        console.log(`開始取消選擇`);
        try {
          for (const marker of markersToSelect) {
            await page.mouse.wheel(0, 100);
            await page.waitForTimeout(200);
            await marker.click();
            await page.waitForTimeout(300);
          }
          console.log(`已取消所有選擇`);
        } catch (err) {
          console.error(`取消選擇失敗: ${err}`);
          testIssues.push(`取消選擇失敗: ${err}`);
        }
      }
    }

    // 如果不是最後一頁，則點擊右箭頭進入下一頁
    if (pageNum < pagesToProcess - 1) {
      console.log(`點擊右箭頭進入下一頁`);

      await page.mouse.wheel(1200, 500);
      await page.waitForTimeout(1000);
      const tableFooter = await page.locator("#TableFoot");
      const nextRightButton = await tableFooter.locator(
        "a:has-text('次の期間を表示')"
      );

      await nextRightButton.click();
      await page.waitForLoadState("domcontentloaded");
      await page.waitForTimeout(1000); // 稍微等待久一點確保頁面加載完成

      console.log(`已進入下一頁`);
    } else {
      console.log(`沒有更多頁面，提前結束`);
      break; // 如果沒有下一頁按鈕則跳出循環
    }
  }
  console.log(`總共找到 ${allEveningSlots.length} 個晚上時段可用位置`);
  return allEveningSlots;
}
