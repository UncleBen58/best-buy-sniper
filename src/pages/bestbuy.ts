import { getBrowser } from '@driver/index';
import { Browser, BrowserContext, Page } from 'playwright';
import { find, get } from 'lodash';
import { CustomerInformation, getCustomerInformation, getPaymentInformation, PaymentInformation } from '@core/configs';
import { logger } from '@core/logger';
import { resolve } from 'path';
import { sendMessage as sendDiscordMessage } from '@core/notifications/discord';
import { sendMessage as sendTelegramMessage } from '@core/notifications/telegram';
import { existsSync, writeFileSync } from 'fs';

interface ProductInformation {
  searchText?: string;
  sku: string;
  model: string;
  productName: string;
  productPage: string;
}

export const wait = (ms: number) => {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
};

const bestBuyUrl = 'https://bestbuy.com';

export class BestBuy {
  private browser: Browser;

  private products: ProductInformation[];

  private page?: Page;

  private context?: BrowserContext;

  constructor({ products }: { products: any[] }) {
    this.browser = getBrowser();
    this.products = products;
  }

  async open(): Promise<Page> {
    this.context = await this.browser.newContext({
      permissions: [],
    });
    this.page = await this.context.newPage();

    return this.page;
  }

  async close(): Promise<void> {  
    await this.page?.close();
    await this.context?.close();

    this.page = undefined;
    this.context = undefined;
  }

  public async purchaseProduct() {
    const page = await this.getPage();

    await page.goto('https://bestbuy.com');

    for (const product of this.products) {
      try {
        await this.goToProductPage(product);
        await this.validateProductMatch(product);
        await this.addToCart(product);
        await this.checkout();
        await this.continueAsGuest();
        await this.submitGuestOrder();

        return true;
      } catch (error) {
        logger.error(error);

        if (error.message === 'Browser is considered a bot, aborting attempt') throw error;
      }
    }

    return false;
  }

  private async goToProductPage(product: ProductInformation): Promise<void> {
    const { productPage } = product;
    const page = await this.getPage();

    logger.info(`Navigating to ${bestBuyUrl}${productPage}`);

    await page.goto(`${bestBuyUrl}${productPage}`, { timeout: 60000 });

    await page.waitForSelector('.sku.product-data');

    logger.info(`Navigation completed`);
  }

  private async validateProductMatch(product: ProductInformation) {
    const { sku: expectedSKU } = product;
    const page = await this.getPage();

    logger.info(`Validating that page corresponds to sku ${expectedSKU}`);

    const skuValue = await page.$eval('.sku.product-data .product-data-value', (element) => element.textContent);

    if (expectedSKU !== skuValue!.trim())
      throw new Error(`Product page does not belong to product with sku ${expectedSKU}`);

    logger.info(`Page corresponds to sku ${expectedSKU}`);
  }

  public async addToCart(product: ProductInformation) {
    const { productName } = product;
    const page = await this.getPage();
    const [context] = this.browser.contexts();
    const cookies = await context.cookies();
    const sensorCookie = find(cookies, { name: '_abck' })?.value;
    const sensorValidationRegex = /~0~/g;

    if (sensorCookie && !sensorValidationRegex.test(sensorCookie)) {
      await Promise.all([
        sendDiscordMessage({ message: `Browser is considered a bot, aborting attempt` }),
        sendTelegramMessage({ message: `Browser is considered a bot, aborting attempt` })
      ]);

      throw new Error('Browser is considered a bot, aborting attempt');
    }

    logger.info(`Checking stock of product "${productName}"`);

    if (!(await this.isInStock())) throw new Error('Product not in stock, aborting attempt');

    await page.focus('.add-to-cart-button:not([disabled])');

    const productInStockScreenshotPath = resolve(`screenshots/${Date.now()}_product-in-stock.png`);

    await page.screenshot({
      path: productInStockScreenshotPath,
      type: 'png'
    });

    await Promise.all([
      sendDiscordMessage({ message: `Product "${productName}" in stock!`, image: productInStockScreenshotPath }),
      sendTelegramMessage({ message: `Product "${productName}" in stock!` })
    ]);

    logger.info(`"${productName}" in stock, adding to cart...`);

    await page.click('.add-to-cart-button:not([disabled])');

    const result = await this.hasItemBeenAddedToCart();

    if (!result) throw new Error(`Product "${productName}" was not able to be added to the cart`);

    const productAddedImagePath = resolve(`screenshots/${Date.now()}_product-added.png`);

    logger.info(`Product "${productName}" added to cart!`);

    await page.screenshot({
      path: productAddedImagePath,
      type: 'png'
    });

    await Promise.all([
      sendDiscordMessage({ message: `Product "${productName}" added to cart!`, image: productAddedImagePath }),
      sendTelegramMessage({ message: `Product "${productName}" added to cart!` })
    ]);
  }

