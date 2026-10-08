"use strict";

// PostCSS plugin. Add `invisible-ink: hollow;` (or blocks / simplified) to an
// @font-face rule and the plugin will
//
//   1. generate a placeholder font from the file in that rule's `src`,
//   2. add a matching @font-face for "<family> Placeholder" (inlined as a
//      data: URL, so it is available before any text renders),
//   3. insert the placeholder after the family wherever it is used: in
//      font-family, the font shorthand and custom properties,
//   4. set font-display: swap on the original rule if it has none.

const crypto = require("crypto");
const fs = require("fs");
const os = require("os");
const path = require("path");

const library = require("./index");
const packageJSON = require("../package.json");

const DESCRIPTOR = "invisible-ink";
const PLACEHOLDER_SUFFIX = " Placeholder";
// @font-face descriptors that must not be copied to the placeholder face
const NOT_COPIED = new Set(["src", "font-family", "font-display", DESCRIPTOR]);
const FONT_SIZE_KEYWORDS = new Set([
    "xx-small", "x-small", "small", "medium", "large", "x-large", "xx-large", "xxx-large",
    "smaller", "larger", "math",
]);
const DEFAULT_WARN_SIZE = 32 * 1024;

// ------------------------------------------------------- value parsing ----

// Splits a CSS value on a separator, ignoring separators inside quotes and
// parentheses.
function splitTopLevel(value, separator) {
    const parts = [];
    let depth = 0;
    let quote = null;
    let current = "";
    for (let i = 0; i < value.length; i++) {
        const ch = value[i];
        if (quote) {
            current += ch;
            if (ch === "\\" && i + 1 < value.length) current += value[++i];
            else if (ch === quote) quote = null;
            continue;
        }
        if (ch === '"' || ch === "'") quote = ch;
        else if (ch === "(") depth++;
        else if (ch === ")") depth--;
        const isSeparator = separator === " " ? /\s/.test(ch) : ch === separator;
        if (isSeparator && depth === 0) {
            if (separator !== " " || current) parts.push(current);
            current = "";
        } else {
            current += ch;
        }
    }
    if (separator !== " " || current) parts.push(current);
    return parts;
}

function unquote(value) {
    value = value.trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
        return value.slice(1, -1).replace(/\\(.)/g, "$1");
    }
    return value;
}

