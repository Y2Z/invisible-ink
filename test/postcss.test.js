"use strict";

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { after, before, describe, it } = require("node:test");

let postcss = null;
try {
    postcss = require("postcss");
} catch (_err) {
    // postcss is an optional peer dependency
}

const invisibleInk = require("../lib/postcss");
const { rewriteFontFamily, rewriteFontShorthand, rewriteCustomProperty, parseDescriptor, pickSourceUrl } = invisibleInk._internal;

const FONT = path.resolve(__dirname, "../example/fonts/AlexBrush-Regular.ttf");
const FAMILIES = new Map([["alex brush", "Alex Brush Placeholder"]]);

describe("value rewriting", () => {
    it("inserts the placeholder right after its family", () => {
        assert.strictEqual(rewriteFontFamily('"Alex Brush", serif', FAMILIES), '"Alex Brush", "Alex Brush Placeholder", serif');
        assert.strictEqual(rewriteFontFamily("Alex  brush", FAMILIES), 'Alex  brush, "Alex Brush Placeholder"');
        assert.strictEqual(rewriteFontFamily("'ALEX BRUSH',cursive", FAMILIES), "'ALEX BRUSH', \"Alex Brush Placeholder\",cursive");
    });

    it("leaves lists alone that already have the placeholder or not the family", () => {
        assert.strictEqual(rewriteFontFamily('"Alex Brush", "Alex Brush Placeholder"', FAMILIES), null);
        assert.strictEqual(rewriteFontFamily("Georgia, serif", FAMILIES), null);
        assert.strictEqual(rewriteFontFamily('"Alex Brush Script"', FAMILIES), null);
    });

    it("handles the font shorthand", () => {
        assert.strictEqual(
            rewriteFontShorthand("italic 700 2rem/1.1 Alex Brush, cursive", FAMILIES),
            'italic 700 2rem/1.1 Alex Brush, "Alex Brush Placeholder", cursive',
        );
        assert.strictEqual(rewriteFontShorthand('16px "Alex Brush"', FAMILIES), '16px "Alex Brush", "Alex Brush Placeholder"');
        assert.strictEqual(rewriteFontShorthand('var(--size) "Alex Brush"', FAMILIES), 'var(--size) "Alex Brush", "Alex Brush Placeholder"');
        assert.strictEqual(rewriteFontShorthand("caption", FAMILIES), null);
    });

    it("rewrites custom properties only when they hold a family list", () => {
        assert.strictEqual(rewriteCustomProperty('"Alex Brush", cursive', FAMILIES), '"Alex Brush", "Alex Brush Placeholder", cursive');
        assert.strictEqual(rewriteCustomProperty("1rem Alex Brush", FAMILIES), null);
        assert.strictEqual(rewriteCustomProperty("url(Alex Brush)", FAMILIES), null);
    });
});

describe("descriptor parsing", () => {
    const fail = (message) => {
        throw new Error(message);
    };

    it("reads modes, tolerance and functions", () => {
        assert.deepStrictEqual(parseDescriptor("hollow", fail).options, { glyphs: "hollow" });
        assert.deepStrictEqual(parseDescriptor("simplified 30 no-layout", fail).options, { glyphs: "simplified", tolerance: 30, layout: false });
        assert.deepStrictEqual(parseDescriptor('blocks characters("Hi, you")', fail).options, { glyphs: "blocks", characters: "Hi, you" });
        assert.deepStrictEqual(parseDescriptor("simplified filter(./hero.txt)", fail).options, { glyphs: "simplified", filterFile: "./hero.txt" });
        assert.strictEqual(parseDescriptor("none", fail).skip, true);
    });

    it("rejects unknown keywords", () => {
        assert.throws(() => parseDescriptor("sparkly", fail), /unknown keyword "sparkly"/);
        assert.throws(() => parseDescriptor("magic(1)", fail), /unknown function/);
    });

    it("picks the first local font url from src", () => {
        assert.strictEqual(pickSourceUrl('local("X"), url("a.woff2") format("woff2"), url(b.ttf)'), "a.woff2");
        assert.strictEqual(pickSourceUrl("url(data:font/woff2;base64,AAAA), url('c.woff')"), "c.woff");
        assert.strictEqual(pickSourceUrl('local("X")'), null);
    });
});

