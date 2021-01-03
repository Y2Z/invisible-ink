# Invisible Ink

Tool for stripping vector paths from font files.


## Application

Create fallback web fonts for text to protect other contents from being shifted during initial load.

The idea is that text rendered using invisible fonts remains hidden while taking up exactly the same amount of space as when the original web font is used, so when it finishes loading and the text gets rendered with a new font, not a single pixel gets shifted.

This is a no-JS method of creating UX-friendly placeholders for web fonts.


## Pros and cons

Pros
- While loading, the page’s elements are no longer “jumping”
- Neither the scroll offset nor scrollbar’s length change once the target web font is finally loaded

Cons
 - Not able to read the text while waiting for the font file to load\
   <sub>Could be solved by trivializing glyph paths instead of removing them completely, or by providing basic default paths for the most common symbols</sub>
 - If the target font file fails to load, the page will become unreadable\
   <sub>A possible solution to this could be some JS logic that would remove the invisible font from CSS if the actual one fails to load (after a couple of seconds)</sub>
 - File size overhead of about 12KB


## Where it works

| Firefox  | Safari  | Brave  | Chromium  | Safari (iOS)  | DuckDuckGo (iOS)  | Other browsers  |
|----------|---------|--------|-----------|---------------|-------------------|-----------------|
| yes      | yes     | yes    | yes       | yes           | yes               | not yet known   |


## See for yourself!

Within the `example` directory you’ll find a basic demo example. Don’t open `index.html` directly though, but rather run `npm run demo-server` and then open http://localhost:5703 (to see the before and after pages load in slo-mo, side-by-side). You can also view them separately via http://localhost:5703/without-invisible-ink.html and http://localhost:5703/with-invisible-ink.html respectively. Have fun!


## How to install on your system

    npm i -g invisible-ink


## How to use in your project

1. `invisible-ink My-Font-Name.ttf > output.css`
2. Change all `font-family: "My Font Name", …;` in your code to `font-family: "My Font Name", "My Font Name Invisible Ink", …;`
3. Add this CSS rule:
    ```CSS
        #invisible-ink {
            font-family: "My Font Name Invisible Ink";
        }
    ```
    and this HTML code:
    ```HTML
        <a id="invisible-ink"></a>
    ```
    to your page.
4. Prepend contents of `output.css` to your project’s CSS codebase.
5. Get rid of `output.css` <sub>…you filthy animal</sub>


## Motivation

Web fonts get loaded asynchronously. The good news is that it doesn’t block the rest of the page from being loaded (unlike JavaScript). The bad news is that there’s always a chance that the CDN where your favorite font lives is just not as fast as you’d like it to be.


## Future of this project

This’s more of a proof of concept than a final piece of software. But it works. In an ideal world there should be a Webpack plug-in to do all this automatically.


## Credits

Sample font “Alex Brush” used for the demo was designed by [Robert E. Leuschke](https://www.typesetit.com/)

All photos shown in the demo pages were obtained from [Pexels](https://pexels.com/) and are in public domain along with the text by [H.P. Lovecraft](https://www.hplovecraft.com/).

## License

MIT
