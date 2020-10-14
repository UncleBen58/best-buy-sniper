<h1 align="center">best-buy-sniper 🎯</h1>
<p>
  <img alt="Version" src="https://img.shields.io/badge/version-0.1.0-blue.svg?cacheSeconds=2592000" />
  <img src="https://img.shields.io/badge/npm-%3E%3D5.5.0-blue.svg" />
  <img src="https://img.shields.io/badge/node-%3E%3D9.3.0-blue.svg" />
</p>

> 🎯 Autonomously buy NVIDIA RTX 30 Series GPUs from Best Buy

## Install
### Windows
`npm install`
### Mac
-todo
### Linux (Ubuntu)
-todo

## Usage
### Windows
<b>NOTE: By default the auto-checkout is disabled so their is no accidental purchasing. To enable auto-checkout uncomment the code found on `line: 368-370` in the `bestbuy.ts` file located in `src/pages`.</b>

1. FIll in all the data in `config/prod/`
  
Add or remove the desired cards you want to purchase in `config/prod/tasks.json`

You must have both telegram and discord notifcation set in order for the bot to work. If you are not using one or both, you must comment out any line of code that has `sendDiscordMessage` and/or `sendTelegramMessage` in `main.ts and bestbuy.ts`. Will add a way to disable them that is more user friendly sorry about that.

2. Use `npm run start` to run the bot

3. Now wait for the item to come in stock

4. Stop the bot at any time with `npm run stop`

Note: the bot will no longer run once a purchase has been made. To be able to use the bot again, delete `purchase.json` from the main folder.

### Mac
-todo

### Linux (Ubuntu)
-todo

