"use strict";

const opentype = require("opentype.js");

const sfnt = require("./sfnt");

// Tables that describe outlines, hinting or bitmaps. They are replaced by
// fresh glyf/loca/maxp tables (or simply dropped). Every other table, most
// importantly hmtx, hhea, OS/2, cmap, kern, GDEF, GPOS and GSUB, is copied
// byte-for-byte, so text laid out with the placeholder lands in exactly the
// same place as with the original font.
const OUTLINE_TABLES = new Set([
    "glyf", "loca", "maxp", "CFF ", "CFF2", "VORG", "gvar", "cvar",
    "fpgm", "prep", "cvt ", "hdmx", "LTSH", "VDMX", "DSIG",
    "SVG ", "COLR", "CPAL", "CBDT", "CBLC", "sbix", "EBDT", "EBLC", "EBSC",
]);

// Layout tables, dropped only when `layout: false` is passed.
const LAYOUT_TABLES = new Set(["GDEF", "GPOS", "GSUB", "kern", "morx", "mort", "kerx", "JSTF", "BASE"]);

// Tables opentype.js needs to read outlines and character mappings.
const OUTLINE_READER_TABLES = ["cmap", "head", "hhea", "hmtx", "maxp", "name", "OS/2", "post", "glyf", "loca", "CFF "];

const DEFAULT_TOLERANCE = 50; // per 1000 units of em
const CURVE_STEPS = 8;

const GLYPH_MODES = ["hollow", "blocks", "simplified"];
const OUTPUT_FORMATS = ["woff2", "truetype"];

function pickName(record) {
    if (!record) return null;
    return record.en || Object.values(record)[0] || null;
}

function parseOutlines(tables) {
    const subset = new Map();
    for (const tag of OUTLINE_READER_TABLES) {
        if (tables.has(tag)) subset.set(tag, tables.get(tag));
    }
    if (tables.has("CFF2")) throw new Error("CFF2 (variable OpenType) fonts are not supported yet");
    const flavor = subset.has("CFF ") ? sfnt.SFNT_OPENTYPE : sfnt.SFNT_TRUETYPE;
    const buffer = sfnt.writeSfnt(flavor, subset);
    return opentype.parse(buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.length));
}

function readFontNames(font) {
    const names = font.names || {};
    return {
        family: pickName(names.preferredFamily) || pickName(names.fontFamily),
        subfamily: pickName(names.preferredSubfamily) || pickName(names.fontSubfamily),
    };
}

function readStyle(tables) {
    const os2 = tables.get("OS/2");
    if (!os2 || os2.length < 64) return { weight: 400, style: "normal" };
    const fsSelection = os2.readUInt16BE(62);
    let style = "normal";
    if (fsSelection & 0x0001) style = "italic";
    else if (fsSelection & 0x0200) style = "oblique";
    return { weight: os2.readUInt16BE(4) || 400, style };
}

// ------------------------------------------------------------ geometry ----

