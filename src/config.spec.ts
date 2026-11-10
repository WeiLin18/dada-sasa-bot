import { expect, test } from "@playwright/test";
import { isNavigationConnectionError } from "../src/config";

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
