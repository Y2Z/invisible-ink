"use strict";

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");
const { describe, it } = require("node:test");

const sfnt = require("../lib/sfnt");

const CLI = path.resolve(__dirname, "../bin/invisible-ink.js");
const FONT = path.resolve(__dirname, "../example/fonts/AlexBrush-Regular.ttf");

function run(...args) {
    const result = spawnSync(process.execPath, [CLI, ...args], { encoding: "utf8" });
    return { code: result.status, stdout: result.stdout, stderr: result.stderr };
}

function fontFromCSS(css) {
    const match = css.match(/data:font\/(woff2|ttf);base64,([^"]+)"/);
    assert.ok(match, "no data: URL in output");
    return { format: match[1], data: Buffer.from(match[2], "base64") };
}

describe("invisible-ink CLI", () => {
    it("prints a WOFF2 @font-face for the placeholder", () => {
        const { code, stdout, stderr } = run(FONT);
        assert.strictEqual(code, 0, stderr);
        assert.match(stdout, /^@font-face \{\n {4}font-family: "Alex Brush Placeholder";/);
        assert.match(stdout, /format\("woff2"\);\n {4}font-weight: 400;\n {4}font-style: normal;\n\}\n$/);
        const font = fontFromCSS(stdout);
        assert.strictEqual(font.format, "woff2");
        assert.ok(sfnt.readFont(font.data).tables.has("GPOS"));
    });

    it("supports --format truetype and --no-layout", () => {
        const { code, stdout } = run("--format", "truetype", "--no-layout", FONT);
        assert.strictEqual(code, 0);
        const font = fontFromCSS(stdout);
        assert.strictEqual(font.format, "ttf");
        assert.ok(!sfnt.readFont(font.data).tables.has("GPOS"));
    });

    it("reads the characters to draw from --filter", () => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), "invisible-ink-"));
        const filter = path.join(dir, "filter.txt");
        fs.writeFileSync(filter, "ab");
        try {
            const hollow = run(FONT);
            const filtered = run("-f", filter, FONT);
            assert.strictEqual(filtered.code, 0, filtered.stderr);
            assert.ok(fontFromCSS(filtered.stdout).data.length > fontFromCSS(hollow.stdout).data.length);
        } finally {
            fs.rmSync(dir, { recursive: true, force: true });
        }
    });

    it("prints one rule per font file", () => {
        const { code, stdout } = run("-b", FONT, FONT);
        assert.strictEqual(code, 0);
        assert.strictEqual(stdout.match(/@font-face/g).length, 2);
    });

    it("prints help and exits with 2 when no font is given", () => {
        const { code, stdout, stderr } = run();
        assert.strictEqual(code, 2);
        assert.strictEqual(stdout, "");
        assert.match(stderr, /^Usage: invisible-ink/);
    });

    it("prints help on --help and the version on --version", () => {
        assert.match(run("--help").stdout, /^Usage: invisible-ink/);
        assert.strictEqual(run("-V").stdout.trim(), require("../package.json").version);
    });

    it("reports unreadable fonts and exits with 2, still printing the others", () => {
        const { code, stdout, stderr } = run(FONT, __filename);
        assert.strictEqual(code, 2);
        assert.match(stdout, /Alex Brush Placeholder/);
        assert.match(stderr, /unable to process font file .*cli\.integration\.test\.js: Unrecognized font format/);
    });

    it("rejects unknown and conflicting options", () => {
        assert.strictEqual(run("--frobnicate", FONT).code, 2);
        assert.match(run("-b", "-s", FONT).stderr, /cannot be combined/);
        assert.match(run("--format", "eot", FONT).stderr, /Unknown output format/);
    });
});