// Splits an opentype.js path into closed polygons (curves are flattened).
function pathToContours(path, scale) {
    const contours = [];
    let contour = null;
    let x = 0;
    let y = 0;

    const add = (px, py) => contour.push({ x: px * scale, y: py * scale });

    for (const command of path.commands) {
        switch (command.type) {
            case "M":
                if (contour && contour.length) contours.push(contour);
                contour = [];
                add(command.x, command.y);
                break;

            case "L":
                add(command.x, command.y);
                break;

            case "Q":
                for (let i = 1; i <= CURVE_STEPS; i++) {
                    const t = i / CURVE_STEPS;
                    const mt = 1 - t;
                    add(
                        mt * mt * x + 2 * mt * t * command.x1 + t * t * command.x,
                        mt * mt * y + 2 * mt * t * command.y1 + t * t * command.y,
                    );
                }
                break;

            case "C":
                for (let i = 1; i <= CURVE_STEPS; i++) {
                    const t = i / CURVE_STEPS;
                    const mt = 1 - t;
                    add(
                        mt * mt * mt * x + 3 * mt * mt * t * command.x1 + 3 * mt * t * t * command.x2 + t * t * t * command.x,
                        mt * mt * mt * y + 3 * mt * mt * t * command.y1 + 3 * mt * t * t * command.y2 + t * t * t * command.y,
                    );
                }
                break;

            case "Z":
                if (contour && contour.length) contours.push(contour);
                contour = null;
                break;

            default:
                throw new Error(`Unknown path command "${command.type}"`);
        }

        if (command.type !== "Z") {
            x = command.x;
            y = command.y;
        }
    }
    if (contour && contour.length) contours.push(contour);

    // A closed contour often repeats its first point at the end
    for (const c of contours) {
        const first = c[0];
        const last = c[c.length - 1];
        if (c.length > 1 && first.x === last.x && first.y === last.y) c.pop();
    }

    return contours;
}

function squaredSegmentDistance(p, a, b) {
    let x = a.x;
    let y = a.y;
    let dx = b.x - x;
    let dy = b.y - y;

    if (dx !== 0 || dy !== 0) {
        const t = ((p.x - x) * dx + (p.y - y) * dy) / (dx * dx + dy * dy);
        if (t > 1) {
            x = b.x;
            y = b.y;
        } else if (t > 0) {
            x += dx * t;
            y += dy * t;
        }
    }

    dx = p.x - x;
    dy = p.y - y;
    return dx * dx + dy * dy;
}

// Ramer–Douglas–Peucker on an open polyline from points[first] to points[last].
function douglasPeucker(points, first, last, sqTolerance, keep) {
    let maxDistance = sqTolerance;
    let index = -1;
    for (let i = first + 1; i < last; i++) {
        const distance = squaredSegmentDistance(points[i], points[first], points[last]);
        if (distance > maxDistance) {
            index = i;
            maxDistance = distance;
        }
    }
    if (index >= 0) {
        keep[index] = true;
        douglasPeucker(points, first, index, sqTolerance, keep);
        douglasPeucker(points, index, last, sqTolerance, keep);
    }
}

// Simplifies a closed polygon. The contour is split at its first point and
// the point farthest from it, and each half is simplified separately.
function simplifyContour(points, tolerance) {
    if (points.length < 4 || tolerance <= 0) return points.slice();

    let far = 1;
    let farDistance = -1;
    for (let i = 1; i < points.length; i++) {
        const dx = points[i].x - points[0].x;
        const dy = points[i].y - points[0].y;
        const distance = dx * dx + dy * dy;
        if (distance > farDistance) {
            far = i;
            farDistance = distance;
        }
    }

    const ring = points.concat([points[0]]);
    const keep = new Array(ring.length).fill(false);
    keep[0] = true;
    keep[far] = true;
    const sqTolerance = tolerance * tolerance;
    douglasPeucker(ring, 0, far, sqTolerance, keep);
    douglasPeucker(ring, far, ring.length - 1, sqTolerance, keep);

    return points.filter((_point, i) => keep[i]);
}

function roundContour(points) {
    const rounded = [];
    for (const point of points) {
        const x = Math.round(point.x);
        const y = Math.round(point.y);
        const previous = rounded[rounded.length - 1];
        if (!previous || previous.x !== x || previous.y !== y) rounded.push({ x, y });
    }
    if (rounded.length > 1) {
        const first = rounded[0];
        const last = rounded[rounded.length - 1];
        if (first.x === last.x && first.y === last.y) rounded.pop();
    }
    return rounded;
}

function boundingBoxOf(contours) {
    const box = [Infinity, Infinity, -Infinity, -Infinity];
    for (const contour of contours) {
        for (const point of contour) {
            box[0] = Math.min(box[0], point.x);
            box[1] = Math.min(box[1], point.y);
            box[2] = Math.max(box[2], point.x);
            box[3] = Math.max(box[3], point.y);
        }
    }
    return box;
}