  public async isInStock() {
    const page = await this.getPage();
    const enabledButton = await page.$('.add-to-cart-button:not([disabled])');

    if (enabledButton) return true;

    return false;
  }

  private async hasItemBeenAddedToCart() {
    const page = await this.getPage();

    const completedSuccessfuly = await page.waitForResponse(
      (response: any) => response.url() === 'https://www.bestbuy.com/cart/api/v1/addToCart' && response.status() === 200
    );

    return completedSuccessfuly;
  }

  private async checkout(retrying: boolean = false) {
    const page = await this.getPage();
    const customerInformation = getCustomerInformation();

    logger.info(`Navigating to cart`);

    await page.goto('https://www.bestbuy.com/cart');

    if (retrying && (await this.isCartEmpty())) throw new Error('Cart is empty, aborting attempt');

    if (!retrying) {
      let attempt = 1;
      let shippingSelected = false;
      await this.changeZipCode(customerInformation.zipcode);

      do {
        try {
          await page.waitForSelector('[name=availability-selection][id*=shipping]', { timeout: 3500 });
          await page.click('[name=availability-selection][id*=shipping]');
          await wait(500);

          shippingSelected = true;
        } catch (error) {
          attempt += 1;
  
          if (attempt > 3) throw new Error("Can't select shipping, aborting attempt");
        }
      } while(!shippingSelected);
    }

    const startingCheckoutScreenshotPath = resolve(`screenshots/${Date.now()}_starting-checkout.png`);

    await page.screenshot({
      path: startingCheckoutScreenshotPath,
      type: 'png'
    });

    await Promise.all([
      sendDiscordMessage({ message: `Attempting checkout`, image: startingCheckoutScreenshotPath }),
      sendTelegramMessage({ message: `Attempting checkout` })
    ]);

    await this.clickCheckoutButton();

    try {
      await page.waitForSelector('.cia-guest-content .js-cia-guest-button', { timeout: 10000 });

      logger.info('Checkout successful, starting order placement');
    } catch (error) {
      logger.warn(error);
      logger.info('Refreshing and trying to checkout again');

      await Promise.all([
        sendDiscordMessage({ message: `Checkout did not went through, trying again`, image: startingCheckoutScreenshotPath }),
        sendTelegramMessage({ message: `Checkout did not went through, trying again` })
      ]);

      await this.checkout(true);
    }
  }

  private async isCartEmpty() {
    const page = await this.getPage();

    const element = await page.$('.fluid-large-view__title');
    const elementTextContent = await element?.textContent();

    return elementTextContent ? elementTextContent.trim().toLowerCase() === 'your cart is empty' : false;
  }

  private async changeZipCode(zipCode: string) {
    const page = await this.getPage();

    logger.info('Waiting for zip code change button to become available');

    await page.waitForSelector('.change-zipcode-link');

    logger.info('Changing zip code...');

    await page.click('.change-zipcode-link');
    await page.focus('.update-zip__zip-input');
    await page.type('.update-zip__zip-input', zipCode);
    await page.press('.update-zip__zip-input', 'Enter');

    logger.info('Waiting for zip code to be updated');

    await page.waitForFunction(
      (zipCode: string) => {
        const element = document.querySelector('.change-zipcode-link');

        if (!!element) {
          const { textContent } = element;

          return textContent?.trim() === zipCode;
        }
      },
      zipCode,
      { polling: 200 }
    );
  }

  private async clickCheckoutButton() {
    const page = await this.getPage();

    logger.info('Trying to checkout...');

    await page.click('.checkout-buttons__checkout button:not(disabled)');
  }

  private async continueAsGuest() {
    const page = await this.getPage();

    logger.info('Continuing as guest');

    await page.click('.cia-guest-content .js-cia-guest-button');

    await page.waitForSelector('.checkout__container .fulfillment');
  }