describe("PostCSS plugin", { skip: !postcss && "postcss is not installed" }, () => {
    let dir;

    before(() => {
        dir = fs.mkdtempSync(path.join(os.tmpdir(), "invisible-ink-postcss-"));
        fs.mkdirSync(path.join(dir, "fonts"));
        fs.copyFileSync(FONT, path.join(dir, "fonts", "brush.ttf"));
        fs.writeFileSync(path.join(dir, "hero.txt"), "Hello");
    });

    after(() => fs.rmSync(dir, { recursive: true, force: true }));

    async function process(css, options, file = "styles.css") {
        const result = await postcss([invisibleInk({ cache: false, ...options })]).process(css, { from: path.join(dir, file) });
        return result;
    }

    const FACE = `@font-face {
    font-family: "Brush";
    src: url("./fonts/brush.ttf?v=1#x") format("truetype");
    font-weight: 400 700;
    unicode-range: U+0000-00FF;
    invisible-ink: hollow;
}`;

    it("adds a placeholder @font-face with the original's descriptors", async () => {
        const { css } = await process(FACE);
        const faces = css.match(/@font-face \{[^}]*\}/g);
        assert.strictEqual(faces.length, 2);
        assert.match(faces[0], /font-family: "Brush Placeholder";/);
        assert.match(faces[0], /src: url\("data:font\/woff2;base64,[A-Za-z0-9+/=]+"\) format\("woff2"\);/);
        assert.match(faces[0], /font-weight: 400 700;/);
        assert.match(faces[0], /unicode-range: U\+0000-00FF;/);
        assert.doesNotMatch(faces[0], /font-display/);
        assert.doesNotMatch(css, /invisible-ink:/);
    });

    it("sets font-display: swap on the original unless it has one", async () => {
        assert.match((await process(FACE)).css, /invisible-ink|font-display: swap;/);
        const own = await process(FACE.replace("font-weight", "font-display: optional;\n    font-weight"));
        assert.strictEqual(own.css.match(/font-display/g).length, 1);
        const off = await process(FACE, { fontDisplay: false });
        assert.doesNotMatch(off.css, /font-display/);
    });

    it("rewrites family lists, the font shorthand and custom properties", async () => {
        const { css } = await process(`${FACE}
:root { --heading: Brush, serif; }
h1 { font-family: "Brush", serif; }
h2 { font: bold 2rem/1 brush, serif; }
p { font-family: Georgia, serif; }`);
        assert.match(css, /--heading: Brush, "Brush Placeholder", serif;/);
        assert.match(css, /h1 \{ font-family: "Brush", "Brush Placeholder", serif; \}/);
        assert.match(css, /h2 \{ font: bold 2rem\/1 brush, "Brush Placeholder", serif; \}/);
        assert.match(css, /p \{ font-family: Georgia, serif; \}/);
    });

    it("remembers families across files processed by the same plugin instance", async () => {
        const plugin = invisibleInk({ cache: false });
        await postcss([plugin]).process(FACE, { from: path.join(dir, "fonts.css") });
        const { css } = await postcss([plugin]).process("a { font-family: Brush; }", { from: path.join(dir, "other.css") });
        assert.strictEqual(css, 'a { font-family: Brush, "Brush Placeholder"; }');
    });

    it("rewrites families named in the `families` option before their @font-face is seen", async () => {
        const { css } = await process("a { font-family: Brush; }", { families: ["Brush"] });
        assert.strictEqual(css, 'a { font-family: Brush, "Brush Placeholder"; }');
    });

    it("only touches rules with the descriptor, unless `all` is set", async () => {
        const plain = FACE.replace(/\n {4}invisible-ink: hollow;/, "");
        assert.strictEqual((await process(plain)).css, plain);
        assert.strictEqual((await process(plain, { all: true })).css.match(/@font-face/g).length, 2);
        const opted = FACE.replace("invisible-ink: hollow", "invisible-ink: none");
        assert.strictEqual((await process(opted, { all: true })).css.match(/@font-face/g).length, 1);
    });

    it("is harmless to run twice", async () => {
        const once = (await process(FACE + "\na { font-family: Brush; }", { all: true })).css;
        const twice = await process(once, { all: true });
        assert.strictEqual(twice.css, once);
        assert.deepStrictEqual(twice.warnings(), []);
    });

    it("reads filter() files relative to the stylesheet and reports them as dependencies", async () => {
        const result = await process(FACE.replace("hollow", "simplified filter(./hero.txt)"));
        const files = result.messages.filter(m => m.type === "dependency").map(m => m.file);
        assert.deepStrictEqual(files.sort(), [path.join(dir, "fonts", "brush.ttf"), path.join(dir, "hero.txt")].sort());
    });

    it("resolves root-relative urls against `root`, and lets `resolve` handle aliases", async () => {
        const rooted = FACE.replace("./fonts/brush.ttf?v=1#x", "/fonts/brush.ttf");
        assert.strictEqual((await process(rooted, { root: dir })).css.match(/@font-face/g).length, 2);
        const aliased = FACE.replace("./fonts/brush.ttf?v=1#x", "$fonts/brush.ttf");
        const resolve = (url) => url.startsWith("$fonts/") ? path.join(dir, "fonts", url.slice(7)) : null;
        assert.strictEqual((await process(aliased, { resolve })).css.match(/@font-face/g).length, 2);
    });

    it("warns about remote fonts and big placeholders, and fails on missing files", async () => {
        const remote = await process(FACE.replace("./fonts/brush.ttf?v=1#x", "https://example.com/brush.woff2"));
        assert.match(remote.warnings()[0].text, /cannot read remote font/);
        const big = await process(FACE, { warnSize: 100 });
        assert.match(big.warnings()[0].text, /placeholder for "Brush" is \d+ KB/);
        await assert.rejects(process(FACE.replace("brush.ttf", "missing.ttf")), /font file not found: \.\/fonts\/missing\.ttf/);
        await assert.rejects(process(FACE.replace("hollow", "sparkly")), /unknown keyword "sparkly"/);
    });

    it("caches generated placeholders on disk", async () => {
        const cache = path.join(dir, "cache");
        const first = await postcss([invisibleInk({ cache })]).process(FACE, { from: path.join(dir, "a.css") });
        assert.strictEqual(fs.readdirSync(cache).length, 1);
        const second = await postcss([invisibleInk({ cache })]).process(FACE, { from: path.join(dir, "a.css") });
        assert.strictEqual(second.css, first.css);
        assert.strictEqual(fs.readdirSync(cache).length, 1);
    });
});
