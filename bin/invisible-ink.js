#!/usr/bin/env node

"use strict";

const fs = require("fs");
const path = require("path");
const { parseArgs } = require("util");

const library = require("../lib");
const packageJSON = require("../package.json");

const HELP = `\
Usage: invisible-ink [options] <fontFile...>

Prints @font-face rules for placeholder fonts: same metrics and kerning as
each font file (.ttf, .otf, .woff, .woff2), but with invisible glyphs.

Options:
  -b, --blocks              draw glyphs as solid blocks
  -s, --simplified          draw glyphs as simplified outlines
  -f, --filter <textFile>   only draw characters found in this file
                            (simplified outlines unless --blocks is given)
  -d, --donor <fontFile>    take simplified outlines from this font instead
                            (--blocks fills in glyphs the donor lacks)
  -t, --tolerance <n>       simplification tolerance per 1000 units of em
                            (default: 50; higher is coarser and smaller)
      --format <format>     woff2 (default) or truetype
      --no-layout           drop kerning and other layout tables: smaller,
                            but text no longer lines up exactly
  -h, --help                show this message
  -V, --version             show version number
`;

function fail(message) {
    process.stderr.write(`invisible-ink: ${message}\n`);
    process.exit(2);
}

let parsed;
try {
    parsed = parseArgs({
        allowPositionals: true,
        options: {
            blocks: { type: "boolean", short: "b" },
            simplified: { type: "boolean", short: "s" },
            filter: { type: "string", short: "f" },
            donor: { type: "string", short: "d" },
            tolerance: { type: "string", short: "t" },
            format: { type: "string", default: "woff2" },
            "no-layout": { type: "boolean" },
            help: { type: "boolean", short: "h" },
            version: { type: "boolean", short: "V" },
        },
    });
} catch (err) {
    fail(`${err.message}\n\n${HELP}`);
}

const { values, positionals: fontFiles } = parsed;

if (values.help) {
    process.stdout.write(HELP);
    process.exit(0);
}
if (values.version) {
    process.stdout.write(`${packageJSON.version}\n`);
    process.exit(0);
}
if (fontFiles.length < 1) {
    process.stderr.write(HELP);
    process.exit(2);
}
if (values.blocks && values.simplified) fail("--blocks and --simplified cannot be combined");

const readFile = (file) => fs.readFileSync(path.resolve(process.cwd(), file));

let glyphs = "hollow";
if (values.simplified || values.filter || values.donor) glyphs = "simplified";
if (values.blocks && !values.donor) glyphs = "blocks";

let options;
try {
    options = {
        glyphs,
        format: values.format,
        layout: !values["no-layout"],
        characters: values.filter ? readFile(values.filter).toString("utf8") : null,
        donor: values.donor ? readFile(values.donor) : null,
        missing: values.donor && values.blocks ? "blocks" : "hollow",
    };
    if (values.tolerance !== undefined) options.tolerance = values.tolerance;
} catch (err) {
    fail(err.message);
}

const output = [];
let failureCount = 0;

for (const fontFile of fontFiles) {
    try {
        const placeholder = library.createPlaceholderFont(readFile(fontFile), options);
        output.push(library.composeCSSFontFaceDefinition(placeholder.familyName, placeholder.format, placeholder.data, {
            "font-weight": placeholder.weight,
            "font-style": placeholder.style,
        }));
    } catch (err) {
        process.stderr.write(`invisible-ink: unable to process font file ${fontFile}: ${err.message}\n`);
        failureCount++;
    }
}

if (output.length > 0) {
    process.stdout.write(output.join("\n\n") + "\n");
}

process.exit(failureCount === 0 ? 0 : 2);
