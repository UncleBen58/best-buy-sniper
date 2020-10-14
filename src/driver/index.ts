import { firefox, Browser } from 'playwright';

let browser: Browser;

export const createBrowser = async (): Promise<Browser> => {
  const options = {
    headless: false,
    ignoreHTTPSErrors: true,
    defaultViewport: { width: 1920, height: 1080 }
  };

  browser = await firefox.launch(options);

  return browser;
};

export const getBrowser = (): Browser => {
  return browser;
};
