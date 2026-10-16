// Pure helpers for the LINE -> excluded-dates.txt worker. No I/O here so they
// can be unit-tested with plain `node --test`.

const JST_OFFSET_MS = 9 * 60 * 60 * 1000;

/** Japan-time "today" as { year, month, day }. */
export const todayInJapan = (now: Date = new Date()) => {
  const jst = new Date(now.getTime() + JST_OFFSET_MS);
  return {
    year: jst.getUTCFullYear(),
    month: jst.getUTCMonth() + 1,
    day: jst.getUTCDate(),
  };
};

export const isRealDate = (year: number, month: number, day: number): boolean => {
  const d = new Date(Date.UTC(year, month - 1, day));
  return (
    d.getUTCFullYear() === year &&
    d.getUTCMonth() === month - 1 &&
    d.getUTCDate() === day
  );
};

const pad2 = (n: number) => String(n).padStart(2, "0");

export const formatDate = (year: number, month: number, day: number): string =>
  `${year}/${pad2(month)}/${pad2(day)}`;

export const DATE_LINE = /^\d{4}\/\d{2}\/\d{2}$/;

/**
 * Normalize one user-typed token to "YYYY/MM/DD".
 * Accepts YYYY/MM/DD, YYYY-MM-DD, YYYY.MM.DD, MM/DD, M/D (and full-width
 * variants, handled by NFKC in parseCommand). MM/DD resolves to the next
 * occurrence that is not in the past (Japan time, today counts as not past).
 * Returns null for anything that is not a real calendar date.
 */
export const normalizeDate = (token: string, now: Date = new Date()): string | null => {
  const full = token.match(/^(\d{4})[\/\-.](\d{1,2})[\/\-.](\d{1,2})$/);
  if (full) {
    const [y, m, d] = [Number(full[1]), Number(full[2]), Number(full[3])];
    return isRealDate(y, m, d) ? formatDate(y, m, d) : null;
  }
  const short = token.match(/^(\d{1,2})[\/\-.](\d{1,2})$/);
  if (short) {
    const [m, d] = [Number(short[1]), Number(short[2])];
    const today = todayInJapan(now);
    // Try this year first, then up to 4 more (covers 02/29 on non-leap years).
    for (let y = today.year; y <= today.year + 4; y++) {
      if (!isRealDate(y, m, d)) continue;
      const isPast =
        y === today.year &&
        (m < today.month || (m === today.month && d < today.day));
      if (isPast) continue;
      return formatDate(y, m, d);
    }
    return null;
  }
  return null;
};

export type Command = {
  kind: "list" | "update";
  add: string[];
  remove: string[];
  invalid: string[];
};

const splitTokens = (s: string): string[] =>
  s.split(/[\s,、，;；]+/).map((t) => t.trim()).filter(Boolean);

/**
 * Parse a LINE text message into a command, or null when the message is not
 * addressed to us (no reply should be sent).
 *
 *   排除 11/03 11/05        add
 *   +11/03 11/05            add
 *   取消排除 2026/11/05     remove
 *   -11/05                  remove
 *   排除清單 / ?             list
 *
 * Multiple lines are allowed; each line is parsed on its own, so a message
 * can add and remove in one go.
 */
export const parseCommand = (text: string, now: Date = new Date()): Command | null => {
  const normalized = text.normalize("NFKC").replace(/\r/g, "");
  const lines = normalized
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
  if (lines.length === 0) return null;

  let matched = false;
  let listOnly = false;
  const add: string[] = [];
  const remove: string[] = [];
  const invalid: string[] = [];

  const collect = (rest: string, into: string[]) => {
    for (const tok of splitTokens(rest)) {
      const d = normalizeDate(tok, now);
      if (d) into.push(d);
      else invalid.push(tok);
    }
  };

  for (const line of lines) {
    if (line === "?" || line === "排除清單" || line === "清單") {
      matched = true;
      listOnly = true;
      continue;
    }
    let m: RegExpMatchArray | null;
    if ((m = line.match(/^(?:取消排除|-)\s*(.*)$/))) {
      matched = true;
      collect(m[1], remove);
    } else if ((m = line.match(/^(?:排除|\+)\s*(.*)$/))) {
      matched = true;
      collect(m[1], add);
    }
    // Any other line is ignored (free chat in the group).
  }

  if (!matched) return null;
  const hasChanges = add.length > 0 || remove.length > 0 || invalid.length > 0;
  return {
    kind: listOnly && !hasChanges ? "list" : "update",
    add: uniqSorted(add),
    remove: uniqSorted(remove),
    invalid: [...new Set(invalid)],
  };
};

