const opentype = require("opentype.js");

module.exports = {
    create: (fontFileArrayBuffer) => {
        // Parse the array buffer input
        const font = opentype.parse(fontFileArrayBuffer);

        // Loop through font's glyphs
        for (let i = 0, ilen = font.glyphs.length; i < ilen; i++) {
            const glyph = font.glyphs.glyphs[i];
            // Discard glyph’s path information
            glyph.path.commands = [];
        }

        // Alter metadata
        font.names.fontFamily.en += " Invisible Ink";
        font.names.postScriptName.en += "-InvisibleInk";
        font.names.uniqueID.en = "";
        font.names.fullName.en += " Invisible Ink";
        font.names.version.en = "";

        // Return the result
        return {
            name: font.names.fontFamily.en,
            data: font.toArrayBuffer(),
        };
    },
};
