# Sumida Gym Availability Checker

自動檢查墨田区体育館預約系統並在有空位時發送 Line 通知的專案。

## 功能

- 使用 Playwright 自動化瀏覽器檢查墨田区体育館網站
- 偵測頁面上的「三角形(△)」或「圓形(○)」符號，表示有空位可預約
- 發現空位時透過 Line Notify 發送通知訊息和截圖
- 可透過 GitHub Actions 自動定期執行檢查
- 可在本地端運行或排程執行

## 安裝

本專案使用 pnpm 作為套件管理工具。

```bash
# 複製專案
git clone <your-repo-url>
cd dada-sasa

# 安裝依賴
pnpm install

# 安裝 Playwright 瀏覽器
npx playwright install chromium
```

## 配置

1. 複製 `.env.example` 到 `.env` 並填入必要資訊:

```bash
cp .env.example .env
```

2. 編輯 `.env` 文件並填寫:

```
# Line Notify Token - 從 https://notify-bot.line.me/ 取得
LINE_NOTIFY_TOKEN=your_token_here

# 目標網址
TARGET_URL=https://yoyaku.sumidacity-gym.com/index.php?op=monthly&UseYM=202507

# 排程設定 (cron 格式)
CHECK_SCHEDULE="0 */3 * * *"  # 每三小時執行一次

# 瀏覽器配置
HEADLESS=true
SCREENSHOT_DIR=./screenshots
```

3. 如果使用 GitHub Actions, 需要在專案的 Settings > Secrets and variables > Actions 中添加 `LINE_NOTIFY_TOKEN` 密鑰。

## 使用方式

### 本地執行單次檢查

```bash
pnpm run check
```

### 啟動定期檢查服務

```bash
pnpm start
```

### GitHub Actions

專案包含 GitHub Actions 工作流配置，會按照設定的排程自動執行檢查。您也可以在 GitHub 界面手動觸發工作流。

## 系統要求

- Node.js 18+
- pnpm 8+

## 開發筆記

### 關於墨田区体育館網站

網站結構分析:
- 空位以「△」(部分可用)和「○」(完全可用)表示
- 該網站每月更新，需要調整 URL 參數以查看不同月份

### 自訂檢查邏輯

如需修改檢查邏輯，請編輯 `src/checkAvailability.ts` 文件。

## License

MIT