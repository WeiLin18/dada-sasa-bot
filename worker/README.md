# LINE → excluded-dates.txt Worker

A small Cloudflare Worker that lets you edit the repo's `excluded-dates.txt`
from LINE on your phone. It receives the LINE webhook from **one** of the two
bots, verifies the signature, parses a command, rewrites the file through the
GitHub Contents API (committing straight to `main`), and replies in the group
using the free `replyToken`. The GitHub Actions scanner needs no change: it
reads the file from `main` on its next run.

## Commands (send in the group)

Every command must start with the trigger word **`波特醬`** (or an
@-mention of the bot, which LINE expands to `@打打殺殺波特醬`). Messages that
do not start with it are ignored, so normal chat never triggers the bot.

| Message | Effect |
| --- | --- |
| `波特醬` or `波特醬 ?` or `波特醬 排除清單` | show the current list |
| `波特醬 排除 11/03 11/05` or `波特醬 +11/03 11/05` | add dates |
| `波特醬 取消排除 2026/11/05` or `波特醬 -11/05` | remove dates |
| `波特醬 <anything else>` | shows the list and flags the text as not understood |
| anything without the trigger word | ignored, no reply |

- Dates: `YYYY/MM/DD` or `MM/DD` (also `-`/`.` separators, 1-digit month/day,
  full-width digits and spaces). `MM/DD` becomes the next occurrence that is not
  in the past, Japan time.
- Separate several dates with spaces or commas. A message may have several
  lines after the trigger word, e.g. `波特醬 +11/03` on one line and `-11/05`
  on the next.
- Adding an existing date or removing a missing one is not an error; the reply
  just says so. Invalid tokens are listed back.
- The reply always ends with the current list grouped by month:
  `2026/11: 01 02 05 …`.
- The file's header comments are preserved; dates are deduped and sorted.
- The commit message looks like
  `chore: excluded dates via LINE (+2026/11/03 -2026/11/05)`.
- To change the trigger word, edit `TRIGGER_PREFIXES` in `wrangler.toml`
  (comma-separated) and redeploy.

## Layout

```
worker/
  src/index.ts     webhook handler, signature check, GitHub + LINE calls
  src/lib.ts       pure helpers: command parsing, date rules, file parse/serialize
  src/lib.test.ts  unit tests (node:test)
  wrangler.toml    worker name + non-secret vars
```

```bash
pnpm --dir worker install
pnpm --dir worker typecheck
pnpm --dir worker test
```

## Environment bindings

| Name | Kind | Meaning |
| --- | --- | --- |
| `LINE_CHANNEL_SECRET` | secret | Channel secret of the bot whose webhook points here. Used to verify `X-Line-Signature`. |
| `LINE_CHANNEL_ACCESS_TOKEN` | secret | Long-lived channel access token of the same bot. Used for the reply API. |
| `GITHUB_TOKEN` | secret | Fine-grained PAT, see below. |
| `ALLOWED_GROUP_ID` | secret | The LINE group id (`C…`). Messages from any other source are ignored silently. |
| `GITHUB_REPO` | var | `owner/repo`, set in `wrangler.toml` (`WeiLin18/dada-sasa-bot`). |
| `FILE_PATH` | var | Path of the dates file in the repo. Optional, defaults to `excluded-dates.txt`. |
| `TRIGGER_PREFIXES` | var | Comma-separated trigger words a message must start with. Optional, defaults to `波特醬,@打打殺殺波特醬`. |

Set the secrets once from `worker/`:

```bash
cd worker
npx wrangler login
npx wrangler secret put LINE_CHANNEL_SECRET
npx wrangler secret put LINE_CHANNEL_ACCESS_TOKEN
npx wrangler secret put GITHUB_TOKEN
npx wrangler secret put ALLOWED_GROUP_ID
```

Each command prompts for the value. For local `wrangler dev`, put the same
names in `worker/.dev.vars` (git-ignored).

### GitHub token

Create a **fine-grained personal access token** at
GitHub → Settings → Developer settings → Personal access tokens → Fine-grained.

- Repository access: *Only select repositories* → `WeiLin18/dada-sasa-bot`.
- Repository permissions: **Contents: Read and write**. Nothing else.
- Pick an expiry you are happy to renew; the worker only replies with an error
  once it expires.

If `main` has branch protection that blocks direct pushes, the PUT will fail
with a 409. Either allow the token's user to bypass, or leave `main`
unprotected (it is a personal repo).

### Which group id?

The scanner already knows it: it is `BOT_POTTER_LINE_GROUP_ID` /
`BOT_POKOBI_LINE_GROUP_ID` in the Actions secrets (both bots post to the same
group, so the ids are equal). You can also read it from the webhook payload in
`wrangler tail` while sending any message in the group.

## Deploy

```bash
cd worker
npx wrangler deploy
```

Wrangler prints the worker URL, e.g.
`https://dada-sasa-line-worker.<account>.workers.dev`. A `GET` to it returns
`ok`; only `POST` with a valid signature does anything.

## LINE Developers console

Do this on **one** bot only (POTTER or POKOBI). The other bot keeps pushing
scan results as before and never receives a webhook.

1. Open the bot's channel → *Messaging API* tab.
2. *Webhook URL*: paste the worker URL and press **Verify**. The worker
   answers `200` to the empty verification request.
3. Turn **Use webhook** on.
4. *LINE Official Account features* → *Auto-reply messages*: open the
   Official Account Manager link and set **Auto-reply** to *Disabled*
   (also disable *Greeting message* if you do not want one when the bot is
   re-added). Otherwise the bot answers every message with the default text.
5. The bot must already be a member of the group. Group messages reach the
   webhook only if *Allow bot to join group chats* is enabled, which it is
   when the bot is already posting there.

Then send `波特醬 ?` in the group. You should get the current list back within a
second or two. `npx wrangler tail` shows live logs if nothing arrives.

## Behaviour details

- The webhook returns `200` immediately and does the GitHub/LINE work in
  `ctx.waitUntil`, so LINE's 1-second timeout is never hit.
- Signature mismatch → `401`, invalid JSON → `400`.
- Only `message` events of type `text` from `source.groupId ===
  ALLOWED_GROUP_ID` are handled. DMs, other groups, stickers, joins etc. are
  dropped without a reply.
- If the file's `sha` changed between read and write (someone edited it on
  GitHub at the same moment) the worker refetches and retries once.
- If the file does not exist yet, the first add creates it.
- Replies are capped at LINE's 5000-character limit.
- On any GitHub error the reply is a short `❌ 更新失敗…` with the status text.