export const uniqSorted = (dates: string[]): string[] => [...new Set(dates)].sort();

export type ExcludedFile = {
  /** Comment / blank lines that appear before the first date line, kept verbatim. */
  header: string[];
  dates: string[];
};

/** Parse excluded-dates.txt. Dates are deduped and sorted; header comments kept. */
export const parseExcludedFile = (content: string): ExcludedFile => {
  const header: string[] = [];
  const dates: string[] = [];
  let seenDate = false;
  for (const raw of content.split(/\r?\n/)) {
    const stripped = raw.replace(/#.*$/, "").trim();
    if (stripped === "") {
      if (!seenDate) header.push(raw.trimEnd());
      continue;
    }
    if (DATE_LINE.test(stripped)) {
      seenDate = true;
      dates.push(stripped);
    }
    // Malformed lines are dropped on rewrite (same as the reader ignoring them).
  }
  // Drop trailing blank header lines; serialize adds exactly one.
  while (header.length && header[header.length - 1] === "") header.pop();
  return { header, dates: uniqSorted(dates) };
};

export const serializeExcludedFile = (file: ExcludedFile): string => {
  const parts: string[] = [];
  if (file.header.length) parts.push(...file.header, "");
  parts.push(...uniqSorted(file.dates));
  return parts.join("\n") + "\n";
};

export type ApplyResult = {
  file: ExcludedFile;
  added: string[];
  removed: string[];
  alreadyPresent: string[];
  notPresent: string[];
  changed: boolean;
};

export const applyCommand = (file: ExcludedFile, cmd: Command): ApplyResult => {
  const set = new Set(file.dates);
  const added: string[] = [];
  const alreadyPresent: string[] = [];
  const removed: string[] = [];
  const notPresent: string[] = [];
  for (const d of cmd.add) {
    if (set.has(d)) alreadyPresent.push(d);
    else {
      set.add(d);
      added.push(d);
    }
  }
  for (const d of cmd.remove) {
    if (set.has(d)) {
      set.delete(d);
      removed.push(d);
    } else notPresent.push(d);
  }
  return {
    file: { header: file.header, dates: uniqSorted([...set]) },
    added,
    removed,
    alreadyPresent,
    notPresent,
    changed: added.length > 0 || removed.length > 0,
  };
};

export const commitMessage = (r: ApplyResult): string => {
  const parts = [...r.added.map((d) => `+${d}`), ...r.removed.map((d) => `-${d}`)];
  return `chore: excluded dates via LINE (${parts.join(" ")})`;
};

/** "2026/11: 01 02 05" per month, one per line. */
export const formatListByMonth = (dates: string[]): string => {
  if (dates.length === 0) return "（目前沒有排除任何日期）";
  const byMonth = new Map<string, string[]>();
  for (const d of uniqSorted(dates)) {
    const month = d.slice(0, 7);
    const day = d.slice(8, 10);
    byMonth.set(month, [...(byMonth.get(month) ?? []), day]);
  }
  return [...byMonth.entries()].map(([m, days]) => `${m}: ${days.join(" ")}`).join("\n");
};

const LINE_TEXT_LIMIT = 5000;

export const formatReply = (
  cmd: Command,
  r: ApplyResult | null,
  dates: string[]
): string => {
  const lines: string[] = [];
  if (r) {
    if (r.added.length) lines.push(`✅ 已排除：${r.added.join("、")}`);
    if (r.removed.length) lines.push(`↩️ 已取消排除：${r.removed.join("、")}`);
    if (r.alreadyPresent.length) lines.push(`（已在清單中：${r.alreadyPresent.join("、")}）`);
    if (r.notPresent.length) lines.push(`（原本就不在清單中：${r.notPresent.join("、")}）`);
  }
  if (cmd.invalid.length) lines.push(`⚠️ 看不懂的日期：${cmd.invalid.join("、")}`);
  if (lines.length) lines.push("");
  lines.push(`📅 目前排除清單（${dates.length} 天）`);
  lines.push(formatListByMonth(dates));
  let text = lines.join("\n");
  if (text.length > LINE_TEXT_LIMIT) text = text.slice(0, LINE_TEXT_LIMIT - 1) + "…";
  return text;
};
