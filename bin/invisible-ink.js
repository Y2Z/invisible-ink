#!/usr/bin/env node

const fs = require("fs");
const path = require("path");
const process = require("process");

const program = require("commander");
const base64Encode = require("base64-arraybuffer").encode;

const library = require("../lib");
const packageJson = require("../package.json");

const MEDIA_TYPE = "application/vnd.ms-opentype";

var exitCode = 0;

program
    .version(packageJson.version)
    .arguments("[fontFile...]")
    .action((fontFiles) => {
        const output = [];

        function bufferToArrayBuffer(buf) {
            const ab = new ArrayBuffer(buf.length);
            const array = new Uint8Array(ab);

            for (var i = 0, ilen = buf.length; i < ilen; i++) {
                array[i] = buf[i];
            }

            return ab;
        }

        // Loop through arguments
        fontFiles.forEach(fontFile => {
            try {
                const sourceFontPath = path.join(process.cwd(), fontFile);
                const sourceFontBuffer = fs.readFileSync(sourceFontPath)
                const sourceFontAB = bufferToArrayBuffer(sourceFontBuffer);
                const invisibleFont = library.create(sourceFontAB);
                const data = base64Encode(invisibleFont.data);

                output.push(
`@font-face {
    font-family: "${invisibleFont.name}";
    src: url("data:${MEDIA_TYPE};base64,${data}") format("opentype");
}`
                );
            } catch (_) {
                console.error(`${fontFile}: unable to process font file`);
                exitCode = 1;
            }
        });

        // Print the output
        if (output.length > 0) {
            console.log(output.join("\n\n"));
        }

        process.exit(exitCode);
    })
    .parse(process.argv);
