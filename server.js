import { WebSocketServer, WebSocket } from 'ws';
import http from 'http';
import crypto from 'crypto';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const DEFAULT_PORT = 3001;
const PORT = Number.parseInt(process.env.PORT || '', 10) || DEFAULT_PORT;
const VOLC_ASR_WS_URL = 'wss://openspeech.bytedance.com/api/v3/sauc/bigmodel_async';
const VOLC_TTS_WS_URL = 'wss://openspeech.bytedance.com/api/v3/tts/bidirection';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ENV_PATH = path.join(__dirname, '.env');
const ALLOWED_QWEN_MODELS = new Set(['qwen3.6-max-preview', 'qwen3.6-plus', 'qwen3.6-flash']);
const DEFAULT_LOCAL_CONFIG = {
  qwenApiKey: '',
  qwenModel: 'qwen3.6-max-preview',
  volcAppId: '',
  volcAccessToken: '',
  volcApiKey: '',
  volcResourceId: 'volc.bigasr.sauc.duration',
  volcTtsResourceId: 'seed-tts-2.0',
  volcProxyUrl: `ws://localhost:${PORT}/proxy`
};
const LOCAL_CONFIG_FIELDS = [
  { responseKey: 'qwenApiKey', envKey: 'VITE_ALYUN_API_KEY' },
  { responseKey: 'qwenModel', envKey: 'VITE_QWEN_MODEL' },
  { responseKey: 'volcAppId', envKey: 'VITE_VOLC_APP_ID' },
  { responseKey: 'volcAccessToken', envKey: 'VITE_VOLC_ACCESS_TOKEN' },
  { responseKey: 'volcApiKey', envKey: 'VITE_VOLC_API_KEY' },
  { responseKey: 'volcResourceId', envKey: 'VITE_VOLC_RESOURCE_ID' },
  { responseKey: 'volcTtsResourceId', envKey: 'VITE_VOLC_TTS_RESOURCE_ID' },
  { responseKey: 'volcProxyUrl', envKey: 'VITE_VOLC_PROXY_URL' }
];

function buildHeaders(config, connectId) {
  const headers = {
    'X-Api-App-Key': config.appId,
    'X-Api-Access-Key': config.accessToken,
    'X-Api-Resource-Id': config.resourceId,
    'X-Api-Connect-Id': connectId
  };

  return headers;
}

function isAllowedOrigin(origin) {
  if (!origin) {
    return true;
  }

  try {
    const url = new URL(origin);
    return ['localhost', '127.0.0.1'].includes(url.hostname);
  } catch {
    return false;
  }
}

function applyCorsHeaders(req, res) {
  const origin = req.headers.origin;
  if (origin && isAllowedOrigin(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
  }
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

function sendJson(req, res, statusCode, payload) {
  applyCorsHeaders(req, res);
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8'
  });
  res.end(JSON.stringify(payload));
}

async function readRequestJson(req) {
  let body = '';

  for await (const chunk of req) {
    body += chunk.toString();
  }

  if (!body) {
    return {};
  }

  return JSON.parse(body);
}

function normalizeEnvValue(value) {
  const normalized = String(value ?? '').trim();
  if (!normalized) {
    return '';
  }

  if (
    (normalized.startsWith('"') && normalized.endsWith('"')) ||
    (normalized.startsWith("'") && normalized.endsWith("'"))
  ) {
    return normalized.slice(1, -1);
  }

  return normalized;
}

async function readEnvFile() {
  try {
    return await fs.readFile(ENV_PATH, 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT') {
      return '';
    }
    throw error;
  }
}

function mapEnvToConfig(envText) {
  const config = { ...DEFAULT_LOCAL_CONFIG };
  const lines = envText.split(/\r?\n/);

  for (const line of lines) {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!match) {
      continue;
    }

    const [, key, rawValue] = match;
    const field = LOCAL_CONFIG_FIELDS.find((item) => item.envKey === key);
    if (field) {
      config[field.responseKey] = normalizeEnvValue(rawValue);
      continue;
    }

    if (key === 'VITE_DASHSCOPE_API_KEY' && !config.qwenApiKey) {
      config.qwenApiKey = normalizeEnvValue(rawValue);
    }
  }

  return config;
}

function sanitizeLocalConfig(payload = {}) {
  const config = { ...DEFAULT_LOCAL_CONFIG };

  for (const field of LOCAL_CONFIG_FIELDS) {
    const value = payload[field.responseKey];
    if (typeof value === 'string') {
      config[field.responseKey] = value.trim();
    } else if (value != null) {
      config[field.responseKey] = String(value).trim();
    }
  }

  if (!config.qwenModel) {
    config.qwenModel = DEFAULT_LOCAL_CONFIG.qwenModel;
  }
  if (!config.volcResourceId) {
    config.volcResourceId = DEFAULT_LOCAL_CONFIG.volcResourceId;
  }
  if (!config.volcTtsResourceId) {
    config.volcTtsResourceId = DEFAULT_LOCAL_CONFIG.volcTtsResourceId;
  }
  if (!config.volcProxyUrl) {
    config.volcProxyUrl = DEFAULT_LOCAL_CONFIG.volcProxyUrl;
  }

  if (!ALLOWED_QWEN_MODELS.has(config.qwenModel)) {
    throw new Error('不支持的 QWEN 模型');
  }

  return config;
}

