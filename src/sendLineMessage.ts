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

/**
 * 发送LINE Flex消息，提供更丰富的视觉效果
 * @param title 消息标题
 * @param contents 消息内容数组
 * @param buttonUrl 按钮链接URL
 * @param buttonLabel 按钮文字
 * @returns
 */
export async function sendLineFlexMessage(
  title: string,
  contents: string[],
  buttonUrl?: string,
  buttonLabel?: string
) {
  try {
    // 检查必要的配置
    if (!config.lineChannelAccessToken) {
      console.error(
        "LINE_CHANNEL_ACCESS_TOKEN is not set in environment variables"
      );
      return false;
    }
    if (!config.lineGroupId?.length) {
      console.error("LINE_GROUP_ID is not set in environment variables");
      return false;
    }

    // 创建 Flex Message 结构
    const flexMessage = {
      type: "flex",
      altText: title,
      contents: {
        type: "bubble",
        header: {
          type: "box",
          layout: "vertical",
          contents: [
            {
              type: "text",
              text: title,
              weight: "bold",
              size: "lg",
              color: "#ffffff",
            },
          ],
          backgroundColor: "#27ACB2",
          paddingTop: "12px",
          paddingBottom: "12px",
        },
        body: {
          type: "box",
          layout: "vertical",
          contents: contents.map((content) => ({
            type: "text",
            text: content,
            wrap: true,
            margin: "md",
          })),
          paddingBottom: "8px",
        },
        footer: buttonUrl
          ? {
              type: "box",
              layout: "vertical",
              contents: [
                {
                  type: "button",
                  action: {
                    type: "uri",
                    label: buttonLabel || "查看详情",
                    uri: buttonUrl,
                  },
                  style: "primary",
                  color: "#1E88E5",
                },
              ],
            }
          : null,
      },
    };

    const response = await fetch("https://api.line.me/v2/bot/message/push", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${config.lineChannelAccessToken}`,
      },
      body: JSON.stringify({
        to: config.lineGroupId,
        messages: [flexMessage],
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error("Error response body:", errorText);
      return false;
    }

    return true;
  } catch (error) {
    console.error("Error sending LINE Flex message:", error);
    return false;
  }
}

export async function sendLineMessage(message: string) {
  try {
    // First, check if environment variables are set
    if (!config.lineChannelAccessToken) {
      console.error(
        "LINE_CHANNEL_ACCESS_TOKEN is not set in environment variables"
      );
    }
    if (!config.lineGroupId) {
      console.error("LINE_GROUP_ID is not set in environment variables");
    }

    const response = await fetch("https://api.line.me/v2/bot/message/push", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${config.lineChannelAccessToken}`,
      },
      body: JSON.stringify({
        to: config.lineGroupId,
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
