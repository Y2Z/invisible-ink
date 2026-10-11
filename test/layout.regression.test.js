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
const sfnt = require("../lib/sfnt");
const { withKerning } = require("./helpers/kerning");

const FONT = fs.readFileSync(path.resolve(__dirname, "../example/fonts/AlexBrush-Regular.ttf"));
// Alex Brush barely kerns, so a kerned copy is made with deliberately large values
// Variable font (weight 200-700) whose width changes live only in gvar: no HVAR
const VARIABLE = fs.readFileSync(path.resolve(__dirname, "fonts/Oswald-wght-noHVAR.ttf"));
// Composites (ř, ţ) that take their widths from a component (USE_MY_METRICS)
// whose deltas differ from their own; one axis (XTRA), no HVAR
const COMPOSITES = fs.readFileSync(path.resolve(__dirname, "fonts/RobotoFlex-XTRA-noHVAR.ttf"));
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

    async function assertSameLayout(original, options, weight, transform, extra = {}) {
        const text = extra.text || TEXT;
        const settings = { weight, variationSettings: extra.variationSettings };
        const expected = await layout.measureLayout(browser, original, "truetype", text, settings);
        const placeholder = library.createPlaceholderFont(original, options);
        const data = transform ? transform(placeholder.data) : placeholder.data;
        const actual = await layout.measureLayout(browser, data, placeholder.format, text, settings);
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

    for (const glyphs of ["hollow", "simplified"]) {
        it(`keeps a variable font without HVAR in place at every weight (${glyphs})`, async () => {
            for (const weight of [200, 333, 400, 555, 700]) {
                const difference = await assertSameLayout(VARIABLE, { glyphs }, weight);
                assert.deepStrictEqual(difference, { maxDx: 0, maxDy: 0, shifted: 0, heightDelta: 0 }, `weight ${weight}`);
            }
        });
    }

    it("keeps composites that use a component's metrics in place along the axis", async () => {
        for (const xtra of [323, 400, 500, 603]) {
            const difference = await assertSameLayout(COMPOSITES, {}, 400, null, {
                text: "rřrř tţtţ řţřţ rrr ttt ř ţ",
                variationSettings: `'XTRA' ${xtra}`,
            });
            assert.deepStrictEqual(difference, { maxDx: 0, maxDy: 0, shifted: 0, heightDelta: 0 }, `XTRA ${xtra}`);
        }
    });

    it("detects the shift when gvar is dropped from a variable font (sanity check)", async () => {
        const withoutGvar = (data) => {
            const { flavor, tables } = sfnt.readFont(data);
            tables.delete("gvar");
            return sfnt.writeWoff2(flavor, tables);
        };
        const difference = await assertSameLayout(VARIABLE, {}, 700, withoutGvar);
        assert.ok(difference.shifted > 0, "dropping gvar should have moved text at weight 700");
    });

    it("detects the shift when layout tables are dropped (sanity check)", async () => {
        const difference = await assertSameLayout(KERNED, { layout: false });
        assert.ok(difference.shifted > 0, "dropping kerning should have moved text");
    });
});
