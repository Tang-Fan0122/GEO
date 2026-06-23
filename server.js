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

function appendKB(type, extra) {
  const current = readKB(type);
  const sep = '\n\n---\n\n';
  writeKB(type, current + sep + extra);
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
    const chunks = [];
    req.on('data', chunk => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

// 解析 multipart/form-data，提取 type 字段和 file 内容
function parseMultipart(buffer, boundary) {
  const boundaryBuf = Buffer.from('--' + boundary);
  const result = { type: null, filename: null, fileContent: null };
  const parts = [];
  let start = 0;

  while (start < buffer.length) {
    const idx = buffer.indexOf(boundaryBuf, start);
    if (idx === -1) break;
    const end = buffer.indexOf(boundaryBuf, idx + boundaryBuf.length);
    if (end === -1) { parts.push(buffer.slice(idx + boundaryBuf.length + 2)); break; }
    parts.push(buffer.slice(idx + boundaryBuf.length + 2, end - 2));
    start = end;
  }

  for (const part of parts) {
    const headerEnd = part.indexOf('\r\n\r\n');
    if (headerEnd === -1) continue;
    const header = part.slice(0, headerEnd).toString();
    const body   = part.slice(headerEnd + 4);

    const nameMatch = header.match(/name="([^"]+)"/);
    const fileMatch = header.match(/filename="([^"]+)"/);
    if (!nameMatch) continue;

    if (nameMatch[1] === 'type' && !fileMatch) {
      result.type = body.toString().trim();
    }
    if (nameMatch[1] === 'file' && fileMatch) {
      result.filename    = fileMatch[1];
      result.fileContent = body;
    }
  }
  return result;
}

function proxyDeepSeek(req, res, body) {
  if (!DEEPSEEK_API_KEY) {
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'DEEPSEEK_API_KEY not configured' }));
    return;
  }
  const bodyStr = typeof body === 'string' ? body : body.toString();
  const options = {
    hostname: 'api.deepseek.com',
    path: '/v1/chat/completions',
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${DEEPSEEK_API_KEY}`,
      'Content-Length': Buffer.byteLength(bodyStr),
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
  proxyReq.write(bodyStr);
  proxyReq.end();
}

const server = http.createServer(async (req, res) => {
  const url = req.url.split('?')[0];

  if (req.method === 'OPTIONS') {
    res.writeHead(204, { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Content-Type' });
    res.end();
    return;
  }

  // POST /api/chat
  if (req.method === 'POST' && url === '/api/chat') {
    const body = await readBody(req);
    proxyDeepSeek(req, res, body);
    return;
  }

  // GET /api/kb/:type
  const kbGetMatch = url.match(/^\/api\/kb\/(aigc|digital)$/);
  if (req.method === 'GET' && kbGetMatch) {
    try {
      const content = readKB(kbGetMatch[1]);
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ content }));
    } catch (e) {
      res.writeHead(500); res.end(JSON.stringify({ error: e.message }));
    }
    return;
  }

  // POST /api/kb/:type  (全量保存)
  const kbPostMatch = url.match(/^\/api\/kb\/(aigc|digital)$/);
  if (req.method === 'POST' && kbPostMatch) {
    try {
      const body = (await readBody(req)).toString();
      const { content } = JSON.parse(body);
      if (typeof content !== 'string') throw new Error('content must be string');
      writeKB(kbPostMatch[1], content);
      res.writeHead(200); res.end(JSON.stringify({ ok: true }));
    } catch (e) {
      res.writeHead(400); res.end(JSON.stringify({ error: e.message }));
    }
    return;
  }

  // POST /api/kb/:type/upload  (文件追加)
  const uploadMatch = url.match(/^\/api\/kb\/(aigc|digital)\/upload$/);
  if (req.method === 'POST' && uploadMatch) {
    try {
      const type = uploadMatch[1];
      const ct   = req.headers['content-type'] || '';
      const bm   = ct.match(/boundary=(.+)$/);
      if (!bm) throw new Error('Missing boundary');

      const buf    = await readBody(req);
      const parsed = parseMultipart(buf, bm[1].trim());
      if (!parsed.fileContent) throw new Error('No file received');

      const ext      = path.extname(parsed.filename || '').toLowerCase();
      let   textContent = '';

      if (ext === '.txt' || ext === '.md' || ext === '') {
        textContent = parsed.fileContent.toString('utf8');
      } else if (ext === '.docx') {
        // 用 mammoth 提取 docx 文本（如已安装）
        try {
          const mammoth = require('mammoth');
          const result  = await mammoth.extractRawText({ buffer: parsed.fileContent });
          textContent   = result.value;
        } catch {
          throw new Error('请安装 mammoth：npm install mammoth，或上传 .txt/.md 格式');
        }
      } else {
        throw new Error(`不支持的文件格式：${ext}，请上传 .txt .md .docx`);
      }

      const header = `\n## 上传文件：${parsed.filename}（${new Date().toLocaleString('zh-CN')}）\n\n`;
      appendKB(type, header + textContent.trim());

      res.writeHead(200); res.end(JSON.stringify({ ok: true, chars: textContent.length }));
    } catch (e) {
      res.writeHead(400); res.end(JSON.stringify({ error: e.message }));
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
