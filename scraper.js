const cheerio = require('cheerio');
const Telenode = require('telenode-js');
const fs = require('fs');
const config = require('./config.json');
const puppeteer = require('puppeteer');

const getYad2Response = async (url) => {
    const browser = await puppeteer.launch({
        headless: 'new',
        args: ['--no-sandbox', '--disable-setuid-sandbox']
    });
    
    try {
        const page = await browser.newPage();
        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120.0.0.0 Safari/537.36');
        await page.setExtraHTTPHeaders({
            'Accept-Language': 'he-IL,he;q=0.9'
        });        
        await page.goto(url, { waitUntil: 'domcontentloaded' });
        
        try {
            await page.waitForSelector('.feed_item', { timeout: 15000 });
        } catch (e) {
            console.warn(`Warning: .feed_item not found on ${url} within timeout. Page might not have loaded content fully. Error: ${e.message}`);
        }
        const content = await page.content();
        
        return content;
    } finally {
        await browser.close();
    }
}

const types = {
    CARS: 'cars',
    NADLAN: 'nadlan',
    ITEMS: 'items',
    UNKNOWN: 'x'
};

const stages = {
    [types.CARS]: ["div[class^=results-feed_feedListBox]", "div[class^=feed-item-base_imageBox]", "div[class^=feed-item-base_feedItemBox]"],
    [types.NADLAN]: ["div[class^=map-feed_mapFeedBox]", "div[class^=item-image_itemImageBox]", "div[class^=item-layout_feedItemBox]"],
    [types.ITEMS]: ["div[class^=fs_search_results_wrapper]", "a.product-block"],
    [types.UNKNOWN]: []
};

const scrapeItemsAndExtractImgUrls = async (url) => {
    const yad2Html = await getYad2Response(url);
    if (!yad2Html) {
        throw new Error("Could not get Yad2 response");
    }
    const $ = cheerio.load(yad2Html);
    const title = $("title")
    const titleText = title.first().text();
    if (titleText === "ShieldSquare Captcha") {
        throw new Error("Bot detection");
    }

    let type = types.UNKNOWN;
    if ($("div[class^=results-feed_feedListBox]").length != 0) {
        type = types.CARS;
    } else if ($("div[class^=map-feed_mapFeedBox]").length != 0) {
        type = types.NADLAN;
    } else if ($("div[class^=fs_search_results_wrapper]").length != 0) {
        type = types.ITEMS;
    } else {
        throw new Error("Unknown type");
    }

    const $feedItems = $(stages[type][0]);
    if ($feedItems.length === 0) {
        throw new Error("Could not find feed items");
    }

    if (type === types.ITEMS) {
        $feedItems.find(stages[type][1]).each((i, el) => {
            const $productBlock = $(el);
    
            const lnkSrc = $productBlock.attr('href');
            const imgSrc = $productBlock.find('img').attr('src');
    
            if (imgSrc && lnkSrc) {
                data.push({'img': imgSrc, 'lnk': new URL(lnkSrc, url).href});
            }
        });
    } else if (type === types.CARS || type === types.NADLAN) {
        const $imageList = $feedItems.find(stages[type][1]);
        const $linkList = $feedItems.find(stages[type][2]);
    
        if ($imageList.length === 0 || $imageList.length !== $linkList.length) {
            throw new Error(`Could not read lists properly for type ${type}`);
        }
    
        $imageList.each((i, imgEl) => {
            const imgSrc = $(imgEl).attr('src') || $(imgEl).find('img').attr('src');
            const linkEl = $linkList[i];
            const lnkSrc = $(linkEl).attr('href') || $(linkEl).find('a').attr('href');
    
            if (imgSrc && lnkSrc) {
                data.push({'img': imgSrc, 'lnk': new URL(lnkSrc, url).href});
            }
        });
    } else {
        throw new Error("Cannot scrape unknown type, selectors are not defined.");
    }
    return data;
}

const checkIfHasNewItem = async (data, topic) => {
    const filePath = `./data/${topic}.json`;
    let savedImgUrls = new Set();

    try {
        if (fs.existsSync(filePath)) {
            const fileContent = fs.readFileSync(filePath, 'utf8');
            const parsedUrls = JSON.parse(fileContent);
            parsedUrls.forEach(url => savedImgUrls.add(url));
        } else {
            if (!fs.existsSync('data')) {
                fs.mkdirSync('data');
            }
            fs.writeFileSync(filePath, '[]');
        }
    } catch (e) {
        console.error(`Error reading/parsing ${filePath}:`, e);
        throw new Error(`Could not read / create ${filePath}`);
    }

    const newItems = [];
    const currentImgUrls = data.map(item => item.img);

    data.forEach(item => {
        if (!savedImgUrls.has(item.img)) {
            newItems.push(item.lnk);
        }
    });

    const updatedSavedUrls = new Set(currentImgUrls);
    newItems.forEach(link => {
        const item = data.find(d => d.lnk === link);
        if (item) {
            updatedSavedUrls.add(item.img);
        }
    });

    const updatedSavedUrlsArray = Array.from(updatedSavedUrls);
    const originalSavedUrlsArray = Array.from(savedImgUrls);

    if (updatedSavedUrlsArray.length !== originalSavedUrlsArray.length ||
        !updatedSavedUrlsArray.every(item => originalSavedUrlsArray.includes(item))) {
            fs.writeFileSync(filePath, JSON.stringify(updatedSavedUrlsArray, null, 2));
    }
    return newItems;
}

const TELEGRAM_API_TOKEN = process.env.TELEGRAM_API_TOKEN;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;
const telenode = new Telenode({ apiToken: TELEGRAM_API_TOKEN });

const scrape = async (topic, url) => {
    try {
        // await telenode.sendTextMessage(`Starting scanning ${topic} on link:\n${url}`, TELEGRAM_CHAT_ID);
        
        const scrapeDataResults = await scrapeItemsAndExtractImgUrls(url);
        const newItems = await checkIfHasNewItem(scrapeDataResults, topic);

        if (newItems.length > 0) {
            await telenode.sendTextMessage(`${newItems.length} new items found for ${topic}:`, TELEGRAM_CHAT_ID);
            for (const msg of newItems) {
                await telenode.sendTextMessage(msg, TELEGRAM_CHAT_ID);
            }
        } else {
            // await telenode.sendTextMessage("No new items were added", TELEGRAM_CHAT_ID);
        }
    } catch (e) {
        let errMsg = e?.message ? `Error: ${e.message}` : "An unknown error occurred.";
        console.error(`Scan workflow for ${topic} failed:`, e);
        await telenode.sendTextMessage(`Scan workflow for ${topic} failed... 😥\n${errMsg}`, TELEGRAM_CHAT_ID);
        throw e; 
    }
};

const program = async () => {
    if (!TELEGRAM_API_TOKEN || !TELEGRAM_CHAT_ID) {
        console.error("Critical: Telegram API Token or Chat ID is not set. Exiting.");
        return;
    }

    const activeProjects = config.projects.filter(project => {
        if (project.disabled) {
            console.log(`Topic "${project.topic}" is disabled. Skipping.`);
        }
        return !project.disabled;
    });

    for (const project of activeProjects) {
        console.log(`Starting scan for topic: ${project.topic}`);
        try {
            await scrape(project.topic, project.url);
            console.log(`Finished scan for topic: ${project.topic}`);
        } catch (error) {
            console.error(`Failed to scan topic: ${project.topic}. Error:`, error.message);
        }
    }
};

program();
