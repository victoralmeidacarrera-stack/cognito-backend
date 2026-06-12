import puppeteer, { type Browser } from 'puppeteer';
import { env } from './env.js';

// Browser headless compartilhado (reaproveitado entre renders do worker).
let browserPromise: Promise<Browser> | null = null;

export function getBrowser(): Promise<Browser> {
  if (!browserPromise) {
    browserPromise = puppeteer.launch({
      headless: true,
      ...(env.PUPPETEER_EXECUTABLE_PATH ? { executablePath: env.PUPPETEER_EXECUTABLE_PATH } : {}),
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
      ],
    });
  }
  return browserPromise;
}

export async function closeBrowser(): Promise<void> {
  if (browserPromise) {
    const browser = await browserPromise;
    await browser.close();
    browserPromise = null;
  }
}
