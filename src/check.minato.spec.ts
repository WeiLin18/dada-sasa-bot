import type { Page } from "@playwright/test";
import { test } from "@playwright/test";
import { sendLineFlexMessage } from "../src/sendLineMessage";
import { config, getAllExcludedDates } from "../src/config";

let page: Page;

const MINATO_URL = "https://web101.rsv.ws-scs.jp/web/";

// どこで：芝浦港南地区(すべて)。一次把地區內所有館撈回來，再用下面的清單過濾，
// 比一個館一個館搜尋省很多請求。
const AREA_CODE = "4000_0";
// 何をする：バドミントン（會自動把設施收斂到羽球可用的場地）
const PURPOSE_BADMINTON = "2010_2010040";

// 港区スポーツセンター 要掃的場地（アリーナ全面 與 競技場２（１コート〜）不掃）
const SPORTS_CENTER = "スポーツセンター";
const SPORTS_CENTER_FACILITIES = [
  "アリーナ半面Ａ",
  "アリーナ半面Ｂ",
  "サブアリーナ全面",
  "競技場２全面",
  "競技場２（２コートＡ）",
  "競技場２（２コートＢ）",
];

// 學校：體育館全部都掃（港南小学校 / 港南中学校 不掃）
const SCHOOLS = ["芝浦小学校", "芝浜小学校", "お台場学園港陽小・中学校"];
const SCHOOL_FACILITY_KEYWORD = "体育館";

// 平日要能打到 20:00：時段必須「涵蓋」20:00（start <= 20:00 < end）
const WEEKDAY_TARGET_MINUTES = 20 * 60;

// 用 1 個月為單位往後掃。
// 實測這個帳號的受付期間約是 today+5 ～ today+61（例：2026/08/18 當下是 08/23～10/18），
// 兩輪（today ～ today+62）就完整覆蓋，第三輪必定全部是「受付期間外」。
// 注意：未登入時網站會顯示更遠的日期，但那些是這個帳號訂不到的。
const ROUNDS = 2;
const ROUND_DAYS = 31;
// 日付順 清單一次只給一頁，最多按這麼多次「さらに表示」
const MAX_MORE_CLICKS = 30;

// 兩種搜尋條件。曜日 用系統自己的「祝日」選項，這樣日本國定假日由伺服器判斷，
// 不用自己維護假日表（例如 2026/11/03 文化の日 是週二，也會被歸到這組）。
const SEARCH_MODES = [
  {
    label: "週末・祝日（全時段）",
    dayOfWeek: ["saturday", "sunday", "holiday"],
    timezone: ["allday"],
    wholeDay: true,
  },
  {
    label: "平日（夜間）",
    dayOfWeek: ["monday", "tuesday", "wednesday", "thursday", "friday"],
    timezone: ["evening"],
    wholeDay: false,
  },
];

// 日付順 清單上的一列
interface SlotRow {
  date: string; // YYYY/MM/DD
  mansion: string; // 館，例：スポーツセンター
  facility: string; // 施設，例：アリーナ半面Ａ
  start: string; // HH:MM
  end: string; // HH:MM
}

// 加上「這列是從哪一組搜尋條件來的」
interface CollectedRow extends SlotRow {
  wholeDay: boolean; // true = 週末・祝日那組，全天都算符合
}

const WEEKDAY_LABELS = ["日", "月", "火", "水", "木", "金", "土"];

const toMinutes = (time: string): number => {
  const [hour, minute] = time.split(":").map(Number);
  return hour * 60 + minute;
};

const weekdayOf = (date: string): string => {
  const [year, month, day] = date.split("/").map(Number);
  return WEEKDAY_LABELS[new Date(year, month - 1, day).getDay()];
};

// 確認目前仍是登入狀態。
// 未登入時網站照樣會給結果，但那是「公開空況」，包含這個帳號根本申請不到的日期，
// 所以 session 一掉就必須整個中止，不能默默拿錯的資料去發通知。
const assertLoggedIn = async (where: string): Promise<void> => {
  const logoutCount = await page.getByText("ログアウト", { exact: true }).count();
  if (logoutCount === 0) {
    throw new Error(
      `session 已遺失（${where}，URL: ${page.url()}）。未登入的結果會包含訂不到的時段，中止`
    );
  }
};

// 回首頁一定要用站內連結。直接 page.goto() 打入口網址會讓網站發新的 session，
// 登入狀態會被丟掉（而且畫面看起來一切正常，只是結果變成公開空況）。
const goHome = async (): Promise<void> => {
  await page.getByText("ホーム", { exact: true }).first().click();
  await page.waitForLoadState("domcontentloaded");
  await page.waitForTimeout(2500);
};

