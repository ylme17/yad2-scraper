const cheerio = require('cheerio');
const Telenode = require('telenode-js');
const fs = require('fs');
const config = require('./config.json');
const puppeteer = require('puppeteer');

const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// Array of user agents
/*
const userAgents = [
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Firefox/120.0',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:120.0) Gecko/20100101 Firefox/120.0',
    'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Mozilla/5.0 (X11; Linux x86_64; rv:120.0) Gecko/20100101 Firefox/120.0',
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_2 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.2 Mobile/15E148 Safari/604.1',
    'Mozilla/5.0 (iPad; CPU OS 17_2 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.2 Mobile/15E148 Safari/604.1',
    'Mozilla/5.0 (Android 14; Mobile; rv:120.0) Gecko/120.0 Firefox/120.0',
    'Mozilla/5.0 (Android 14; Tablet; rv:120.0) Gecko/120.0 Firefox/120.0'
];*/

const userAgents = [
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Firefox/122.0',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:122.0) Gecko/20100101 Firefox/122.0',
    'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
    'Mozilla/5.0 (X11; Linux x86_64; rv:122.0) Gecko/20100101 Firefox/122.0',
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1',
    'Mozilla/5.0 (iPad; CPU OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1',
    'Mozilla/5.0 (Android 14; Mobile; rv:122.0) Gecko/122.0 Firefox/122.0',
    'Mozilla/5.0 (Android 14; Tablet; rv:122.0) Gecko/122.0 Firefox/122.0',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Edge/122.0.2365.66',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36 OPR/108.0.0.0',
    'Mozilla/5.0 (Windows NT 10.0; WOW64; Trident/7.0; rv:11.0) like Gecko',
    'Mozilla/5.0 (Linux; Android 10) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.6261.89 Mobile Safari/537.36',
    'Mozilla/5.0 (Linux; Android 11; Pixel 5) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.6261.89 Mobile Safari/537.36'
];

// Function to get a random user agent
const getRandomUserAgent = () => {
    const userAgent = userAgents[Math.floor(Math.random() * userAgents.length)];
    console.log(`userAgent = ${userAgent}`); //For debug
    return userAgent;
};

// Function to get HTML from a web page using Puppeteer
const getYad2Response = async (url) => {
    const browser = await puppeteer.launch({
        headless: 'new',
        args: ['--no-sandbox', '--disable-setuid-sandbox']
    });

    try {
        const page = await browser.newPage();
        await page.setUserAgent(getRandomUserAgent()); // Use a random user agent
        await page.setExtraHTTPHeaders({ 'Accept-Language': 'he-IL,he;q=0.9' });
        await page.goto(url, { waitUntil: 'domcontentloaded' });
        await delay(1500 + Math.random() * 1000); // Add a random delay between 1.5 and 2.5 seconds

        try {
            await page.waitForSelector('img', { timeout: 15000 });
        } catch (e) {
            console.warn(`Warning: "img" not found on ${url} within timeout. Error: ${e.message}`);
        }
        const content = await page.content();
        return content;
    } finally {
        await browser.close();
    }
}

// Constants for site types and selectors
const types = { CARS: 'cars', NADLAN: 'nadlan', ITEMS: 'items', UNKNOWN: 'x' };
const stages = {
    [types.CARS]: ["div[class^=results-feed_feedListBox]", "div[class^=feed-item-base_imageBox]", "div[class^=feed-item-base_feedItemBox]"],
    [types.NADLAN]: ["div[class^=map-feed_mapFeedBox]", "div[class^=item-image_itemImageBox]", "div[class^=item-layout_feedItemBox]"],
    [types.ITEMS]: ["div[class^=fs_search_results_wrapper]", "a.product-block"],
    [types.UNKNOWN]: []
};

