"use strict";

// Builds a minimal GPOS table with one 'kern' feature (PairPos format 1) and
// puts it into a font, so tests can check kerning with any font they have.

const opentype = require("opentype.js");

const sfnt = require("../../lib/sfnt");

function u16(value) {
    const b = Buffer.alloc(2);
    b.writeUInt16BE(value & 0xffff, 0);
    return b;
}

function i16(value) {
    const b = Buffer.alloc(2);
    b.writeInt16BE(value, 0);
    return b;
}

// pairs: [[firstGlyphId, secondGlyphId, xAdvanceAdjustment], ...]
function buildGpos(pairs) {
    const byFirst = new Map();
    for (const [first, second, value] of pairs) {
        if (!byFirst.has(first)) byFirst.set(first, []);
        byFirst.get(first).push([second, value]);
    }
    const firsts = [...byFirst.keys()].sort((a, b) => a - b);

    // PairPos format 1 subtable: header, pair sets, coverage
    const pairSets = firsts.map(first => {
        const records = byFirst.get(first).sort((a, b) => a[0] - b[0]);
        return Buffer.concat([u16(records.length), ...records.map(([second, value]) => Buffer.concat([u16(second), i16(value)]))]);
    });
    const headerLength = 10 + firsts.length * 2;
    let offset = headerLength;
    const pairSetOffsets = pairSets.map(set => {
        const at = offset;
        offset += set.length;
        return at;
    });
    const coverage = Buffer.concat([u16(1), u16(firsts.length), ...firsts.map(u16)]);
    const subtable = Buffer.concat([
        u16(1), u16(offset), u16(0x0004), u16(0), u16(firsts.length), ...pairSetOffsets.map(u16),
        ...pairSets, coverage,
    ]);

    const lookup = Buffer.concat([u16(2), u16(0), u16(1), u16(8), subtable]);
    const lookupList = Buffer.concat([u16(1), u16(4), lookup]);

    const feature = Buffer.concat([u16(0), u16(1), u16(0)]);
    const featureList = Buffer.concat([u16(1), Buffer.from("kern", "latin1"), u16(8), feature]);

    // One script table (default LangSys -> feature 0), listed as DFLT and latn
    const langSys = Buffer.concat([u16(0), u16(0xffff), u16(1), u16(0)]);
    const script = Buffer.concat([u16(4), u16(0), langSys]);
    const scriptList = Buffer.concat([
        u16(2), Buffer.from("DFLT", "latin1"), u16(14), Buffer.from("latn", "latin1"), u16(14), script,
    ]);

    const header = Buffer.concat([u16(1), u16(0), u16(10), u16(10 + scriptList.length), u16(10 + scriptList.length + featureList.length)]);
    return Buffer.concat([header, scriptList, featureList, lookupList]);
}

// Returns a copy of `fontBuffer` (TrueType) kerned with character pairs like
// [["A", "V", -300]]. Existing GPOS/GSUB/kern tables are replaced.
function withKerning(fontBuffer, characterPairs) {
    const font = opentype.parse(fontBuffer.buffer.slice(fontBuffer.byteOffset, fontBuffer.byteOffset + fontBuffer.length));
    const glyphPairs = characterPairs.map(([a, b, value]) => [font.charToGlyphIndex(a), font.charToGlyphIndex(b), value]);

    const { flavor, tables } = sfnt.readFont(fontBuffer);
    tables.delete("kern");
    tables.delete("GSUB");
    tables.set("GPOS", buildGpos(glyphPairs));
    return sfnt.writeSfnt(flavor, tables);
}

module.exports = { buildGpos, withKerning };
