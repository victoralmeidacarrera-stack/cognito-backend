import puppeteer, { type Browser } from 'puppeteer';
import { env } from './env.js';

// Browser headless compartilhado (reaproveitado entre renders do worker).
let browserPromise: Promise<Browser> | null = null;

async function launchBrowser(): Promise<Browser> {
  const browser = await puppeteer.launch({
    headless: true,
    ...(env.PUPPETEER_EXECUTABLE_PATH ? { executablePath: env.PUPPETEER_EXECUTABLE_PATH } : {}),
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu'],
  });
  // Chromium pode morrer (crash/OOM) num processo de vida longa; sem isso o
  // cache entregaria uma instância morta pra sempre (ConnectionClosedError
  // em todo render/composição até reiniciar a API).
  browser.on('disconnected', () => {
    browserPromise = null;
  });
  return browser;
}

export async function getBrowser(): Promise<Browser> {
  if (browserPromise) {
    const existing = await browserPromise.catch(() => null);
    if (existing?.connected) return existing;
    browserPromise = null; // morto ou falhou ao lançar → relança abaixo
  }
  browserPromise = launchBrowser();
  return browserPromise;
}

export async function closeBrowser(): Promise<void> {
  if (browserPromise) {
    const browser = await browserPromise.catch(() => null);
    browserPromise = null;
    if (browser?.connected) await browser.close();
  }
}
