"use strict";

// Reading and writing of font containers: plain sfnt (TrueType / OpenType),
// WOFF and WOFF2. Tables are kept as raw bytes, so anything this module does
// not need to understand is passed through untouched.

const zlib = require("zlib");

const SFNT_TRUETYPE = 0x00010000;
const SFNT_OPENTYPE = 0x4f54544f; // "OTTO"
const SIGNATURE_WOFF = 0x774f4646; // "wOFF"
const SIGNATURE_WOFF2 = 0x774f4632; // "wOF2"
const SIGNATURE_TTC = 0x74746366; // "ttcf"

// WOFF2 "known table tags", in the order defined by the specification.
const WOFF2_KNOWN_TAGS = [
    "cmap", "head", "hhea", "hmtx", "maxp", "name", "OS/2", "post",
    "cvt ", "fpgm", "glyf", "loca", "prep", "CFF ", "VORG", "EBDT",
    "EBLC", "gasp", "hdmx", "kern", "LTSH", "PCLT", "VDMX", "vhea",
    "vmtx", "BASE", "GDEF", "GPOS", "GSUB", "EBSC", "JSTF", "MATH",
    "CBDT", "CBLC", "COLR", "CPAL", "SVG ", "sbix", "acnt", "avar",
    "bdat", "bloc", "bsln", "cvar", "fdsc", "feat", "fmtx", "fvar",
    "gvar", "hsty", "just", "lcar", "mort", "morx", "opbd", "prop",
    "trak", "Zapf", "Silf", "Glat", "Gloc", "Feat", "Sill",
];

function toBuffer(input) {
    if (Buffer.isBuffer(input)) return input;
    if (input instanceof ArrayBuffer) return Buffer.from(input);
    if (ArrayBuffer.isView(input)) return Buffer.from(input.buffer, input.byteOffset, input.byteLength);
    throw new TypeError("Expected a Buffer, ArrayBuffer or typed array");
}

function readTag(buffer, offset) {
    return buffer.toString("latin1", offset, offset + 4);
}

function detectContainer(buffer) {
    if (buffer.length < 4) throw new Error("File is too short to be a font");
    switch (buffer.readUInt32BE(0)) {
        case SFNT_TRUETYPE:
        case 0x74727565: // "true" (old Apple TrueType)
        case SFNT_OPENTYPE:
            return "sfnt";
        case SIGNATURE_WOFF:
            return "woff";
        case SIGNATURE_WOFF2:
            return "woff2";
        case SIGNATURE_TTC:
            throw new Error("Font collections (.ttc) are not supported");
        default:
            throw new Error("Unrecognized font format");
    }
}

// Returns { flavor, tables: Map<tag, Buffer> } for any supported container.
function readFont(input) {
    const buffer = toBuffer(input);

    switch (detectContainer(buffer)) {
        case "sfnt": return readSfnt(buffer);
        case "woff": return readWoff(buffer);
        case "woff2": return readWoff2(buffer);
    }
}

function readSfnt(buffer) {
    const flavor = buffer.readUInt32BE(0);
    const numTables = buffer.readUInt16BE(4);
    const tables = new Map();

    for (let i = 0; i < numTables; i++) {
        const record = 12 + i * 16;
        const tag = readTag(buffer, record);
        const offset = buffer.readUInt32BE(record + 8);
        const length = buffer.readUInt32BE(record + 12);
        if (offset + length > buffer.length) throw new Error(`Table "${tag}" extends past the end of the file`);
        tables.set(tag, buffer.subarray(offset, offset + length));
    }

    return { flavor, tables };
}

function readWoff(buffer) {
    const flavor = buffer.readUInt32BE(4);
    const numTables = buffer.readUInt16BE(12);
    const tables = new Map();

    for (let i = 0; i < numTables; i++) {
        const record = 44 + i * 20;
        const tag = readTag(buffer, record);
        const offset = buffer.readUInt32BE(record + 4);
        const compLength = buffer.readUInt32BE(record + 8);
        const origLength = buffer.readUInt32BE(record + 12);
        const data = buffer.subarray(offset, offset + compLength);
        tables.set(tag, compLength < origLength ? zlib.inflateSync(data) : data);
    }

    return { flavor, tables };
}

