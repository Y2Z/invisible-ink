"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { describe, it } = require("node:test");
const opentype = require("opentype.js");

const library = require("../lib");
const sfnt = require("../lib/sfnt");
const { withKerning } = require("./helpers/kerning");

const FONT_PATH = path.resolve(__dirname, "../example/fonts/AlexBrush-Regular.ttf");
const FONT = fs.readFileSync(FONT_PATH);
const LAYOUT_TABLES = ["hmtx", "hhea", "OS/2", "cmap", "GDEF", "GPOS", "GSUB", "post", "name"];

function parse(buffer) {
    return opentype.parse(buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.length));
}

function placeholderTables(options) {
    return sfnt.readFont(library.createPlaceholderFont(FONT, options).data).tables;
}

function visibleGlyphIndices(buffer) {
    const font = parse(buffer);
    const visible = [];
    for (let i = 0; i < font.glyphs.length; i++) {
        // Anything without area (e.g. a single-point contour) draws nothing
        const box = font.glyphs.get(i).getBoundingBox();
        if (box.x2 > box.x1 && box.y2 > box.y1) visible.push(i);
    }
    return visible;
}

describe("createPlaceholderFont", () => {
    for (const glyphs of ["hollow", "blocks", "simplified"]) {
        it(`keeps every metric and layout table byte-for-byte (${glyphs})`, () => {
            const source = sfnt.readFont(FONT).tables;
            const result = placeholderTables({ glyphs, format: "truetype" });
            for (const tag of LAYOUT_TABLES) {
                assert.ok(result.get(tag).equals(source.get(tag)), `"${tag}" differs`);
            }
        });
    }

    it("keeps the glyph count, so GPOS/GSUB glyph ids stay valid", () => {
        const result = library.createPlaceholderFont(FONT, { format: "truetype" });
        assert.strictEqual(parse(result.data).glyphs.length, parse(FONT).glyphs.length);
    });

    it("keeps kerning that the source font has", () => {
        const kerned = withKerning(FONT, [["A", "V", -300]]);
        const result = library.createPlaceholderFont(kerned, { format: "truetype" });
        assert.ok(sfnt.readFont(result.data).tables.get("GPOS").equals(sfnt.readFont(kerned).tables.get("GPOS")));
    });

    it("takes outlines from a donor without needing glyphs: simplified", () => {
        assert.ok(library.createPlaceholderFont(FONT, { donor: FONT }).visibleGlyphCount > 200);
        assert.strictEqual(library.createPlaceholderFont(FONT, { donor: FONT, glyphs: "hollow" }).visibleGlyphCount, 0);
    });

    it("drops layout tables only when asked to", () => {
        const result = placeholderTables({ layout: false, format: "truetype" });
        assert.ok(!result.has("GPOS"));
        assert.ok(!result.has("GSUB"));
        assert.ok(result.has("hmtx"));
    });

    it("draws nothing in hollow mode", () => {
        const result = library.createPlaceholderFont(FONT, { format: "truetype" });
        assert.deepStrictEqual(visibleGlyphIndices(result.data), []);
        assert.strictEqual(result.visibleGlyphCount, 0);
    });

    it("draws only the requested characters", () => {
        const result = library.createPlaceholderFont(FONT, { characters: "ab", format: "truetype" });
        const font = parse(FONT);
        assert.deepStrictEqual(
            visibleGlyphIndices(result.data),
            [font.charToGlyphIndex("a"), font.charToGlyphIndex("b")].sort((x, y) => x - y),
        );
    });

    it("makes blocks out of the glyph bounding boxes", () => {
        const result = library.createPlaceholderFont(FONT, { glyphs: "blocks", characters: "o", format: "truetype" });
        const original = parse(FONT);
        const index = original.charToGlyphIndex("o");
        const block = parse(result.data).glyphs.get(index);
        const box = original.glyphs.get(index).getBoundingBox();
        const corners = new Set(block.path.commands.filter(c => c.type !== "Z").map(c => `${c.x},${c.y}`));
        assert.strictEqual(corners.size, 4);
        assert.deepStrictEqual(
            [block.xMin, block.yMin, block.xMax, block.yMax],
            [box.x1, box.y1, box.x2, box.y2].map(Math.round),
        );
    });

    it("keeps holes when simplifying (one contour per original contour)", () => {
        const result = library.createPlaceholderFont(FONT, { characters: "o", tolerance: 5, format: "truetype" });
        const original = parse(FONT);
        const index = original.charToGlyphIndex("o");
        const count = glyph => glyph.path.commands.filter(c => c.type === "M").length;
        assert.strictEqual(count(parse(result.data).glyphs.get(index)), count(original.glyphs.get(index)));
    });

    it("coarser tolerance gives smaller fonts", () => {
        const fine = library.createPlaceholderFont(FONT, { glyphs: "simplified", tolerance: 10 });
        const coarse = library.createPlaceholderFont(FONT, { glyphs: "simplified", tolerance: 100 });
        assert.ok(coarse.data.length < fine.data.length);
    });

    it("produces WOFF2 by default, and it reads back to the same tables", () => {
        const woff2 = library.createPlaceholderFont(FONT);
        const ttf = library.createPlaceholderFont(FONT, { format: "truetype" });
        assert.strictEqual(woff2.format, "woff2");
        assert.strictEqual(woff2.data.toString("latin1", 0, 4), "wOF2");
        const a = sfnt.readFont(woff2.data).tables;
        const b = sfnt.readFont(ttf.data).tables;
        assert.deepStrictEqual([...a.keys()].sort(), [...b.keys()].sort());
        for (const [tag, data] of b) {
            if (tag !== "head") assert.ok(a.get(tag).equals(data), `"${tag}" differs`);
        }
    });

    it("gives the same placeholder for TrueType and WOFF2 input", () => {
        const { flavor, tables } = sfnt.readFont(FONT);
        const asWoff2 = sfnt.writeWoff2(flavor, tables);
        const a = sfnt.readFont(library.createPlaceholderFont(FONT, { glyphs: "simplified", format: "truetype" }).data).tables;
        const b = sfnt.readFont(library.createPlaceholderFont(asWoff2, { glyphs: "simplified", format: "truetype" }).data).tables;
        for (const [tag, data] of a) {
            if (tag !== "head") assert.ok(b.get(tag).equals(data), `"${tag}" differs`);
        }
    });

    it("names the placeholder after the font family", () => {
        const result = library.createPlaceholderFont(FONT);
        assert.strictEqual(result.familyName, "Alex Brush Placeholder");
        assert.strictEqual(result.sourceFamilyName, "Alex Brush");
        assert.strictEqual(result.weight, 400);
        assert.strictEqual(result.style, "normal");
        assert.strictEqual(library.createPlaceholderFont(FONT, { familyName: "X" }).familyName, "X");
    });

    it("rejects unknown options and unsupported input", () => {
        assert.throws(() => library.createPlaceholderFont(FONT, { glyphs: "fancy" }), /glyphs mode/);
        assert.throws(() => library.createPlaceholderFont(FONT, { format: "eot" }), /output format/);
        assert.throws(() => library.createPlaceholderFont(FONT, { tolerance: -1 }), /tolerance/);
        assert.throws(() => library.createPlaceholderFont(Buffer.from("not a font")), /Unrecognized font format/);
        assert.throws(() => library.createPlaceholderFont(Buffer.from("ttcf\0\0\0\0")), /collections/);
    });
});

