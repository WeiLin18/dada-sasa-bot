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

  webhookPort: "3000",
  // Time-based notification settings
  priorityHours: [8, 20], // Hours when notifications should always be sent
  rangeMinutes: Number(process.env.RANGE_MINUTES || 10), // Minutes before and after priority hours to send notifications,

  // 要過濾掉的日期，格式為 "YYYY/MM/DD"
  excludedDates: process.env.EXCLUDED_DATES
    ? process.env.EXCLUDED_DATES.split(",")
    : ["2025/10/11"],
};
