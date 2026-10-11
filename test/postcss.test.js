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
const {
    optionsCacheKey, parseDescriptor, pickSourceUrl, rewriteCustomProperty, rewriteFontFamily, rewriteFontShorthand, sourceUrls,
} = invisibleInk._internal;

const FONT = path.resolve(__dirname, "../example/fonts/AlexBrush-Regular.ttf");
const FAMILIES = new Map([["alex brush", "Alex Brush Placeholder"], ["source sans 3", "Source Sans 3 Placeholder"]]);

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

    it("finds the size in the font shorthand even when the family name contains digits", () => {
        const cases = [
            ["12px Source Sans 3, sans-serif", '12px Source Sans 3, "Source Sans 3 Placeholder", sans-serif'],
            ["700 12px Source Sans 3", '700 12px Source Sans 3, "Source Sans 3 Placeholder"'],
            ["condensed 700 16px Alex Brush", 'condensed 700 16px Alex Brush, "Alex Brush Placeholder"'],
            ["oblique 10deg 16px Alex Brush", 'oblique 10deg 16px Alex Brush, "Alex Brush Placeholder"'],
            ["16px / 1.5 Alex Brush", '16px / 1.5 Alex Brush, "Alex Brush Placeholder"'],
            ["16px/ 1.5 Alex Brush", '16px/ 1.5 Alex Brush, "Alex Brush Placeholder"'],
            ["16px /1.5 Alex Brush", '16px /1.5 Alex Brush, "Alex Brush Placeholder"'],
            ["bold 1.2em/var(--lh) Alex Brush", 'bold 1.2em/var(--lh) Alex Brush, "Alex Brush Placeholder"'],
            ["small 'Alex Brush'", "small 'Alex Brush', \"Alex Brush Placeholder\""],
            ["120% Alex Brush", '120% Alex Brush, "Alex Brush Placeholder"'],
        ];
        for (const [input, expected] of cases) assert.strictEqual(rewriteFontShorthand(input, FAMILIES), expected, input);
        assert.strictEqual(rewriteFontShorthand("700 Source Sans 3", FAMILIES), null, "no size: not a valid shorthand");
    });

    it("rewrites custom properties only when they hold a family list", () => {
        assert.strictEqual(rewriteCustomProperty('"Alex Brush", cursive', FAMILIES), '"Alex Brush", "Alex Brush Placeholder", cursive');
        assert.strictEqual(rewriteCustomProperty("1rem Alex Brush", FAMILIES), null);
        assert.strictEqual(rewriteCustomProperty("url(Alex Brush)", FAMILIES), null);
    });

    it("rewrites a single family in a custom property only when its name is about fonts", () => {
        for (const name of ["--font-heading", "--heading-font", "--body-family", "--typeface", "--ff-sans", "--FONT"]) {
            assert.strictEqual(rewriteCustomProperty("Alex Brush", FAMILIES, name), 'Alex Brush, "Alex Brush Placeholder"', name);
        }
        for (const name of ["--grid-area", "--animation-name", "--offset", "--buffer"]) {
            assert.strictEqual(rewriteCustomProperty("Alex Brush", FAMILIES, name), null, name);
        }
        assert.strictEqual(rewriteCustomProperty("Alex Brush, cursive", FAMILIES, "--stack"), 'Alex Brush, "Alex Brush Placeholder", cursive');
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

    it("lists every url() of src in order", () => {
        assert.deepStrictEqual(
            sourceUrls('local("X"), url(https://cdn/a.woff2) format("woff2"), url("data:font/woff2;base64,AA"), url(\'b.ttf\')'),
            ["https://cdn/a.woff2", "b.ttf"],
        );
    });

    it("picks the first local font url from src", () => {
        assert.strictEqual(pickSourceUrl('local("X"), url("a.woff2") format("woff2"), url(b.ttf)'), "a.woff2");
        assert.strictEqual(pickSourceUrl("url(data:font/woff2;base64,AAAA), url('c.woff')"), "c.woff");
        assert.strictEqual(pickSourceUrl('local("X")'), null);
    });
});

