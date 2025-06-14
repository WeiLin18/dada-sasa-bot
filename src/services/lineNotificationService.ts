import LineNotify from 'line-notify-nodejs';
import * as dotenv from 'dotenv';
import * as fs from 'fs';
import { join } from 'path';

dotenv.config();

const LINE_TOKEN = process.env.LINE_NOTIFY_TOKEN;

if (!LINE_TOKEN) {
  console.error('Error: LINE_NOTIFY_TOKEN not found in environment variables');
  process.exit(1);
}

class LineNotificationService {
  private notify: any;

  constructor() {
    this.notify = new LineNotify(LINE_TOKEN);
  }

  /**
   * Send a text notification to Line
   * @param message The message to send
   * @returns Promise with notification result
   */
  async sendMessage(message: string): Promise<any> {
    try {
      return await this.notify.send({
        message,
      });
    } catch (error) {
      console.error('Failed to send Line notification:', error);
      return null;
    }
  }

  /**
   * Send a notification with image to Line
   * @param message The message to send
   * @param imagePath Path to the image file
   * @returns Promise with notification result
   */
  async sendImageNotification(message: string, imagePath: string): Promise<any> {
    try {
      if (!fs.existsSync(imagePath)) {
        throw new Error(`Image file not found: ${imagePath}`);
      }

      return await this.notify.send({
        message,
        imageThumbnail: imagePath,
        imageFullsize: imagePath,
      });
    } catch (error) {
      console.error('Failed to send Line notification with image:', error);
      return null;
    }
  }
}

export default new LineNotificationService();
