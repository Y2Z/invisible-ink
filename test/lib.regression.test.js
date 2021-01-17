"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const pixelmatch = require("pixelmatch");
const PNG = require("pngjs").PNG;
const puppeteer = require("puppeteer");

const library = require("../lib");

function fileExists(filePath) {
    let result = true;

    try {
        fs.accessSync(filePath, fs.constants.F_OK);
    } catch(_err) {
        result = false;
    }

    return result;
}

function composeHTML(composedCSSFontFaceDefinition, mockHTML) {
    return `\
<!doctype html>
<style>
${composedCSSFontFaceDefinition}
body {
    font-family: "Alex Brush Placeholder";
}
</style>
${mockHTML}`;
}

const resolution = {
    width: 1280,
    height: 800,
};
const browserOptions = {
    headless: true,
};
const imagesPath = path.resolve(process.cwd(), "test/images");
const mockHTML = `\
<h1>The Rats in the Walls</h1>
<h2>By H. P. Lovecraft</h2>
<p>
    On July 16, 1923, I moved into Exham Priory after the last workman had finished his labours.
    The restoration had been a stupendous task, for little had remained of the deserted pile but
    a shell-like ruin; yet because it had been the seat of my ancestors I let no expense deter me.
    The place had not been inhabited since the reign of James the First, when a tragedy of intensely
    hideous, though largely unexplained, nature had struck down the master, five of his children,
    and several servants; and driven forth under a cloud of suspicion and terror the third son,
    my lineal progenitor and the only survivor of the abhorred line. With this sole heir denounced
    as a murderer, the estate had reverted to the crown, nor had the accused man made any attempt
    to exculpate himself or regain his property. Shaken by some horror greater than that of conscience
    or the law, and expressing only a frantic wish to exclude the ancient edifice from his sight
    and memory, Walter de la Poer, eleventh Baron Exham, fled to Virginia and there founded the
    family which by the next century had become known as Delapore.
</p>`;

// ██╗  ██╗ ██████╗ ██╗     ██╗      ██████╗ ██╗    ██╗
// ██║  ██║██╔═══██╗██║     ██║     ██╔═══██╗██║    ██║
// ███████║██║   ██║██║     ██║     ██║   ██║██║ █╗ ██║
// ██╔══██║██║   ██║██║     ██║     ██║   ██║██║███╗██║
// ██║  ██║╚██████╔╝███████╗███████╗╚██████╔╝╚███╔███╔╝
// ╚═╝  ╚═╝ ╚═════╝ ╚══════╝╚══════╝ ╚═════╝  ╚══╝╚══╝