// Function to scrape items and extract image URLs
const scrapeItemsAndExtractImgUrls = async (url) => {
    const yad2Html = await getYad2Response(url);
    if (!yad2Html) throw new Error("Could not get Yad2 response");
    const $ = cheerio.load(yad2Html);
    if ($("title").first().text() === "ShieldSquare Captcha") throw new Error("Bot detection");

    let type = types.UNKNOWN;
    if ($("div[class^=results-feed_feedListBox]").length) type = types.CARS;
    else if ($("div[class^=map-feed_mapFeedBox]").length) type = types.NADLAN;
    else if ($("div[class^=fs_search_results_wrapper]").length) type = types.ITEMS;
    else throw new Error("Unknown type");

    const $feedItems = $(stages[type][0]);
    if ($feedItems.length === 0) throw new Error("Could not find feed items");

    const data = [];

    if (type === types.ITEMS) {
        $feedItems.find(stages[type][1]).each((i, el) => {
            const $productBlock = $(el);
            const lnkSrc = $productBlock.attr('href');
            const imgSrc = $productBlock.find('img').attr('src');
            if (imgSrc && lnkSrc) data.push({ 'img': imgSrc, 'lnk': new URL(lnkSrc, url).href });
        });
    } else if (type === types.CARS || type === types.NADLAN) {
        const $imageList = $feedItems.find(stages[type][1]);
        const $linkList = $feedItems.find(stages[type][2]);
        if ($imageList.length === 0 || $imageList.length !== $linkList.length) throw new Error(`Could not read lists properly for type ${type}`);
        
        $imageList.each((i, imgEl) => {
            const imgSrc = $(imgEl).attr('src') || $(imgEl).find('img').attr('src');
            const linkEl = $linkList[i];
            const lnkSrc = $(linkEl).attr('href') || $(linkEl).find('a').attr('href');
            if (imgSrc && lnkSrc) data.push({ 'img': imgSrc, 'lnk': new URL(lnkSrc, url).href });
        });
    } else {
        throw new Error("Cannot scrape unknown type, selectors are not defined.");
    }
    return data;
}

// Function to check if there are new items
const checkIfHasNewItem = async (data, topic) => {
    const filePath = `./data/${topic}.json`;
    let savedUrls = [];
    try {
        savedUrls = require(filePath);
    } catch (e) {
        if (e.code === "MODULE_NOT_FOUND") {
            if (!fs.existsSync('data')) fs.mkdirSync('data');
            fs.writeFileSync(filePath, '[]');
        } else {
            console.log(e);
            throw new Error(`Could not read / create ${filePath}`);
        }
    }
    let shouldUpdateFile = false;
    let imgUrls = data.map(a => a['img']);
    savedUrls = savedUrls.filter(savedUrl => {
        return imgUrls.includes(savedUrl);
    });
    const newItems = [];
    data.forEach(url => {
        if (!savedUrls.includes(url['img'])) {
            savedUrls.push(url['img']);
            newItems.push(url['lnk']);
            shouldUpdateFile = true;
        }
    });
    if (shouldUpdateFile) {
        const updatedUrls = JSON.stringify(savedUrls, null, 2);
        fs.writeFileSync(filePath, updatedUrls);
        await createPushFlagForWorkflow();
    }
    return newItems;
}

const createPushFlagForWorkflow = () => {
    fs.writeFileSync("push_me", "")
}

// Main function to scrape and send notifications
const scrape = async (topic, url, telenode, TELEGRAM_CHAT_ID) => {
    try {
        const scrapeImgResults = await scrapeItemsAndExtractImgUrls(url);
        const newItems = await checkIfHasNewItem(scrapeImgResults, topic);

        if (newItems.length > 0) {
            const messageText = `${newItems.length} new items found for ${topic}:`;
            await telenode.sendTextMessage(messageText, TELEGRAM_CHAT_ID);
            for (const msg of newItems) {
                await telenode.sendTextMessage(msg, TELEGRAM_CHAT_ID);
            }
        }
    } catch (e) {
        const errMsg = e?.message ? `Error: ${e.message}` : "An unknown error occurred.";
        console.error(`Scan workflow for ${topic} failed:`, e);
        try {
            await telenode.sendTextMessage(`Scan workflow for ${topic} failed... 😥\n${errMsg}`, TELEGRAM_CHAT_ID);
        } catch (error) {
            console.error("Failed to send telegram message", error);
        }
        throw e;
    }
};

// Main program function
const program = async () => {
    const TELEGRAM_API_TOKEN = process.env.TELEGRAM_API_TOKEN;
    const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;
    const telenode = new Telenode({ apiToken: TELEGRAM_API_TOKEN });

    if (!TELEGRAM_API_TOKEN || !TELEGRAM_CHAT_ID) {
        console.error("Critical: Telegram API Token or Chat ID is not set. Exiting.");
        return;
    }

    const activeProjects = config.projects.filter(project => !project.disabled);
    for (const project of activeProjects) {
        console.log(`Starting scan for topic: ${project.topic}`);
        try {
            await scrape(project.topic, project.url, telenode, TELEGRAM_CHAT_ID);
            console.log(`Finished scan for topic: ${project.topic}`);
            await delay(15000);
        } catch (error) {
            console.error(`Failed to scan topic: ${project.topic}. Error:`, error.message);
        }
    }
};

program();

