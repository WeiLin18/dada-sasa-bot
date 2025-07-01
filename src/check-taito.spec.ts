import type { Page, Locator } from "@playwright/test";
import { test } from "@playwright/test";
import { config } from "./config";
import { sendLineFlexMessage } from "./sendLineMessage";

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

/**
 * 獲取頁面上的返回按鈕，嘗試多種選擇器以提高穩定性
 * 優先使用ID、名稱、值、角色和文本的多重選擇器
 */
async function getBackButton(page: Page): Promise<Locator> {
  // 檢查是否有"<< 戻る"文本的連結按鈕
  const backLinkByText = page.getByRole("link", { name: "<< 戻る" });
  if (await backLinkByText.isVisible()) {
    console.log("找到'<< 戻る'文本的連結按鈕");
    return backLinkByText;
  }

  // 檢查是否有ID為"btnBack"的按鈕
  const backBtnById = page.locator("#btnBack");
  if (await backBtnById.isVisible()) {
    console.log("找到ID為'btnBack'的按鈕");
    return backBtnById;
  }

  // 檢查是否有name為"btnBack"的按鈕
  const backBtnByName = page.locator("button[name='btnBack']");
  if (await backBtnByName.isVisible()) {
    console.log("找到name為'btnBack'的按鈕");
    return backBtnByName;
  }

  // 檢查是否有包含"戻る"文本的按鈕
  const backBtnByContainsText = page.getByRole("button", { name: /戻る/ });
  if (await backBtnByContainsText.isVisible()) {
    console.log("找到包含'戻る'文本的按鈕");
    return backBtnByContainsText;
  }

  // 檢查是否有value為"戻る"的按鈕
  const backBtnByValue = page.locator("input[value*='戻る']");
  if (await backBtnByValue.isVisible()) {
    console.log("找到value包含'戻る'的按鈕");
    return backBtnByValue;
  }

  // 如果上述都找不到，嘗試更寬泛的選擇器
  console.log("使用通用的返回按鈕選擇器");
  return page
    .locator(
      "a:has-text('<< 戻る'), button:has-text('戻る'), input[value*='戻る']"
    )
    .first();
}