describe("variable fonts (gvar)", () => {
    const gvar = require("../lib/gvar");
    const VARIABLE = fs.readFileSync(path.resolve(__dirname, "fonts/Oswald-wght-noHVAR.ttf"));

    // Phantom point deltas of every glyph: { glyphIndex: [[tuple, [[dx, dy] × 4]], ...] }
    function phantomDeltas(tables) {
        const table = tables.get("gvar");
        const counts = gvar.glyphPointCounts(tables);
        const axisCount = table.readUInt16BE(4);
        const longOffsets = table.readUInt16BE(14) & 1;
        const dataStart = table.readUInt32BE(16);
        const offsetAt = (i) => (longOffsets ? table.readUInt32BE(20 + i * 4) : table.readUInt16BE(20 + i * 2) * 2);
        const result = {};
        counts.forEach((count, i) => {
            const data = table.subarray(dataStart + offsetAt(i), dataStart + offsetAt(i + 1));
            const variations = gvar.readGlyphVariations(data, axisCount, count)
                .filter(v => v.phantom.some(([x, y]) => x || y))
                .map(v => [`${v.tupleIndex}:${v.tupleBytes.toString("hex")}`, v.phantom]);
            if (variations.length) result[i] = variations;
        });
        return result;
    }

    const COMPOSITES = fs.readFileSync(path.resolve(__dirname, "fonts/RobotoFlex-XTRA-noHVAR.ttf"));

    // What the placeholder must carry for each glyph: the deltas of the glyph
    // whose metrics renderers use (a USE_MY_METRICS component, or itself)
    function expectedDeltas(tables) {
        const own = phantomDeltas(tables);
        const sources = gvar.metricsSources(gvar.readGlyphStructure(tables).metricsComponent);
        const expected = {};
        sources.forEach((source, glyph) => {
            if (own[source]) expected[glyph] = own[source];
        });
        return expected;
    }

    for (const glyphs of ["hollow", "blocks", "simplified"]) {
        it(`keeps every glyph's width variation (${glyphs})`, () => {
            for (const font of [VARIABLE, COMPOSITES]) {
                const source = sfnt.readFont(font).tables;
                const placeholder = sfnt.readFont(library.createPlaceholderFont(font, { glyphs }).data).tables;
                const expected = expectedDeltas(source);
                assert.ok(Object.keys(expected).length >= 4, "the fixture has width variation");
                assert.deepStrictEqual(phantomDeltas(placeholder), expected);
            }
        });
    }

    it("gives composites with USE_MY_METRICS their component's width variation", () => {
        const source = sfnt.readFont(COMPOSITES).tables;
        const font = parse(COMPOSITES);
        const [r, rcaron] = [font.charToGlyphIndex("r"), font.charToGlyphIndex("ř")];
        const structure = gvar.readGlyphStructure(source);
        assert.strictEqual(structure.metricsComponent[rcaron], r);
        const own = phantomDeltas(source);
        assert.notDeepStrictEqual(own[rcaron], own[r], "the fixture's ř has deltas of its own that differ from r's");
        const placeholder = phantomDeltas(sfnt.readFont(library.createPlaceholderFont(COMPOSITES).data).tables);
        assert.deepStrictEqual(placeholder[rcaron], own[r]);
    });

    it("follows USE_MY_METRICS through nested composites and survives cycles", () => {
        assert.deepStrictEqual(gvar.metricsSources([-1, 0, 1, -1]), [0, 0, 0, 3]);
        assert.deepStrictEqual(gvar.metricsSources([1, 0]), [1, 0]); // a cycle stops where it would repeat
    });

    it("gives every tuple exactly the four phantom points, renumbered for the new outline", () => {
        const placeholder = sfnt.readFont(library.createPlaceholderFont(VARIABLE, { glyphs: "simplified" }).data).tables;
        const table = placeholder.get("gvar");
        const axisCount = table.readUInt16BE(4);
        const counts = gvar.glyphPointCounts(placeholder);
        const dataStart = table.readUInt32BE(16);
        let tuplesChecked = 0;
        counts.forEach((count, i) => {
            const start = dataStart + table.readUInt32BE(20 + i * 4);
            const end = dataStart + table.readUInt32BE(24 + i * 4);
            if (end === start) return;
            const data = table.subarray(start, end);
            assert.strictEqual(data.readUInt16BE(0) & 0x8000, 0, `glyph ${i}: no shared point numbers`);
            let header = 4;
            let chunk = data.readUInt16BE(2);
            for (let t = 0; t < (data.readUInt16BE(0) & 0x0fff); t++) {
                const size = data.readUInt16BE(header);
                const tupleIndex = data.readUInt16BE(header + 2);
                assert.ok(tupleIndex & 0x2000, `glyph ${i}: private point numbers`);
                // packed point numbers: count 4, one run of words, first = count, then +1 +1 +1
                assert.deepStrictEqual(
                    [data[chunk], data[chunk + 1], ...[0, 1, 2, 3].map(k => data.readUInt16BE(chunk + 2 + k * 2))],
                    [4, 0x83, count, 1, 1, 1],
                    `glyph ${i}, tuple ${t}`,
                );
                header += 4 + ((tupleIndex & 0x8000) ? axisCount * 2 : 0) + ((tupleIndex & 0x4000) ? axisCount * 4 : 0);
                chunk += size;
                tuplesChecked++;
            }
            assert.ok(chunk <= data.length, `glyph ${i}: data fits`);
        });
        assert.ok(tuplesChecked > 40);
    });

    it("counts gvar points: outline points for simple glyphs, components for composites", () => {
        const tables = sfnt.readFont(VARIABLE).tables;
        const counts = gvar.glyphPointCounts(tables);
        const font = parse(VARIABLE);
        const space = font.charToGlyphIndex(" ");
        const o = font.charToGlyphIndex("o");
        assert.strictEqual(counts[space], 0);
        const contours = font.glyphs.get(o).path.commands.filter(c => c.type === "M").length;
        assert.ok(counts[o] > contours * 3, "the o has outline points");
    });

    it("adds no gvar to fonts without one", () => {
        assert.ok(!sfnt.readFont(library.createPlaceholderFont(FONT).data).tables.has("gvar"));
    });
});

