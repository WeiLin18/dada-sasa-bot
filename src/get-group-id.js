const express = require("express");
const app = express();

app.use(express.json());

// 改成根路徑 "/" 而不是 "/webhook"
app.post("/", (req, res) => {
  console.log("\n=== 新事件 ===");

  const events = req.body.events || [];
  events.forEach((event) => {
    if (event.source?.type === "group") {
      console.log("🎯 Group ID:", event.source.groupId);
      console.log("📱 事件類型:", event.type);
      console.log("⏰ 時間:", new Date().toLocaleString());
      console.log("---");
    }
  });

  res.sendStatus(200);
});

app.listen(3000, () => {
  console.log("🚀 監聽器已啟動在 http://localhost:3000");
  console.log("💡 用 ngrok 暴露: ngrok http 3000");
});
