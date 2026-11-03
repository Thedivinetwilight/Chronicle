// Test proxy that reproduces the field failure mode: a module request that
// never settles. Forwards everything to TARGET except assets matching STALL
// (default: the lazily imported capture analyzer chunk), whose responses are
// held open forever without any bytes — exactly the condition that makes a
// dynamic import() hang with no rejection.
import http from 'node:http';

const TARGET = process.env.TARGET ?? 'http://127.0.0.1:4173';
const PORT = Number(process.env.PORT ?? 4180);
const STALL = process.env.STALL ?? '/assets/analyzer-';

const server = http.createServer((req, res) => {
  const url = req.url ?? '/';
  if (url.startsWith(STALL)) {
    // Never respond. The client's request hangs; import() never settles.
    res.writeHead(200, { 'content-type': 'text/plain' });
    // writeHead sends headers only when flushed; keep the socket open with
    // no body and no end() so module evaluation never completes.
    return;
  }
  const upstream = http.request(
    `${TARGET}${url}`,
    { method: req.method, headers: { ...req.headers, host: new URL(TARGET).host } },
    (up) => {
      res.writeHead(up.statusCode ?? 502, up.headers);
      up.pipe(res);
    }
  );
  upstream.on('error', () => {
    res.writeHead(502).end('proxy error');
  });
  req.pipe(upstream);
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`blackhole proxy on :${PORT} -> ${TARGET}, stalling '${STALL}'`);
});
