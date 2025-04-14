# Invisible Ink

Gradually-loading web fonts.

This is a purely HTML+CSS approach to combating [FOUT (Flash Of Unstyled Text)](https://css-tricks.com/fout-foit-foft/).


## Application

Create fallback web fonts to prevent contents from jumping during initial page load.

The idea is that text rendered using placeholder fonts remains hidden while taking up exactly the same amount of space as when the original web font is used, so once it finishes loading and the text gets rendered with a new font, not a single pixel gets shifted!



## See for yourself!

Run `make SERVE` and then navigate to http://localhost:5703

![](assets/screencast.gif)


## How to install on your system

    npm i -g invisible-ink


## How to use in your project

1. `invisible-ink My-Font-Name.ttf > output.css`
2. Change all
    ```CSS
    font-family: "My Font Name", …;
    ```
    in your code to
    ```CSS
    font-family: "My Font Name", "My Font Name Placeholder", …;
    ```
3. Add this CSS rule:
    ```CSS
    #invisible-ink {
        font-family: "My Font Name Placeholder";
    }
    ```
    and this HTML code:
    ```HTML
    <span id="invisible-ink"></span>
    ```
    to your page.
4. Prepend contents of `output.css` to your project’s CSS codebase.


## Motivation

Web fonts get loaded asynchronously.  The good news is that it doesn’t block the rest of the page from being loaded (unlike JavaScript).  The bad news, there’s always a chance that the CDN where your favorite font lives is just not as fast as you’d like it to be, and the font available on your system will take up different amount of space than the specified web font (when it loads).


## Credits

Sample font “Alex Brush” used for the demo was designed by [Robert E. Leuschke](https://www.typesetit.com/).

All photos shown on the demo’s pages were obtained from [Pexels](https://pexels.com/) and are in the public domain along with the text by [H.P. Lovecraft](https://www.hplovecraft.com/).


## License

To the extent possible under law, the author(s) have dedicated all copyright related and neighboring rights to this software to the public domain worldwide.
This software is distributed without any warranty.
