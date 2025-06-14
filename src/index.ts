import * as cron from 'node-cron';
import * as dotenv from 'dotenv';
import checkAvailability from './checkAvailability';
import lineNotification from './services/lineNotificationService';

// Load environment variables
dotenv.config();

// Get schedule from environment or use default (every 3 hours)
const CHECK_SCHEDULE = process.env.CHECK_SCHEDULE || '0 */3 * * *';

/**
 * Main function to start the scheduled checks
 */
async function main() {
  console.log('Sumida Gymnasium Availability Checker is starting...');
  console.log(`Schedule set to: ${CHECK_SCHEDULE}`);
  
  try {
    // Send startup notification
    await lineNotification.sendMessage(
      '🚀 墨田区体育館空位自動檢查系統已啟動\n' +
      `檢查排程: ${CHECK_SCHEDULE}\n` +
      '系統將會在有空位時通知您'
    );
    
    // Run an initial check immediately
    console.log('Running initial availability check...');
    await checkAvailability();
    
    // Set up the scheduled task
    if (cron.validate(CHECK_SCHEDULE)) {
      cron.schedule(CHECK_SCHEDULE, async () => {
        console.log(`Running scheduled check at ${new Date().toISOString()}`);
        try {
          await checkAvailability();
        } catch (error) {
          console.error('Error in scheduled check:', error);
        }
      });
      console.log('Scheduled checks are now active');
    } else {
      console.error(`Invalid cron schedule: ${CHECK_SCHEDULE}`);
      process.exit(1);
    }
  } catch (error) {
    console.error('Failed to start the service:', error);
    process.exit(1);
  }
}

// Start the application
main().catch(console.error);