// ---------------------------------------------------------------- WOFF2 ----

function readUIntBase128(buffer, state) {
    let result = 0;
    for (let i = 0; i < 5; i++) {
        const byte = buffer[state.offset++];
        if (i === 0 && byte === 0x80) throw new Error("Invalid UIntBase128 value");
        result = result * 128 + (byte & 0x7f);
        if ((byte & 0x80) === 0) return result;
    }
    throw new Error("UIntBase128 value is too long");
}

function read255UInt16(buffer, state) {
    const code = buffer[state.offset++];
    if (code === 253) {
        const value = buffer.readUInt16BE(state.offset);
        state.offset += 2;
        return value;
    }
    if (code === 255) return buffer[state.offset++] + 253;
    if (code === 254) return buffer[state.offset++] + 253 * 2;
    return code;
}

function readWoff2(buffer) {
    const flavor = buffer.readUInt32BE(4);
    if (flavor === SIGNATURE_TTC) throw new Error("WOFF2 font collections are not supported");
    const numTables = buffer.readUInt16BE(12);
    const totalCompressedSize = buffer.readUInt32BE(20);

    const state = { offset: 48 };
    const entries = [];
    for (let i = 0; i < numTables; i++) {
        const flags = buffer[state.offset++];
        let tag;
        if ((flags & 0x3f) === 0x3f) {
            tag = readTag(buffer, state.offset);
            state.offset += 4;
        } else {
            tag = WOFF2_KNOWN_TAGS[flags & 0x3f];
        }
        const version = flags >> 6;
        const origLength = readUIntBase128(buffer, state);
        // glyf and loca are transformed when version is 0, everything else when it is not
        const transformed = (tag === "glyf" || tag === "loca") ? version === 0 : version !== 0;
        const transformLength = transformed ? readUIntBase128(buffer, state) : origLength;
        entries.push({ tag, version, origLength, transformed, transformLength });
    }

    const stream = zlib.brotliDecompressSync(buffer.subarray(state.offset, state.offset + totalCompressedSize));

    const raw = new Map();
    let position = 0;
    for (const entry of entries) {
        raw.set(entry.tag, stream.subarray(position, position + entry.transformLength));
        position += entry.transformLength;
    }

    const tables = new Map();
    let glyfInfo = null;
    const glyfEntry = entries.find(e => e.tag === "glyf");
    if (glyfEntry && glyfEntry.transformed) {
        glyfInfo = reconstructGlyf(raw.get("glyf"));
    }

    for (const entry of entries) {
        if (entry.tag === "glyf" && glyfInfo) {
            tables.set("glyf", glyfInfo.glyf);
        } else if (entry.tag === "loca" && glyfInfo) {
            tables.set("loca", glyfInfo.loca);
        } else if (entry.tag === "hmtx" && entry.transformed) {
            tables.set("hmtx", reconstructHmtx(raw.get("hmtx"), raw, glyfInfo));
        } else if (entry.transformed && entry.tag !== "glyf" && entry.tag !== "loca") {
            throw new Error(`Unsupported WOFF2 transform for table "${entry.tag}"`);
        } else {
            tables.set(entry.tag, raw.get(entry.tag));
        }
    }

    if (glyfInfo) {
        // loca format is dictated by the reconstructed data
        const head = Buffer.from(tables.get("head"));
        head.writeInt16BE(1, 50);
        tables.set("head", head);
    }

    return { flavor, tables };
}

function withSign(flag, value) {
    return (flag & 1) ? value : -value;
}

