import type { Page } from "@playwright/test";
import { test } from "@playwright/test";
import { sendLineFlexMessage } from "../src/sendLineMessage";
import {
  getAllExcludedDates,
  isNightBlackout,
  isToshimaReleaseWindow,
} from "../src/config";

let page: Page;

const TOSHIMA_URL = "https://www2.pf489.com/toshima/WebR/Home/WgR_ModeSelect";

// 要掃的設施（としま産業振興プラザ※イケビズ 不掃）
const facilities = [
  "豊島体育館",
  "巣鴨体育館",
  "雑司が谷体育館",
  "南長崎スポーツセンター",
  "ふるさと千川館",
];

// ふるさと千川館 是以 1 小時為單位開放，只回報連續 3 小時以上的時段
const CONTINUOUS_FACILITY = "ふるさと千川館";
const CONTINUOUS_MIN_MINUTES = 180;

// 平日只看跨過 18:00 之後的時段（週末則全天都看）
const WEEKDAY_EVENING_FROM = 18 * 60;

// 一次掃一個「1ヶ月」區間，往後推到申込期間結束為止。
// 豊島區目前只開放到「次月底」（例：8/15 當下只到 9/30），超出的日期會顯示「－」且沒有 checkbox，
// 所以掃到某個區間完全沒有可申請的格子時就提前結束，不用白跑。
// MAX_PERIODS 只是上限，開放期間變長時會自動掃得更遠。
const MAX_PERIODS = 4;
const PERIOD_DAYS = 30;

// 單一點擊的上限。站台跳出對話框時遮罩會攔截所有點擊，而遮罩不會自己消失，
// 沒有這個上限的話單一個點擊就會一路重試到整份測試 timeout（10 分鐘）為止。
const CLICK_TIMEOUT = 15000;

// 站台一次最多只能勾 20 個日期。勾第 21 個時不但不會生效，還會把
// location.hash 設成 #messageDlg，讓錯誤對話框自動彈出來把整頁蓋住，
// 之後每個點擊都被遮罩攔截，一路重試到測試逾時。
// 所以超過 20 個就分批送出，一批一批查。
const MAX_DATES_PER_SUBMIT = 20;
// 分批的保險上限，避免極端情況下無限迴圈
const MAX_BATCHES_PER_PERIOD = 5;

// 單一時段（例：9:00～12:00）
interface Slot {
  start: number; // 開始時間（當日分鐘數）
  end: number; // 結束時間（當日分鐘數）
  label: string; // 原始文字
}

// 時間帶別空き状況頁面上的一列（設施 × 場地 × 日期）
interface RowAvailability {
  facility: string; // 設施名稱，例：豊島体育館
  room: string; // 場地名稱，例：Ａ面 / 多目的ホール
  date: string; // YYYY/MM/DD
  weekday: string; // 月火水木金土日
  isWeekend: boolean; // 週末或國定假日
  slots: Slot[]; // 有空（○）的時段
}

const toMinutes = (time: string): number => {
  const [hour, minute] = time.split(":").map(Number);
  return hour * 60 + minute;
};

const toTimeText = (minutes: number): string =>
  `${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, "0")}`;

// 把相鄰（前一段結束 === 下一段開始）的時段合併成連續區塊
const mergeContinuousSlots = (slots: Slot[]): Slot[] => {
  const sorted = [...slots].sort((a, b) => a.start - b.start);
  const merged: Slot[] = [];

  for (const slot of sorted) {
    const last = merged[merged.length - 1];
    if (last && last.end === slot.start) {
      last.end = slot.end;
      last.label = `${toTimeText(last.start)}～${toTimeText(last.end)}`;
    } else {
      merged.push({ ...slot });
    }
  }

  return merged;
};