describe("Hollow", function() {
    this.timeout(5000);

    it("should display no glyphs", async function() {
        const imageFileName = "hollow";
        const libraryOptions = {};
        const sourceFontPath = path.resolve(process.cwd(), "example/fonts/AlexBrush-Regular.ttf");
        const sourceFontBuffer = fs.readFileSync(sourceFontPath)
        const sourceFontAB = library.bufferToArrayBuffer(sourceFontBuffer);
        const placeholderFont = library.createFontBuffer(sourceFontAB, libraryOptions, undefined);
        const composedCSSFontFaceDefinition = library.composeCSSFontFaceDefinition(placeholderFont.name, "opentype", placeholderFont.data);
        const HTML = composeHTML(composedCSSFontFaceDefinition, mockHTML);
        const browser = await puppeteer.launch(browserOptions);
        const page = await browser.newPage();
        await page.setContent(HTML);
        await page.setViewport( { width: resolution.width, height: resolution.height} );
        const actualImagePath = path.resolve(imagesPath, "actual", `${imageFileName}.png`);
        await page.screenshot({ path: actualImagePath, type: "png" });
        await page.close();
        await browser.close();

        const expectedImagePath = path.resolve(imagesPath, "expected", `${imageFileName}.png`);
        const actualImage = PNG.sync.read(fs.readFileSync(actualImagePath));
        if (!fileExists(expectedImagePath)) {
            fs.copyFileSync(actualImagePath, expectedImagePath);
        }
        const expectedImage = PNG.sync.read(fs.readFileSync(expectedImagePath));
        const deltaImage = new PNG({ width: actualImage.width, height: actualImage.height });

        const numberOfMismatchingPixels = pixelmatch(actualImage.data, expectedImage.data, deltaImage.data, actualImage.width, actualImage.height, { threshold: 0.1 });

        fs.writeFileSync(path.resolve(imagesPath, "delta", `${imageFileName}.png`), PNG.sync.write(deltaImage));

        assert.strictEqual(numberOfMismatchingPixels, 0);
    });

    it("should display some glyphs from original font", async function() {
        const imageFileName = "hollow-filtered";
        const libraryOptions = {
            allowedUnicodes: [ "a", "b", "c", "d", "e", "f" ].map(name => name.charCodeAt()),
        };
        const sourceFontPath = path.resolve(process.cwd(), "example/fonts/AlexBrush-Regular.ttf");
        const sourceFontBuffer = fs.readFileSync(sourceFontPath)
        const sourceFontAB = library.bufferToArrayBuffer(sourceFontBuffer);
        const placeholderFont = library.createFontBuffer(sourceFontAB, libraryOptions, undefined);
        const composedCSSFontFaceDefinition = library.composeCSSFontFaceDefinition(placeholderFont.name, "opentype", placeholderFont.data);
        const HTML = composeHTML(composedCSSFontFaceDefinition, mockHTML);
        const browser = await puppeteer.launch(browserOptions);
        const page = await browser.newPage();
        await page.setContent(HTML);
        await page.setViewport( { width: resolution.width, height: resolution.height} );
        const actualImagePath = path.resolve(imagesPath, "actual", `${imageFileName}.png`);
        await page.screenshot({ path: actualImagePath, type: "png" });
        await page.close();
        await browser.close();

        const expectedImagePath = path.resolve(imagesPath, "expected", `${imageFileName}.png`);
        const actualImage = PNG.sync.read(fs.readFileSync(actualImagePath));
        if (!fileExists(expectedImagePath)) {
            fs.copyFileSync(actualImagePath, expectedImagePath);
        }
        const expectedImage = PNG.sync.read(fs.readFileSync(expectedImagePath));
        const deltaImage = new PNG({ width: actualImage.width, height: actualImage.height });

        const numberOfMismatchingPixels = pixelmatch(actualImage.data, expectedImage.data, deltaImage.data, actualImage.width, actualImage.height, { threshold: 0.1 });

        fs.writeFileSync(path.resolve(imagesPath, "delta", `${imageFileName}.png`), PNG.sync.write(deltaImage));

        assert.strictEqual(numberOfMismatchingPixels, 0);
    });
});

// ███████╗ ██████╗ ██╗     ██╗██████╗
// ██╔════╝██╔═══██╗██║     ██║██╔══██╗
// ███████╗██║   ██║██║     ██║██║  ██║
// ╚════██║██║   ██║██║     ██║██║  ██║
// ███████║╚██████╔╝███████╗██║██████╔╝
// ╚══════╝ ╚═════╝ ╚══════╝╚═╝╚═════╝

