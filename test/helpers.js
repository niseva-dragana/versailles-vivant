'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { createServer } = require('../server');
const { loadI18n, dictionaryFor } = require('../server/render-lang');

const ROOT = path.join(__dirname, '..');
const pages = () => fs.readdirSync(ROOT).filter((f) => f.endsWith('.html')).sort();
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');

async function startServer(options) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vv-test-'));
  const server = createServer(Object.assign({ dataDir, log: false }, options));
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  function request(method, url, { headers = {}, body } = {}) {
    return new Promise((resolve, reject) => {
      const req = http.request({ host: '127.0.0.1', port, method, path: url, headers }, (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks).toString('utf8') }));
      });
      req.on('error', reject);
      if (body) req.write(body);
      req.end();
    });
  }
  return {
    port, dataDir, request,
    get: (url, headers) => request('GET', url, { headers }),
    post: (url, obj, headers) => request('POST', url, { headers: Object.assign({ 'Content-Type': 'application/json' }, headers), body: typeof obj === 'string' ? obj : JSON.stringify(obj) }),
    close: () => new Promise((resolve) => server.close(resolve))
  };
}

module.exports = { ROOT, pages, read, startServer, loadI18n, dictionaryFor };
