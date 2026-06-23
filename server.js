const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 3000;
const DEEPSEEK_API_KEY = process.env.DEEPSEEK_API_KEY || '';
const KB_DIR = process.env.KB_DIR || './data';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js':   'application/javascript; charset=utf-8',
  '.css':  'text/css; charset=utf-8',
  '.json': 'application/json',
  '.ico':  'image/x-icon',
};

function ensureKBDir() {
  if (!fs.existsSync(KB_DIR)) fs.mkdirSync(KB_DIR, { recursive: true });
}

function kbPath(type) {
  return path.join(KB_DIR, `kb_${type}.txt`);
}

function initKBFromJS(type) {
  const jsFile = `./kb_${type}.js`;
  if (!fs.existsSync(jsFile)) return '';
  const src = fs.readFileSync(jsFile, 'utf8');
  const m = src.match(/const KB_\w+ = `([\s\S]*?)`;/);
  return m ? m[1] : '';
}

function readKB(type) {
  ensureKBDir();
  const p = kbPath(type);
  if (fs.existsSync(p)) return fs.readFileSync(p, 'utf8');
  const content = initKBFromJS(type);
  fs.writeFileSync(p, content, 'utf8');
  return content;
}

function writeKB(type, content) {
  ensureKBDir();
  fs.writeFileSync(kbPath(type), content, 'utf8');
}

function serveStatic(res, filePath) {
  const ext = path.extname(filePath);
  const mime = MIME[ext] || 'text/plain; charset=utf-8';
  fs.readFile(filePath, (err, data) => {
    if (err) { res.writeHead(404); res.end('Not found'); return; }
    res.writeHead(200, { 'Content-Type': mime });
    res.end(data);
  });
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => resolve(body));
    req.on('error', reject);
  });
}

function proxyDeepSeek(req, res, body) {
  if (!DEEPSEEK_API_KEY) {
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'DEEPSEEK_API_KEY not configured' }));
    return;
  }
  const options = {
    hostname: 'api.deepseek.com',
    path: '/v1/chat/completions',
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${DEEPSEEK_API_KEY}`,
      'Content-Length': Buffer.byteLength(body),
    },
  };
  const proxyReq = https.request(options, proxyRes => {
    res.writeHead(proxyRes.statusCode, {
      'Content-Type': proxyRes.headers['content-type'] || 'application/json',
      'Access-Control-Allow-Origin': '*',
      'Cache-Control': 'no-cache',
      'X-Accel-Buffering': 'no',
    });
    proxyRes.pipe(res);
  });
  proxyReq.on('error', err => {
    res.writeHead(502, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: err.message }));
  });
  proxyReq.write(body);
  proxyReq.end();
}

const server = http.createServer(async (req, res) => {
  const url = req.url.split('?')[0];

  if (req.method === 'OPTIONS') {
    res.writeHead(204, { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Content-Type' });
    res.end();
    return;
  }

  // POST /api/chat — DeepSeek 代理
  if (req.method === 'POST' && url === '/api/chat') {
    const body = await readBody(req);
    proxyDeepSeek(req, res, body);
    return;
  }

  // GET /api/kb/:type — 读知识库
  const kbGetMatch = url.match(/^\/api\/kb\/(aigc|digital)$/);
  if (req.method === 'GET' && kbGetMatch) {
    const type = kbGetMatch[1];
    try {
      const content = readKB(type);
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ content }));
    } catch (e) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: e.message }));
    }
    return;
  }

  // POST /api/kb/:type — 写知识库
  const kbPostMatch = url.match(/^\/api\/kb\/(aigc|digital)$/);
  if (req.method === 'POST' && kbPostMatch) {
    const type = kbPostMatch[1];
    try {
      const body = await readBody(req);
      const { content } = JSON.parse(body);
      if (typeof content !== 'string') throw new Error('content must be string');
      writeKB(type, content);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true }));
    } catch (e) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: e.message }));
    }
    return;
  }

  // 静态文件
  let filePath = '.' + url;
  if (filePath === './') filePath = './index.html';
  serveStatic(res, filePath);
});

server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  ensureKBDir();
});