function formatEnvValue(value) {
  return String(value ?? '').replace(/\r?\n/g, ' ').trim();
}

function upsertEnvValue(lines, key, value) {
  const nextValue = formatEnvValue(value);
  const replacement = `${key}=${nextValue}`;
  let found = false;

  const updatedLines = lines.map((line) => {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!match || match[1] !== key) {
      return line;
    }

    found = true;
    return replacement;
  });

  if (!found) {
    updatedLines.push(replacement);
  }

  return updatedLines;
}

function mergeEnvConfig(envText, config) {
  let lines = envText ? envText.split(/\r?\n/) : [];

  lines = upsertEnvValue(lines, 'VITE_ALYUN_API_KEY', config.qwenApiKey);
  lines = upsertEnvValue(lines, 'VITE_DASHSCOPE_API_KEY', config.qwenApiKey);
  lines = upsertEnvValue(lines, 'VITE_QWEN_MODEL', config.qwenModel);
  lines = upsertEnvValue(lines, 'VITE_VOLC_APP_ID', config.volcAppId);
  lines = upsertEnvValue(lines, 'VITE_VOLC_ACCESS_TOKEN', config.volcAccessToken);
  lines = upsertEnvValue(lines, 'VITE_VOLC_API_KEY', config.volcApiKey);
  lines = upsertEnvValue(lines, 'VITE_VOLC_RESOURCE_ID', config.volcResourceId);
  lines = upsertEnvValue(lines, 'VITE_VOLC_TTS_RESOURCE_ID', config.volcTtsResourceId);
  lines = upsertEnvValue(lines, 'VITE_VOLC_PROXY_URL', config.volcProxyUrl);

  const nextText = lines.join('\n').replace(/\n{3,}/g, '\n\n');
  return nextText.endsWith('\n') ? nextText : `${nextText}\n`;
}

async function handleConfigRequest(req, res) {
  if (req.method === 'GET') {
    const envText = await readEnvFile();
    sendJson(req, res, 200, { config: mapEnvToConfig(envText) });
    return;
  }

  if (req.method === 'POST') {
    const requestBody = await readRequestJson(req);
    const config = sanitizeLocalConfig(requestBody);
    const envText = await readEnvFile();
    const nextEnvText = mergeEnvConfig(envText, config);
    await fs.writeFile(ENV_PATH, nextEnvText, 'utf8');
    sendJson(req, res, 200, { config: mapEnvToConfig(nextEnvText) });
    return;
  }

  sendJson(req, res, 405, { error: 'Method not allowed' });
}

const server = http.createServer(async (req, res) => {
  const requestUrl = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);

  if (req.method === 'OPTIONS') {
    applyCorsHeaders(req, res);
    res.writeHead(204);
    res.end();
    return;
  }

  if (requestUrl.pathname === '/config') {
    if (!isAllowedOrigin(req.headers.origin)) {
      sendJson(req, res, 403, { error: 'Origin not allowed' });
      return;
    }

    try {
      await handleConfigRequest(req, res);
    } catch (error) {
      console.error('[Config] Request error:', error);
      sendJson(req, res, 500, { error: error.message || '配置请求失败' });
    }
    return;
  }

  // Serve static files
  if (req.method === 'GET') {
    let pathname = requestUrl.pathname;
    if (pathname === '/') {
      pathname = '/index.html';
    }
    // Remove leading slash for path join
    const relativePath = pathname.startsWith('/') ? pathname.slice(1) : pathname;
    const filePath = path.join(__dirname, relativePath);
    console.log(`[Static] Request: ${requestUrl.pathname} -> ${relativePath} -> ${filePath}`);

    const extname = path.extname(filePath).toLowerCase();
    const mimeTypes = {
      '.html': 'text/html; charset=utf-8',
      '.js': 'application/javascript; charset=utf-8',
      '.css': 'text/css; charset=utf-8',
      '.json': 'application/json; charset=utf-8',
      '.png': 'image/png',
      '.jpg': 'image/jpeg',
      '.svg': 'image/svg+xml',
      '.ico': 'image/x-icon'
    };

    const contentType = mimeTypes[extname] || 'application/octet-stream';

    try {
      const content = await fs.readFile(filePath);
      res.writeHead(200, { 'Content-Type': contentType });
      res.end(content);
      return;
    } catch (error) {
      if (error.code === 'ENOENT') {
        console.error(`[Static] 404 Not Found: ${filePath}`);
        console.error(`[Static] Requested URL: ${requestUrl.pathname}`);
        console.error(`[Static] __dirname: ${__dirname}`);
        res.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(`<h1>404 - 文件未找到</h1><p>请求路径：${requestUrl.pathname}</p>`);
        return;
      }
      res.writeHead(500, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(`<h1>500 - 服务器错误</h1><p>${error.message}</p>`);
      return;
    }
  }

  res.writeHead(405, {
    'Content-Type': 'application/json; charset=utf-8'
  });
  res.end(JSON.stringify({ error: 'Method not allowed' }));
});