describe("Solid", function() {
    this.timeout(5000);

    it("should have only solid blocks instead of glyphs", async function() {
        const imageFileName = "solid";
        const libraryOptions = {
            useSolidBlocks: true,
        };
        const sourceFontPath = path.resolve(process.cwd(), "example/fonts/AlexBrush-Regular.ttf");
        const sourceFontBuffer = fs.readFileSync(sourceFontPath)
        const sourceFontAB = library.bufferToArrayBuffer(sourceFontBuffer);
        const placeholderFont = library.createFontBuffer(sourceFontAB, libraryOptions, undefined);
        const composedCSSFontFaceDefinition = library.composeCSSFontFaceDefinition(placeholderFont.name, "opentype", placeholderFont.data);
        const HTML = composeHTML(composedCSSFontFaceDefinition, mockHTML);
        const browser = await puppeteer.launch(browserOptions);
        const page = await browser.newPage();
        await page.setContent(HTML);
        await page.setViewport( { width: resolution.width, height: resolution.height} );
        const actualImagePath = path.resolve(imagesPath, "actual", `${imageFileName}.png`);
        await page.screenshot({ path: actualImagePath, type: "png" });
        await page.close();
        await browser.close();

        const expectedImagePath = path.resolve(imagesPath, "expected", `${imageFileName}.png`);
        const actualImage = PNG.sync.read(fs.readFileSync(actualImagePath));
        if (!fileExists(expectedImagePath)) {
            fs.copyFileSync(actualImagePath, expectedImagePath);
        }
        const expectedImage = PNG.sync.read(fs.readFileSync(expectedImagePath));
        const deltaImage = new PNG({ width: actualImage.width, height: actualImage.height });

        const numberOfMismatchingPixels = pixelmatch(actualImage.data, expectedImage.data, deltaImage.data, actualImage.width, actualImage.height, { threshold: 0.1 });

        fs.writeFileSync(path.resolve(imagesPath, "delta", `${imageFileName}.png`), PNG.sync.write(deltaImage));

        assert.strictEqual(numberOfMismatchingPixels, 0);
    });

    it("should contain some solid blocks instead of glyphs", async function() {
        const imageFileName = "solid-filtered";
        const libraryOptions = {
            allowedUnicodes: [ "a", "b", "c", "d", "e", "f" ].map(name => name.charCodeAt()),
            useSolidBlocks: true,
        };
        const sourceFontPath = path.resolve(process.cwd(), "example/fonts/AlexBrush-Regular.ttf");
        const sourceFontBuffer = fs.readFileSync(sourceFontPath)
        const sourceFontAB = library.bufferToArrayBuffer(sourceFontBuffer);
        const placeholderFont = library.createFontBuffer(sourceFontAB, libraryOptions, undefined);
        const composedCSSFontFaceDefinition = library.composeCSSFontFaceDefinition(placeholderFont.name, "opentype", placeholderFont.data);
        const HTML = composeHTML(composedCSSFontFaceDefinition, mockHTML);
        const browser = await puppeteer.launch(browserOptions);
        const page = await browser.newPage();
        await page.setContent(HTML);
        await page.setViewport( { width: resolution.width, height: resolution.height} );
        const actualImagePath = path.resolve(imagesPath, "actual", `${imageFileName}.png`);
        await page.screenshot({ path: actualImagePath, type: "png" });
        await page.close();
        await browser.close();

        const expectedImagePath = path.resolve(imagesPath, "expected", `${imageFileName}.png`);
        const actualImage = PNG.sync.read(fs.readFileSync(actualImagePath));
        if (!fileExists(expectedImagePath)) {
            fs.copyFileSync(actualImagePath, expectedImagePath);
        }
        const expectedImage = PNG.sync.read(fs.readFileSync(expectedImagePath));
        const deltaImage = new PNG({ width: actualImage.width, height: actualImage.height });

        const numberOfMismatchingPixels = pixelmatch(actualImage.data, expectedImage.data, deltaImage.data, actualImage.width, actualImage.height, { threshold: 0.1 });

        fs.writeFileSync(path.resolve(imagesPath, "delta", `${imageFileName}.png`), PNG.sync.write(deltaImage));

        assert.strictEqual(numberOfMismatchingPixels, 0);
    });
});

//  ██████╗ ██████╗  █████╗ ██████╗ ██╗   ██╗ █████╗ ██╗
// ██╔════╝ ██╔══██╗██╔══██╗██╔══██╗██║   ██║██╔══██╗██║
// ██║  ███╗██████╔╝███████║██║  ██║██║   ██║███████║██║
// ██║   ██║██╔══██╗██╔══██║██║  ██║██║   ██║██╔══██║██║
// ╚██████╔╝██║  ██║██║  ██║██████╔╝╚██████╔╝██║  ██║███████╗
//  ╚═════╝ ╚═╝  ╚═╝╚═╝  ╚═╝╚═════╝  ╚═════╝ ╚═╝  ╚═╝╚══════╝