test("查詢豊島設施的平日晚上與週末可用性", async ({ browser }) => {
  // 釋出時段（每月 1 號與 21 號 JST 09:00～10:00）在 CI 上跳過
  test.skip(
    !!process.env.CI && isToshimaReleaseWindow(),
    "豊島區釋出時段（每月 1 號與 21 號 JST 09:00～10:00），CI 跳過"
  );

  test.skip(isNightBlackout(), "日本時間 01:00-05:59 夜間黑名單時段，跳過測試");

  page = await browser.newPage();
  await page.goto(TOSHIMA_URL);
  await page.waitForLoadState("domcontentloaded");

  // 步驟 1：用「使用目的から探す」→ 屋内スポーツ → バドミントン 搜尋（豊島區不需登入）
  await test.step("搜尋バドミントン可用設施", async () => {
    await page.getByRole("link", { name: "使用目的から探す" }).click();
    await page.waitForTimeout(500);
    await page.getByText("屋内スポーツ", { exact: true }).click();
    await page.waitForTimeout(800);
    await page.locator('label[for="checkPurposeMiddle503"]').click(); // バドミントン
    await page.locator("#btnSearchViaPurposeOption").click();
    await page.waitForLoadState("domcontentloaded");
    await page.waitForTimeout(2500);
    console.log("已進入施設検索頁");
  });

  // 步驟 2：勾選要掃的設施後進入施設別空き状況
  await test.step("選擇設施", async () => {
    for (const facility of facilities) {
      await page
        .locator("#shisetsu label", { hasText: facility })
        .first()
        .click();
      await page.waitForTimeout(150);
    }
    await page.locator("#btnNext").click();
    await page.waitForLoadState("domcontentloaded");
    await page.waitForTimeout(3000);
    console.log(`已選擇 ${facilities.length} 個設施並進入空き状況頁`);
  });

  const allRows: RowAvailability[] = [];

  // 步驟 3：一個區間一個區間掃（施設別空き状況 → 時間帯別空き状況 → 返回）
  let reachedEndOfWindow = false;

  for (let period = 0; period < MAX_PERIODS && !reachedEndOfWindow; period++) {
    await test.step(`掃描第 ${period + 1} 個區間`, async () => {
      const startDate = new Date();
      startDate.setDate(startDate.getDate() + period * PERIOD_DAYS);
      const startDateText = `${startDate.getFullYear()}/${
        startDate.getMonth() + 1
      }/${startDate.getDate()}`;
      const label = `區間 ${period + 1}`;

      for (let batch = 0; batch < MAX_BATCHES_PER_PERIOD; batch++) {
        // 每一批都重新套用顯示條件再重新抓一次候選，
        // 這樣 checkdate 的編號一定對應到當下畫面，不會因為返回後版面變動而錯位
        await showPeriod(startDateText);
        await dismissBlockingDialog(`${label} 批次 ${batch + 1} 表示後`);

        // 送出後按「前に戻る」回來時，上一批的勾選還留著。不清掉的話下一批會
        // 疊加上去，不但很快撞到 20 個的上限，解析結果也會重複計入。
        const cleared = await clearDateSelections();
        if (cleared > 0) {
          console.log(`[${label}] 批次 ${batch + 1}：清掉上一批的 ${cleared} 個勾選`);
        }

        const { bookableCells, candidates } = await collectCandidates();

        // 整個區間都在申込期間外，代表已經掃到開放期間的尾巴了
        if (bookableCells === 0) {
          console.log(`[${label}] 已超出申込期間，結束掃描`);
          reachedEndOfWindow = true;
          return;
        }

        const excludedDates = getAllExcludedDates();
        const targets = candidates.filter(({ date }) => {
          if (!excludedDates.includes(date)) return true;
          if (batch === 0) console.log(`跳過排除日期: ${date}`);
          return false;
        });

        if (batch === 0) {
          console.log(
            `[${label}] 有空的日期數: ${targets.length}（每批最多 ${MAX_DATES_PER_SUBMIT} 個）`
          );
        }

        const chunk = targets.slice(
          batch * MAX_DATES_PER_SUBMIT,
          (batch + 1) * MAX_DATES_PER_SUBMIT
        );
        if (chunk.length === 0) return;

        console.log(
          `[${label}] 批次 ${batch + 1}：勾選 ${chunk.length} 個日期`
        );

        // 一旦遇過被遮擋，之後就直接用 DOM 點擊，不用每個都先白等一次逾時
        let useDomClick = false;
        let blocked = false;

        for (const { id } of chunk) {
          if (!useDomClick) {
            try {
              await page
                .locator(`label[for="${id}"]`)
                .click({ timeout: CLICK_TIMEOUT });
              continue;
            } catch {
              // 可能是對話框遮罩，也可能是表格的固定表頭浮層蓋住了格子
              await dismissBlockingDialog(`${label} 勾選 ${id}`);
              useDomClick = true;
            }
          }

          if (!(await toggleDateByDom(id))) {
            console.warn(`[${label}] 勾選 ${id} 失敗，跳過此批次`);
            blocked = true;
            break;
          }
        }
        if (blocked) continue;

        await page
          .getByRole("link", { name: "次へ進む" })
          .click({ timeout: CLICK_TIMEOUT });
        await page.waitForLoadState("domcontentloaded");
        await page.waitForTimeout(4000);

        await dismissBlockingDialog(`${label} 次へ進む後`);

        // 跳出對話框時站台會停留在原頁面而不是導向時間帯別空き状況。
        // 用網址判斷有沒有真的換頁，比比對對話框文字可靠（訊息內容會變）。
        if (!page.url().includes("JikantaibetsuAkiJoukyou")) {
          console.warn(
            `[${label}] 批次 ${batch + 1} 未進入時間帯別空き状況，跳過（URL: ${page.url()}）`
          );
          continue;
        }

        const rows = await parseTimeSlotPage();
        console.log(
          `[${label}] 批次 ${batch + 1} 解析到 ${rows.length} 列有空時段`
        );
        for (const row of rows) {
          console.log(
            `  ${row.facility} ${row.room} ${row.date}(${row.weekday}) 週末=${
              row.isWeekend
            }: ${row.slots.map((slot) => slot.label).join(", ")}`
          );
        }
        allRows.push(...rows);

        // 回到施設別空き状況，準備下一批
        await page
          .getByRole("link", { name: "前に戻る" })
          .first()
          .click({ timeout: CLICK_TIMEOUT });
        await page.waitForLoadState("domcontentloaded");
        await page.waitForTimeout(3000);
        await dismissBlockingDialog(`${label} 前に戻る後`);
      }
    });
  }

  // 步驟 4：套用「平日 18 點後 / 週末全天」與「ふるさと千川館 連續 3 小時」條件
  const contents: string[] = [];

  await test.step("篩選符合條件的時段", async () => {
    for (const row of allRows) {
      const wanted = row.isWeekend
        ? row.slots
        : row.slots.filter((slot) => slot.end > WEEKDAY_EVENING_FROM);
      if (wanted.length === 0) continue;

      let blocks = mergeContinuousSlots(wanted);
      if (row.facility === CONTINUOUS_FACILITY) {
        blocks = blocks.filter(
          (block) => block.end - block.start >= CONTINUOUS_MIN_MINUTES
        );
      }
      if (blocks.length === 0) continue;

      const [, month, day] = row.date.split("/");
      const times = blocks
        .map((block) => {
          const hours = (block.end - block.start) / 60;
          return `${block.label}(${
            Number.isInteger(hours) ? hours : hours.toFixed(1)
          }h)`;
        })
        .join(", ");

      const line = `${row.facility} ${row.room} ${month}/${day}(${row.weekday}): ${times}`;
      // 兩個區間邊界會重疊一天，去掉重複的列
      if (contents.includes(line)) continue;
      contents.push(line);
      console.log(`找到可用時段: ${line}`);
    }
  });

  // 步驟 5：發送通知
  await test.step("發送通知", async () => {
    console.log(`豊島 - 共找到 ${contents.length} 筆符合條件的時段`);

    if (contents.length === 0) {
      console.log("豊島 - 未找到符合條件的時段");
      return;
    }

    const title = "🏸 豊島平日晚上 & 假日時段釋出🔥";
    const buttonUrl = TOSHIMA_URL;
    const buttonLabel = "予約サイトへ";

    const filteredContents = contents.filter((item) => item !== "");
    await sendLineFlexMessage(title, filteredContents, buttonUrl, buttonLabel);
    console.log("LINE notification sent successfully");
  });
});

