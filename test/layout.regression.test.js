"use strict";

// Lays the same text out in Chromium with the original font and with each
// placeholder, and checks that every character lands in exactly the same spot.
// Skipped when Puppeteer or a browser is unavailable; set CHROME_PATH to use a
// specific Chrome/Chromium binary.

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { after, before, describe, it } = require("node:test");

const library = require("../lib");
const { withKerning } = require("./helpers/kerning");

const FONT = fs.readFileSync(path.resolve(__dirname, "../example/fonts/AlexBrush-Regular.ttf"));
// Alex Brush barely kerns, so a kerned copy is made with deliberately large values
const KERNED = withKerning(FONT, [["A", "V", -300], ["V", "A", -300], ["T", "o", -250], ["W", "a", -200], ["L", "T", -280]]);
const TEXT = "AVATAR WAVE To Walter LT VAT. " +
    "On July 16, 1923, I moved into Exham Priory after the last workman had finished his labours. " +
    "The restoration had been a stupendous task, for little had remained of the deserted pile but a shell-like ruin.";

let layout = null;
let browser = null;
let skipReason = null;
try {
    layout = require("./helpers/layout");
    require("puppeteer");
} catch (err) {
    skipReason = `puppeteer cannot be loaded (${err.code || err.message})`;
}

describe("layout in Chromium", { skip: skipReason || false }, () => {
    before(async () => {
        browser = await layout.launchBrowser();
    });

    after(async () => {
        if (browser) await browser.close();
    });

    async function assertSameLayout(original, options) {
        const expected = await layout.measureLayout(browser, original, "truetype", TEXT);
        const placeholder = library.createPlaceholderFont(original, options);
        const actual = await layout.measureLayout(browser, placeholder.data, placeholder.format, TEXT);
        assert.ok(expected.loaded, "original font did not load");
        assert.ok(actual.loaded, "placeholder font was rejected by the browser");
        return layout.compareLayouts(expected, actual);
    }

    for (const [name, options] of [
        ["hollow", {}],
        ["blocks", { glyphs: "blocks" }],
        ["simplified", { glyphs: "simplified" }],
        ["filtered", { characters: "On July" }],
        ["hollow TrueType", { format: "truetype" }],
    ]) {
        it(`${name} placeholder keeps every character in place`, async () => {
            const difference = await assertSameLayout(FONT, options);
            assert.deepStrictEqual(difference, { maxDx: 0, maxDy: 0, shifted: 0, heightDelta: 0 });
        });
    }

    it("keeps kerned text in place", async () => {
        const difference = await assertSameLayout(KERNED, {});
        assert.deepStrictEqual(difference, { maxDx: 0, maxDy: 0, shifted: 0, heightDelta: 0 });
    });

    it("detects the shift when layout tables are dropped (sanity check)", async () => {
        const difference = await assertSameLayout(KERNED, { layout: false });
        assert.ok(difference.shifted > 0, "dropping kerning should have moved text");
    });
});