function blockContour(contours) {
    const [xMin, yMin, xMax, yMax] = boundingBoxOf(contours).map(Math.round);
    if (xMax <= xMin || yMax <= yMin) return [];
    // Clockwise, as TrueType outer contours are drawn
    return [[
        { x: xMin, y: yMin },
        { x: xMin, y: yMax },
        { x: xMax, y: yMax },
        { x: xMax, y: yMin },
    ]];
}

function simplifiedContours(contours, tolerance) {
    return contours
        .map(contour => roundContour(simplifyContour(contour, tolerance)))
        .filter(contour => contour.length >= 3);
}

function encodeContours(contours) {
    if (!contours.length) return { data: Buffer.alloc(0), points: 0 };
    const points = [];
    const endPoints = [];
    for (const contour of contours) {
        for (const point of contour) points.push({ x: point.x, y: point.y, onCurve: true });
        endPoints.push(points.length - 1);
    }
    const data = sfnt.encodeSimpleGlyph(endPoints, points, boundingBoxOf(contours), null, false);
    return { data, points: points.length };
}

// ------------------------------------------------------------- options ----

function codePointsOf(characters) {
    if (characters === null || characters === undefined) return null;
    if (typeof characters === "string") {
        const set = new Set();
        for (const character of characters) set.add(character.codePointAt(0));
        return set;
    }
    if (characters instanceof Set) return characters;
    if (Array.isArray(characters)) return new Set(characters);
    throw new TypeError("`characters` must be a string, an array of code points or a Set");
}

function normalizeOptions(options) {
    options = Object.assign({}, options);
    const glyphs = options.glyphs || (options.characters !== undefined && options.characters !== null ? "simplified" : "hollow");
    if (!GLYPH_MODES.includes(glyphs)) {
        throw new Error(`Unknown glyphs mode "${glyphs}" (expected ${GLYPH_MODES.join(", ")})`);
    }
    const format = options.format || "woff2";
    if (!OUTPUT_FORMATS.includes(format)) {
        throw new Error(`Unknown output format "${format}" (expected ${OUTPUT_FORMATS.join(", ")})`);
    }
    const tolerance = options.tolerance === undefined ? DEFAULT_TOLERANCE : Number(options.tolerance);
    if (!Number.isFinite(tolerance) || tolerance < 0) throw new Error("`tolerance` must be a non-negative number");
    const missing = options.missing || "hollow";
    if (missing !== "hollow" && missing !== "blocks") throw new Error('`missing` must be "hollow" or "blocks"');

    return {
        glyphs,
        format,
        tolerance,
        missing,
        characters: codePointsOf(options.characters),
        donor: options.donor ? sfnt.toBuffer(options.donor) : null,
        layout: options.layout !== false,
        familyName: options.familyName || null,
    };
}

// --------------------------------------------------------------- main -----

