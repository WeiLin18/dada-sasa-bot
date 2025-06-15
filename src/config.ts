import dotenv from "dotenv";

dotenv.config();

export const config = {
  lineChannelAccessToken: process.env.LINE_CHANNEL_ACCESS_TOKEN,
  lineChannelSecret: process.env.LINE_CHANNEL_SECRET,
  lineUserId: process.env.LINE_USER_ID,
  lineGroupId: process.env.LINE_GROUP_ID || "C7fb621f48039ecd7814250fec21d1b13",
  password: process.env.PASSWORD,
  userId: process.env.USER_ID,
  webhookPort: process.env.WEBHOOK_PORT || "3000",
};
