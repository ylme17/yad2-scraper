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
        
        await page.goto(url);
        await page.waitForSelector('.feed_item', {timeout: 10000}).catch(() => {});
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
    [types.ITEMS]: ["div[class^=fs_search_results_wrapper]", "img[class^=card__media]", "a[class^=product-block]"],
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
    if ($feedItems.length == 0) {
        throw new Error("Could not find feed items");
    }

    console.log(`$feedItems = "${$feedItems}"`);

    /*if(type == types.ITEMS) {
        const elements = $feedItems.find('a.product-block');
        console.log(`elements = "${elements.length}"`);
        console.log(`elements = "${elements}"`);
    } else {*/
        const $imageList = $feedItems.find(stages[type][1]);
        const $linkList = $feedItems.find(stages[type][2]);
    //}

    console.log(`$imageList = "${$imageList.length}"`);
    console.log(`$imageList = "${$imageList}"`);
    console.log(`$linkList = "${$linkList.length}"`);
    console.log(`$linkList = "${$linkList}"`);

    if ($imageList == 0 || $imageList.length != $linkList.length) {
        throw new Error(`Could not read lists properly`);
    }

    const data = []
    $imageList.each((i, _) => {
        const imgSrc = $($imageList[i]).find("img").attr('src');
        const lnkSrc = $($linkList[i]).find("a").attr('href');

        if (imgSrc && lnkSrc) {
            data.push({'img':imgSrc, 'lnk':  new URL(lnkSrc, url).href})
        }
    })
    return data;
}

const checkIfHasNewItem = async (data, topic) => {
    const filePath = `./data/${topic}.json`;
    let savedUrls = [];
    try {
        savedUrls = require(filePath);
    } catch (e) {
        if (e.code === "MODULE_NOT_FOUND") {
            if (!fs.existsSync('data')) {
                fs.mkdirSync('data');
            }
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

const scrape = async (topic, url) => {
    const apiToken = process.env.API_TOKEN || config.telegramApiToken;
    const chatId = process.env.CHAT_ID || config.chatId;
    const telenode = new Telenode({apiToken})
    try {
        // await telenode.sendTextMessage(`Starting scanning ${topic} on link:\n${url}`, chatId)
        const scrapeDataResults = await scrapeItemsAndExtractImgUrls(url);
        const newItems = await checkIfHasNewItem(scrapeDataResults, topic);
        if (newItems.length > 0) {
            await telenode.sendTextMessage(`${newItems.length} new items`, chatId)
            .then(Promise.all(
                newItems.map(msg => telenode.sendTextMessage(msg, chatId))));
        } else {
            // await telenode.sendTextMessage("No new items were added", chatId);
        }
    } catch (e) {
        let errMsg = e?.message || "";
        if (errMsg) {
            errMsg = `Error: ${errMsg}`
        }
        await telenode.sendTextMessage(`Scan workflow failed... 😥\n${errMsg}`, chatId)
        throw new Error(e)
    }
}

const program = async () => {
    await Promise.all(config.projects.filter(project => {
        if (project.disabled) {
            console.log(`Topic "${project.topic}" is disabled. Skipping.`);
        }
        return !project.disabled;
    }).map(async project => {
        await scrape(project.topic, project.url)
    }))
};

program();