const wss = new WebSocketServer({ server, path: '/proxy' });

wss.on('connection', (clientWs) => {
  console.log('[Proxy] Client connected');

  let volcWs = null;
  let serviceType = null;

  clientWs.on('message', (data) => {
    if (!volcWs) {
      try {
        const config = JSON.parse(data.toString());
        serviceType = config.serviceType || 'asr';
        const connectId = crypto.randomUUID();
        const targetUrl = serviceType === 'tts' ? VOLC_TTS_WS_URL : VOLC_ASR_WS_URL;

        console.log(`[Proxy] Connecting to Volcengine ${serviceType.toUpperCase()}:`, {
          appId: config.appId,
          hasApiKey: Boolean(config.apiKey),
          resourceId: config.resourceId
        });

        const headers = buildHeaders(config, connectId);
        const logHeaders = {
          ...headers,
          'X-Api-Key': headers['X-Api-Key'] ? '[redacted]' : undefined,
          'X-Api-Access-Token': headers['X-Api-Access-Token'] ? '[redacted]' : undefined
        };

        volcWs = new WebSocket(targetUrl, [], {
          headers
        });

        volcWs.on('unexpected-response', async (_, response) => {
          let responseBody = '';
          try {
            for await (const chunk of response) {
              responseBody += chunk.toString();
            }
          } catch {
          }

          const details = {
            statusCode: response.statusCode,
            statusMessage: response.statusMessage,
            headers: response.headers,
            body: responseBody.trim(),
            requestHeaders: logHeaders,
            targetUrl,
            resourceId: config.resourceId,
            hasApiKey: Boolean(config.apiKey),
            hasAppId: Boolean(config.appId),
            hasAccessToken: Boolean(config.accessToken)
          };

          console.error(`[Proxy] Volcengine ${serviceType.toUpperCase()} unexpected response:`, details);
          if (clientWs.readyState === WebSocket.OPEN) {
            clientWs.send(JSON.stringify({
              type: 'error',
              message: `Volcengine ${serviceType.toUpperCase()} ${response.statusCode || ''} ${response.statusMessage || ''}`.trim(),
              details
            }));
          }
        });

        volcWs.on('open', () => {
          console.log(`[Proxy] Connected to Volcengine ${serviceType.toUpperCase()}`);
          clientWs.send(JSON.stringify({ type: 'connected', serviceType }));
        });

        volcWs.on('message', (upstreamData) => {
          clientWs.send(upstreamData);
        });

        volcWs.on('close', (code, reason) => {
          console.log(`[Proxy] Volcengine ${serviceType.toUpperCase()} connection closed`, {
            code,
            reason: reason?.toString?.() || ''
          });
          if (clientWs.readyState === WebSocket.OPEN) {
            clientWs.close();
          }
        });

        volcWs.on('error', (err) => {
          const details = {
            targetUrl,
            resourceId: config.resourceId,
            hasApiKey: Boolean(config.apiKey),
            hasAppId: Boolean(config.appId),
            hasAccessToken: Boolean(config.accessToken),
            requestHeaders: logHeaders
          };
          console.error(`[Proxy] Volcengine ${serviceType.toUpperCase()} error:`, err, details);
          if (clientWs.readyState === WebSocket.OPEN) {
            clientWs.send(JSON.stringify({ type: 'error', message: err.message, details }));
          }
        });

        return;
      } catch (err) {
        console.error('[Proxy] Parse config error:', err);
        if (clientWs.readyState === WebSocket.OPEN) {
          clientWs.send(JSON.stringify({ type: 'error', message: err.message }));
        }
      }
      return;
    }

    if (volcWs.readyState === WebSocket.OPEN) {
      volcWs.send(data);
    }
  });

  clientWs.on('close', () => {
    console.log('[Proxy] Client disconnected');
    if (volcWs && volcWs.readyState < WebSocket.CLOSING) {
      volcWs.close();
    }
  });

  clientWs.on('error', (err) => {
    console.error('[Proxy] Client error:', err);
    if (volcWs && volcWs.readyState < WebSocket.CLOSING) {
      volcWs.close();
    }
  });
});

server.on('error', (error) => {
  if (error.code === 'EADDRINUSE') {
    console.error(`[Proxy] Port ${PORT} is already in use. Stop the existing process or restart with PORT=<new-port> npm run server`);
    process.exit(1);
  }

  if (error.code === 'EACCES') {
    console.error(`[Proxy] Port ${PORT} requires elevated privileges. Restart with a different port, for example PORT=3002 npm run server`);
    process.exit(1);
  }

  console.error('[Proxy] Server failed to start:', error);
  process.exit(1);
});

server.listen(PORT, () => {
  console.log(`[Proxy] Server running on ws://localhost:${PORT}/proxy`);
  console.log(`[Config] Server running on http://localhost:${PORT}/config`);
});