describe("cache key", () => {
    it("tells different character sets apart, whatever their type", () => {
        const key = (characters) => optionsCacheKey({ glyphs: "simplified", characters });
        assert.notStrictEqual(key(new Set([65])), key(new Set([66])));
        assert.strictEqual(key(new Set([66, 65])), key("AB"));
        assert.strictEqual(key([65, 66, 65]), key("BA"));
        assert.notStrictEqual(key("AB"), key(null));
    });

    it("hashes Buffers instead of ignoring them, and ignores key order", () => {
        assert.notStrictEqual(optionsCacheKey({ donor: Buffer.from("a") }), optionsCacheKey({ donor: Buffer.from("b") }));
        assert.strictEqual(optionsCacheKey({ a: 1, b: 2 }), optionsCacheKey({ b: 2, a: 1 }));
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

    it("does not reuse a cached placeholder made for other characters", async () => {
        const cache = path.join(dir, "cache-characters");
        const css = FACE.replace("hollow", "simplified");
        const build = async (characters, cacheDir) =>
            (await postcss([invisibleInk({ cache: cacheDir, characters })]).process(css, { from: path.join(dir, "a.css") })).css;
        await build(new Set([65]), cache);
        const cached = await build(new Set([..."Hello"].map(c => c.codePointAt(0))), cache);
        const fresh = await build(new Set([..."Hello"].map(c => c.codePointAt(0))), false);
        assert.strictEqual(cached, fresh);
    });

    it("treats protocol-relative urls as remote", async () => {
        const result = await process(FACE.replace("./fonts/brush.ttf?v=1#x", "//cdn.example.com/brush.woff2"));
        assert.match(result.warnings()[0].text, /cannot read remote font "\/\/cdn\.example\.com\/brush\.woff2"/);
        assert.strictEqual(result.css.match(/@font-face/g).length, 1);
    });

    it("goes past remote and missing sources to the first local font file", async () => {
        const src = 'url(https://cdn.example.com/brush.woff2) format("woff2"), url(./fonts/nope.woff2), url("./fonts/brush.ttf")';
        const result = await process(FACE.replace(/src: [^;]+;/, `src: ${src};`));
        assert.strictEqual(result.css.match(/@font-face/g).length, 2);
        assert.deepStrictEqual(result.warnings(), []);
        // only remote sources: warn; a missing local file among them: fail
        const remoteOnly = await process(FACE.replace(/src: [^;]+;/, "src: url(https://a/x.woff2), url(//b/y.woff2);"));
        assert.match(remoteOnly.warnings()[0].text, /cannot read remote font "https:\/\/a\/x\.woff2"/);
        await assert.rejects(
            process(FACE.replace(/src: [^;]+;/, "src: url(https://a/x.woff2), url(./fonts/nope.woff2);")),
            /font file not found: \.\/fonts\/nope\.woff2/,
        );
    });

    it("resolves urls against the file each @font-face came from", async () => {
        // What postcss-import or Vite produce: rules from another folder inlined into one root
        fs.mkdirSync(path.join(dir, "vendor", "brush"), { recursive: true });
        fs.copyFileSync(FONT, path.join(dir, "vendor", "brush", "brush.ttf"));
        fs.writeFileSync(path.join(dir, "vendor", "brush", "chars.txt"), "Hi");
        const imported = postcss.parse(
            '@font-face { font-family: "Vendor"; src: url(./brush.ttf); invisible-ink: simplified filter(./chars.txt); }',
            { from: path.join(dir, "vendor", "brush", "index.css") },
        );
        const main = postcss.parse("p { font-family: Vendor; }", { from: path.join(dir, "app", "main.css") });
        main.prepend(imported.nodes);
        const result = await postcss([invisibleInk({ cache: false })]).process(main, { from: path.join(dir, "app", "main.css") });
        assert.strictEqual(result.css.match(/@font-face/g).length, 2);
        assert.match(result.css, /p \{ font-family: Vendor, "Vendor Placeholder"; \}/);
        const dependencies = result.messages.filter(m => m.type === "dependency");
        assert.deepStrictEqual(dependencies.map(m => path.relative(dir, m.file)).sort(), ["vendor/brush/brush.ttf", "vendor/brush/chars.txt"]);
        assert.ok(dependencies.every(m => m.parent === path.join(dir, "app", "main.css")), "dependencies belong to the root file");
    });

    it("leaves an invisible-ink: none marker so later passes still skip the rule", async () => {
        const optedOut = FACE.replace("invisible-ink: hollow", "invisible-ink: none");
        const once = (await process(optedOut, { all: true })).css;
        assert.match(once, /\/\* invisible-ink: none \*\//);
        assert.doesNotMatch(once, /invisible-ink: none;/);
        const twice = (await process(once, { all: true })).css;
        assert.strictEqual(twice, once);
        assert.strictEqual(twice.match(/@font-face/g).length, 1);
        // an explicit descriptor next to the marker wins
        const overridden = once.replace("/* invisible-ink: none */", "/* invisible-ink: none */\n    invisible-ink: hollow;");
        assert.strictEqual((await process(overridden)).css.match(/@font-face/g).length, 2);
    });

    it("leaves single-word custom properties alone unless they are about fonts", async () => {
        const { css } = await process(`${FACE}\n:root { --grid-area: brush; --font-body: brush; }`);
        assert.match(css, /--grid-area: brush;/);
        assert.match(css, /--font-body: brush, "Brush Placeholder";/);
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
