import {
  applyCommand,
  commitMessage,
  formatReply,
  parseCommand,
  parseExcludedFile,
  DEFAULT_PREFIXES,
  serializeExcludedFile,
  type ApplyResult,
  type Command,
} from "./lib.ts";

export interface Env {
  LINE_CHANNEL_SECRET: string;
  LINE_CHANNEL_ACCESS_TOKEN: string;
  GITHUB_TOKEN: string;
  /** owner/repo */
  GITHUB_REPO: string;
  ALLOWED_GROUP_ID: string;
  /** Defaults to excluded-dates.txt */
  FILE_PATH?: string;
  /** Comma-separated trigger words; defaults to DEFAULT_PREFIXES in lib.ts */
  TRIGGER_PREFIXES?: string;
}

type LineEvent = {
  type: string;
  replyToken?: string;
  source?: { type?: string; groupId?: string; userId?: string };
  message?: { type?: string; text?: string };
};

// ---------- LINE ----------

const verifySignature = async (
  body: string,
  signature: string | null,
  secret: string
): Promise<boolean> => {
  if (!signature) return false;
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const mac = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(body));
  const expected = btoa(String.fromCharCode(...new Uint8Array(mac)));
  if (expected.length !== signature.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) {
    diff |= expected.charCodeAt(i) ^ signature.charCodeAt(i);
  }
  return diff === 0;
};

const replyToLine = async (env: Env, replyToken: string, text: string): Promise<void> => {
  const res = await fetch("https://api.line.me/v2/bot/message/reply", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${env.LINE_CHANNEL_ACCESS_TOKEN}`,
    },
    body: JSON.stringify({ replyToken, messages: [{ type: "text", text }] }),
  });
  if (!res.ok) {
    console.error("LINE reply failed", res.status, await res.text());
  }
};

// ---------- GitHub Contents API ----------

const ghHeaders = (env: Env) => ({
  Authorization: `Bearer ${env.GITHUB_TOKEN}`,
  Accept: "application/vnd.github+json",
  "X-GitHub-Api-Version": "2022-11-28",
  "User-Agent": "dada-sasa-line-worker",
});

const contentsUrl = (env: Env) =>
  `https://api.github.com/repos/${env.GITHUB_REPO}/contents/${encodeURI(
    env.FILE_PATH || "excluded-dates.txt"
  )}`;

const b64ToUtf8 = (b64: string): string => {
  const bin = atob(b64.replace(/\s/g, ""));
  const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
  return new TextDecoder().decode(bytes);
};

const utf8ToB64 = (s: string): string => {
  const bytes = new TextEncoder().encode(s);
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
};

type RemoteFile = { content: string; sha: string | null };

const readFile = async (env: Env): Promise<RemoteFile> => {
  const res = await fetch(`${contentsUrl(env)}?ref=main`, { headers: ghHeaders(env) });
  if (res.status === 404) return { content: "", sha: null };
  if (!res.ok) throw new Error(`GitHub GET ${res.status}: ${await res.text()}`);
  const json = (await res.json()) as { content: string; sha: string };
  return { content: b64ToUtf8(json.content), sha: json.sha };
};

class ShaConflict extends Error {}

const writeFile = async (
  env: Env,
  content: string,
  sha: string | null,
  message: string
): Promise<void> => {
  const res = await fetch(contentsUrl(env), {
    method: "PUT",
    headers: { ...ghHeaders(env), "Content-Type": "application/json" },
    body: JSON.stringify({
      message,
      content: utf8ToB64(content),
      branch: "main",
      ...(sha ? { sha } : {}),
    }),
  });
  if (res.status === 409 || res.status === 422) {
    throw new ShaConflict(`GitHub PUT ${res.status}: ${await res.text()}`);
  }
  if (!res.ok) throw new Error(`GitHub PUT ${res.status}: ${await res.text()}`);
};

/** Read, apply, write. Retries once when the sha went stale between read and write. */
const updateExcludedDates = async (
  env: Env,
  cmd: Command
): Promise<{ result: ApplyResult | null; dates: string[] }> => {
  for (let attempt = 0; attempt < 2; attempt++) {
    const remote = await readFile(env);
    const file = parseExcludedFile(remote.content);
    if (cmd.kind === "list") return { result: null, dates: file.dates };

    const result = applyCommand(file, cmd);
    if (!result.changed) return { result, dates: result.file.dates };

    try {
      await writeFile(env, serializeExcludedFile(result.file), remote.sha, commitMessage(result));
      return { result, dates: result.file.dates };
    } catch (e) {
      if (e instanceof ShaConflict && attempt === 0) {
        console.warn("sha conflict, retrying", e.message);
        continue;
      }
      throw e;
    }
  }
  throw new Error("unreachable");
};

// ---------- Event handling ----------

const handleEvent = async (env: Env, ev: LineEvent): Promise<void> => {
  if (ev.type !== "message" || ev.message?.type !== "text") return;
  if (!ev.replyToken || !ev.message.text) return;
  if (ev.source?.groupId !== env.ALLOWED_GROUP_ID) return;

  const prefixes = env.TRIGGER_PREFIXES
    ? env.TRIGGER_PREFIXES.split(",").map((p) => p.trim()).filter(Boolean)
    : DEFAULT_PREFIXES;
  const cmd = parseCommand(ev.message.text, new Date(), prefixes);
  if (!cmd) return;

  try {
    const { result, dates } = await updateExcludedDates(env, cmd);
    await replyToLine(env, ev.replyToken, formatReply(cmd, result, dates));
  } catch (e) {
    console.error("update failed", e);
    const msg = e instanceof Error ? e.message : String(e);
    await replyToLine(env, ev.replyToken, `❌ 更新失敗，請稍後再試或直接到 GitHub 編輯。\n${msg.slice(0, 300)}`);
  }
};

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    if (request.method !== "POST") return new Response("ok", { status: 200 });

    const body = await request.text();
    const ok = await verifySignature(
      body,
      request.headers.get("x-line-signature"),
      env.LINE_CHANNEL_SECRET
    );
    if (!ok) return new Response("bad signature", { status: 401 });

    let events: LineEvent[] = [];
    try {
      events = ((JSON.parse(body) as { events?: LineEvent[] }).events) ?? [];
    } catch {
      return new Response("bad json", { status: 400 });
    }

    // LINE's Verify button sends an empty events array; always respond 200 fast.
    ctx.waitUntil(Promise.all(events.map((ev) => handleEvent(env, ev))));
    return new Response("ok", { status: 200 });
  },
} satisfies ExportedHandler<Env>;