/**
 * 套用「表示開始日 + 1ヶ月」並按下表示
 */
async function showPeriod(startDateText: string): Promise<void> {
  await page.locator("#dpStartDate").fill(startDateText);
  await page.locator('label[for="radioPeriod1month"]').click();
  await page.locator("#btnHyoji").click({ timeout: CLICK_TIMEOUT });
  await page.waitForLoadState("domcontentloaded");
  await page.waitForTimeout(3500);
}

/**
 * 抓出畫面上所有有空（○ / △）的日期，
 * 同時回報有多少格子是可申請的（用來判斷是否已超出申込期間）
 */
async function collectCandidates(): Promise<{
  bookableCells: number;
  candidates: { id: string; date: string }[];
}> {
  return await page.evaluate(() => {
    const found: { id: string; date: string }[] = [];
    let bookable = 0;

    document
      .querySelectorAll("table.calendar.horizon tbody td")
      .forEach((td) => {
        const input = td.querySelector(
          "input[name=checkdate]"
        ) as HTMLInputElement | null;
        // 申込期間外（－）與休館日沒有 checkbox，用這個判斷是否還在開放期間內
        if (!input) return;
        bookable += 1;

        const mark = (td.textContent || "").trim();
        if (mark !== "○" && mark !== "△") return;
        // value 格式：20260824 + 場地代碼，前 8 碼為日期
        const raw = input.value.slice(0, 8);
        found.push({
          id: input.id,
          date: `${raw.slice(0, 4)}/${raw.slice(4, 6)}/${raw.slice(6, 8)}`,
        });
      });

    return { bookableCells: bookable, candidates: found };
  });
}

