"use strict";

// Rewrites the gvar table of a variable TrueType font for a placeholder.
//
// In gvar every glyph has four "phantom points" after its outline points:
// the horizontal origin, the advance width, and their vertical counterparts.
// Variation deltas on those points are how a variable font changes glyph
// widths along its axes when it has no HVAR table (and how many renderers
// compute advances even when it does). The placeholder replaces the outlines,
// so the outline deltas no longer apply; this keeps only the phantom point
// deltas and renumbers them for the new outlines. Outline points get no
// deltas, so blocks and simplified glyphs keep the default instance's shape.

const SHARED_POINT_NUMBERS = 0x8000;
const COUNT_MASK = 0x0fff;
const EMBEDDED_PEAK_TUPLE = 0x8000;
const INTERMEDIATE_REGION = 0x4000;
const PRIVATE_POINT_NUMBERS = 0x2000;

const DELTAS_ARE_ZERO = 0x80;
const DELTAS_ARE_WORDS = 0x40;
const DELTA_RUN_COUNT_MASK = 0x3f;
const POINTS_ARE_WORDS = 0x80;
const POINT_RUN_COUNT_MASK = 0x7f;

const PHANTOM_POINTS = 4;

// --------------------------------------------------- glyf point counts ----

// Reads the glyf table: for every glyph, the number of points it has in gvar's
// numbering before the phantom points (outline points for simple glyphs,
// components for composite ones), and the component whose metrics a
// composite uses (USE_MY_METRICS), or -1.
function readGlyphStructure(tables) {
    const glyf = tables.get("glyf");
    const loca = tables.get("loca");
    const numGlyphs = tables.get("maxp").readUInt16BE(4);
    const longOffsets = tables.get("head").readInt16BE(50) === 1;
    const offsetAt = (i) => (longOffsets ? loca.readUInt32BE(i * 4) : loca.readUInt16BE(i * 2) * 2);
    const counts = new Array(numGlyphs).fill(0);
    const metricsComponent = new Array(numGlyphs).fill(-1);

    for (let i = 0; i < numGlyphs; i++) {
        const start = offsetAt(i);
        if (offsetAt(i + 1) <= start) continue; // empty glyph
        const numberOfContours = glyf.readInt16BE(start);
        if (numberOfContours > 0) {
            counts[i] = glyf.readUInt16BE(start + 10 + (numberOfContours - 1) * 2) + 1;
        } else if (numberOfContours < 0) {
            const components = readComponents(glyf, start + 10);
            counts[i] = components.length;
            for (const component of components) {
                if (component.useMyMetrics) metricsComponent[i] = component.glyphIndex;
            }
        }
    }
    return { counts, metricsComponent };
}

function glyphPointCounts(tables) {
    return readGlyphStructure(tables).counts;
}

function readComponents(glyf, offset) {
    const ARG_1_AND_2_ARE_WORDS = 0x0001;
    const WE_HAVE_A_SCALE = 0x0008;
    const MORE_COMPONENTS = 0x0020;
    const WE_HAVE_AN_X_AND_Y_SCALE = 0x0040;
    const WE_HAVE_A_TWO_BY_TWO = 0x0080;
    const USE_MY_METRICS = 0x0200;

    const components = [];
    let flags;
    do {
        flags = glyf.readUInt16BE(offset);
        components.push({ glyphIndex: glyf.readUInt16BE(offset + 2), useMyMetrics: Boolean(flags & USE_MY_METRICS) });
        offset += 4 + ((flags & ARG_1_AND_2_ARE_WORDS) ? 4 : 2);
        if (flags & WE_HAVE_A_SCALE) offset += 2;
        else if (flags & WE_HAVE_AN_X_AND_Y_SCALE) offset += 4;
        else if (flags & WE_HAVE_A_TWO_BY_TWO) offset += 8;
    } while (flags & MORE_COMPONENTS);
    return components;
}

// The glyph whose phantom points decide a glyph's metrics: itself, or for a
// composite with USE_MY_METRICS, that component (followed through nested
// composites). Renderers take the advance from there, so the placeholder,
// whose glyphs are all simple, must carry that glyph's deltas.
function metricsSources(metricsComponent) {
    return metricsComponent.map((_component, glyph) => {
        let current = glyph;
        const seen = new Set([glyph]);
        while (metricsComponent[current] >= 0 && metricsComponent[current] < metricsComponent.length) {
            const next = metricsComponent[current];
            if (seen.has(next)) break; // malformed font: a cycle
            seen.add(next);
            current = next;
        }
        return current;
    });
}

// ------------------------------------------------------------ decoding ----