// Decodes one point of the WOFF2 "triplet" coordinate encoding.
function decodeTriplet(flag, data, state) {
    const f = flag & 0x7f;
    const onCurve = (flag & 0x80) === 0;
    const at = state.offset;
    let dx, dy;

    if (f < 10) {
        dx = 0;
        dy = withSign(f, ((f & 14) << 7) + data[at]);
        state.offset += 1;
    } else if (f < 20) {
        dx = withSign(f, (((f - 10) & 14) << 7) + data[at]);
        dy = 0;
        state.offset += 1;
    } else if (f < 84) {
        const b0 = f - 20;
        const b1 = data[at];
        dx = withSign(f, 1 + (b0 & 0x30) + (b1 >> 4));
        dy = withSign(f >> 1, 1 + ((b0 & 0x0c) << 2) + (b1 & 0x0f));
        state.offset += 1;
    } else if (f < 120) {
        const b0 = f - 84;
        dx = withSign(f, 1 + (Math.floor(b0 / 12) << 8) + data[at]);
        dy = withSign(f >> 1, 1 + (((b0 % 12) >> 2) << 8) + data[at + 1]);
        state.offset += 2;
    } else if (f < 124) {
        const b2 = data[at + 1];
        dx = withSign(f, (data[at] << 4) + (b2 >> 4));
        dy = withSign(f >> 1, ((b2 & 0x0f) << 8) + data[at + 2]);
        state.offset += 3;
    } else {
        dx = withSign(f, (data[at] << 8) + data[at + 1]);
        dy = withSign(f >> 1, (data[at + 2] << 8) + data[at + 3]);
        state.offset += 4;
    }

    return { dx, dy, onCurve };
}

// Length in bytes of the composite glyph description starting at `offset`.
function compositeLength(data, offset) {
    const ARG_1_AND_2_ARE_WORDS = 0x0001;
    const WE_HAVE_A_SCALE = 0x0008;
    const MORE_COMPONENTS = 0x0020;
    const WE_HAVE_AN_X_AND_Y_SCALE = 0x0040;
    const WE_HAVE_A_TWO_BY_TWO = 0x0080;
    const WE_HAVE_INSTRUCTIONS = 0x0100;

    let position = offset;
    let flags;
    let hasInstructions = false;
    do {
        flags = data.readUInt16BE(position);
        hasInstructions = hasInstructions || Boolean(flags & WE_HAVE_INSTRUCTIONS);
        position += 4 + ((flags & ARG_1_AND_2_ARE_WORDS) ? 4 : 2);
        if (flags & WE_HAVE_A_SCALE) position += 2;
        else if (flags & WE_HAVE_AN_X_AND_Y_SCALE) position += 4;
        else if (flags & WE_HAVE_A_TWO_BY_TWO) position += 8;
    } while (flags & MORE_COMPONENTS);

    return { length: position - offset, hasInstructions };
}