/**
 * 取消畫面上所有已勾選的日期，回傳清掉的數量。
 * 走 label 的點擊而不是直接改 checked，讓站台自己的計數也跟著更新。
 */
async function clearDateSelections(): Promise<number> {
  return await page.evaluate(() => {
    const inputs = [
      ...document.querySelectorAll("input[name=checkdate]"),
    ] as HTMLInputElement[];
    let cleared = 0;

    inputs.forEach((input) => {
      if (!input.checked) return;
      const label = document.querySelector(
        `label[for="${input.id}"]`
      ) as HTMLElement | null;
      if (label) label.click();
      else input.checked = false;
      cleared += 1;
    });

    return cleared;
  });
}

/**
 * 直接在 DOM 上點 label 來勾選日期。
 *
 * 這張表有固定表頭的浮層（_fixedhead），站台又可能跳出對話框遮罩，
 * 兩者都會攔截滑鼠事件，讓一般的點擊一路重試到逾時。DOM 點擊不經過
 * 命中測試，可以繞過這兩種遮擋，而且照樣會觸發 label 綁定的事件。
 *
 * 回傳是否確實已勾選；沒勾到就回 false，不會假裝成功。
 */
async function toggleDateByDom(inputId: string): Promise<boolean> {
  return await page.evaluate((id) => {
    const input = document.getElementById(id) as HTMLInputElement | null;
    const label = document.querySelector(
      `label[for="${id}"]`
    ) as HTMLElement | null;
    if (!input || !label) return false;

    if (!input.checked) label.click();
    return input.checked;
  }, inputId);
}

