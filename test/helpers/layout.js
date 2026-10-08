"use strict";

// Lays text out in Chromium with a given font and reports where every
// character ended up, so two fonts can be compared position by position.

const fs = require("fs");

const MIME = { woff2: "font/woff2", truetype: "font/ttf", opentype: "font/otf" };

// Prefers $CHROME_PATH, then whatever browser Puppeteer was installed with.
function chromeExecutable() {
    if (process.env.CHROME_PATH && fs.existsSync(process.env.CHROME_PATH)) return process.env.CHROME_PATH;
    return undefined;
}

async function launchBrowser() {
    const puppeteer = require("puppeteer");
    return puppeteer.launch({
        headless: true,
        executablePath: chromeExecutable(),
        args: ["--no-sandbox", "--font-render-hinting=none"],
    });
}

const PAGE_STYLE = `
    html, body { margin: 0; padding: 0; }
    #sample { width: 640px; font-size: 40px; line-height: normal; overflow-wrap: break-word; }
`;

// Returns { loaded, characters: [{ x, y, width }], width, height }.
async function measureLayout(browser, fontData, format, text) {
    const page = await browser.newPage();
    try {
        const url = `data:${MIME[format]};base64,${Buffer.from(fontData).toString("base64")}`;
        await page.setContent(`<!doctype html><meta charset="utf-8"><style>
            @font-face { font-family: "Measured"; src: url("${url}") format("${format}"); }
            ${PAGE_STYLE}
            #sample { font-family: "Measured", monospace; }
        </style><div id="sample"></div>`);

        return await page.evaluate(async (sampleText) => {
            const sample = document.getElementById("sample");
            sample.textContent = sampleText;
            let loaded = true;
            try {
                await document.fonts.load('40px "Measured"', sampleText);
                loaded = [...document.fonts].some(face => face.family.replace(/"/g, "") === "Measured" && face.status === "loaded");
            } catch (_err) {
                loaded = false;
            }
            await document.fonts.ready;

            const node = sample.firstChild;
            const range = document.createRange();
            const characters = [];
            for (let i = 0; i < node.length; i++) {
                range.setStart(node, i);
                range.setEnd(node, i + 1);
                const rect = range.getBoundingClientRect();
                characters.push({ x: rect.left, y: rect.top, width: rect.width });
            }
            const box = sample.getBoundingClientRect();
            return { loaded, characters, width: box.width, height: box.height };
        }, text);
    } finally {
        await page.close();
    }
}

// Largest horizontal/vertical offset between two layouts of the same text.
function compareLayouts(expected, actual) {
    let maxDx = 0;
    let maxDy = 0;
    let shifted = 0;
    expected.characters.forEach((a, i) => {
        const b = actual.characters[i];
        const dx = Math.abs(a.x - b.x);
        const dy = Math.abs(a.y - b.y);
        maxDx = Math.max(maxDx, dx);
        maxDy = Math.max(maxDy, dy);
        if (dx > 0.01 || dy > 0.01) shifted++;
    });
    return { maxDx, maxDy, shifted, heightDelta: actual.height - expected.height };
}

module.exports = { launchBrowser, measureLayout, compareLayouts };