// 只留下要掃的館 × 場地
const isWantedFacility = (mansion: string, facility: string): boolean => {
  if (mansion === SPORTS_CENTER)
    return SPORTS_CENTER_FACILITIES.includes(facility);
  if (SCHOOLS.includes(mansion))
    return facility.includes(SCHOOL_FACILITY_KEYWORD);
  return false;
};

test("查詢港區設施的平日晚上與週末可用性", async ({ browser }) => {
  page = await browser.newPage();

  // 必須登入。未登入時網站給的是公開空況，會包含這個帳號還不能申請的日期
  // （受付期間是綁帳號的），登入後看到的才是實際訂得到的。
  await test.step("登入", async () => {
    if (!config.minatoId || !config.minatoPassword) {
      throw new Error(
        "缺少 MINATO_ID / MINATO_PASSWORD，未登入的查詢結果會包含訂不到的時段，中止"
      );
    }

    await page.goto(MINATO_URL);
    await page.waitForLoadState("domcontentloaded");
    await page.locator("#btn-login").click();
    await page.waitForLoadState("domcontentloaded");

    await page.locator("#userId").fill(config.minatoId);
    await page.locator("#password").fill(config.minatoPassword);
    await page.locator("#btn-go").click();
    await page.waitForLoadState("domcontentloaded");
    await page.waitForTimeout(2500);

    // 用兩個獨立訊號判斷，只要其中一個成立就算登入成功：
    //   1. 出現「ログアウト」。實測未登入時三個頁面的 HTML 都完全沒有這個字，
    //      所以用 count 而不是 isVisible —— 版面可能有手機／桌機兩份，其中一份是隱藏的
    //   2. 原本到處都在的登入按鈕不見了
    const logoutCount = await page.getByText("ログアウト", { exact: true }).count();
    const loginStillVisible = await page
      .locator("#btn-login")
      .isVisible()
      .catch(() => false);

    if (logoutCount === 0 && loginStillVisible) {
      const notice = await page
        .locator(".alert, .error, .errmsg")
        .first()
        .innerText()
        .catch(() => "");
      throw new Error(
        `登入失敗，請確認 MINATO_ID / MINATO_PASSWORD（URL: ${page.url()}${
          notice ? ` / 畫面訊息: ${notice.replace(/\s+/g, " ").slice(0, 120)}` : ""
        }）`
      );
    }
    console.log(
      `港區 - 登入成功（ログアウト x${logoutCount}, 登入鈕仍可見=${loginStillVisible}）`
    );
  });

  const allRows: CollectedRow[] = [];
  const seen = new Set<string>();

  for (const mode of SEARCH_MODES) {
    for (let round = 0; round < ROUNDS; round++) {
      const startDate = new Date();
      startDate.setDate(startDate.getDate() + round * ROUND_DAYS);
      // 用本地日期組字串，不要用 toISOString（會先轉 UTC，在日本時間跑會少一天）
      const startDateValue = [
        startDate.getFullYear(),
        String(startDate.getMonth() + 1).padStart(2, "0"),
        String(startDate.getDate()).padStart(2, "0"),
      ].join("-"); // YYYY-MM-DD

      await test.step(`${mode.label} 第 ${
        round + 1
      } 輪（${startDateValue}）`, async () => {
        const rows = await searchDailyList(mode, startDateValue);
        console.log(`[${mode.label} R${round + 1}] 取得 ${rows.length} 列`);

        for (const row of rows) {
          // 兩組搜尋在國定假日會重疊（祝日同時也是某個平日），不同輪次邊界也會重疊
          const key = `${row.date}|${row.mansion}|${row.facility}|${row.start}|${row.end}`;
          if (seen.has(key)) continue;
          seen.add(key);
          allRows.push({ ...row, wholeDay: mode.wholeDay });
        }
      });
    }
  }

  // 套用條件：週末・祝日全天都要，平日只要能打到 20:00 的
  const contents: string[] = [];

  await test.step("篩選符合條件的時段", async () => {
    const excludedDates = getAllExcludedDates();

    for (const row of allRows) {
      if (!isWantedFacility(row.mansion, row.facility)) continue;

      if (excludedDates.includes(row.date)) {
        console.log(`跳過排除日期: ${row.date}`);
        continue;
      }

      if (!row.wholeDay) {
        // 平日：時段必須涵蓋 20:00
        const covers20 =
          toMinutes(row.start) <= WEEKDAY_TARGET_MINUTES &&
          toMinutes(row.end) > WEEKDAY_TARGET_MINUTES;
        if (!covers20) continue;
      }

      const [, month, day] = row.date.split("/");
      const line = `${row.mansion} ${row.facility} ${month}/${day}(${weekdayOf(
        row.date
      )}): ${row.start}～${row.end}`;
      contents.push(line);
      console.log(`找到可用時段: ${line}`);
    }
  });

  await test.step("發送通知", async () => {
    console.log(`港區 - 共找到 ${contents.length} 筆符合條件的時段`);

    if (contents.length === 0) {
      console.log("港區 - 未找到符合條件的時段");
      return;
    }

    const title = "🏸 港區平日晚上 & 假日時段釋出🔥";
    const buttonUrl = MINATO_URL;
    const buttonLabel = "予約サイトへ";

    const filteredContents = contents.filter((item) => item !== "");
    await sendLineFlexMessage(title, filteredContents, buttonUrl, buttonLabel);
    console.log("LINE notification sent successfully");
  });
});