// Creates a placeholder font: same metrics, kerning and layout rules as the
// source font, but with empty, block-shaped or simplified glyphs.
//
// options:
//   glyphs      "hollow" (default) | "blocks" | "simplified"
//   characters  only these characters get block/simplified glyphs, the rest
//               stay hollow (string, array of code points or Set)
//   tolerance   simplification tolerance, in units per 1000 units of em (50)
//   donor       font (Buffer/ArrayBuffer) to take simplified outlines from
//   missing     what to draw when the donor lacks a glyph: "hollow" | "blocks"
//   layout      keep GSUB/GPOS/kern (default true); false gives a smaller
//               font whose layout is only exact for unkerned text
//   format      "woff2" (default) | "truetype"
//   familyName  name for the placeholder (default: "<family> Placeholder")
function createPlaceholderFont(input, options) {
    const opts = normalizeOptions(options);
    const source = sfnt.readFont(input);
    const tables = source.tables;

    for (const tag of ["head", "hhea", "hmtx", "maxp", "cmap"]) {
        if (!tables.has(tag)) throw new Error(`Font has no "${tag}" table`);
    }

    const font = parseOutlines(tables);
    const numGlyphs = tables.get("maxp").readUInt16BE(4);
    const unitsPerEm = tables.get("head").readUInt16BE(18);
    const tolerance = opts.tolerance * unitsPerEm / 1000;

    let donorFont = null;
    let donorScale = 1;
    if (opts.donor) {
        const donorTables = sfnt.readFont(opts.donor).tables;
        donorFont = parseOutlines(donorTables);
        donorScale = unitsPerEm / donorTables.get("head").readUInt16BE(18);
    }

    const glyphRecords = [];
    let maxPoints = 0;
    let maxContours = 0;
    let visibleGlyphs = 0;

    for (let index = 0; index < numGlyphs; index++) {
        const glyph = font.glyphs.get(index);
        const unicodes = glyph.unicodes || (glyph.unicode !== undefined ? [glyph.unicode] : []);
        const selected = opts.glyphs !== "hollow" &&
            (!opts.characters || unicodes.some(codePoint => opts.characters.has(codePoint)));

        let contours = [];
        if (selected && opts.glyphs === "blocks") {
            contours = blockContour(pathToContours(glyph.path, 1));
        } else if (selected) {
            let outlineGlyph = glyph;
            let scale = 1;
            if (donorFont) {
                outlineGlyph = null;
                scale = donorScale;
                const byCode = unicodes.length ? donorFont.charToGlyphIndex(String.fromCodePoint(unicodes[0])) : 0;
                if (byCode > 0) {
                    outlineGlyph = donorFont.glyphs.get(byCode);
                } else if (glyph.name && donorFont.glyphNames && donorFont.glyphNames.names) {
                    const byName = donorFont.glyphNames.names.indexOf(glyph.name);
                    if (byName > 0) outlineGlyph = donorFont.glyphs.get(byName);
                }
            }
            if (outlineGlyph) {
                contours = simplifiedContours(pathToContours(outlineGlyph.path, scale), tolerance);
            } else if (opts.missing === "blocks") {
                contours = blockContour(pathToContours(glyph.path, 1));
            }
        }

        const encoded = encodeContours(contours);
        if (encoded.points) visibleGlyphs++;
        maxPoints = Math.max(maxPoints, encoded.points);
        maxContours = Math.max(maxContours, contours.length);
        glyphRecords.push(encoded.data);
    }

    // Browsers (OTS) reject a zero-length glyf table. A single-point contour
    // is valid TrueType and draws nothing, so .notdef gets one if needed.
    if (glyphRecords.every(record => record.length === 0)) {
        glyphRecords[0] = sfnt.encodeSimpleGlyph([0], [{ x: 0, y: 0, onCurve: true }], [0, 0, 0, 0], null, false);
        maxPoints = Math.max(maxPoints, 1);
        maxContours = Math.max(maxContours, 1);
    }

    const { glyf, loca } = sfnt.assembleGlyfAndLoca(glyphRecords);

    const maxp = Buffer.alloc(32);
    maxp.writeUInt32BE(0x00010000, 0);
    maxp.writeUInt16BE(numGlyphs, 4);
    maxp.writeUInt16BE(maxPoints, 6);
    maxp.writeUInt16BE(maxContours, 8);
    maxp.writeUInt16BE(2, 14); // maxZones

    const head = Buffer.from(tables.get("head"));
    head.writeInt16BE(1, 50); // indexToLocFormat: long offsets
    head.writeInt16BE(0, 52); // glyphDataFormat

    const output = new Map();
    for (const [tag, data] of tables) {
        if (OUTLINE_TABLES.has(tag)) continue;
        if (!opts.layout && LAYOUT_TABLES.has(tag)) continue;
        output.set(tag, data);
    }
    output.set("head", head);
    output.set("maxp", maxp);
    output.set("glyf", glyf);
    output.set("loca", loca);

    const data = opts.format === "woff2"
        ? sfnt.writeWoff2(sfnt.SFNT_TRUETYPE, output)
        : sfnt.writeSfnt(sfnt.SFNT_TRUETYPE, output);

    const names = readFontNames(font);
    const style = readStyle(tables);
    const sourceFamilyName = names.family || "Unnamed";

    return {
        familyName: opts.familyName || `${sourceFamilyName} Placeholder`,
        sourceFamilyName,
        weight: style.weight,
        style: style.style,
        format: opts.format,
        data,
        glyphCount: numGlyphs,
        visibleGlyphCount: visibleGlyphs,
    };
}

