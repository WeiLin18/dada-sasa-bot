# Tokyo Gym Availability Checker

A project that automatically checks Tokyo ward gymnasium reservation systems (Sumida, Taito, Shibuya, Minato, and Toshima) and sends Line notifications when slots become available.

## Features

- Uses Playwright to automate browser checks on each ward's gymnasium reservation website
- Detects "triangle (△)" or "circle (○)" symbols on the page, indicating available reservation slots
- Sends notifications through Line Messaging API when availability is found
- Can be automated to run periodically via GitHub Actions
- Can be run locally or scheduled

## Installation

This project uses pnpm as its package manager.

```bash
# Clone the repository
git clone <your-repo-url>
cd dada-sasa

# Install dependencies
pnpm install

# Install Playwright browsers
npx playwright install chromium
```

## Configuration

1. Create a `.env` file with the required information:

```bash
cp .env.example .env
```

2. Edit the `.env` file with your details:

```
# Line Messaging API credentials
BOT_POTTER_LINE_CHANNEL_ACCESS_TOKEN=your_token_here
LINE_USER_ID=your_user_id_here

# Sumida Gym login credentials
USER_ID=your_gym_user_id
PASSWORD=your_gym_password
```

3. If using GitHub Actions, add the following secrets in your repository's Settings > Secrets and variables > Actions:
   - `BOT_POTTER_LINE_CHANNEL_ACCESS_TOKEN`: Your LINE messaging API token
   - `LINE_USER_ID`: Your LINE user ID
   - `BOT_POTTER_LINE_GROUP_ID`: Your LINE group ID
   - `USER_ID`: Your gym system user ID
   - `PASSWORD`: Your gym system password

## Excluded Dates (dates you don't want notifications for)

Dates to skip are listed in [`excluded-dates.txt`](excluded-dates.txt) at the repo root, one per line in `YYYY/MM/DD` format. Blank lines and lines starting with `#` are ignored. Invalid lines are logged as warnings and skipped; they never fail the run. The `EXCLUDED_DATES` GitHub Actions secret is **no longer used** and can be deleted.

The file is read on every run, so a commit to `main` takes effect on the next scheduled check. The current list is also shown at the bottom of each LINE notification.

### Editing from the GitHub mobile app

1. Open the repository in the GitHub app and tap **Code**.
2. Tap `excluded-dates.txt`.
3. Tap the **pencil (Edit)** icon in the top-right corner.
4. Add or remove lines (one `YYYY/MM/DD` per line).
5. Tap **Commit changes**, keep the target branch as `main`, and confirm.

## Usage

### GitHub Actions

The project includes a GitHub Actions workflow configuration that will automatically run checks according to the schedule (every 3 hours by default). You can also manually trigger the workflow from the GitHub interface.

## System Requirements

- Node.js 20+
- pnpm 8+

## Development Notes

### About Sumida City Gymnasium Website

Website structure analysis:

- Available slots are indicated by "△" (partially available) and "○" (fully available)
- The website updates monthly, and you need to adjust the URL parameters to view different months

### Customizing Check Logic

To modify the checking logic, edit the `src/check.sumida.spec.ts` file.

## License

MIT