function quote(value) {
    return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

// Family names compare case-insensitively, with runs of spaces collapsed.
function familyKey(name) {
    return unquote(name).replace(/\s+/g, " ").toLowerCase();
}

// Parses `simplified 30 characters("Hello") no-layout` and friends.
function parseDescriptor(value, fail) {
    const options = {};
    let skip = false;
    const tokens = splitTopLevel(value.trim(), " ");

    for (let i = 0; i < tokens.length; i++) {
        const token = tokens[i];
        const call = token.match(/^([a-z-]+)\((.*)\)$/is);
        if (call) {
            const argument = unquote(call[2]);
            switch (call[1].toLowerCase()) {
                case "characters": options.characters = argument; break;
                case "filter": options.filterFile = argument; break;
                case "donor": options.donorFile = argument; break;
                default: fail(`unknown function "${call[1]}()"`);
            }
            continue;
        }
        switch (token.toLowerCase()) {
            case "hollow":
            case "blocks":
                options.glyphs = token.toLowerCase();
                break;
            case "simplified":
                options.glyphs = "simplified";
                if (/^\d+(\.\d+)?$/.test(tokens[i + 1] || "")) options.tolerance = Number(tokens[++i]);
                break;
            case "no-layout":
                options.layout = false;
                break;
            case "none":
                skip = true;
                break;
            default:
                fail(`unknown keyword "${token}"`);
        }
    }

    return { options, skip };
}

// Picks the first url() in a src descriptor that points at a font file.
function pickSourceUrl(src) {
    for (const entry of splitTopLevel(src, ",")) {
        const match = entry.match(/url\(\s*(?:"([^"]*)"|'([^']*)'|([^)\s]*))\s*\)/i);
        if (!match) continue; // local()
        const url = match[1] ?? match[2] ?? match[3];
        if (url.startsWith("data:")) continue;
        return url;
    }
    return null;
}

// --------------------------------------------------------------- cache ----

function defaultCacheDir() {
    const nodeModules = path.resolve(process.cwd(), "node_modules");
    if (fs.existsSync(nodeModules)) return path.join(nodeModules, ".cache", "invisible-ink");
    return path.join(os.tmpdir(), "invisible-ink-cache");
}

function createCache(cacheOption) {
    const memory = new Map();
    const dir = cacheOption === false ? null : (typeof cacheOption === "string" ? cacheOption : defaultCacheDir());

    return {
        get(key) {
            if (memory.has(key)) return memory.get(key);
            if (!dir) return null;
            try {
                const entry = JSON.parse(fs.readFileSync(path.join(dir, `${key}.json`), "utf8"));
                entry.data = Buffer.from(entry.data, "base64");
                memory.set(key, entry);
                return entry;
            } catch (_err) {
                return null;
            }
        },
        set(key, entry) {
            memory.set(key, entry);
            if (!dir) return;
            try {
                fs.mkdirSync(dir, { recursive: true });
                fs.writeFileSync(path.join(dir, `${key}.json`), JSON.stringify({ ...entry, data: entry.data.toString("base64") }));
            } catch (_err) {
                // A read-only file system only costs us the disk cache
            }
        },
    };
}

// ------------------------------------------------------------- rewriting ----

// Inserts placeholders into a comma-separated family list. `families` maps
// familyKey(name) to the placeholder family name.
function rewriteFamilyList(items, families) {
    const out = [];
    let changed = false;
    items.forEach((item, i) => {
        out.push(item);
        const placeholder = families.get(familyKey(item));
        if (!placeholder) return;
        const next = items[i + 1];
        if (next !== undefined && familyKey(next) === familyKey(placeholder)) return;
        const leading = item.match(/^\s*/)[0];
        out.push((leading || " ") + quote(placeholder));
        changed = true;
    });
    return changed ? out : null;
}

function rewriteFontFamily(value, families) {
    const items = splitTopLevel(value, ",");
    const rewritten = rewriteFamilyList(items, families);
    return rewritten ? rewritten.join(",") : null;
}

function looksLikeFontSize(token) {
    const size = token.split("/")[0].toLowerCase();
    return FONT_SIZE_KEYWORDS.has(size) || /^[+-]?(\d|\.\d)/.test(size) || /^(var|calc|clamp|min|max|env)\(/.test(size);
}

// In the font shorthand the family list follows the size (and line height).
function rewriteFontShorthand(value, families) {
    const items = splitTopLevel(value, ",");
    const tokens = splitTopLevel(items[0], " ");
    let sizeIndex = -1;
    tokens.forEach((token, i) => {
        if (looksLikeFontSize(token)) sizeIndex = i;
    });
    if (sizeIndex < 0 || sizeIndex === tokens.length - 1) return null;

    const prefix = tokens.slice(0, sizeIndex + 1).join(" ");
    const firstFamily = tokens.slice(sizeIndex + 1).join(" ");
    const rewritten = rewriteFamilyList([firstFamily, ...items.slice(1)], families);
    if (!rewritten) return null;
    return `${prefix} ${rewritten.join(",")}`;
}

// Custom properties are only touched when they hold a plain family list
// that names a family with a placeholder.
function rewriteCustomProperty(value, families) {
    const items = splitTopLevel(value, ",");
    const isFamilyList = items.every(item => {
        const trimmed = item.trim();
        return /^(["'][^"']+["']|[a-z_-][\w -]*)$/i.test(trimmed);
    });
    if (!isFamilyList) return null;
    return rewriteFontFamily(value, families);
}

// ------------------------------------------------------------------ plugin ----

// options:
//   glyphs, tolerance, layout, characters, format
//                   defaults for every rule (see createPlaceholderFont)
//   all             process every @font-face, not only ones with the descriptor
//   families        extra family names to rewrite in files that are processed
//                   before the file declaring their @font-face
//   fontDisplay     value set on original rules lacking font-display
//                   ("swap" by default, false to leave them alone)
//   resolve         (url, fromFile) => absolute path or null, for bundler
//                   aliases; by default urls resolve relative to the CSS file,
//                   and root-relative ones ("/fonts/x.woff2") against `root`
//   root            directory for root-relative urls (default: ./public or
//                   ./static if one exists, else the working directory)
//   cache           directory for generated placeholders, or false
//   warnSize        warn when a placeholder exceeds this many bytes
function invisibleInk(pluginOptions = {}) {
    const defaults = {
        glyphs: pluginOptions.glyphs,
        tolerance: pluginOptions.tolerance,
        layout: pluginOptions.layout,
        characters: pluginOptions.characters,
        format: pluginOptions.format || "woff2",
    };
    const cache = createCache(pluginOptions.cache);
    const warnSize = pluginOptions.warnSize === undefined ? DEFAULT_WARN_SIZE : pluginOptions.warnSize;
    const fontDisplay = pluginOptions.fontDisplay === undefined ? "swap" : pluginOptions.fontDisplay;
    // Vite serves root-relative urls from public/, SvelteKit from static/
    const root = pluginOptions.root ||
        ["public", "static"].map(dir => path.resolve(dir)).find(dir => fs.existsSync(dir)) ||
        process.cwd();

    // Shared across files: @font-face rules and usages often live in different stylesheets
    const families = new Map();
    for (const name of pluginOptions.families || []) {
        families.set(familyKey(name), unquote(name) + PLACEHOLDER_SUFFIX);
    }

    function resolveUrl(url, fromFile) {
        let clean = url.split(/[?#]/)[0];
        try {
            clean = decodeURI(clean);
        } catch (_err) {
            // keep the url as written
        }
        if (pluginOptions.resolve) {
            const resolved = pluginOptions.resolve(url, fromFile);
            if (resolved) return resolved;
        }
        if (/^[a-z][a-z0-9+.-]*:/i.test(clean)) return null; // http:, https: and other schemes
        if (clean.startsWith("/")) return path.join(root, clean);
        const base = fromFile ? path.dirname(fromFile) : process.cwd();
        return path.resolve(base, clean);
    }

    function generate(fontPath, options) {
        const fontData = fs.readFileSync(fontPath);
        const hash = crypto.createHash("sha256");
        hash.update(packageJSON.version);
        hash.update(JSON.stringify(options, (key, value) => (Buffer.isBuffer(value) ? undefined : value)));
        hash.update(fontData);
        if (options.donor) hash.update(options.donor);
        const key = hash.digest("hex").slice(0, 32);

        let entry = cache.get(key);
        if (!entry) {
            const placeholder = library.createPlaceholderFont(fontData, options);
            entry = { format: placeholder.format, data: placeholder.data };
            cache.set(key, entry);
        }
        return entry;
    }

    function processFontFace(rule, result, fromFile, declared) {
        let descriptor = null;
        rule.each(node => {
            if (node.type === "decl" && node.prop.toLowerCase() === DESCRIPTOR) descriptor = node;
        });
        if (!descriptor && !pluginOptions.all) return;

        const fail = (message) => {
            throw (descriptor || rule).error(message, { plugin: "invisible-ink" });
        };

        const parsed = descriptor ? parseDescriptor(descriptor.value, fail) : { options: {}, skip: false };
        if (descriptor) descriptor.remove();
        if (parsed.skip) return;

        let familyDecl = null;
        let srcDecl = null;
        let hasDisplay = false;
        rule.each(node => {
            if (node.type !== "decl") return;
            const prop = node.prop.toLowerCase();
            if (prop === "font-family") familyDecl = node;
            if (prop === "src") srcDecl = node;
            if (prop === "font-display") hasDisplay = true;
        });
        if (!familyDecl) fail("@font-face has no font-family");
        if (!srcDecl) fail("@font-face has no src");

        const family = unquote(familyDecl.value);
        const placeholderFamily = family + PLACEHOLDER_SUFFIX;
        // This is a placeholder, or already has one (the plugin ran before)
        if ([...families.values()].some(name => familyKey(name) === familyKey(family))) return;
        if (declared.has(familyKey(placeholderFamily))) {
            families.set(familyKey(family), placeholderFamily);
            return;
        }
        if (/placeholder$/i.test(family) && declared.has(familyKey(family.slice(0, -PLACEHOLDER_SUFFIX.length)))) return;
        const url = pickSourceUrl(srcDecl.value);
        if (!url) {
            if (descriptor) result.warn(`no usable url() in src of "${family}", skipping`, { node: srcDecl });
            return;
        }
        const fontPath = resolveUrl(url, fromFile);
        if (!fontPath) {
            result.warn(`cannot read remote font "${url}"; download it into the project to get a placeholder`, { node: srcDecl });
            return;
        }
        if (!fs.existsSync(fontPath)) fail(`font file not found: ${url} (looked in ${fontPath})`);
        result.messages.push({ type: "dependency", plugin: "invisible-ink", file: fontPath, parent: fromFile });

        const options = { ...defaults };
        for (const [key, value] of Object.entries(parsed.options)) options[key] = value;
        const relativeTo = fromFile ? path.dirname(fromFile) : process.cwd();
        if (options.filterFile) {
            const filterPath = path.resolve(relativeTo, options.filterFile);
            options.characters = fs.readFileSync(filterPath, "utf8");
            result.messages.push({ type: "dependency", plugin: "invisible-ink", file: filterPath, parent: fromFile });
            delete options.filterFile;
        }
        if (options.donorFile) {
            const donorPath = path.resolve(relativeTo, options.donorFile);
            options.donor = fs.readFileSync(donorPath);
            result.messages.push({ type: "dependency", plugin: "invisible-ink", file: donorPath, parent: fromFile });
            delete options.donorFile;
        }
        for (const key of Object.keys(options)) {
            if (options[key] === undefined) delete options[key];
        }

        let entry;
        try {
            entry = generate(fontPath, options);
        } catch (err) {
            fail(`could not create a placeholder for ${url}: ${err.message}`);
        }
        if (warnSize && entry.data.length > warnSize) {
            result.warn(
                `invisible-ink: placeholder for "${family}" is ${Math.round(entry.data.length / 1024)} KB; ` +
                "a font subset to the scripts you use (e.g. latin) gives a much smaller one",
                { node: rule },
            );
        }

        const placeholderRule = rule.clone({ nodes: [] });
        placeholderRule.append({ prop: "font-family", value: quote(placeholderFamily) });
        placeholderRule.append({
            prop: "src",
            value: `url("data:font/${entry.format === "woff2" ? "woff2" : "ttf"};base64,${entry.data.toString("base64")}") format("${entry.format}")`,
        });
        rule.each(node => {
            if (node.type === "decl" && !NOT_COPIED.has(node.prop.toLowerCase())) {
                placeholderRule.append(node.clone());
            }
        });
        rule.before(placeholderRule);

        if (fontDisplay && !hasDisplay) rule.append({ prop: "font-display", value: fontDisplay });

        families.set(familyKey(family), placeholderFamily);
    }

    return {
        postcssPlugin: "invisible-ink",
        Once(root, { result }) {
            const fromFile = root.source && root.source.input && root.source.input.file;

            const declared = new Set();
            root.walkAtRules(/^font-face$/i, rule => {
                rule.each(node => {
                    if (node.type === "decl" && node.prop.toLowerCase() === "font-family") declared.add(familyKey(node.value));
                });
            });

            root.walkAtRules(/^font-face$/i, rule => processFontFace(rule, result, fromFile, declared));

            if (!families.size) return;
            root.walkDecls(decl => {
                if (decl.parent && decl.parent.type === "atrule" && /^font-face$/i.test(decl.parent.name)) return;
                const prop = decl.prop.toLowerCase();
                let value = null;
                if (prop === "font-family") value = rewriteFontFamily(decl.value, families);
                else if (prop === "font") value = rewriteFontShorthand(decl.value, families);
                else if (prop.startsWith("--")) value = rewriteCustomProperty(decl.value, families);
                if (value !== null) decl.value = value;
            });
        },
    };
}

invisibleInk.postcss = true;

module.exports = invisibleInk;
module.exports._internal = { parseDescriptor, pickSourceUrl, rewriteFontFamily, rewriteFontShorthand, rewriteCustomProperty, splitTopLevel };