// ------------------------------------------------------------ CSS output ---

const FORMAT_DETAILS = {
    woff2: { mediaType: "font/woff2", format: "woff2" },
    truetype: { mediaType: "font/ttf", format: "truetype" },
    opentype: { mediaType: "font/otf", format: "opentype" },
};

function bufferToBase64String(buffer) {
    return sfnt.toBuffer(buffer).toString("base64");
}

function cssString(value) {
    return `"${String(value).replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

// descriptors: optional extra @font-face descriptors, e.g. { "font-weight": "700" }
function composeCSSFontFaceDefinition(fontFamilyName, fontDataType, fontDataBuffer, descriptors) {
    const details = FORMAT_DETAILS[fontDataType];
    if (!details) throw new Error("Unknown font type");

    const lines = [`    font-family: ${cssString(fontFamilyName)};`];
    lines.push(`    src: url("data:${details.mediaType};base64,${bufferToBase64String(fontDataBuffer)}") format("${details.format}");`);
    for (const [name, value] of Object.entries(descriptors || {})) {
        lines.push(`    ${name}: ${value};`);
    }

    return `@font-face {\n${lines.join("\n")}\n}`;
}

// --------------------------------------------- 1.x API, kept for callers ----

function bufferToArrayBuffer(buffer) {
    return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.length);
}

function glyphToSolidBlockPath(sourceGlyph) {
    const path = new opentype.Path();
    path.moveTo(sourceGlyph.xMax, sourceGlyph.yMin);
    path.lineTo(sourceGlyph.xMin, sourceGlyph.yMin);
    path.lineTo(sourceGlyph.xMin, sourceGlyph.yMax);
    path.lineTo(sourceGlyph.xMax, sourceGlyph.yMax);
    path.lineTo(sourceGlyph.xMax, sourceGlyph.yMin);
    return path;
}

// Deprecated: use createPlaceholderFont(). Returns a TrueType font.
function createFontBuffer(fontFileArrayBuffer, options, donorFontFileArrayBuffer) {
    options = options || {};
    const donor = donorFontFileArrayBuffer || null;
    let glyphs = "hollow";
    if (donor || options.allowedUnicodes) glyphs = "simplified";
    // 1.x semantics: with a donor, solid blocks fill in for glyphs it lacks
    if (options.useSolidBlocks && !donor) glyphs = "blocks";

    const result = createPlaceholderFont(fontFileArrayBuffer, {
        glyphs,
        characters: options.allowedUnicodes || null,
        donor,
        missing: options.useSolidBlocks ? "blocks" : "hollow",
        format: "truetype",
    });
    return { name: result.familyName, data: bufferToArrayBuffer(result.data), format: "truetype" };
}

module.exports = {
    createPlaceholderFont,
    composeCSSFontFaceDefinition,
    bufferToBase64String,
    // 1.x API
    bufferToArrayBuffer,
    createFontBuffer,
    glyphToSolidBlockPath,
    // internals, exported for tests
    _internal: { pathToContours, simplifyContour, codePointsOf, readStyle },
};
