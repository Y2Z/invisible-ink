#!/usr/bin/env node

"use strict";

const fs = require("fs");
const path = require("path");
const process = require("process");

const program = require("commander");

const library = require("../lib");
const packageJSON = require("../package.json");

program
    .version(packageJSON.version)
    .arguments("[fontFile...]")
    .option('-b, --blocks', 'substitute glyphs with solid blocks')
    .option('-d, --donor <fontFile>', 'borrow glyphs from donor font file')
    .option('-f, --filter <textFile>', 'only substitute characters found in this file')
    .action(fontFiles => {
        const output = [];
        var successCount = 0;
        var failureCount = 0;

        if (fontFiles.length < 1) {
            program.outputHelp();
        } else {
            const options = {
                allowedUnicodes: null,
                useSolidBlocks: program.blocks,
            };

            if (program.filter) {
                options.allowedUnicodes = [];
                const filterFilePath = path.resolve(process.cwd(), program.filter);
                const filter = fs.readFileSync(filterFilePath).toString();
                filter.split('').forEach(character => {
                    options.allowedUnicodes.push(character.charCodeAt());
                });

                // Make unique
                options.allowedUnicodes = [...new Set(options.allowedUnicodes)];
            }

            var donorFontAB;
            if (program.donor) {
                const donorFontPath = path.resolve(process.cwd(), program.donor);
                const donorFontBuffer = fs.readFileSync(donorFontPath)
                donorFontAB = library.bufferToArrayBuffer(donorFontBuffer);
            }

            // Loop through arguments
            fontFiles.forEach(fontFile => {
                try {
                    const sourceFontPath = path.resolve(process.cwd(), fontFile);
                    const sourceFontBuffer = fs.readFileSync(sourceFontPath)
                    const sourceFontAB = library.bufferToArrayBuffer(sourceFontBuffer);
                    const placeholderFont = library.createFontBuffer(sourceFontAB, options, donorFontAB);
                    const fontFaceDefinition = library.composeCSSFontFaceDefinition(placeholderFont.name, "opentype", placeholderFont.data);
                    output.push(fontFaceDefinition);
                    successCount++;
                } catch (err) {
                    console.error(`unable to process font file ${fontFile}: ${err}`);
                    failureCount++;
                }
            });

            // Print the output
            if (output.length > 0) {
                console.log(output.join("\n\n"));
            }
        }

        const exitCode = (successCount > 0 && failureCount == 0) ? 0 : 2;
        process.exit(exitCode);
    })
    .parse(process.argv);
