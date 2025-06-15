import { config } from "./config";

export async function getUserLineID() {
  const response = await fetch("https://api.line.me/v2/bot/followers/ids", {
    method: "GET",
    headers: {
      Authorization: `Bearer ${config.lineChannelAccessToken}`,
    },
  });

  if (!response.ok) {
    console.error("Error fetching user LINE ID:", await response.text());
    return null;
  }

  const data = await response.json();

  console.log("Fetched user LINE IDs:", data);
}

export async function sendLineMessage(message: string) {
  try {
    // First, check if environment variables are set
    if (!config.lineChannelAccessToken) {
      console.error(
        "LINE_CHANNEL_ACCESS_TOKEN is not set in environment variables"
      );
    }
    if (!config.lineUserId) {
      console.error("LINE_USER_ID is not set in environment variables");
    }

    const response = await fetch("https://api.line.me/v2/bot/message/push", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${config.lineChannelAccessToken}`,
      },
      body: JSON.stringify({
        to: config.lineUserId,
        messages: [
          {
            type: "text",
            text: message,
          },
        ],
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error("Error response body:", errorText);
    }
  } catch (error) {
    console.error("Error sending LINE message:", error);
  }
}