function reconstructGlyf(data) {
    const numGlyphs = data.readUInt16BE(4);
    const optionFlags = data.readUInt16BE(2);
    const sizes = [];
    for (let i = 0; i < 7; i++) sizes.push(data.readUInt32BE(8 + i * 4));

    let start = 36;
    const streams = sizes.map(size => {
        const stream = data.subarray(start, start + size);
        start += size;
        return stream;
    });
    const [nContourStream, nPointsStream, flagStream, glyphStream, compositeStream, bboxStream, instructionStream] = streams;
    const overlapBitmap = (optionFlags & 1) ? data.subarray(start, start + ((numGlyphs + 7) >> 3)) : null;

    const bboxBitmapLength = 4 * Math.floor((numGlyphs + 31) / 32);
    const bboxBitmap = bboxStream.subarray(0, bboxBitmapLength);
    const states = {
        nPoints: { offset: 0 },
        flag: { offset: 0 },
        glyph: { offset: 0 },
        composite: { offset: 0 },
        bbox: { offset: bboxBitmapLength },
        instruction: { offset: 0 },
    };

    const glyphs = [];
    const xMins = [];

    for (let index = 0; index < numGlyphs; index++) {
        const nContours = nContourStream.readInt16BE(index * 2);
        const hasBbox = Boolean(bboxBitmap[index >> 3] & (0x80 >> (index & 7)));
        const readBbox = () => {
            const b = bboxStream;
            const o = states.bbox.offset;
            states.bbox.offset += 8;
            return [b.readInt16BE(o), b.readInt16BE(o + 2), b.readInt16BE(o + 4), b.readInt16BE(o + 6)];
        };

        if (nContours === 0) {
            glyphs.push(Buffer.alloc(0));
            xMins.push(0);
            continue;
        }

        if (nContours < 0) {
            const { length, hasInstructions } = compositeLength(compositeStream, states.composite.offset);
            const components = compositeStream.subarray(states.composite.offset, states.composite.offset + length);
            states.composite.offset += length;
            const bbox = readBbox();
            let instructions = Buffer.alloc(0);
            if (hasInstructions) {
                const instructionLength = read255UInt16(glyphStream, states.glyph);
                instructions = instructionStream.subarray(states.instruction.offset, states.instruction.offset + instructionLength);
                states.instruction.offset += instructionLength;
            }
            const header = Buffer.alloc(10);
            header.writeInt16BE(-1, 0);
            bbox.forEach((value, i) => header.writeInt16BE(value, 2 + i * 2));
            const parts = [header, components];
            if (hasInstructions) {
                const lengthBytes = Buffer.alloc(2);
                lengthBytes.writeUInt16BE(instructions.length, 0);
                parts.push(lengthBytes, instructions);
            }
            glyphs.push(Buffer.concat(parts));
            xMins.push(bbox[0]);
            continue;
        }

        const endPoints = [];
        let totalPoints = 0;
        for (let c = 0; c < nContours; c++) {
            totalPoints += read255UInt16(nPointsStream, states.nPoints);
            endPoints.push(totalPoints - 1);
        }

        const points = [];
        let x = 0;
        let y = 0;
        for (let p = 0; p < totalPoints; p++) {
            const flag = flagStream[states.flag.offset++];
            const { dx, dy, onCurve } = decodeTriplet(flag, glyphStream, states.glyph);
            x += dx;
            y += dy;
            points.push({ x, y, onCurve });
        }

        const instructionLength = read255UInt16(glyphStream, states.glyph);
        const instructions = instructionStream.subarray(states.instruction.offset, states.instruction.offset + instructionLength);
        states.instruction.offset += instructionLength;

        let bbox;
        if (hasBbox) {
            bbox = readBbox();
        } else {
            bbox = [Infinity, Infinity, -Infinity, -Infinity];
            for (const point of points) {
                bbox[0] = Math.min(bbox[0], point.x);
                bbox[1] = Math.min(bbox[1], point.y);
                bbox[2] = Math.max(bbox[2], point.x);
                bbox[3] = Math.max(bbox[3], point.y);
            }
        }

        const overlap = Boolean(overlapBitmap && (overlapBitmap[index >> 3] & (0x80 >> (index & 7))));
        glyphs.push(encodeSimpleGlyph(endPoints, points, bbox, instructions, overlap));
        xMins.push(bbox[0]);
    }

    const { glyf, loca } = assembleGlyfAndLoca(glyphs);
    return { glyf, loca, xMins, numGlyphs };
}

function reconstructHmtx(data, raw, glyfInfo) {
    const flags = data[0];
    const numHMetrics = raw.get("hhea").readUInt16BE(34);
    const numGlyphs = raw.get("maxp").readUInt16BE(4);
    const xMins = glyfInfo ? glyfInfo.xMins : new Array(numGlyphs).fill(0);

    let offset = 1;
    const advances = [];
    for (let i = 0; i < numHMetrics; i++) {
        advances.push(data.readUInt16BE(offset));
        offset += 2;
    }
    const lsbs = [];
    for (let i = 0; i < numHMetrics; i++) {
        if (flags & 1) {
            lsbs.push(xMins[i]);
        } else {
            lsbs.push(data.readInt16BE(offset));
            offset += 2;
        }
    }
    for (let i = numHMetrics; i < numGlyphs; i++) {
        if (flags & 2) {
            lsbs.push(xMins[i]);
        } else {
            lsbs.push(data.readInt16BE(offset));
            offset += 2;
        }
    }

    const out = Buffer.alloc(numHMetrics * 4 + (numGlyphs - numHMetrics) * 2);
    let position = 0;
    for (let i = 0; i < numGlyphs; i++) {
        if (i < numHMetrics) {
            out.writeUInt16BE(advances[i], position);
            position += 2;
        }
        out.writeInt16BE(lsbs[i], position);
        position += 2;
    }
    return out;
}

