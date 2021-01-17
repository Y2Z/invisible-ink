"use strict";

const assert = require("assert");
const library = require("../lib");

describe("bufferToArrayBuffer", () => {
    it("should return correct ArrayBuffer representation of input Buffer", () => {
        const inputString = "Dummy";
        const actualArrayBuffer = library.bufferToArrayBuffer(
            Buffer.from(inputString),
        );

        assert.strictEqual(actualArrayBuffer.byteLength, inputString.length);
        const actualArrayBufferView = new Uint8Array(actualArrayBuffer);
        for (let i = 0, ilen = inputString.length; i < ilen; i++) {
            assert.strictEqual(actualArrayBufferView[i], inputString.charCodeAt(i));
        }
    });
});

describe("bufferToBase64String", () => {
    it("should return correct Base64 string representation of input Buffer", () => {
        const actualBase64String = library.bufferToBase64String(
            Buffer.from("Dummy data"),
        );
        const expectedBase64String = "RHVtbXkgZGF0YQ==";

        assert.strictEqual(actualBase64String, expectedBase64String);
    });
});

describe("composeCSSFontFaceDefinition", () => {
    it("should return correct CSS @font-face definition for opentype fonts", () => {
        const actualCSSFontFaceDefinition = library.composeCSSFontFaceDefinition(
            "Test Font",
            "opentype",
            Buffer.from("Dummy font data"),
        );
        const expectedCSSFontFaceDefinition = `\
@font-face {
    font-family: "Test Font";
    src: url("data:application/vnd.ms-opentype;base64,RHVtbXkgZm9udCBkYXRh") format("opentype");
}`;

        assert.strictEqual(actualCSSFontFaceDefinition, expectedCSSFontFaceDefinition);
    });
});

describe("glyphToSolidBlockPath", () => {
    it("should return correct path that represents full block glyph based on source glyph's dimensions", () => {
        const inputGlyph = {
            xMax: 10,
            xMin: 1,
            yMax: 9,
            yMin: 0,
        };
        const actualPath = library.glyphToSolidBlockPath(inputGlyph);

        assert.strictEqual(actualPath.commands.length, 5);
        assert.strictEqual(actualPath.commands[0].type, "M");
        assert.strictEqual(actualPath.commands[0].x, 10);
        assert.strictEqual(actualPath.commands[0].y, 0);
        assert.strictEqual(actualPath.commands[1].type, "L");
        assert.strictEqual(actualPath.commands[1].x, 1);
        assert.strictEqual(actualPath.commands[1].y, 0);
        assert.strictEqual(actualPath.commands[2].type, "L");
        assert.strictEqual(actualPath.commands[2].x, 1);
        assert.strictEqual(actualPath.commands[2].y, 9);
        assert.strictEqual(actualPath.commands[3].type, "L");
        assert.strictEqual(actualPath.commands[3].x, 10);
        assert.strictEqual(actualPath.commands[3].y, 9);
        assert.strictEqual(actualPath.commands[4].type, "L");
        assert.strictEqual(actualPath.commands[4].x, 10);
        assert.strictEqual(actualPath.commands[4].y, 0);
        assert.strictEqual(actualPath.fill, "black");
        assert.strictEqual(actualPath.stroke, null);
        assert.strictEqual(actualPath.strokeWidth, 1);
    });
});
