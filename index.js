const path = require("path");

const opentype = require("opentype.js");
const base64Encode = require("base64-arraybuffer").encode;

const args = process.argv.slice(2);
const output = [];
for (let i = 0, ilen = args.length; i < ilen; i++) {
    const sourceFontPath = path.join(__dirname, args[i]);
    const font = opentype.loadSync(sourceFontPath);

    // Loop through font's glyphs
    for (let j = 0, jlen = font.glyphs.length; j < jlen; j++) {
        const glyph = font.glyphs.glyphs[j];
        // Discard glyph’s path information
        glyph.path.commands = [];
    }

    // Alter metadata
    font.names.fontFamily.en += " Invisible Ink";
    font.names.postScriptName.en += "-InvisibleInk";
    font.names.uniqueID.en = "";
    font.names.fullName.en += " Invisible Ink";
    font.names.version.en = "";

    const data = base64Encode(font.toArrayBuffer());
    const mediaType = "application/vnd.ms-opentype";

    output.push(
`@font-face {
    font-family: "${font.names.fontFamily.en}";
    src: url("data:${mediaType};base64,${data}") format("opentype");
}`
    );
}

if (output.length > 0) {
    console.log(output.join("\n\n"));
}
