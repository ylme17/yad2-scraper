const cheerio = require('cheerio');
const Telenode = require('telenode-js');
const fs = require('fs');
const config = require('./config.json');
const puppeteer = require('puppeteer');

// Function to get HTML from a web page using Puppeteer
const getYad2Response = async (url) => {
    const browser = await puppeteer.launch({
        headless: 'new',
        args: ['--no-sandbox', '--disable-setuid-sandbox']
    });

    try {
        const page = await browser.newPage();
        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120.0.0.0 Safari/537.36');
        await page.setExtraHTTPHeaders({ 'Accept-Language': 'he-IL,he;q=0.9' });
        await page.goto(url, { waitUntil: 'domcontentloaded' });

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
    let savedImgUrls = new Set();
    let newItems = [];
    let hasNew = false;

    try {
        if (fs.existsSync(filePath)) {
            const fileContent = fs.readFileSync(filePath, 'utf8');
            try {
                const parsedData = JSON.parse(fileContent);
                if (Array.isArray(parsedData)) {
                    parsedData.forEach(item => {
                        if (item && item.img) {
                            savedImgUrls.add(item.img);
                        }
                    });
                } else {
                    console.warn(`Warning: ${filePath} does not contain an array. Overwriting.`);
                    savedImgUrls = new Set();
                }
            } catch (parseError) {
                console.error(`Error parsing JSON from ${filePath}:`, parseError);
                savedImgUrls = new Set();
            }
        } else {
            if (!fs.existsSync('data')) fs.mkdirSync('data');
            fs.writeFileSync(filePath, '[]');
        }
    } catch (e) {
        console.error(`Error reading/parsing ${filePath}:`, e);
        throw new Error(`Could not read / create ${filePath}`);
    }

    newItems = [];
    const currentImgUrls = data.map(item => item.img);

    // Find new items
    data.forEach(item => {
        if (!savedImgUrls.has(item.img)) {
            newItems.push(item.lnk);
            hasNew = true;
        }
    });

    // Write all current items (new and old) to the file, overwriting the old content
    const saveData = data.map(item => item.img); // Extract only image URLs for saving
    fs.writeFileSync(filePath, JSON.stringify(saveData, null, 2));

    return { hasNew, newItems };
}

// Main function to scrape and send notifications
const scrape = async (topic, url, telenode, TELEGRAM_CHAT_ID) => {
    try {
        const scrapeDataResults = await scrapeItemsAndExtractImgUrls(url);
        const { hasNew, newItems } = await checkIfHasNewItem(scrapeDataResults, topic); // Receive the hasNew flag

        if (hasNew) { // Use the hasNew flag
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
        } catch (error) {
            console.error(`Failed to scan topic: ${project.topic}. Error:`, error.message);
        }
    }
};

program();