  private async submitGuestOrder() {
    const page = await this.getPage();
    const customerInformation = getCustomerInformation();
    const paymentInformation = getPaymentInformation();

    logger.info('Started order information completion');

    await this.completeShippingInformation(customerInformation);
    await this.completeContactInformation(customerInformation);

    await page.screenshot({
      path: resolve(`screenshots/${Date.now()}_first-information-page-completed.png`),
      type: 'png',
      fullPage: true
    });

    logger.info('Continuing to payment screen...');

    await page.click('.button--continue button');

    await this.completePaymentInformation(paymentInformation);

    await page.screenshot({
      path: resolve(`screenshots/${Date.now()}_second-information-page-completed.png`),
      type: 'png',
      fullPage: true
    });

    logger.info('Performing last validation before placing order...');

    const placeOrderButton = await page.$('.button--place-order button.btn-primary');

    const totalContainer = await page.$('.order-summary__price > span');
    const totalContainerTextContent = await totalContainer?.textContent();
    const parsedTotal = totalContainerTextContent ? parseFloat(totalContainerTextContent.replace('$', '')) : 0;

    if (parsedTotal === 0 || parsedTotal > customerInformation.budget)
      throw new Error('Total amount does not seems right, aborting');

    logger.info('Placing order...');

    const placingOrderScreenshotPath = resolve(`screenshots/${Date.now()}_placing-order.png`);

    await page.screenshot({
      path: placingOrderScreenshotPath,
      type: 'png',
      fullPage: true
    });

    await Promise.all([
      sendDiscordMessage({ message: `Placing order...`, image: placingOrderScreenshotPath }),
      sendTelegramMessage({ message: `Placing order...` })
    ]);

    if (existsSync('purchase.json')) {
      logger.warn('Purchase already completed, ending process');

      process.exit(2);
    }

    // *** UNCOMMENT THIS SECTION TO ENABLE AUTO-CHECKOUT ***

    // if (!!placeOrderButton) {
    //   await page.click('.button--place-order button.btn-primary');
    // }

    await wait(3000);

    logger.info('Order placed!');

    if (!existsSync('purchase.json')) writeFileSync('purchase.json', '{}');

    const orderPlacedScreenshotPath = resolve(`screenshots/${Date.now()}_order-placed-1.png`);

    await page.screenshot({
      path: orderPlacedScreenshotPath,
      type: 'png',
      fullPage: true
    });

    await Promise.all([
      sendDiscordMessage({ message: `Order placed!`, image: orderPlacedScreenshotPath }),
      sendTelegramMessage({ message: `Order placed!` })
    ]);

    await wait(3000);

    await page.screenshot({
      path: resolve(`screenshots/${Date.now()}_order-placed-2.png`),
      type: 'png',
      fullPage: true
    });

    await wait(14000);
  }

  private async completeShippingInformation(customerInformation: CustomerInformation) {
    const page = await this.getPage();

    logger.info('Filling shipping information...');

    await page.type('[id="consolidatedAddresses.ui_address_2.firstName"]', customerInformation.firstName);
    await page.type('[id="consolidatedAddresses.ui_address_2.lastName"]', customerInformation.lastName);

    const hideSuggestionsButton = await page.$('.address-form__cell .autocomplete__toggle');
    const hideSuggestionsButtonTextContent = await hideSuggestionsButton?.textContent();

    if (hideSuggestionsButtonTextContent?.trim().toLocaleLowerCase() === 'hide suggestions')
      await page.click('.address-form__cell .autocomplete__toggle');

    await page.type('[id="consolidatedAddresses.ui_address_2.street"]', customerInformation.address);

    if (customerInformation.addressSecondLine) {
      await page.click('.address-form__showAddress2Link');
      await page.type('[id="consolidatedAddresses.ui_address_2.street2"]', customerInformation.addressSecondLine);
    }

    await page.type('[id="consolidatedAddresses.ui_address_2.city"]', customerInformation.city);
    await page.selectOption('[id="consolidatedAddresses.ui_address_2.state"]', customerInformation.state);
    await page.type('[id="consolidatedAddresses.ui_address_2.zipcode"]', customerInformation.zipcode);
    await page.uncheck('[id="save-for-billing-address-ui_address_2"]');

    logger.info('Shipping information completed');
  }

  private async completeContactInformation(customerInformation: CustomerInformation) {
    const page = await this.getPage();

    logger.info('Filling contact information...');

    await page.type('[id="user.emailAddress"]', customerInformation.email);
    await page.type('[id="user.phone"]', customerInformation.phone);
    await page.check('#text-updates');

    logger.info('Contact information completed');
  }

  private async completePaymentInformation(paymentInformation: PaymentInformation) {
    const page = await this.getPage();

    logger.info('Filling payment information...');

    await page.waitForSelector('.payment');
    await page.type('#optimized-cc-card-number', paymentInformation.creditCardNumber);
    await page.selectOption('[name="expiration-month"]', paymentInformation.expirationMonth);
    await page.selectOption('[name="expiration-year"]', paymentInformation.expirationYear);
    await page.type('#credit-card-cvv', paymentInformation.cvv);
    await page.type('[id="payment.billingAddress.firstName"]', paymentInformation.firstName);
    await page.type('[id="payment.billingAddress.lastName"]', paymentInformation.lastName);
    await page.type('[id="payment.billingAddress.street"]', paymentInformation.address);
    await page.type('[id="payment.billingAddress.city"]', paymentInformation.city);
    await page.type('[id="payment.billingAddress.state"]', paymentInformation.state);
    await page.type('[id="payment.billingAddress.zipcode"]', paymentInformation.zipcode);

    logger.info('Payment information completed');
  }

  private async getPage() {
    return this.page!;
  }
}