/**
 * 從首頁下條件搜尋，切到「日付順」分頁，把所有有空的時段列出來。
 * 日付順 只列出有空的時段，而且帶 data-starttime / data-endtime，比逐一解析空き状況表格快很多。
 */
async function searchDailyList(
  mode: (typeof SEARCH_MODES)[number],
  startDateValue: string
): Promise<SlotRow[]> {
  await goHome();
  await assertLoggedIn("搜尋前的首頁");
  await page.waitForSelector("#bname");
  await page.waitForTimeout(1200);

  // 「いつ」區塊預設是收起來的，收起時裡面的欄位點不到
  if (!(await page.locator("#days").isVisible())) {
    await page.locator("#collapse-when").click();
    await page.waitForTimeout(600);
  }

  // 網站會用 cookie 記住上一次的曜日／時間帯條件，先清掉再套自己的
  for (const name of ["dayofweek", "timezone"]) {
    const checkedIds = await page.evaluate(
      (inputName) =>
        [...document.querySelectorAll(`input[name=${inputName}]`)]
          .filter((input) => (input as HTMLInputElement).checked)
          .map((input) => (input as HTMLInputElement).id),
      name
    );
    for (const id of checkedIds) {
      await page.locator(`label[for="${id}"]`).click();
    }
  }

  // checkbox 本身被樣式蓋住，要點 label
  for (const id of [...mode.dayOfWeek, ...mode.timezone]) {
    await page.locator(`label[for="${id}"]`).click();
  }

  await page.selectOption("#days", String(ROUND_DAYS));
  await page.locator("#daystart").fill(startDateValue);
  await page.selectOption("#bname", AREA_CODE);
  await page.waitForTimeout(1500); // 選館之後才會載入施設清單
  await page.selectOption("#purpose", PURPOSE_BADMINTON);
  await page.waitForTimeout(400);

  await page.locator("#btn-go").click();
  await page.waitForLoadState("domcontentloaded");
  await page.waitForTimeout(3500);
  await assertLoggedIn("空き状況 結果頁");

  await page.getByText("日付順", { exact: true }).first().click();
  await page.waitForLoadState("domcontentloaded");
  await page.waitForTimeout(3000);
  await assertLoggedIn("日付順 清單頁");

  // 一頁一頁展開，直到「さらに表示」消失
  let clicks = 0;
  for (; clicks < MAX_MORE_CLICKS; clicks++) {
    const moreButton = page.locator("#unreserved-moreBtn");
    if (!(await moreButton.isVisible().catch(() => false))) break;
    await moreButton.click();
    await page.waitForTimeout(1500);
  }
  if (
    await page
      .locator("#unreserved-moreBtn")
      .isVisible()
      .catch(() => false)
  ) {
    console.log(
      `⚠️ [${mode.label} ${startDateValue}] 按了 ${clicks} 次「さらに表示」仍有未載入的資料，結果可能不完整`
    );
  }

  return await page.evaluate(() =>
    [...document.querySelectorAll("tr[id]")]
      .filter((tr) => /^\d{8}_/.test(tr.id))
      .map((tr) => {
        // tr id 格式：YYYYMMDD_館コード_施設コード_時段_序號
        const raw = tr.id.slice(0, 8);
        const chart = tr.querySelector(".timezonechart") as HTMLElement | null;
        return {
          date: `${raw.slice(0, 4)}/${raw.slice(4, 6)}/${raw.slice(6, 8)}`,
          mansion:
            (tr.querySelector(".mansion") as HTMLElement)?.innerText.trim() ??
            "",
          facility:
            (tr.querySelector(".facility") as HTMLElement)?.innerText.trim() ??
            "",
          start: chart?.dataset.starttime ?? "",
          end: chart?.dataset.endtime ?? "",
        };
      })
      .filter((row) => row.start && row.end)
  );
}