test("查詢台東設施的晚上時段可用性（完整版）", async ({ browser }) => {
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
    // 檢查是否在優先時間範圍內
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
      `當前時間不在指定的優先時間 [${config.priorityHours.join(", ")}] 的前後${
        config.rangeMinutes
      }分鐘內，跳過執行`
    );
    test.skip();
    return;
  }

  console.log(
    `當前時間在指定的優先時間 [${config.priorityHours.join(", ")}] 的前後${
      config.rangeMinutes
    }分鐘內，開始執行測試`
  );

  // 創建新頁面並設置超時
  page = await browser.newPage();
  page.setDefaultTimeout(60000); // 60秒超時

  await test.step("登入系統", async () => {
    try {
      console.log("正在導航到登入頁面...");
      await page.goto("https://shisetsu.city.taito.lg.jp/");
      await page.waitForLoadState("domcontentloaded");

      console.log("點擊登入按鈕...");
      await page.getByRole("button", { name: "ログインする" }).click();
      await page.waitForLoadState("domcontentloaded");

      console.log("填寫登入資訊...");
      await page.locator("#txtID").fill(config.taiUserId as string);
      await page.locator("#txtPass").fill(config.taiPassword as string);
      await page.getByRole("button", { name: "ログイン" }).click();
      await page.waitForLoadState("domcontentloaded");
      console.log("登入成功");
    } catch (error) {
      console.error("登入失敗:", error);
      await page.screenshot({ path: "e2e-result/login-error.png" });
      throw error;
    }
  });

  await test.step("導航到設施頁面", async () => {
    try {
      console.log("點擊運動施設按鈕...");
      await page.getByRole("button", { name: "運動施設" }).click();
      await page.waitForLoadState("domcontentloaded");

      console.log("選擇台東體育館...");
      await page
        .getByRole("button", { name: "台東リバーサイドＳＣ体育館" })
        .click();

      console.log("點擊下一步按鈕...");
      await page.getByRole("button", { name: "次へ >>" }).click();
      await page.waitForLoadState("domcontentloaded");

      console.log("選擇1個月顯示...");
      await page.getByRole("button", { name: "1ヶ月" }).click();

      console.log("選擇橫向顯示...");
      await page.getByRole("button", { name: "横表示" }).click();

      console.log("再次點擊下一步按鈕...");
      await page.getByRole("button", { name: "次へ >>" }).click();
      await page.waitForLoadState("domcontentloaded");

      console.log("已導航到可用性日曆");
    } catch (error) {
      console.error("導航到設施頁面失敗:", error);
      await page.screenshot({ path: "e2e-result/navigation-error.png" });
      throw error;
    }
  });

  await test.step("搜尋晚上時段可用性", async () => {
    try {
      console.log("正在尋找晚上時段（18:00～21:00）有○的位置...");
      const eveningSlots = await selectAvailableSlots();

      if (eveningSlots.length > 0) {
        console.log(`找到 ${eveningSlots.length} 個晚上時段可用位置`);

        // 依日期分組位置以便更好地可視化
        const slotsByDate = groupSlotsByDate(eveningSlots);
        console.log("依日期顯示可用位置：");

        // 準備要發送的訊息內容
        const title = `🏸 台東施設情報（晚上時段）`;
        const contents = [`找到 ${eveningSlots.length} 個晚上時段可用位置`];

        for (const [date, slots] of Object.entries(slotsByDate)) {
          // 添加間隔行
          contents.push(" "); // 空格代替空字符串作為間隔
          contents.push(`📅 ${date}: ${slots.length}`);

          for (const slot of slots) {
            const weekdayInfo = slot.weekday ? ` (${slot.weekday})` : "";
            console.log(`  - ${slot.facility}: ${slot.timeSlot}${weekdayInfo}`);
            contents.push(
              `  - ${slot.facility}: ${slot.timeSlot}${weekdayInfo}`
            );
          }
        }

        // 發送摘要通知
        const buttonUrl = "https://shisetsu.city.taito.lg.jp/";
        const buttonLabel = "予約サイトへ";
        console.log("發送通知...");

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
    } catch (error) {
      console.error("搜尋晚上時段可用性失敗:", error);
      await page.screenshot({ path: "e2e-result/search-error.png" });
      throw error;
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

  // 設定要處理的頁數，預設為3頁
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
        console.log(`正在處理設施行: ${actualFacilityName}`);

        try {
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
            try {
              const markerText = await marker.textContent();
              console.log(`點擊標記: ${markerText}`);
              await page.mouse.wheel(0, 100);
              await page.waitForTimeout(300);
              await marker.click();
              await page.waitForTimeout(500);
            } catch (clickError) {
              console.error(`點擊標記失敗: ${clickError}`);
              await page.screenshot({
                path: `e2e-result/marker-click-error-${pageNum}-${rowIndex}.png`,
              });
              // 繼續下一個標記
              continue;
            }
          }

          // 點擊下一步按鈕前進到詳情頁面
          console.log(`點擊"次へ >>"按鈕前進到詳情頁面`);
          const nextButton = page.locator("#ucPCFooter_pnlNextBtn");
          await page.mouse.wheel(0, 100);
          await page.waitForTimeout(300);

          try {
            await nextButton.click();
            await page.waitForLoadState("domcontentloaded");
            await page.waitForTimeout(800);
          } catch (nextButtonError) {
            console.error(`點擊下一步按鈕失敗: ${nextButtonError}`);
            await page.screenshot({
              path: `e2e-result/next-button-error-${pageNum}-${rowIndex}.png`,
            });

            // 如果無法點擊下一步，取消當前所有選擇並繼續下一個設施
            for (const marker of markersToSelect) {
              try {
                await page.mouse.wheel(0, 100);
                await page.waitForTimeout(300);
                await marker.click();
                await page.waitForTimeout(500);
              } catch (e) {
                console.error(`取消選擇標記失敗: ${e}`);
              }
            }
            continue;
          }

          // 在詳情頁面記錄晚上時段可用的位置
          console.log(`正在詳情頁面尋找晚上時段可用的位置`);

          // 檢查設施的晚上時段
          console.log(`正在檢查設施: ${actualFacilityName} 的晚上時段`);

          try {
            const tables = await page.locator("table#Table1").all();

            for (const table of tables) {
              // 獲取當前日期信息
              const dateText =
                (await table
                  .locator("tr.TitleColor td")
                  .first()
                  .textContent()) || "";
              console.log(`詳情頁面日期: ${dateText}`);
              const formattedDate = formatDate(dateText);
              const weekday = new Date(formattedDate).toLocaleDateString(
                "ja-JP",
                {
                  weekday: "short",
                }
              );

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

              // 檢查晚上時段是否有○標記
              let isEveningAvailable = false;

              // 嘗試找 ○ 標記
              const cellFour = cells[4];
              if (cellFour) {
                const circleLocator = cellFour.locator("a:has-text('○')");
                isEveningAvailable = await circleLocator.isVisible();
              }

              // 如果找不到 ○ 標記，嘗試找 △ 標記作為備選
              if (!isEveningAvailable && cells[4]) {
                const triangleLocator = cells[4].locator("a:has-text('△')");
                isEveningAvailable = await triangleLocator.isVisible();
              }

              if (isEveningAvailable) {
                console.log(
                  `找到晚上時段可用: ${actualFacilityName}-${dateText}`
                );

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
                console.log(
                  `設施 ${actualFacilityName} 的晚上時段沒有可用標記`
                );
              }
            }
          } catch (detailsError) {
            console.error(`處理詳情頁面失敗: ${detailsError}`);
            await page.screenshot({
              path: `e2e-result/details-error-${pageNum}-${rowIndex}.png`,
            });
          }

          // 返回上一頁
          console.log(`嘗試返回上一頁`);
          await page.waitForTimeout(1000);
          await page.mouse.wheel(0, 500);

          try {
            // 使用 getBackButton 工具函數獲取返回按鈕
            const backButton = await getBackButton(page);
            await backButton.click();
            await page.waitForLoadState("domcontentloaded");
            await page.waitForTimeout(1000);
          } catch (backButtonError) {
            console.error(`點擊返回按鈕失敗: ${backButtonError}`);
            await page.screenshot({
              path: `e2e-result/back-button-error-${pageNum}-${rowIndex}.png`,
            });

            // 如果無法返回，嘗試使用瀏覽器的後退功能
            try {
              console.log(`嘗試使用瀏覽器的後退功能`);
              await page.goBack();
              await page.waitForLoadState("domcontentloaded");
              await page.waitForTimeout(1000);
            } catch (goBackError) {
              console.error(`瀏覽器後退失敗: ${goBackError}`);
              // 如果後退也失敗，重新載入頁面並跳過當前設施
              await page.reload();
              await page.waitForLoadState("domcontentloaded");
              break;
            }
          }

          // 取消所有選擇，再次點擊之前選擇的標記取消選擇
          console.log(`取消所有選擇`);
          for (const marker of markersToSelect) {
            try {
              await page.mouse.wheel(0, 100);
              await page.waitForTimeout(300);
              await marker.click();
              await page.waitForTimeout(500);
            } catch (deselectError) {
              console.error(`取消選擇標記失敗: ${deselectError}`);
              // 繼續下一個標記
              continue;
            }
          }
        } catch (rowError) {
          console.error(`處理設施行失敗: ${rowError}`);
          await page.screenshot({
            path: `e2e-result/row-error-${pageNum}-${rowIndex}.png`,
          });
          // 繼續下一個設施行
          continue;
        }
      }
    }

    // 如果不是最後一頁，則點擊右箭頭進入下一頁
    if (pageNum < pagesToProcess - 1) {
      console.log(`嘗試進入下一頁`);
      try {
        const nextRightButton = await page.locator(
          "#dlRepeat_ctl00_tpItem_Migrated_lnkNextSpan"
        );

        await page.mouse.wheel(0, 100);
        await page.waitForTimeout(300);
        await nextRightButton.click();
        await page.waitForLoadState("domcontentloaded");
        await page.waitForTimeout(1500); // 稍微等待久一點確保頁面加載完成

        console.log(`已進入下一頁`);
      } catch (nextPageError) {
        console.error(`進入下一頁失敗: ${nextPageError}`);
        await page.screenshot({
          path: `e2e-result/next-page-error-${pageNum}.png`,
        });
        break; // 如果無法進入下一頁則跳出循環
      }
    } else {
      console.log(`沒有更多頁面，提前結束`);
      break; // 如果沒有下一頁按鈕則跳出循環
    }
  }

  console.log(`總共找到 ${allEveningSlots.length} 個晚上時段可用位置`);
  return allEveningSlots;
}
