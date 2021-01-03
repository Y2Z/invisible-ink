const fs = require('fs');
const http = require('http');
const url = require('url');
const ReadableStream = require('stream').Readable;

const Throttle = require('throttle');

const port = process.env.PORT || 5703;
const bytesPerSecond = 13 * 1024; // 13 KBps

const stringToStream = (string) => {
    const stream = new ReadableStream();
    stream._read = () => {}; // redundant? see update below
    stream.push(string);
    stream.push(null);
    return stream;
}

const server = http.createServer((req, res) => {
    const requestedUrl = url.parse(req.url);

    switch (requestedUrl.pathname) {
        // Homepage
        case '/':
        case '/index.html':
            fs.createReadStream('example/index.html').pipe(res);
            break;

        // Favicon
        case '/images/1x1-00000000.png':
            fs.createReadStream('example' + decodeURIComponent(requestedUrl.pathname))
                .pipe(res);
            break;

        // Content that needs to be throttled
        case '/images/pexels-cmonphotography-4202203.jpg':
        case '/images/pexels-cmonphotography-2664261.jpg':
            case '/fonts/AlexBrush-Regular.ttf':
            fs.createReadStream('example' + decodeURIComponent(requestedUrl.pathname))
                .pipe(new Throttle(bytesPerSecond))
                .pipe(res);
            break;

        // Modify and throttle
        case '/with-invisible-ink.html':
        case '/without-invisible-ink.html':
            var fileContents =
                fs.readFileSync('example' + decodeURIComponent(requestedUrl.pathname))
                    .toString();
            fileContents = fileContents.replace('.ttf', '.ttf?' + Date.now());
            const stream = stringToStream(fileContents);
            stream.pipe(new Throttle(bytesPerSecond)).pipe(res);
            break;

        // Everything else
        default:
            res.end('404');
            break;
    }
});

server.listen(port, () => {
    console.log(`Server is listening to HTTP requests on port ${port}`);
});
