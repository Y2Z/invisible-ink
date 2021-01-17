"use strict";

const fs = require("fs");
const path = require("path");

const library = require("../lib");

// Conventional
(() => {
    process.stdout.write("Generating conventional…");
    const examplePageHTML = generateExamplePageHTML("Conventional");
    fs.writeFileSync(path.resolve("example", "example-conventional.html"), examplePageHTML);
    console.log(" done");
})();

// Hollow
(() => {
    process.stdout.write("Generating hollow…");
    const libraryOptions = {
        allowedNames: [],
    };
    const sourceFontPath = path.resolve(process.cwd(), "example/fonts/AlexBrush-Regular.ttf");
    const sourceFontBuffer = fs.readFileSync(sourceFontPath)
    const sourceFontAB = library.bufferToArrayBuffer(sourceFontBuffer);
    const placeholderFont = library.createFontBuffer(sourceFontAB, libraryOptions, undefined);
    const composedCSSFontFaceDefinition = "\n\n" + library.composeCSSFontFaceDefinition(placeholderFont.name, "opentype", placeholderFont.data);
    const examplePageHTML = generateExamplePageHTML("Hollow", composedCSSFontFaceDefinition);
    fs.writeFileSync(path.resolve("example", "example-hollow.html"), examplePageHTML);
    console.log(" done");
})();

// Solid
(() => {
    process.stdout.write("Generating solid…");
    const libraryOptions = {
        allowedNames: [],
        useSolidBlocks: true,
    };
    const sourceFontPath = path.resolve(process.cwd(), "example/fonts/AlexBrush-Regular.ttf");
    const sourceFontBuffer = fs.readFileSync(sourceFontPath)
    const sourceFontAB = library.bufferToArrayBuffer(sourceFontBuffer);
    const placeholderFont = library.createFontBuffer(sourceFontAB, libraryOptions, undefined);
    const composedCSSFontFaceDefinition = "\n\n" + library.composeCSSFontFaceDefinition(placeholderFont.name, "opentype", placeholderFont.data);
    const examplePageHTML = generateExamplePageHTML("Solid", composedCSSFontFaceDefinition);
    fs.writeFileSync(path.resolve("example", "example-solid.html"), examplePageHTML);
    console.log(" done");
})();

// Gradual
(() => {
    process.stdout.write("Generating gradual…");
    const libraryOptions = {
        allowedNames: "The Rats in the Walls By H. P. Lovecraft On July 16, 1923, I moved into Exham Priory".split("").map(name => name.charCodeAt()),
    };
    const sourceFontPath = path.resolve(process.cwd(), "example/fonts/AlexBrush-Regular.ttf");
    const sourceFontBuffer = fs.readFileSync(sourceFontPath)
    const sourceFontAB = library.bufferToArrayBuffer(sourceFontBuffer);
    const placeholderFont = library.createFontBuffer(sourceFontAB, libraryOptions, sourceFontAB);
    const composedCSSFontFaceDefinition = "\n\n" + library.composeCSSFontFaceDefinition(placeholderFont.name, "opentype", placeholderFont.data);
    const examplePageHTML = generateExamplePageHTML("Gradual", composedCSSFontFaceDefinition);
    fs.writeFileSync(path.resolve("example", "example-gradual.html"), examplePageHTML);
    console.log(" done");
})();

