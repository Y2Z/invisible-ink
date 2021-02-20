const fs = require("fs");
const http = require("http");
const path = require("path");
const url = require("url");
const ReadableStream = require("stream").Readable;

const Throttle = require("throttle");

const port = process.env.PORT || 5703;
const bytesPerSecond = 13 * 1024; // 13 KBps

const stringToStream = (string) => {
    const stream = new ReadableStream();
    stream._read = () => {};
    stream.push(string);
    stream.push(null);
    return stream;
}

const server = http.createServer((req, res) => {
    const baseURL = "http://" + req.headers.host + "/";
    const requestedUrl = new URL(req.url, baseURL);

    let filePath;

    switch (requestedUrl.pathname) {
        // Homepage
        case "/":
        case "/index.html":
            filePath = path.resolve(process.cwd(), "example", "index.html");
            fs.createReadStream(filePath).pipe(res);
            break;

        // Favicon
        case "/images/1x1-00000000.png":
            filePath = path.resolve(process.cwd(), "example" + decodeURIComponent(requestedUrl.pathname));
            fs.createReadStream(filePath).pipe(res);
            break;

        // Content that needs to be throttled
        case "/images/pexels-cmonphotography-4202203.jpg":
        case "/images/pexels-cmonphotography-2664261.jpg":
        case "/fonts/AlexBrush-Regular.ttf":
            filePath = path.resolve(process.cwd(), "example" + decodeURIComponent(requestedUrl.pathname));
            fs.createReadStream(filePath).pipe(new Throttle(bytesPerSecond)).pipe(res);
            break;

        // Modify and throttle
        case "/example-conventional.html":
        case "/example-hollow.html":
        case "/example-solid.html":
        case "/example-gradual.html":
            filePath = path.resolve(process.cwd(), "example" + decodeURIComponent(requestedUrl.pathname));
            var fileContents = fs.readFileSync(filePath).toString();
            fileContents = fileContents.replace(".ttf", ".ttf?" + Date.now());
            const stream = stringToStream(fileContents);
            stream.pipe(new Throttle(bytesPerSecond)).pipe(res);
            break;

        // Everything else
        default:
            res.end("404");
            break;
    }
});

server.listen(port, () => {
    console.log(`Server is listening to HTTP requests on http://0.0.0.0:${port}`);
});