// ------------------------------------------------------- glyf encoding ----

// Encodes a simple TrueType glyph. Coordinates are absolute; flags are written
// without run-length compression, coordinates as short or word deltas.
function encodeSimpleGlyph(endPoints, points, bbox, instructions, overlap) {
    if (!instructions) instructions = Buffer.alloc(0);
    const flags = [];
    const xBytes = [];
    const yBytes = [];
    let previousX = 0;
    let previousY = 0;

    points.forEach((point, i) => {
        let flag = point.onCurve ? 0x01 : 0x00;
        if (i === 0 && overlap) flag |= 0x40;
        const dx = point.x - previousX;
        const dy = point.y - previousY;
        previousX = point.x;
        previousY = point.y;

        if (dx === 0) {
            flag |= 0x10; // x is same
        } else if (dx > -256 && dx < 256) {
            flag |= 0x02 | (dx > 0 ? 0x10 : 0);
            xBytes.push(Math.abs(dx));
        } else {
            xBytes.push((dx >> 8) & 0xff, dx & 0xff);
        }

        if (dy === 0) {
            flag |= 0x20;
        } else if (dy > -256 && dy < 256) {
            flag |= 0x04 | (dy > 0 ? 0x20 : 0);
            yBytes.push(Math.abs(dy));
        } else {
            yBytes.push((dy >> 8) & 0xff, dy & 0xff);
        }

        flags.push(flag);
    });

    const header = Buffer.alloc(10 + endPoints.length * 2 + 2);
    header.writeInt16BE(endPoints.length, 0);
    bbox.forEach((value, i) => header.writeInt16BE(value, 2 + i * 2));
    endPoints.forEach((value, i) => header.writeUInt16BE(value, 10 + i * 2));
    header.writeUInt16BE(instructions.length, 10 + endPoints.length * 2);

    return Buffer.concat([header, instructions, Buffer.from(flags), Buffer.from(xBytes), Buffer.from(yBytes)]);
}

// Concatenates glyph records (4-byte aligned) and builds a long-format loca.
function assembleGlyfAndLoca(glyphs) {
    const loca = Buffer.alloc((glyphs.length + 1) * 4);
    const parts = [];
    let offset = 0;

    glyphs.forEach((glyph, i) => {
        loca.writeUInt32BE(offset, i * 4);
        if (glyph.length > 0) {
            const padding = (4 - (glyph.length % 4)) % 4;
            parts.push(glyph);
            if (padding) parts.push(Buffer.alloc(padding));
            offset += glyph.length + padding;
        }
    });
    loca.writeUInt32BE(offset, glyphs.length * 4);

    return { glyf: Buffer.concat(parts), loca };
}

// --------------------------------------------------------------- writing ----

function calcChecksum(buffer) {
    let sum = 0;
    const padded = buffer.length % 4 ? Buffer.concat([buffer, Buffer.alloc(4 - (buffer.length % 4))]) : buffer;
    for (let i = 0; i < padded.length; i += 4) {
        sum = (sum + padded.readUInt32BE(i)) >>> 0;
    }
    return sum;
}

function sortedTags(tables) {
    return [...tables.keys()].sort();
}