function generateExamplePageHTML(title, styles) {
    const fontFamily = (styles) ? `"Alex Brush", "Alex Brush Placeholder"` : `"Alex Brush"`;

    // -= Le hack =-
    // There must be at least one visible element on the page that uses our placeholder font at all times,
    // otherwise browsers will assume that our placeholder web font is not needed and will flush it from their memory,
    // hence making it not work for other elements (where it's the second font in the chain) ¯\_(ツ)_/¯
    const hackCSS = (styles) ? `

            #invisible-ink {
                font-family: "Alex Brush Placeholder";
            }` : "";
    const hackHTML = (styles) ? `
        <span id="invisible-ink"></span>
` : "";

    return `\
<!doctype html>
<html lang="en">
    <head>
        <meta charset="UTF-8" />
        <link rel="icon" href="images/1x1-00000000.png" />
        <title>${title || ""}</title>
        <style>${styles || ""}

            @font-face {
                font-family: "Alex Brush";
                src: url('fonts/AlexBrush-Regular.ttf');
                /* Suppress FOIT */
                font-display: swap;
            }

            body {
                background-color: #000;
                color: #fff;
                font-family: ${fontFamily}, Arial, Helvetica, sans-serif;
                margin: 0 auto;
                overflow-y: scroll;
                padding: 20px;
            }

            div {
                padding-bottom: 200px;
            }

            img {
                display: inline-block;
                border: 8px solid #fff;
                box-sizing: border-box;
                height: 160px;
                margin: 10px;
                margin-top: 4px;
                width: 240px;
            }

            img.left {
                margin-left: 0;
                float: left;
            }

            img.right {
                margin-right: 0;
                float: right;
            }${hackCSS || ""}

        </style>
    </head>
    <body>${hackHTML || ""}
        <h1>The Rats in the Walls</h1>
        <h2>By H. P. Lovecraft</h2>

        <p>
            On July 16, 1923, I moved into Exham Priory after the last workman had finished his labours.
            The restoration had been a stupendous task, for little had remained of the deserted pile but
            a shell-like ruin; yet because it had been the seat of my ancestors I let no expense deter me.
            The place had not been inhabited since the reign of James the First, when a tragedy of intensely
            hideous, though largely unexplained, nature had struck down the master, five of his children,
            and several servants; and driven forth under a cloud of suspicion and terror the third son,
            my lineal progenitor and the only survivor of the abhorred line. With this sole heir denounced
            as a murderer, the estate had reverted to the crown, nor had the accused man made any attempt
            to exculpate himself or regain his property. Shaken by some horror greater than that of conscience
            or the law, and expressing only a frantic wish to exclude the ancient edifice from his sight
            and memory, Walter de la Poer, eleventh Baron Exham, fled to Virginia and there founded the
            family which by the next century had become known as Delapore.
        </p>

        <p>
            <img src="images/pexels-cmonphotography-4202203.jpg" class="left" alt="Little Public Domain rat" />

            Exham Priory had remained untenanted, though later allotted to the estates
            of the Norrys family and much studied because of its peculiarly composite architecture; an architecture
            involving Gothic towers resting on a Saxon or Romanesque substructure, whose foundation in turn
            was of a still earlier order or blend of orders—Roman, and even Druidic or native Cymric,
            if legends speak truly. This foundation was a very singular thing, being merged on one side
            with the solid limestone of the precipice from whose brink the priory overlooked a desolate
            valley three miles west of the village of Anchester. Architects and antiquarians loved to examine
            this strange relic of forgotten centuries, but the country folk hated it. They had hated it
            hundreds of years before, when my ancestors lived there, and they hated it now, with the moss
            and mould of abandonment on it. I had not been a day in Anchester before I knew I came of an
            accursed house. And this week workmen have blown up Exham Priory, and are busy obliterating
            the traces of its foundations.
        </p>

        <p>
            <img src="images/pexels-cmonphotography-2664261.jpg" class="right" alt="Little Public Domain rat" />

            The bare statistics of my ancestry I had always known, together with the fact
            that my first American forbear had come to the colonies under a strange cloud. Of details, however,
            I had been kept wholly ignorant through the policy of reticence always maintained by the Delapores.
            Unlike our planter neighbours, we seldom boasted of crusading ancestors or other mediaeval and
            Renaissance heroes; nor was any kind of tradition handed down except what may have been recorded
            in the sealed envelope left before the Civil War by every squire to his eldest son for posthumous
            opening. The glories we cherished were those achieved since the migration; the glories of a
            proud and honourable, if somewhat reserved and unsocial Virginia line.
        </p>

        <p>
            During the war our fortunes were extinguished and our whole existence changed
            by the burning of Carfax, our home on the banks of the James. My grandfather, advanced in years,
            had perished in that incendiary outrage, and with him the envelope that bound us all to the
            past. I can recall that fire today as I saw it then at the age of seven, with the Federal soldiers
            shouting, the women screaming, and the negroes howling and praying. My father was in the army,
            defending Richmond, and after many formalities my mother and I were passed through the lines
            to join him. When the war ended we all moved north, whence my mother had come; and I grew to
            manhood, middle age, and ultimate wealth as a stolid Yankee. Neither my father nor I ever knew
            what our hereditary envelope had contained, and as I merged into the greyness of Massachusetts
            business life I lost all interest in the mysteries which evidently lurked far back in my family
            tree. Had I suspected their nature, how gladly I would have left Exham Priory to its moss, bats,
            and cobwebs!
        </p>

        <p>
            My father died in 1904, but without any message to leave me, or to my only
            child, Alfred, a motherless boy of ten. It was this boy who reversed the order of family information;
            for although I could give him only jesting conjectures about the past, he wrote me of some very
            interesting ancestral legends when the late war took him to England in 1917 as an aviation officer.
            Apparently the Delapores had a colourful and perhaps sinister history, for a friend of my son&rsquo;s,
            Capt. Edward Norrys of the Royal Flying Corps, dwelt near the family seat at Anchester and related
            some peasant superstitions which few novelists could equal for wildness and incredibility. Norrys
            himself, of course, did not take them seriously; but they amused my son and made good material
            for his letters to me. It was this legendry which definitely turned my attention to my transatlantic
            heritage, and made me resolve to purchase and restore the family seat which Norrys shewed to
            Alfred in its picturesque desertion, and offered to get for him at a surprisingly reasonable
            figure, since his own uncle was the present owner.
        <p>

        <p>
            I bought Exham Priory in 1918, but was almost immediately distracted from my
            plans of restoration by the return of my son as a maimed invalid. During the two years that
            he lived I thought of nothing but his care, having even placed my business under the direction
            of partners. In 1921, as I found myself bereaved and aimless, a retired manufacturer no longer
            young, I resolved to divert my remaining years with my new possession. Visiting Anchester in
            December, I was entertained by Capt. Norrys, a plump, amiable young man who had thought much
            of my son, and secured his assistance in gathering plans and anecdotes to guide in the coming
            restoration. Exham Priory itself I saw without emotion, a jumble of tottering mediaeval ruins
            covered with lichens and honeycombed with rooks&rsquo; nests, perched perilously upon a precipice,
            and denuded of floors or other interior features save the stone walls of the separate towers.
        </p>

        <p>…<p>
    </body>
</html>
`;
}
