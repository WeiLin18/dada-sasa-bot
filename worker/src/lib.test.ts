import { test } from "node:test";
import assert from "node:assert/strict";
import {
  applyCommand,
  commitMessage,
  formatListByMonth,
  formatReply,
  normalizeDate,
  parseCommand,
  parseExcludedFile,
  serializeExcludedFile,
} from "./lib.ts";

// 2026-10-16 03:00 UTC = 2026-10-16 12:00 JST
const NOW = new Date("2026-10-16T03:00:00Z");
// 2026-10-16 23:00 UTC = 2026-10-17 08:00 JST (date already rolled over in Japan)
const NOW_LATE = new Date("2026-10-16T23:00:00Z");

test("normalizeDate: full dates", () => {
  assert.equal(normalizeDate("2026/11/03", NOW), "2026/11/03");
  assert.equal(normalizeDate("2026-11-3", NOW), "2026/11/03");
  assert.equal(normalizeDate("2026/02/30", NOW), null);
  assert.equal(normalizeDate("2026/13/01", NOW), null);
  assert.equal(normalizeDate("abc", NOW), null);
});

test("normalizeDate: MM/DD resolves to next non-past occurrence in JST", () => {
  assert.equal(normalizeDate("11/03", NOW), "2026/11/03");
  assert.equal(normalizeDate("10/16", NOW), "2026/10/16"); // today is not past
  assert.equal(normalizeDate("10/15", NOW), "2027/10/15"); // yesterday -> next year
  assert.equal(normalizeDate("10/16", NOW_LATE), "2027/10/16"); // JST already 10/17
  assert.equal(normalizeDate("2/29", NOW), "2028/02/29"); // next leap year
  assert.equal(normalizeDate("1/5", NOW), "2027/01/05");
});

test("parseCommand: add / remove / list / ignore", () => {
  assert.deepEqual(parseCommand("排除 11/03 11/05", NOW), {
    kind: "update",
    add: ["2026/11/03", "2026/11/05"],
    remove: [],
    invalid: [],
  });
  assert.deepEqual(parseCommand("+2026/11/05, 11/03, xyz", NOW), {
    kind: "update",
    add: ["2026/11/03", "2026/11/05"],
    remove: [],
    invalid: ["xyz"],
  });
  assert.deepEqual(parseCommand("取消排除 11/05", NOW), {
    kind: "update",
    add: [],
    remove: ["2026/11/05"],
    invalid: [],
  });
  assert.deepEqual(parseCommand("-11/05", NOW)?.remove, ["2026/11/05"]);
  assert.equal(parseCommand("排除清單", NOW)?.kind, "list");
  assert.equal(parseCommand("?", NOW)?.kind, "list");
  assert.equal(parseCommand("？", NOW)?.kind, "list"); // full-width
  assert.equal(parseCommand("今天打球嗎", NOW), null);
  assert.equal(parseCommand("", NOW), null);
});

test("parseCommand: full-width spaces, digits and multi-line", () => {
  const cmd = parseCommand("排除　１１／０３\n-11/05", NOW);
  assert.deepEqual(cmd, {
    kind: "update",
    add: ["2026/11/03"],
    remove: ["2026/11/05"],
    invalid: [],
  });
});

test("parseExcludedFile keeps header comments, sorts and dedupes", () => {
  const text = "# header\n# more\n\n2026/11/05\n2026/11/01 # inline\nbogus\n2026/11/01\n\n";
  const file = parseExcludedFile(text);
  assert.deepEqual(file.header, ["# header", "# more"]);
  assert.deepEqual(file.dates, ["2026/11/01", "2026/11/05"]);
  assert.equal(serializeExcludedFile(file), "# header\n# more\n\n2026/11/01\n2026/11/05\n");
});

test("parseExcludedFile on empty / no header", () => {
  assert.deepEqual(parseExcludedFile(""), { header: [], dates: [] });
  assert.equal(serializeExcludedFile(parseExcludedFile("2026/01/02\n")), "2026/01/02\n");
});

test("applyCommand add/remove is idempotent and reports", () => {
  const file = parseExcludedFile("# h\n\n2026/11/01\n2026/11/05\n");
  const cmd = parseCommand("排除 2026/11/01 2026/11/03\n取消排除 2026/11/05 2026/11/09", NOW)!;
  const r = applyCommand(file, cmd);
  assert.deepEqual(r.added, ["2026/11/03"]);
  assert.deepEqual(r.alreadyPresent, ["2026/11/01"]);
  assert.deepEqual(r.removed, ["2026/11/05"]);
  assert.deepEqual(r.notPresent, ["2026/11/09"]);
  assert.equal(r.changed, true);
  assert.deepEqual(r.file.dates, ["2026/11/01", "2026/11/03"]);
  assert.equal(commitMessage(r), "chore: excluded dates via LINE (+2026/11/03 -2026/11/05)");

  const noop = applyCommand(r.file, parseCommand("排除 2026/11/01", NOW)!);
  assert.equal(noop.changed, false);
});

test("formatListByMonth groups by month", () => {
  assert.equal(
    formatListByMonth(["2026/11/05", "2026/10/18", "2026/11/01", "2027/01/03"]),
    "2026/10: 18\n2026/11: 01 05\n2027/01: 03"
  );
});

test("formatReply includes confirmation and list", () => {
  const file = parseExcludedFile("2026/11/01\n");
  const cmd = parseCommand("排除 11/03 foo", NOW)!;
  const r = applyCommand(file, cmd);
  const text = formatReply(cmd, r, r.file.dates);
  assert.match(text, /✅ 已排除：2026\/11\/03/);
  assert.match(text, /看不懂的日期：foo/);
  assert.match(text, /2026\/11: 01 03/);
  assert.ok(text.length <= 5000);
});