describe("character filter", () => {
    it("counts characters by code point, including astral ones", () => {
        const { codePointsOf } = library._internal;
        assert.deepStrictEqual([...codePointsOf("a😀a")], [0x61, 0x1f600]);
        assert.deepStrictEqual([...codePointsOf([65, 66])], [65, 66]);
        assert.strictEqual(codePointsOf(null), null);
    });
});

describe("simplifyContour", () => {
    const { simplifyContour } = library._internal;

    it("removes points closer than the tolerance to the outline", () => {
        const square = [
            { x: 0, y: 0 }, { x: 50, y: 1 }, { x: 100, y: 0 }, { x: 100, y: 100 }, { x: 0, y: 100 },
        ];
        assert.deepStrictEqual(simplifyContour(square, 5), [
            { x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }, { x: 0, y: 100 },
        ]);
    });

    it("keeps points farther than the tolerance", () => {
        const notch = [{ x: 0, y: 0 }, { x: 50, y: 30 }, { x: 100, y: 0 }, { x: 100, y: 100 }, { x: 0, y: 100 }];
        assert.strictEqual(simplifyContour(notch, 5).length, 5);
    });
});

describe("pathToContours", () => {
    it("splits paths into one closed contour per M…Z and flattens curves", () => {
        const { pathToContours } = library._internal;
        const p = new opentype.Path();
        p.moveTo(0, 0);
        p.lineTo(10, 0);
        p.quadraticCurveTo(10, 10, 0, 10);
        p.close();
        p.moveTo(20, 20);
        p.curveTo(30, 20, 30, 30, 20, 30);
        p.close();
        const contours = pathToContours(p, 1);
        assert.strictEqual(contours.length, 2);
        assert.deepStrictEqual(contours[0][0], { x: 0, y: 0 });
        assert.deepStrictEqual(contours[0].at(-1), { x: 0, y: 10 });
        assert.ok(contours[0].length > 3);
        assert.deepStrictEqual(contours[1].at(-1), { x: 20, y: 30 });
    });
});

