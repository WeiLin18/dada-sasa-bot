import type { Page, Locator } from "@playwright/test";
import { test } from "@playwright/test";
import { isPriorityTime, getAllExcludedDates } from "../src/config";
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

// 定義需要選擇的設施類型（夜間巡邏用）
const facilityTypes = [
  // "第１競技場（全面）",
  // "第１競技場（半面Ａ）",
  // "第１競技場（半面Ｂ）",
  "第２競技場",
];

// 週末（土日）全天巡邏的場地。
// 週末通常有場就打，所以四個競技場都看；武道場／弓道場／相撲場／会議室 不是羽球場，不列入。
const weekendFacilityTypes = [
  "第１競技場（全面）",
  "第１競技場（半面Ａ）",
  "第１競技場（半面Ｂ）",
  "第２競技場",
];

// 週末巡邏最多往後看幾個月（含當月）。
// 台東目前開放到約 4 個月後（例：2026/08 當下可看到 2026/12，2027/01 起全是「－」），
// 掃到某個月完全沒有可申請的格子就提前結束，不用白跑。
const WEEKEND_MAX_MONTHS = 6;

// 在測試最開始增加錯誤收集功能
test("查詢台東設施的晚上時段可用性", async ({ browser }) => {
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

  let eveningSlots: string[] = [];
  let twoMonthEveningSlots: string[] = [];

  // 步驟 3：搜尋晚上時段可用性並報告
  await test.step("搜尋晚上時段可用性", async () => {
    // 尋找並選擇晚上時段（18:00～21:00）有○的位置
    console.log("正在尋找晚上時段（18:00～21:00）有○的位置...");
    await page.waitForTimeout(1000);
    eveningSlots = await getAvailableSlots();
  });

  await test.step("搜尋兩個月後的晚上時段可用性", async () => {
    console.log("正在尋找兩個月後的晚上時段（18:00～21:00）有○的位置...");
    await page.goto("https://shisetsu.city.taito.lg.jp/");
    await page.waitForLoadState("domcontentloaded");

    await test.step("導航到設施頁面", async () => {
      await page.getByRole("button", { name: "運動施設" }).click();
      await page.waitForLoadState("domcontentloaded");
      await page
        .getByRole("button", { name: "台東リバーサイドＳＣ体育館" })
        .click();
      await page.getByRole("button", { name: "次へ >>" }).click();
      await page.waitForLoadState("domcontentloaded");
      await page.waitForTimeout(1000);

      // 年份也要一起填。原本只填月份，跨年時（11 月往後兩個月 = 1 月）
      // 會變成查「今年 1 月」這個已經過去的月份，而不是明年 1 月。
      // 先把日設成 1 再加月，避免月底日期造成的溢位（例如 1/31 + 1 個月 = 3/3）。
      const twoMonthsLater = new Date();
      twoMonthsLater.setDate(1);
      twoMonthsLater.setMonth(twoMonthsLater.getMonth() + 2);
      const targetYear = twoMonthsLater.getFullYear();
      const targetMonth = twoMonthsLater.getMonth() + 1;
      await page.locator("#txtYear").fill(String(targetYear));
      await page.locator("#txtMonth").fill(String(targetMonth));
      console.log("已填寫年月", targetYear, targetMonth);
      await page.getByRole("button", { name: "1ヶ月" }).click();
      await page.getByRole("button", { name: "夜間" }).click();
      await page.getByRole("button", { name: "横表示" }).click();
      await page.getByRole("button", { name: "次へ >>" }).click();
      await page.waitForLoadState("domcontentloaded");
      console.log("已導航到可用性日曆");
    });

    await test.step("搜尋兩個月後的晚上時段可用性", async () => {
      console.log("正在尋找兩個月後的晚上時段（18:00～21:00）有○的位置...");
      await page.waitForTimeout(1000);
      twoMonthEveningSlots = await getAvailableSlots();
    });
  });

  // 週末（土日）全天巡邏，往後掃到申込期間結束為止
  let weekendSlots: string[] = [];

  await test.step("搜尋週末全天可用性", async () => {
    console.log("正在尋找週末（土日）全天有○或△的位置...");
    weekendSlots = await getWeekendSlots();
    console.log(`台東 - 週末找到 ${weekendSlots.length} 個可用位置`);
  });

  await test.step("發送通知", async () => {
    const nightSlots = [...eveningSlots, ...twoMonthEveningSlots];

    // 晚上或週末任一有找到就通知
    if (nightSlots.length > 0 || weekendSlots.length > 0) {
      console.log(
        `台東 - 晚上 ${nightSlots.length} 筆、週末 ${weekendSlots.length} 筆`
      );

      console.log("台東 - 依日期顯示可用位置：");

      // 準備要發送的訊息內容
      const title =
        nightSlots.length > 0 && weekendSlots.length > 0
          ? `🏸 台東晚上 & 週末時段釋出🔥`
          : weekendSlots.length > 0
          ? `🏸 台東週末時段釋出🔥`
          : `🏸 台東時段釋出🔥`;
      const contents = [
        ...nightSlots,
        ...(weekendSlots.length > 0 && nightSlots.length > 0 ? [" "] : []),
        ...weekendSlots,
      ];

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
      console.log("台東 - 未找到晚上或週末可用位置");
      // 發送無可用位置的通知
      const title = `🏸 台東施設情報`;
      const contents = ["目前沒有晚上或週末可用位置"];
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

      await page.waitForTimeout(3000);
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
        // 包含靜態排除日期 + 動態近期日期（從今天算起5天內）
        const excludedDates = getAllExcludedDates();
        for (const marker of availableMarkers) {
          // 檢查日期是否在排除清單中
          if (excludedDates.includes(marker.date)) {
            console.log(`跳過排除日期: ${marker.date}`);
            continue;
          }

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

/**
 * 週末（土日）全天巡邏。
 * 一個月一個月往後看，每個月都重新走一次「日時選択」設定：
 * 年月 → 1ヶ月 → 全日 → 土 → 日 → 横表示 → 次へ。
 * 曜日篩選交給網站處理，回來的表格就只剩土日的欄位，不必自己算週末。
 */
async function getWeekendSlots(): Promise<string[]> {
  const found: string[] = [];
  const excludedDates = getAllExcludedDates();
  const now = new Date();

  for (let offset = 0; offset < WEEKEND_MAX_MONTHS; offset++) {
    const target = new Date(now.getFullYear(), now.getMonth() + offset, 1);
    const year = target.getFullYear();
    const month = target.getMonth() + 1;

    await navigateToWeekendCalendar(year, month);

    const table = page.locator("table#dlRepeat_ctl00_tpItem_dgTable");

    // 判斷這個月是否還在申込期間內。超出期間的月份整張表只會有「－」或「休館日」，
    // 完全不會出現 ○ / △ / ×，用這個當結束條件。
    const inWindow = await table.evaluate((el) =>
      [...el.querySelectorAll("td")].some((td) => {
        const mark = (td.textContent || "").trim();
        return mark === "○" || mark === "△" || mark === "×";
      })
    );
    if (!inWindow) {
      console.log(`台東 - ${year}/${month} 已超出申込期間，結束週末巡邏`);
      break;
    }

    const rows = await table.evaluate((el, wanted) => {
      const result: { name: string; marks: { date: string; mark: string }[] }[] =
        [];

      [...el.querySelectorAll("tr")].forEach((tr) => {
        const cells = [...tr.querySelectorAll("td")];
        const name = (cells[0]?.textContent || "").trim();
        if (!wanted.includes(name)) return;

        // cells[0] 是場地名、cells[1] 是定員，之後才是各日期的格子
        const marks = cells
          .slice(2)
          .map((td) => {
            const mark = (td.textContent || "").trim();
            // 日期只能從連結的 href 取（格式如 b20261205），表頭只有「5土」這種文字
            const matched = td
              .querySelector("a")
              ?.getAttribute("href")
              ?.match(/b(\d{8})/);
            if (!matched) return null;
            const raw = matched[1];
            return {
              date: `${raw.slice(0, 4)}/${raw.slice(4, 6)}/${raw.slice(6, 8)}`,
              mark,
            };
          })
          .filter((cell): cell is { date: string; mark: string } => !!cell);

        result.push({ name, marks });
      });

      return result;
    }, weekendFacilityTypes);

    let monthCount = 0;
    for (const row of rows) {
      for (const { date, mark } of row.marks) {
        if (mark !== "○" && mark !== "△") continue;
        if (excludedDates.includes(date)) {
          console.log(`跳過排除日期: ${date}`);
          continue;
        }
        const slotInfo = `${row.name} - ${date} - ${mark}（週末）`;
        found.push(slotInfo);
        monthCount += 1;
        console.log(`找到週末可用時段: ${slotInfo}`);
      }
    }
    console.log(`台東 - ${year}/${month} 週末找到 ${monthCount} 筆`);
  }

  return found;
}

/**
 * 走一次「日時選択」，設定成指定年月的週末全天橫表示
 */
async function navigateToWeekendCalendar(
  year: number,
  month: number
): Promise<void> {
  await page.goto("https://shisetsu.city.taito.lg.jp/");
  await page.waitForLoadState("domcontentloaded");
  await page.waitForTimeout(1000);
  await page.getByRole("button", { name: "運動施設" }).click();
  await page.waitForLoadState("domcontentloaded");
  await page.waitForTimeout(700);
  await page
    .getByRole("button", { name: "台東リバーサイドＳＣ体育館" })
    .click();
  await page.getByRole("button", { name: "次へ >>" }).click();
  await page.waitForLoadState("domcontentloaded");
  await page.waitForTimeout(1000);

  // 年份一定要一起填，不然跨年時（例如 12 月往後看 1 月）會查到今年的過去月份
  await page.locator("#txtYear").fill(String(year));
  await page.locator("#txtMonth").fill(String(month));
  await page.locator("#txtDay").fill("1");

  // 這些都是 submit 按鈕，每按一次就是一次 postback，要逐一等頁面回來
  for (const selector of [
    "#rbtnMonth", // 1ヶ月
    "#rbtnAllday", // 全日
    "#chkSat", // 土
    "#chkSun", // 日
    "#rbYoko", // 横表示
  ]) {
    await page.locator(selector).click();
    await page.waitForLoadState("domcontentloaded");
    await page.waitForTimeout(700);
  }

  await page.getByRole("button", { name: "次へ >>" }).click();
  await page.waitForLoadState("domcontentloaded");
  await page.waitForTimeout(2500);
  console.log(`台東 - 已進入 ${year}/${month} 週末全天日曆`);
}
