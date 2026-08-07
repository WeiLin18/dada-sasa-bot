import dotenv from "dotenv";

dotenv.config();

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

  webhookPort: "3000",
  // Time-based notification settings
  priorityHours: [20], // Hours when notifications should always be sent
  rangeMinutes: Number(process.env.RANGE_MINUTES || 15), // Minutes before and after priority hours to send notifications,

  // 要過濾掉的日期，格式為 "YYYY/MM/DD"
  excludedDates: process.env.EXCLUDED_DATES
    ? process.env.EXCLUDED_DATES.split(",")
    : ["2025/12/26", "2026/01/03"],

  // 要排除的近期天數（從今天算起）
  excludeRecentDays: 5,
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

// 檢查是否在優先時間內（只針對 20:00）
export const isPriorityTime = (): boolean => {
  const now = new Date();
  const japanHour = (now.getUTCHours() + 9) % 24;
  const japanMinute = now.getUTCMinutes();

  // 只檢查 20:00 ~ 20:15
  return (
    japanHour === 20 && japanMinute >= 0 && japanMinute <= config.rangeMinutes
  );
};