describe("sfnt", () => {
    it("round-trips a font through writeSfnt with a valid head checksum", () => {
        const { flavor, tables } = sfnt.readFont(FONT);
        const written = sfnt.writeSfnt(flavor, tables);
        assert.strictEqual(sfnt.calcChecksum(written), 0xb1b0afba);
        const reread = sfnt.readFont(written).tables;
        for (const [tag, data] of tables) {
            if (tag !== "head") assert.ok(reread.get(tag).equals(data), `"${tag}" differs`);
        }
    });

    it("rebuilds omitted side bearings from glyph headers when glyf is not transformed", () => {
        // WOFF2 with glyf/loca stored as-is (null transform) and hmtx transformed
        // with both side bearing arrays left out (flags = 3)
        const zlib = require("zlib");
        const { flavor, tables } = sfnt.readFont(FONT);
        const numGlyphs = tables.get("maxp").readUInt16BE(4);
        const numHMetrics = tables.get("hhea").readUInt16BE(34);
        const hmtx = tables.get("hmtx");
        const transformedHmtx = Buffer.alloc(1 + numHMetrics * 2);
        transformedHmtx[0] = 3;
        for (let i = 0; i < numHMetrics; i++) transformedHmtx.writeUInt16BE(hmtx.readUInt16BE(i * 4), 1 + i * 2);

        const known = ["cmap", "head", "hhea", "hmtx", "maxp", "name", "OS/2", "post", "cvt ", "fpgm", "glyf", "loca", "prep", "CFF ", "VORG", "EBDT",
            "EBLC", "gasp", "hdmx", "kern", "LTSH", "PCLT", "VDMX", "vhea", "vmtx", "BASE", "GDEF", "GPOS", "GSUB"];
        const varint = (value) => {
            const bytes = [];
            do {
                bytes.unshift(value & 0x7f);
                value = Math.floor(value / 128);
            } while (value > 0);
            return bytes.map((byte, i) => (i < bytes.length - 1 ? byte | 0x80 : byte));
        };
        const tags = [...tables.keys()].sort();
        const directory = [];
        const stream = [];
        for (const tag of tags) {
            const index = known.indexOf(tag);
            const version = tag === "glyf" || tag === "loca" ? 3 : tag === "hmtx" ? 1 : 0;
            directory.push(index >= 0 ? index | (version << 6) : 0x3f | (version << 6));
            if (index < 0) directory.push(...Buffer.from(tag, "latin1"));
            directory.push(...varint(tables.get(tag).length));
            if (tag === "hmtx") directory.push(...varint(transformedHmtx.length));
            stream.push(tag === "hmtx" ? transformedHmtx : tables.get(tag));
        }
        const compressed = zlib.brotliCompressSync(Buffer.concat(stream));
        const header = Buffer.alloc(48);
        header.write("wOF2", 0, "latin1");
        header.writeUInt32BE(flavor, 4);
        header.writeUInt16BE(tags.length, 12);
        header.writeUInt32BE(compressed.length, 20);
        const woff2 = Buffer.concat([header, Buffer.from(directory), compressed]);
        header.writeUInt32BE(woff2.length, 8);

        const decoded = sfnt.readFont(Buffer.concat([header, Buffer.from(directory), compressed])).tables.get("hmtx");
        const font = parse(FONT);
        let checked = 0;
        for (let i = 0; i < numGlyphs; i++) {
            const lsb = i < numHMetrics ? decoded.readInt16BE(i * 4 + 2) : decoded.readInt16BE(numHMetrics * 4 + (i - numHMetrics) * 2);
            const glyph = font.glyphs.get(i);
            const expected = glyph.path.commands.length ? glyph.xMin : 0;
            assert.strictEqual(lsb, expected, `glyph ${i}`);
            if (expected !== 0) checked++;
        }
        assert.ok(checked > 100, "most glyphs have a non-zero side bearing");
        for (let i = 0; i < numHMetrics; i++) assert.strictEqual(decoded.readUInt16BE(i * 4), hmtx.readUInt16BE(i * 4));
    });

    it("decodes WOFF (zlib) files", () => {
        const zlib = require("zlib");
        const { flavor, tables } = sfnt.readFont(FONT);
        const tags = [...tables.keys()].sort();
        const entries = tags.map(tag => ({ tag, data: tables.get(tag), comp: zlib.deflateSync(tables.get(tag)) }));
        const header = Buffer.alloc(44 + tags.length * 20);
        header.write("wOFF", 0, "latin1");
        header.writeUInt32BE(flavor, 4);
        header.writeUInt16BE(tags.length, 12);
        let offset = header.length;
        const bodies = [];
        entries.forEach((entry, i) => {
            const useComp = entry.comp.length < entry.data.length;
            const stored = useComp ? entry.comp : entry.data;
            const record = 44 + i * 20;
            header.write(entry.tag, record, "latin1");
            header.writeUInt32BE(offset, record + 4);
            header.writeUInt32BE(stored.length, record + 8);
            header.writeUInt32BE(entry.data.length, record + 12);
            const padded = Buffer.concat([stored, Buffer.alloc((4 - (stored.length % 4)) % 4)]);
            bodies.push(padded);
            offset += padded.length;
        });
        const woff = Buffer.concat([header, ...bodies]);
        const decoded = sfnt.readFont(woff).tables;
        for (const [tag, data] of tables) assert.ok(decoded.get(tag).equals(data), `"${tag}" differs`);
    });
});