// Packed point numbers; returns null for "all points".
function readPointNumbers(data, state) {
    let count = data[state.offset++];
    if (count & 0x80) count = ((count & 0x7f) << 8) | data[state.offset++];
    if (count === 0) return null;

    const points = [];
    let point = 0;
    while (points.length < count) {
        const control = data[state.offset++];
        const runLength = (control & POINT_RUN_COUNT_MASK) + 1;
        for (let i = 0; i < runLength && points.length < count; i++) {
            if (control & POINTS_ARE_WORDS) {
                point += data.readUInt16BE(state.offset);
                state.offset += 2;
            } else {
                point += data[state.offset++];
            }
            points.push(point);
        }
    }
    return points;
}

function readDeltas(data, state, count) {
    const deltas = [];
    while (deltas.length < count) {
        const control = data[state.offset++];
        const runLength = (control & DELTA_RUN_COUNT_MASK) + 1;
        const kind = control & (DELTAS_ARE_ZERO | DELTAS_ARE_WORDS);
        for (let i = 0; i < runLength && deltas.length < count; i++) {
            if (kind === DELTAS_ARE_ZERO) {
                deltas.push(0);
            } else if (kind === DELTAS_ARE_WORDS) {
                deltas.push(data.readInt16BE(state.offset));
                state.offset += 2;
            } else if (kind === (DELTAS_ARE_ZERO | DELTAS_ARE_WORDS)) {
                deltas.push(data.readInt32BE(state.offset)); // DELTAS_ARE_LONGS
                state.offset += 4;
            } else {
                deltas.push(data.readInt8(state.offset++));
            }
        }
    }
    return deltas;
}

// Returns [{ tupleBytes, flags, phantom: [[dx, dy] × 4] }] for one glyph.
function readGlyphVariations(data, axisCount, pointCount) {
    if (data.length < 4) return [];
    const tupleCountField = data.readUInt16BE(0);
    const tupleCount = tupleCountField & COUNT_MASK;
    const dataOffset = data.readUInt16BE(2);

    const headers = [];
    let headerOffset = 4;
    for (let t = 0; t < tupleCount; t++) {
        const size = data.readUInt16BE(headerOffset);
        const tupleIndex = data.readUInt16BE(headerOffset + 2);
        let coordinates = 0;
        if (tupleIndex & EMBEDDED_PEAK_TUPLE) coordinates += axisCount;
        if (tupleIndex & INTERMEDIATE_REGION) coordinates += axisCount * 2;
        const tupleBytes = data.subarray(headerOffset + 4, headerOffset + 4 + coordinates * 2);
        headers.push({ size, tupleIndex, tupleBytes });
        headerOffset += 4 + coordinates * 2;
    }

    const state = { offset: dataOffset };
    const sharedPoints = (tupleCountField & SHARED_POINT_NUMBERS) ? readPointNumbers(data, state) : null;
    const totalPoints = pointCount + PHANTOM_POINTS;
    const phantomStart = pointCount;

    const variations = [];
    for (const header of headers) {
        const chunkEnd = state.offset + header.size;
        const chunkState = { offset: state.offset };
        const points = (header.tupleIndex & PRIVATE_POINT_NUMBERS) ? readPointNumbers(data, chunkState) : sharedPoints;
        const numbers = points || Array.from({ length: totalPoints }, (_v, i) => i);
        // X and Y deltas are packed separately; runs never cross from one to the other
        const deltas = readDeltas(data, chunkState, numbers.length).concat(readDeltas(data, chunkState, numbers.length));

        // Phantom points without an explicit delta do not move (deltas are
        // only inferred for points inside contours)
        const phantom = [[0, 0], [0, 0], [0, 0], [0, 0]];
        numbers.forEach((point, i) => {
            const p = point - phantomStart;
            if (p >= 0 && p < PHANTOM_POINTS) phantom[p] = [deltas[i], deltas[numbers.length + i]];
        });

        variations.push({ tupleIndex: header.tupleIndex & ~PRIVATE_POINT_NUMBERS, tupleBytes: header.tupleBytes, phantom });
        state.offset = chunkEnd;
    }
    return variations;
}

// ------------------------------------------------------------ encoding ----

function encodeDeltas(values) {
    const parts = [];
    for (let i = 0; i < values.length;) {
        // Runs of one kind, at most 64 values long
        const value = values[i];
        const kind = value === 0 ? "zero" : (value >= -128 && value <= 127 ? "byte" : (value >= -32768 && value <= 32767 ? "word" : "long"));
        let end = i + 1;
        while (end < values.length && end - i < 64) {
            const v = values[end];
            const k = v === 0 ? "zero" : (v >= -128 && v <= 127 ? "byte" : (v >= -32768 && v <= 32767 ? "word" : "long"));
            if (k !== kind) break;
            end++;
        }
        const run = values.slice(i, end);
        const count = run.length - 1;
        if (kind === "zero") {
            parts.push(Buffer.from([DELTAS_ARE_ZERO | count]));
        } else if (kind === "byte") {
            const b = Buffer.alloc(1 + run.length);
            b[0] = count;
            run.forEach((v, j) => b.writeInt8(v, 1 + j));
            parts.push(b);
        } else if (kind === "word") {
            const b = Buffer.alloc(1 + run.length * 2);
            b[0] = DELTAS_ARE_WORDS | count;
            run.forEach((v, j) => b.writeInt16BE(v, 1 + j * 2));
            parts.push(b);
        } else {
            const b = Buffer.alloc(1 + run.length * 4);
            b[0] = DELTAS_ARE_ZERO | DELTAS_ARE_WORDS | count;
            run.forEach((v, j) => b.writeInt32BE(v, 1 + j * 4));
            parts.push(b);
        }
        i = end;
    }
    return Buffer.concat(parts);
}

