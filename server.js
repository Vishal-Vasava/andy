/**
 * Andy local dev server
 * Run: node server.js
 * Then open http://localhost:3000 in Chrome and install as PWA
 */
const http  = require('http');
const fs    = require('fs');
const path  = require('path');
const os    = require('os');
const { exec } = require('child_process');

const PORT = process.env.PORT || 3000;
const DIR  = __dirname;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js':   'application/javascript; charset=utf-8',
  '.css':  'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg':  'image/svg+xml',
  '.png':  'image/png',
  '.ico':  'image/x-icon',
  '.webp': 'image/webp',
};

const server = http.createServer((req, res) => {
  let urlPath = req.url.split('?')[0];
  if (urlPath === '/') urlPath = '/index.html';

  const filePath = path.join(DIR, urlPath);

  // Security: prevent directory traversal
  if (!filePath.startsWith(DIR)) {
    res.writeHead(403); res.end('Forbidden'); return;
  }

  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end(`Not found: ${urlPath}`);
      return;
    }
    const mime = MIME[path.extname(filePath)] || 'application/octet-stream';
    res.writeHead(200, {
      'Content-Type': mime,
      'Cache-Control': 'no-cache',
      // Allow service worker to control the whole scope
      'Service-Worker-Allowed': '/',
    });
    res.end(data);
  });
});

server.on('error', err => {
  if (err.code === 'EADDRINUSE') {
    console.error(`\n❌  Port ${PORT} is already in use. Try: PORT=3001 node server.js\n`);
  } else {
    console.error(err);
  }
  process.exit(1);
});

server.listen(PORT, '0.0.0.0', () => {
  // Find local network IP for mobile access
  let localIP = 'localhost';
  for (const ifaces of Object.values(os.networkInterfaces())) {
    for (const iface of ifaces) {
      if (iface.family === 'IPv4' && !iface.internal) {
        localIP = iface.address;
        break;
      }
    }
  }

  console.log('\n\x1b[36m╔══════════════════════════════════════╗');
  console.log('║        🤖  Andy is running!          ║');
  console.log('╚══════════════════════════════════════╝\x1b[0m\n');
  console.log(`  \x1b[1mDesktop:\x1b[0m  http://localhost:${PORT}`);
  console.log(`  \x1b[1mMobile:\x1b[0m   http://${localIP}:${PORT}  (same WiFi)\n`);
  console.log('  \x1b[33mTo install as app:\x1b[0m');
  console.log('  • Desktop: Chrome ⋮ menu → "Install Andy..."');
  console.log('  • Android: Chrome ⋮ menu → "Add to Home Screen"');
  console.log('  • iOS:     Safari Share → "Add to Home Screen"\n');
  console.log('  Press Ctrl+C to stop.\n');

  // Auto-open browser on Windows
  if (process.platform === 'win32') {
    exec(`start http://localhost:${PORT}`);
  } else if (process.platform === 'darwin') {
    exec(`open http://localhost:${PORT}`);
  }
});
