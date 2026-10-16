import dotenv from "dotenv";
import fs from "node:fs";
import path from "node:path";

dotenv.config();

// 排除日期清單檔案（repo 根目錄），可直接在 GitHub 手機 App 編輯
export const EXCLUDED_DATES_FILE = path.resolve(
  __dirname,
  "..",
  "excluded-dates.txt"
);

const DATE_PATTERN = /^\d{4}\/\d{2}\/\d{2}$/;

// 檢查 "YYYY/MM/DD" 字串是否為真實存在的日期（例如 2026/02/30 會被拒絕）
const isRealDate = (value: string): boolean => {
  const [year, month, day] = value.split("/").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
};

// 解析清單內容：忽略空白行與 # 註解，格式錯誤或不存在的日期會印警告並略過
export const parseExcludedDates = (content: string, source: string): string[] => {
  const dates: string[] = [];
  content.split(/\r?\n/).forEach((rawLine, index) => {
    const line = rawLine.replace(/#.*$/, "").trim();
    if (!line) return;
    if (!DATE_PATTERN.test(line) || !isRealDate(line)) {
      console.warn(
        `[excluded-dates] ${source}:${index + 1} 不是有效的 YYYY/MM/DD 日期，已略過: "${rawLine.trim()}"`
      );
      return;
    }
    dates.push(line);
  });
  return [...new Set(dates)];
};

// 讀取 excluded-dates.txt；檔案不存在時退回 EXCLUDED_DATES 環境變數（逗號分隔），再不然就是空清單
const loadExcludedDates = (): string[] => {
  if (fs.existsSync(EXCLUDED_DATES_FILE)) {
    return parseExcludedDates(
      fs.readFileSync(EXCLUDED_DATES_FILE, "utf8"),
      path.basename(EXCLUDED_DATES_FILE)
    );
  }
  console.warn(
    `[excluded-dates] 找不到 ${EXCLUDED_DATES_FILE}，改用 EXCLUDED_DATES 環境變數`
  );
  return parseExcludedDates(
    (process.env.EXCLUDED_DATES ?? "").split(",").join("\n"),
    "EXCLUDED_DATES"
  );
};

export const config = {
  botPotterLineChannelAccessToken:
    process.env.BOT_POTTER_LINE_CHANNEL_ACCESS_TOKEN,
  botPotterLineGroupId: process.env.BOT_POTTER_LINE_GROUP_ID,
  botPokobiLineChannelAccessToken:
    process.env.BOT_POKOBI_LINE_CHANNEL_ACCESS_TOKEN,
  botPokobiLineGroupId: process.env.BOT_POKOBI_LINE_GROUP_ID,
  // sumida
  password: process.env.PASSWORD,
  userId: process.env.USER_ID,
  // tai
  taiUserId: process.env.TAI_USER_ID,
  taiPassword: process.env.TAI_PASSWORD,
  // shibuya
  shibuyaId: process.env.SHIBUYA_ID,
  shibuyaPassword: process.env.SHIBUYA_PASSWORD,
  // minato
  minatoId: process.env.MINATO_ID,
  minatoPassword: process.env.MINATO_PASSWORD,

  webhookPort: "3000",

  // 要過濾掉的日期，格式為 "YYYY/MM/DD"，來源為 repo 根目錄的 excluded-dates.txt
  excludedDates: loadExcludedDates(),

  // 要排除的近期天數（從今天算起）
  excludeRecentDays: 8,
};

// 取得從今天算起 N 天內的日期列表（使用日本時區）
export const getRecentDatesToExclude = (): string[] => {
  const dates: string[] = [];
  const now = new Date();

  // 轉換為日本時間
  const japanOffset = 9 * 60; // UTC+9
  const japanTime = new Date(now.getTime() + japanOffset * 60 * 1000);

  for (let i = 0; i < config.excludeRecentDays; i++) {
    const date = new Date(japanTime);
    date.setDate(date.getDate() + i);

    const year = date.getUTCFullYear();
    const month = String(date.getUTCMonth() + 1).padStart(2, "0");
    const day = String(date.getUTCDate()).padStart(2, "0");

    dates.push(`${year}/${month}/${day}`);
  }

  return dates;
};

// 取得所有要排除的日期（靜態 + 動態近期日期）
export const getAllExcludedDates = (): string[] => {
  const recentDates = getRecentDatesToExclude();
  const allExcluded = [...new Set([...config.excludedDates, ...recentDates])];
  return allExcluded;
};

// CI 排程本身刻意跳過日本時間 01:00～05:59（見 .github/workflows/check-availability.yml 的
// cron 設定），但 GitHub Actions 的排程觸發是 best-effort，高負載時可能延遲數小時，
// 導致原本該跳過的 run 實際落在這段時間才執行、誤發半夜通知。
// 這裡在程式碼層再擋一次，不管 CI 幾點被觸發，只要當下日本時間落在黑名單時段就整支測試跳過。
export const isNightBlackout = (now: Date = new Date()): boolean => {
  const japanHour = (now.getUTCHours() + 9) % 24;
  return japanHour >= 1 && japanHour <= 5;
};

// 豊島區每月 1 號與 21 號的日本時間 09:00～09:59 是場地釋出時段，
// 這段時間網站會很擁擠，CI 上不要去掃（本機手動執行不受影響）。
// 接受 now 參數是為了可以測邊界，正常呼叫不用傳。
export const isToshimaReleaseWindow = (now: Date = new Date()): boolean => {
  // 先位移成日本時間再讀 UTC 欄位，跟 getRecentDatesToExclude 同一個做法
  const japanTime = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  const japanDay = japanTime.getUTCDate();
  const japanHour = japanTime.getUTCHours();

  return (japanDay === 1 || japanDay === 21) && japanHour === 9;
};