/**
 * 關掉站台跳出的對話框（remodal）。
 *
 * 對話框會用 .remodal-overlay 蓋住整頁並攔截所有點擊，遮罩不會自己消失，
 * 對話框本身也寫明只能用右上角的 × 關閉（Esc 無效）。不關掉的話後續每個
 * 點擊都會被擋，一路重試到整份測試 timeout。
 *
 * 會跳出對話框的情況不只一種，所以不比對內容，只要有遮罩就關：
 *   - messageDlg：錯誤或提示訊息，內容是動態填入的
 *   - SesseionTimeoutWarn：連線逾時警告，整份測試跑得久就可能中途跳出
 *   - shisetsuXXX_info：各設施的お知らせ
 */
async function dismissBlockingDialog(context: string): Promise<boolean> {
  let dismissedAny = false;

  // 關掉一個可能還有下一個，但也不要無限迴圈
  for (let attempt = 0; attempt < 3; attempt++) {
    if ((await page.locator(".remodal-overlay:visible").count()) === 0) break;

    const message = await page
      .locator(".remodal:visible")
      .first()
      .innerText()
      .catch(() => "");
    console.warn(
      `[${context}] 偵測到對話框遮罩，關閉中：${message
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, 80)}`
    );

    const closeButton = page.locator("a.remodal-close:visible").first();
    if ((await closeButton.count()) === 0) {
      console.warn(`[${context}] 對話框沒有可見的關閉鈕，放棄關閉`);
      break;
    }

    await closeButton.click({ timeout: CLICK_TIMEOUT }).catch(() => {});
    await page.waitForTimeout(600);
    dismissedAny = true;
  }

  return dismissedAny;
}

/**
 * 解析「時間帯別空き状況」頁面，取出每個設施 × 場地 × 日期中有 ○ 的時段
 */
async function parseTimeSlotPage(): Promise<RowAvailability[]> {
  const raw = await page.evaluate(() => {
    const results: {
      facility: string;
      room: string;
      dateText: string;
      isWeekend: boolean;
      slots: string[];
    }[] = [];

    document.querySelectorAll("table.calendar.horizon").forEach((table) => {
      const headers = [...table.querySelectorAll("thead th")];
      if (headers.length < 3) return;

      const dateHeader = headers[0] as HTMLElement;
      const dateText = dateHeader.innerText.trim(); // 例：2026年8月24日(月)
      // 週末 / 國定假日由表頭 class 判斷（sat / sun / hol）
      const isWeekend = /\b(sat|sun|hol)\b/.test(dateHeader.className);

      // 前兩欄是「日期」與「定員」，其餘才是時段
      const timeLabels = headers
        .slice(2)
        .map((th) => (th as HTMLElement).innerText.replace(/\s/g, ""));

      const item = table.closest(".item");
      const facility =
        (item?.querySelector("h3") as HTMLElement)?.innerText.trim() || "";

      table.querySelectorAll("tbody tr").forEach((tr) => {
        const cells = [...tr.querySelectorAll("td")];
        if (cells.length < 3) return;

        const room = (cells[0] as HTMLElement).innerText.trim();
        const slots: string[] = [];

        cells.slice(2).forEach((td, index) => {
          // 只有可申請的空位才會有 checkbox（×、清掃、－ 都沒有）
          if (!td.querySelector("input[name=checktime]")) return;
          if ((td.textContent || "").trim() !== "○") return;
          if (timeLabels[index]) slots.push(timeLabels[index]);
        });

        if (slots.length > 0)
          results.push({ facility, room, dateText, isWeekend, slots });
      });
    });

    return results;
  });

  return raw.map((row) => {
    const match = row.dateText.match(/(\d+)年(\d+)月(\d+)日\((.)\)/);
    const date = match
      ? `${match[1]}/${match[2].padStart(2, "0")}/${match[3].padStart(2, "0")}`
      : row.dateText;
    const weekday = match ? match[4] : "";

    return {
      facility: row.facility,
      room: row.room,
      date,
      weekday,
      isWeekend: row.isWeekend || weekday === "土" || weekday === "日",
      slots: row.slots.map((label) => {
        const [start, end] = label.split("～");
        return { start: toMinutes(start), end: toMinutes(end), label };
      }),
    };
  });
}
