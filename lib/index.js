"use strict";

const base64Encode = require("base64-arraybuffer").encode;
const opentype = require("opentype.js");
const simplify = require("simplify-js");

function bufferToArrayBuffer(beffer) {
    const ab = new ArrayBuffer(beffer.length);
    const array = new Uint8Array(ab);

    for (let i = 0, ilen = beffer.length; i < ilen; i++) {
        array[i] = beffer[i];
    }

    return ab;
}

function bufferToBase64String(buffer) {
    return base64Encode(buffer);
}

function composeCSSFontFaceDefinition(fontFamilyName, fontDataType, fontDataBuffer) {
    let fontDataEncoding = "";
    let fontDataMediaType = "";
    let fontDataString = "";
    let fontFormat = "";

    switch (fontDataType) {
        case "opentype":
            fontDataEncoding = "base64";
            fontDataMediaType = "application/vnd.ms-opentype";
            fontDataString = bufferToBase64String(fontDataBuffer);
            fontFormat = "opentype";
            break;

        default:
            throw new Error("Unknown font type");
    }

    return `\
@font-face {
    font-family: "${fontFamilyName}";
    src: url("data:${fontDataMediaType};${fontDataEncoding},${fontDataString}") format("${fontFormat}");
}`;
}

function createFontBuffer(fontFileArrayBuffer, options, donorFontFileArrayBuffer) {
    // Parse input font
    const sourceFont = opentype.parse(fontFileArrayBuffer);
    // Parse donor font (if provided)
    const donorFont = (donorFontFileArrayBuffer) ? opentype.parse(donorFontFileArrayBuffer) : null;

    // Ensure the options object exists
    if (!options) options = {}

    // Glyphs that will compose the resulting placeholder font
    const glyphs = [];

    const hasDonorFont = Boolean(donorFont);

    // Loop through source font
    for (let i = 0, ilen = sourceFont.glyphs.length; i < ilen; i++) {
        const sourceGlyph = sourceFont.glyphs.get(i);
        let path = new opentype.Path();

        if (hasDonorFont) {
            let isSuccessful = false;

            if (!options.allowedUnicodes || options.allowedUnicodes.includes(sourceGlyph.unicode)) {
                if (donorFont.nameToGlyphIndex(sourceGlyph.name) > -1) {
                    path = donorFont.nameToGlyph(sourceGlyph.name).path;
                    isSuccessful = true;

                    // Simplify path
                    path = simplifyOpentypeFontPath(path, 50, false);
                }
            }

            if (options.useSolidBlocks && !isSuccessful) {
                if (sourceGlyph.xMin !== undefined) {
                    // Replace the whole glyph with a solid block of the same dimensions
                    path = glyphToSolidBlockPath(sourceGlyph);
                }
            }
        } else if (options.useSolidBlocks) {
            if (!options.allowedUnicodes || options.allowedUnicodes.includes(sourceGlyph.unicode)) {
                if (sourceGlyph.xMin !== undefined) {
                    // Replace the whole glyph with a solid block of the same dimensions
                    path = glyphToSolidBlockPath(sourceGlyph);
                }
            }
        } else {
            // Use filter to specify what existing glyphs to keep
            if (options.allowedUnicodes && options.allowedUnicodes.includes(sourceGlyph.unicode)) {
                path = sourceGlyph.path;

                // Simplify path
                path = simplifyOpentypeFontPath(path, 50, false);
            }
        }

        const placeholderGlyph = new opentype.Glyph({
            name: sourceGlyph.name,
            unicode: sourceGlyph.unicode,
            advanceWidth: sourceGlyph.advanceWidth,
            path,
        });
        glyphs.push(placeholderGlyph);
    }

    const placeholderFont = new opentype.Font({
        familyName: sourceFont.names.fontFamily.en + " Placeholder",
        styleName: sourceFont.names.fontSubfamily.en,
        unitsPerEm: sourceFont.unitsPerEm,
        ascender: sourceFont.ascender,
        descender: sourceFont.descender,
        glyphs: glyphs,
    });

    // Return the newly created font
    return {
        name: placeholderFont.names.fontFamily.en,
        data: placeholderFont.toArrayBuffer(),
    };
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

function convertOpentypeFontPathToArrayOfPoints(opentypeFontPath) {
    const points = [];

    opentypeFontPath.commands.forEach(command => {
        switch (command.type) {
            case "M":
            case "L":
                points.push({ x: command.x, y: command.y });
                break;

            case "Q":
                points.push({ x: command.x, y: command.y }); // XXX
                break;

            default:
                console.error("Unknown font type path command:", command.type)
            case "Z":
                // return "z";
        }
    });

    return points;
}

function convertArrayOfPointsToOpentypeFontPath(arrayOfPoints) {
    const opentypePath = new opentype.Path();

    arrayOfPoints.forEach((point, pi) => {
        if (pi == 0) {
            opentypePath.moveTo(point.x, point.y);
        } else {
            opentypePath.lineTo(point.x, point.y);
        }
    });

    return opentypePath;
}

function simplifyOpentypeFontPath(opentypeFontPath, toleranceInPixels, highestQuality) {
    const simplifiedArrayOfPoints = simplify(convertOpentypeFontPathToArrayOfPoints(opentypeFontPath), toleranceInPixels, highestQuality);

    const result = convertArrayOfPointsToOpentypeFontPath(simplifiedArrayOfPoints);

    return result;
}

module.exports = {
    bufferToArrayBuffer,
    bufferToBase64String,
    composeCSSFontFaceDefinition,
    createFontBuffer,
    glyphToSolidBlockPath,
};
