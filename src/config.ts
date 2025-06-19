import dotenv from "dotenv";

dotenv.config();

export const config = {
  lineChannelAccessToken: process.env.LINE_CHANNEL_ACCESS_TOKEN,
  lineChannelSecret: process.env.LINE_CHANNEL_SECRET,
  lineUserId: process.env.LINE_USER_ID,
  lineGroupId: process.env.LINE_GROUP_ID || "C202c799a1e99316abbf48a5e4bd4a117",
  // sumida
  password: process.env.PASSWORD,
  userId: process.env.USER_ID,
  // tai
  taiUserId: process.env.TAI_USER_ID,
  taiPassword: process.env.TAI_PASSWORD,

  webhookPort: "3000",
  // Time-based notification settings
  priorityHours: [8, 12, 18, 22], // Hours when notifications should always be sent
};
