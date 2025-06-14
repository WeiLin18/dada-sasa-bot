import * as fs from 'fs';
import * as path from 'path';

export const createScreenshotDir = (dir: string): void => {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
};

export const getFormattedDate = (): string => {
  const now = new Date();
  return now.toISOString().replace(/[:.]/g, '-');
};

export const getScreenshotPath = (filename: string): string => {
  const screenshotDir = process.env.SCREENSHOT_DIR || './screenshots';
  createScreenshotDir(screenshotDir);
  return path.join(screenshotDir, filename);
};

// Get year and month for URL in YYYYMM format
export const getYearMonth = (offset = 0): string => {
  const date = new Date();
  date.setMonth(date.getMonth() + offset);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  return `${year}${month}`;
};