describe("composeCSSFontFaceDefinition", () => {
    it("returns a @font-face rule for WOFF2 data", () => {
        assert.strictEqual(
            library.composeCSSFontFaceDefinition("Test Font", "woff2", Buffer.from("Dummy font data"), { "font-weight": 700 }),
            `@font-face {
    font-family: "Test Font";
    src: url("data:font/woff2;base64,RHVtbXkgZm9udCBkYXRh") format("woff2");
    font-weight: 700;
}`,
        );
    });

    it("still accepts the 1.x opentype type", () => {
        assert.match(
            library.composeCSSFontFaceDefinition("Test Font", "opentype", Buffer.from("x")),
            /src: url\("data:font\/otf;base64,eA=="\) format\("opentype"\);/,
        );
    });

    it("escapes quotes in family names", () => {
        assert.match(library.composeCSSFontFaceDefinition('A "B"', "woff2", Buffer.alloc(1)), /font-family: "A \\"B\\"";/);
    });

    it("rejects unknown types", () => {
        assert.throws(() => library.composeCSSFontFaceDefinition("A", "eot", Buffer.alloc(1)), /Unknown font type/);
    });
});

describe("1.x API", () => {
    it("bufferToArrayBuffer copies the bytes of a Buffer", () => {
        const ab = library.bufferToArrayBuffer(Buffer.from("Dummy"));
        assert.deepStrictEqual([...new Uint8Array(ab)], [...Buffer.from("Dummy")]);
    });

    it("bufferToBase64String encodes Buffers and ArrayBuffers", () => {
        assert.strictEqual(library.bufferToBase64String(Buffer.from("Dummy data")), "RHVtbXkgZGF0YQ==");
        assert.strictEqual(library.bufferToBase64String(new Uint8Array([68]).buffer), "RA==");
    });

    it("createFontBuffer still returns a font with the placeholder name", () => {
        const result = library.createFontBuffer(library.bufferToArrayBuffer(FONT), { allowedUnicodes: [97] });
        assert.strictEqual(result.name, "Alex Brush Placeholder");
        assert.ok(result.data instanceof ArrayBuffer);
        assert.strictEqual(visibleGlyphIndices(Buffer.from(result.data)).length, 1);
    });

    it("glyphToSolidBlockPath draws the glyph's bounding box", () => {
        const p = library.glyphToSolidBlockPath({ xMin: 1, yMin: 0, xMax: 10, yMax: 9 });
        assert.deepStrictEqual(p.commands.map(c => [c.type, c.x, c.y]), [
            ["M", 10, 0], ["L", 1, 0], ["L", 1, 9], ["L", 10, 9], ["L", 10, 0],
        ]);
    });
});
