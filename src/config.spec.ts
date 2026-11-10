import { expect, test } from "@playwright/test";
import {
  isNavigationConnectionError,
  isNightBlackout,
  isToshimaReleaseWindow,
  isToshimaScanWindow,
} from "../src/config";

// 以日本時間組出一個 Date（JST = UTC+9）
const jst = (
  year: number,
  month: number,
  day: number,
  hour: number,
  minute = 0
): Date => new Date(Date.UTC(year, month - 1, day, hour, minute) - 9 * 60 * 60 * 1000);

test.describe("isToshimaScanWindow（豊島降頻閘門）", () => {
  test("白名單的整點後 40 分鐘內放行", () => {
    for (const hour of [7, 10, 13, 16, 19, 22]) {
      expect(isToshimaScanWindow(jst(2026, 11, 10, hour, 0)), `${hour}:00`).toBe(true);
      expect(isToshimaScanWindow(jst(2026, 11, 10, hour, 39)), `${hour}:39`).toBe(true);
      // cron 的 :40 那一次會被擋掉，所以同一個小時只掃一次
      expect(isToshimaScanWindow(jst(2026, 11, 10, hour, 40)), `${hour}:40`).toBe(false);
      expect(isToshimaScanWindow(jst(2026, 11, 10, hour, 59)), `${hour}:59`).toBe(false);
    }
  });

  test("非白名單的小時一律擋掉", () => {
    for (const hour of [0, 1, 5, 6, 8, 9, 11, 12, 14, 15, 17, 18, 20, 21, 23]) {
      expect(isToshimaScanWindow(jst(2026, 11, 10, hour, 0)), `${hour}:00`).toBe(false);
      expect(isToshimaScanWindow(jst(2026, 11, 10, hour, 30)), `${hour}:30`).toBe(false);
    }
  });

  test("一天剛好放行 6 次（cron 的 :00 與 :40 共 28 次中）", () => {
    const cronMinutes = [0, 40];
    let allowed = 0;
    for (let hour = 0; hour < 24; hour++) {
      for (const minute of cronMinutes) {
        if (isToshimaScanWindow(jst(2026, 11, 10, hour, minute))) allowed += 1;
      }
    }
    expect(allowed).toBe(6);
  });

  test("避開 09:00 的釋出時段，兩個閘門不會互相吃掉", () => {
    const releaseDay = jst(2026, 12, 1, 9, 0);
    expect(isToshimaReleaseWindow(releaseDay)).toBe(true);
    expect(isToshimaScanWindow(releaseDay)).toBe(false);
  });

  test("放行時段都不在夜間黑名單內", () => {
    for (const hour of [7, 10, 13, 16, 19, 22]) {
      expect(isNightBlackout(jst(2026, 11, 10, hour, 0)), `${hour}:00`).toBe(false);
    }
  });

  test("跨日邊界（JST 22:00 是 UTC 13:00 同日，JST 07:00 是 UTC 22:00 前一日）", () => {
    expect(isToshimaScanWindow(new Date("2026-11-10T13:00:00Z"))).toBe(true); // JST 22:00
    expect(isToshimaScanWindow(new Date("2026-11-09T22:00:00Z"))).toBe(true); // JST 翌日 07:00
    expect(isToshimaScanWindow(new Date("2026-11-10T15:00:00Z"))).toBe(false); // JST 翌日 00:00
  });
});

test.describe("isNavigationConnectionError（只認連線錯誤）", () => {
  test("連線層面的失敗視為連不上", () => {
    const messages = [
      "page.goto: net::ERR_CONNECTION_TIMED_OUT at https://www2.pf489.com/toshima/WebR/Home/WgR_ModeSelect",
      "page.goto: net::ERR_CONNECTION_REFUSED at https://www2.pf489.com/",
      "page.goto: net::ERR_NAME_NOT_RESOLVED at https://www2.pf489.com/",
      "page.goto: net::ERR_CONNECTION_RESET at https://www2.pf489.com/",
      "page.goto: net::ERR_ADDRESS_UNREACHABLE at https://10.255.255.1/",
      "page.goto: net::ERR_INTERNET_DISCONNECTED at https://www2.pf489.com/",
      // 連線被靜默丟棄時，Playwright 的 navigation timeout 會先到
      "page.goto: Timeout 30000ms exceeded.\nCall log:\n  - navigating to \"https://10.255.255.1/\"",
    ];
    for (const message of messages) {
      expect(isNavigationConnectionError(new Error(message)), message.slice(0, 60)).toBe(
        true
      );
    }
  });

  test("其他失敗一律不吞，照舊讓測試紅", () => {
    const messages = [
      // 流程卡住 / 找不到元素
      'locator.click: Timeout 15000ms exceeded.\nCall log:\n  - waiting for getByRole("link", { name: "次へ進む" })',
      "locator.fill: Error: strict mode violation: locator('#dpStartDate') resolved to 2 elements",
      "expect(received).toBe(expected)",
      // 憑證 / HTTP 層面的問題代表站台或設定有變，不是「連不上」
      "page.goto: net::ERR_CERT_AUTHORITY_INVALID at https://www2.pf489.com/",
      "page.goto: net::ERR_HTTP_RESPONSE_CODE_FAILURE at https://www2.pf489.com/",
      // 解析失敗
      "TypeError: Cannot read properties of null (reading 'innerText')",
      "",
    ];
    for (const message of messages) {
      expect(isNavigationConnectionError(new Error(message)), message.slice(0, 60)).toBe(
        false
      );
    }
  });

  test("非 Error 的輸入不會誤判", () => {
    expect(isNavigationConnectionError(null)).toBe(false);
    expect(isNavigationConnectionError(undefined)).toBe(false);
    expect(isNavigationConnectionError({})).toBe(false);
    expect(isNavigationConnectionError(42)).toBe(false);
    // 字串形式的錯誤還是認得出來
    expect(isNavigationConnectionError("net::ERR_CONNECTION_TIMED_OUT")).toBe(true);
  });
});
