import dotenv from "dotenv";

dotenv.config();

export const config = {
  lineChannelAccessToken: process.env.LINE_CHANNEL_ACCESS_TOKEN,
  lineUserId: process.env.LINE_USER_ID,
  password: process.env.PASSWORD,
  userId: process.env.USER_ID,
};