// Serializes tables into a plain sfnt (.ttf / .otf) file.
function writeSfnt(flavor, tables) {
    const tags = sortedTags(tables);
    const numTables = tags.length;
    let entrySelector = 0;
    while ((1 << (entrySelector + 1)) <= numTables) entrySelector++;
    const searchRange = (1 << entrySelector) * 16;

    const header = Buffer.alloc(12 + numTables * 16);
    header.writeUInt32BE(flavor, 0);
    header.writeUInt16BE(numTables, 4);
    header.writeUInt16BE(searchRange, 6);
    header.writeUInt16BE(entrySelector, 8);
    header.writeUInt16BE(numTables * 16 - searchRange, 10);

    const parts = [header];
    let offset = header.length;
    let headOffset = -1;

    tags.forEach((tag, i) => {
        let data = tables.get(tag);
        if (tag === "head") {
            data = Buffer.from(data);
            data.writeUInt32BE(0, 8); // checkSumAdjustment is computed last
            headOffset = offset;
        }
        const record = 12 + i * 16;
        header.write(tag, record, 4, "latin1");
        header.writeUInt32BE(calcChecksum(data), record + 4);
        header.writeUInt32BE(offset, record + 8);
        header.writeUInt32BE(data.length, record + 12);
        parts.push(data);
        const padding = (4 - (data.length % 4)) % 4;
        if (padding) parts.push(Buffer.alloc(padding));
        offset += data.length + padding;
    });

    const font = Buffer.concat(parts);
    if (headOffset >= 0) {
        font.writeUInt32BE((0xb1b0afba - calcChecksum(font)) >>> 0, headOffset + 8);
    }
    return font;
}

function writeUIntBase128(value) {
    const bytes = [];
    do {
        bytes.unshift(value & 0x7f);
        value = Math.floor(value / 128);
    } while (value > 0);
    for (let i = 0; i < bytes.length - 1; i++) bytes[i] |= 0x80;
    return bytes;
}

// Serializes tables into a WOFF2 file. No table transforms are applied
// (glyf/loca use the "null" transform), which keeps the encoder small while
// still getting Brotli compression.
function writeWoff2(flavor, tables) {
    const sfnt = writeSfnt(flavor, tables); // for totalSfntSize and the final head checksum
    const sfntTables = readSfnt(sfnt).tables;
    const tags = sortedTags(sfntTables);

    const directory = [];
    for (const tag of tags) {
        const known = WOFF2_KNOWN_TAGS.indexOf(tag);
        const version = (tag === "glyf" || tag === "loca") ? 3 : 0;
        if (known >= 0) {
            directory.push(known | (version << 6));
        } else {
            directory.push(0x3f | (version << 6), ...Buffer.from(tag, "latin1"));
        }
        directory.push(...writeUIntBase128(sfntTables.get(tag).length));
    }

    const compressed = zlib.brotliCompressSync(Buffer.concat(tags.map(tag => sfntTables.get(tag))), {
        params: {
            [zlib.constants.BROTLI_PARAM_MODE]: zlib.constants.BROTLI_MODE_FONT,
            [zlib.constants.BROTLI_PARAM_QUALITY]: zlib.constants.BROTLI_MAX_QUALITY,
            [zlib.constants.BROTLI_PARAM_SIZE_HINT]: sfnt.length,
        },
    });

    const headerLength = 48;
    const unpadded = headerLength + directory.length + compressed.length;
    const totalLength = unpadded + ((4 - (unpadded % 4)) % 4);

    const header = Buffer.alloc(headerLength);
    header.writeUInt32BE(SIGNATURE_WOFF2, 0);
    header.writeUInt32BE(flavor, 4);
    header.writeUInt32BE(totalLength, 8);
    header.writeUInt16BE(tags.length, 12);
    header.writeUInt16BE(0, 14);
    header.writeUInt32BE(sfnt.length, 16);
    header.writeUInt32BE(compressed.length, 20);
    header.writeUInt16BE(1, 24); // majorVersion
    header.writeUInt16BE(0, 26); // minorVersion
    // metadata and private blocks are absent (all zeroes)

    return Buffer.concat([header, Buffer.from(directory), compressed, Buffer.alloc(totalLength - unpadded)]);
}

module.exports = {
    SFNT_TRUETYPE,
    SFNT_OPENTYPE,
    assembleGlyfAndLoca,
    calcChecksum,
    detectContainer,
    encodeSimpleGlyph,
    readFont,
    toBuffer,
    writeSfnt,
    writeWoff2,
};