// Explicit point numbers firstPoint … firstPoint+3, as one run of words.
function encodePhantomPointNumbers(firstPoint) {
    const b = Buffer.alloc(2 + PHANTOM_POINTS * 2);
    b[0] = PHANTOM_POINTS;
    b[1] = POINTS_ARE_WORDS | (PHANTOM_POINTS - 1);
    b.writeUInt16BE(firstPoint, 2);
    for (let i = 1; i < PHANTOM_POINTS; i++) b.writeUInt16BE(1, 2 + i * 2);
    return b;
}

function encodeGlyphVariations(variations, newPointCount) {
    const kept = variations.filter(v => v.phantom.some(([dx, dy]) => dx !== 0 || dy !== 0));
    if (!kept.length) return Buffer.alloc(0);

    const pointNumbers = encodePhantomPointNumbers(newPointCount);
    const chunks = kept.map(v => Buffer.concat([
        pointNumbers,
        encodeDeltas(v.phantom.map(p => p[0])),
        encodeDeltas(v.phantom.map(p => p[1])),
    ]));
    const headers = kept.map((v, i) => {
        const h = Buffer.alloc(4);
        h.writeUInt16BE(chunks[i].length, 0);
        h.writeUInt16BE(v.tupleIndex | PRIVATE_POINT_NUMBERS, 2);
        return Buffer.concat([h, v.tupleBytes]);
    });

    const headerBlock = Buffer.concat(headers);
    const top = Buffer.alloc(4);
    top.writeUInt16BE(kept.length, 0);
    top.writeUInt16BE(4 + headerBlock.length, 2);
    const glyphData = Buffer.concat([top, headerBlock, ...chunks]);
    return glyphData.length % 2 ? Buffer.concat([glyphData, Buffer.alloc(1)]) : glyphData;
}

// --------------------------------------------------------------- table ----

// gvar: the source table; structure: readGlyphStructure() of the source font;
// newCounts: points per glyph (before phantom points) in the placeholder.
function rewriteGvar(gvar, structure, newCounts) {
    const sourceCounts = structure.counts;
    const sources = metricsSources(structure.metricsComponent);
    const axisCount = gvar.readUInt16BE(4);
    const sharedTupleCount = gvar.readUInt16BE(6);
    const sharedTuplesOffset = gvar.readUInt32BE(8);
    const glyphCount = gvar.readUInt16BE(12);
    const flags = gvar.readUInt16BE(14);
    const dataArrayOffset = gvar.readUInt32BE(16);
    const longOffsets = Boolean(flags & 1);
    const offsetAt = (i) => (longOffsets ? gvar.readUInt32BE(20 + i * 4) : gvar.readUInt16BE(20 + i * 2) * 2);

    if (glyphCount !== sourceCounts.length) throw new Error("gvar and maxp disagree on the number of glyphs");

    const sharedTuples = gvar.subarray(sharedTuplesOffset, sharedTuplesOffset + sharedTupleCount * axisCount * 2);
    const variationsOf = (i) => {
        const start = dataArrayOffset + offsetAt(i);
        const end = dataArrayOffset + offsetAt(i + 1);
        return end > start ? readGlyphVariations(gvar.subarray(start, end), axisCount, sourceCounts[i]) : [];
    };
    const glyphData = [];
    for (let i = 0; i < glyphCount; i++) {
        glyphData.push(encodeGlyphVariations(variationsOf(sources[i]), newCounts[i]));
    }

    const headerLength = 20 + (glyphCount + 1) * 4;
    const header = Buffer.alloc(headerLength);
    header.writeUInt16BE(1, 0);
    header.writeUInt16BE(0, 2);
    header.writeUInt16BE(axisCount, 4);
    header.writeUInt16BE(sharedTupleCount, 6);
    header.writeUInt32BE(headerLength, 8);
    header.writeUInt16BE(glyphCount, 12);
    header.writeUInt16BE(1, 14); // long offsets
    header.writeUInt32BE(headerLength + sharedTuples.length, 16);
    let offset = 0;
    glyphData.forEach((data, i) => {
        header.writeUInt32BE(offset, 20 + i * 4);
        offset += data.length;
    });
    header.writeUInt32BE(offset, 20 + glyphCount * 4);

    return Buffer.concat([header, sharedTuples, ...glyphData]);
}

module.exports = { glyphPointCounts, metricsSources, readGlyphStructure, readGlyphVariations, rewriteGvar };