describe("Gradual", function() {
    this.timeout(5000);

    it("should display all glyphs from donor font", async function() {
        const imageFileName = "gradual";
        const libraryOptions = {};
        const sourceFontPath = path.resolve(process.cwd(), "example/fonts/AlexBrush-Regular.ttf");
        const sourceFontBuffer = fs.readFileSync(sourceFontPath)
        const sourceFontAB = library.bufferToArrayBuffer(sourceFontBuffer);
        const placeholderFont = library.createFontBuffer(sourceFontAB, libraryOptions, sourceFontAB);
        const composedCSSFontFaceDefinition = library.composeCSSFontFaceDefinition(placeholderFont.name, "opentype", placeholderFont.data);
        const HTML = composeHTML(composedCSSFontFaceDefinition, mockHTML);
        const browser = await puppeteer.launch(browserOptions);
        const page = await browser.newPage();
        await page.setContent(HTML);
        await page.setViewport( { width: resolution.width, height: resolution.height} );
        const actualImagePath = path.resolve(imagesPath, "actual", `${imageFileName}.png`);
        await page.screenshot({ path: actualImagePath, type: "png" });
        await page.close();
        await browser.close();

        const expectedImagePath = path.resolve(imagesPath, "expected", `${imageFileName}.png`);
        const actualImage = PNG.sync.read(fs.readFileSync(actualImagePath));
        if (!fileExists(expectedImagePath)) {
            fs.copyFileSync(actualImagePath, expectedImagePath);
        }
        const expectedImage = PNG.sync.read(fs.readFileSync(expectedImagePath));
        const deltaImage = new PNG({ width: actualImage.width, height: actualImage.height });

        const numberOfMismatchingPixels = pixelmatch(actualImage.data, expectedImage.data, deltaImage.data, actualImage.width, actualImage.height, { threshold: 0.1 });

        fs.writeFileSync(path.resolve(imagesPath, "delta", `${imageFileName}.png`), PNG.sync.write(deltaImage));

        assert.strictEqual(numberOfMismatchingPixels, 0);
    });

    it("should display some glyphs from donor font", async function() {
        const imageFileName = "gradual-filtered";
        const libraryOptions = {
            allowedUnicodes: [ "a", "b", "c", "d", "e", "f" ].map(name => name.charCodeAt()),
        };
        const sourceFontPath = path.resolve(process.cwd(), "example/fonts/AlexBrush-Regular.ttf");
        const sourceFontBuffer = fs.readFileSync(sourceFontPath)
        const sourceFontAB = library.bufferToArrayBuffer(sourceFontBuffer);
        const placeholderFont = library.createFontBuffer(sourceFontAB, libraryOptions, sourceFontAB);
        const composedCSSFontFaceDefinition = library.composeCSSFontFaceDefinition(placeholderFont.name, "opentype", placeholderFont.data);
        const HTML = composeHTML(composedCSSFontFaceDefinition, mockHTML);
        const browser = await puppeteer.launch(browserOptions);
        const page = await browser.newPage();
        await page.setContent(HTML);
        await page.setViewport( { width: resolution.width, height: resolution.height} );
        const actualImagePath = path.resolve(imagesPath, "actual", `${imageFileName}.png`);
        await page.screenshot({ path: actualImagePath, type: "png" });
        await page.close();
        await browser.close();

        const expectedImagePath = path.resolve(imagesPath, "expected", `${imageFileName}.png`);
        const actualImage = PNG.sync.read(fs.readFileSync(actualImagePath));
        if (!fileExists(expectedImagePath)) {
            fs.copyFileSync(actualImagePath, expectedImagePath);
        }
        const expectedImage = PNG.sync.read(fs.readFileSync(expectedImagePath));
        const deltaImage = new PNG({ width: actualImage.width, height: actualImage.height });

        const numberOfMismatchingPixels = pixelmatch(actualImage.data, expectedImage.data, deltaImage.data, actualImage.width, actualImage.height, { threshold: 0.1 });

        fs.writeFileSync(path.resolve(imagesPath, "delta", `${imageFileName}.png`), PNG.sync.write(deltaImage));

        assert.strictEqual(numberOfMismatchingPixels, 0);
    });

    it("should display some glyphs from donor font and solid blocks instead of empty glyphs", async function() {
        const imageFileName = "gradual-filtered-solid";
        const libraryOptions = {
            allowedUnicodes: [ "a", "b", "c", "d", "e", "f" ].map(name => name.charCodeAt()),
            useSolidBlocks: true,
        };
        const sourceFontPath = path.resolve(process.cwd(), "example/fonts/AlexBrush-Regular.ttf");
        const sourceFontBuffer = fs.readFileSync(sourceFontPath)
        const sourceFontAB = library.bufferToArrayBuffer(sourceFontBuffer);
        const placeholderFont = library.createFontBuffer(sourceFontAB, libraryOptions, sourceFontAB);
        const composedCSSFontFaceDefinition = library.composeCSSFontFaceDefinition(placeholderFont.name, "opentype", placeholderFont.data);
        const HTML = composeHTML(composedCSSFontFaceDefinition, mockHTML);
        const browser = await puppeteer.launch(browserOptions);
        const page = await browser.newPage();
        await page.setContent(HTML);
        await page.setViewport( { width: resolution.width, height: resolution.height} );
        const actualImagePath = path.resolve(imagesPath, "actual", `${imageFileName}.png`);
        await page.screenshot({ path: actualImagePath, type: "png" });
        await page.close();
        await browser.close();

        const expectedImagePath = path.resolve(imagesPath, "expected", `${imageFileName}.png`);
        const actualImage = PNG.sync.read(fs.readFileSync(actualImagePath));
        if (!fileExists(expectedImagePath)) {
            fs.copyFileSync(actualImagePath, expectedImagePath);
        }
        const expectedImage = PNG.sync.read(fs.readFileSync(expectedImagePath));
        const deltaImage = new PNG({ width: actualImage.width, height: actualImage.height });

        const numberOfMismatchingPixels = pixelmatch(actualImage.data, expectedImage.data, deltaImage.data, actualImage.width, actualImage.height, { threshold: 0.1 });

        fs.writeFileSync(path.resolve(imagesPath, "delta", `${imageFileName}.png`), PNG.sync.write(deltaImage));

        assert.strictEqual(numberOfMismatchingPixels, 0);
    });
});
