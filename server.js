/**
 * 本地代理服务
 * 转发豆包 ASR/TTS WebSocket 请求，处理鉴权
 */

import { WebSocketServer, WebSocket } from 'ws';
import http from 'http';
import fsPromises from 'fs/promises';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ENV_PATH = path.join(__dirname, '.env.local');

// 加载环境变量（优先 .env.local）
const envPath = path.join(__dirname, '.env.local');
if (fs.existsSync(envPath)) {
  dotenv.config({ path: envPath });
} else {
  dotenv.config();
}

const DEFAULT_PORT = 3001;
const PORT = parseInt(process.env.PORT || '', 10) || DEFAULT_PORT;

// 豆包 WebSocket 地址
const VOLC_ASR_WS_URL = 'wss://openspeech.bytedance.com/api/v3/sauc/bigmodel_async';
const VOLC_TTS_WS_URL = 'wss://openspeech.bytedance.com/api/v3/tts/bidirection';

// 允许的 QWEN 模型
const ALLOWED_QWEN_MODELS = new Set(['qwen-max', 'qwen-plus', 'qwen-turbo', 'qwen3.6-max-preview', 'qwen3.6-plus', 'qwen3.6-flash']);

// 默认配置
const DEFAULT_CONFIG = {
  qwenApiKey: '',
  qwenModel: 'qwen-max',
  volcAppKey: '',
  volcAccessKey: '',
  volcApiKey: '',
  volcResourceId: 'volc.seedasr.sauc.duration',
  volcTtsResourceId: 'seed-tts-2.0',
  volcTtsVoice: 'zh_female_vv_uranus_bigtts',
  volcProxyUrl: `ws://localhost:${PORT}/proxy`
};

// 存储 WebSocket 连接
const clientConnections = new Map();

function buildVolcHeaders(config, connectId) {
  return {
    'X-Api-App-Key': config.appKey,
    'X-Api-Access-Key': config.accessKey,
    'X-Api-Resource-Id': config.resourceId,
    'X-Api-Connect-Id': connectId
  };
}

/**
 * 检查来源是否允许
 */
function isAllowedOrigin(origin) {
  if (!origin) return true;
  try {
    const url = new URL(origin);
    return ['localhost', '127.0.0.1'].includes(url.hostname);
  } catch {
    return false;
  }
}

/**
 * 应用 CORS 头
 */
function applyCorsHeaders(req, res) {
  const origin = req.headers.origin;
  if (origin && isAllowedOrigin(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
  }
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

/**
 * 发送 JSON 响应
 */
function sendJson(req, res, statusCode, payload) {
  applyCorsHeaders(req, res);
  res.writeHead(statusCode, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(payload));
}

/**
 * 读取请求体
 */
async function readRequestBody(req) {
  let body = '';
  for await (const chunk of req) {
    body += chunk.toString();
  }
  return body ? JSON.parse(body) : {};
}

/**
 * 规范化环境变量值
 */
function normalizeEnvValue(value) {
  const normalized = String(value ?? '').trim();
  if (!normalized) return '';
  if ((normalized.startsWith('"') && normalized.endsWith('"')) ||
      (normalized.startsWith("'") && normalized.endsWith("'"))) {
    return normalized.slice(1, -1);
  }
  return normalized;
}

/**
 * 读取 .env 文件
 */
async function readEnvFile() {
  try {
    return await fsPromises.readFile(ENV_PATH, 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT') return '';
    throw error;
  }
}

/**
 * 将.env 内容映射到配置对象
 */
function mapEnvToConfig(envText) {
  const config = { ...DEFAULT_CONFIG };
  const lines = envText.split(/\r?\n/);

  for (const line of lines) {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!match) continue;

    const [, key, rawValue] = match;
    const value = normalizeEnvValue(rawValue);

    switch (key) {
      case 'VITE_ALYUN_API_KEY':
      case 'VITE_DASHSCOPE_API_KEY':
      case 'VITE_DASHSCOPE_KEY':
        if (!config.qwenApiKey) config.qwenApiKey = value;
        break;
      case 'VITE_QWEN_MODEL':
        config.qwenModel = value;
        break;
      case 'VITE_VOLC_APP_ID':
      case 'VITE_VOLC_APP_KEY':
        config.volcAppKey = value;
        break;
      case 'VITE_VOLC_ACCESS_TOKEN':
      case 'VITE_VOLC_ACCESS_KEY':
        config.volcAccessKey = value;
        break;
      case 'VITE_VOLC_API_KEY':
      case 'VITE_VOLC_SECRET_KEY':
        config.volcApiKey = value;
        break;
      case 'VITE_VOLC_RESOURCE_ID':
        config.volcResourceId = value;
        break;
      case 'VITE_VOLC_TTS_RESOURCE_ID':
        config.volcTtsResourceId = value;
        break;
      case 'VITE_VOLC_TTS_VOICE':
        config.volcTtsVoice = value;
        break;
      case 'VITE_VOLC_PROXY_URL':
        config.volcProxyUrl = value;
        break;
    }
  }

  return config;
}

/**
 * 配置请求处理
 */
async function handleConfigRequest(req, res) {
  if (req.method === 'GET') {
    const envText = await readEnvFile();
    sendJson(req, res, 200, { config: mapEnvToConfig(envText) });
    return;
  }

  if (req.method === 'POST') {
    const requestBody = await readRequestBody(req);
    const config = requestBody.config || {};

    // 验证模型
    if (config.qwenModel && !ALLOWED_QWEN_MODELS.has(config.qwenModel)) {
      sendJson(req, res, 400, { error: '不支持的 QWEN 模型' });
      return;
    }

    // 读取当前.env 内容
    let envText = await readEnvFile();
    let lines = envText ? envText.split(/\r?\n/) : [];

    // 更新或添加环境变量
    const envUpdates = {
      'VITE_ALYUN_API_KEY': config.qwenApiKey,
      'VITE_DASHSCOPE_KEY': config.qwenApiKey,
      'VITE_QWEN_MODEL': config.qwenModel,
      'VITE_VOLC_APP_ID': config.volcAppKey,
      'VITE_VOLC_APP_KEY': config.volcAppKey,
      'VITE_VOLC_ACCESS_TOKEN': config.volcAccessKey,
      'VITE_VOLC_ACCESS_KEY': config.volcAccessKey,
      'VITE_VOLC_SECRET_KEY': config.volcApiKey,
      'VITE_VOLC_API_KEY': config.volcApiKey,
      'VITE_VOLC_RESOURCE_ID': config.volcResourceId,
      'VITE_VOLC_TTS_RESOURCE_ID': config.volcTtsResourceId,
      'VITE_VOLC_TTS_VOICE': config.volcTtsVoice,
      'VITE_VOLC_PROXY_URL': config.volcProxyUrl
    };

    for (const [key, value] of Object.entries(envUpdates)) {
      const newValue = `${key}=${String(value ?? '').replace(/\r?\n/g, ' ').trim()}`;
      const existingIndex = lines.findIndex(line => line.match(new RegExp(`^\\s*${key}\\s*=`)));

      if (existingIndex >= 0) {
        lines[existingIndex] = newValue;
      } else if (value) {
        lines.push(newValue);
      }
    }

    // 写回文件
    const newEnvText = lines.join('\n').replace(/\n{3,}/g, '\n\n');
    await fsPromises.writeFile(ENV_PATH, newEnvText.endsWith('\n') ? newEnvText : newEnvText + '\n', 'utf8');

    sendJson(req, res, 200, { config: mapEnvToConfig(newEnvText) });
    return;
  }

  sendJson(req, res, 405, { error: 'Method not allowed' });
}

/**
 * 创建 HTTP 服务器
 */
const server = http.createServer(async (req, res) => {
  const requestUrl = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);

  // OPTIONS 预检请求
  if (req.method === 'OPTIONS') {
    applyCorsHeaders(req, res);
    res.writeHead(204);
    res.end();
    return;
  }

  // /config 路由
  if (requestUrl.pathname === '/config' || requestUrl.pathname === '/api/config') {
    if (!isAllowedOrigin(req.headers.origin)) {
      sendJson(req, res, 403, { error: 'Origin not allowed' });
      return;
    }
    try {
      await handleConfigRequest(req, res);
    } catch (error) {
      console.error('[Config] 错误:', error);
      sendJson(req, res, 500, { error: error.message || '配置请求失败' });
    }
    return;
  }

  // 静态文件服务
  if (req.method === 'GET') {
    let pathname = requestUrl.pathname;
    if (pathname === '/') pathname = '/index.html';

    const relativePath = pathname.startsWith('/') ? pathname.slice(1) : pathname;
    const filePath = path.join(__dirname, relativePath);

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
      const content = await fsPromises.readFile(filePath);
      res.writeHead(200, { 'Content-Type': contentType });
      res.end(content);
    } catch (error) {
      if (error.code === 'ENOENT') {
        res.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(`<h1>404 - 文件未找到</h1><p>请求路径：${requestUrl.pathname}</p>`);
      } else {
        res.writeHead(500, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(`<h1>服务器错误</h1><p>${error.message}</p>`);
      }
    }
    return;
  }

  res.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end('<h1>404 - 未找到</h1>');
});

/**
 * 创建 WebSocket 服务器
 */
const wss = new WebSocketServer({
  server,
  path: '/proxy'
});

wss.on('connection', (clientWs, req) => {
  const clientId = `${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
  console.log(`[WebSocket] 客户端 ${clientId} 已连接`);

  let upstreamWs = null;
  let messageBuffer = []; // 缓冲消息，直到上游连接就绪

  const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
  const volcAppKey = url.searchParams.get('app_key');
  const volcAccessKey = url.searchParams.get('access_key');
  const volcResourceId = url.searchParams.get('resource_id') || DEFAULT_CONFIG.volcResourceId;
  const volcConnectId = url.searchParams.get('connect_id') || `${Date.now()}-${Math.random().toString(36).substring(2, 15)}`;

  if (!volcAppKey || !volcAccessKey) {
    console.error('[WebSocket] 缺少 ASR 鉴权');
    clientWs.close(4001, 'Missing ASR auth');
    return;
  }

  const asrUrl = `${VOLC_ASR_WS_URL}?connect_id=${encodeURIComponent(volcConnectId)}`;
  const headers = buildVolcHeaders({
    appKey: volcAppKey,
    accessKey: volcAccessKey,
    resourceId: volcResourceId
  }, volcConnectId);

  console.log(`[WebSocket] 连接到豆包 ASR: ${asrUrl}`);

  upstreamWs = new WebSocket(asrUrl, { headers });

  upstreamWs.binaryType = 'arraybuffer';

  upstreamWs.on('open', () => {
    console.log(`[WebSocket] 豆包 ASR 已连接`);
    // 发送缓冲的消息
    for (const msg of messageBuffer) {
      upstreamWs.send(msg);
    }
    messageBuffer = [];
  });

  upstreamWs.on('message', (upstreamData) => {
    if (clientWs.readyState === WebSocket.OPEN) {
      clientWs.send(upstreamData);
    }
  });

  upstreamWs.on('error', (error) => {
    console.error(`[WebSocket] 豆包 ASR 错误:`, error);
  });

  upstreamWs.on('close', () => {
    console.log(`[WebSocket] 豆包 ASR 连接关闭`);
    if (clientWs.readyState === WebSocket.OPEN) {
      clientWs.close();
    }
  });

  // 处理客户端消息 - 缓冲或转发到上游
  clientWs.on('message', async (data) => {
    try {
      if (upstreamWs && upstreamWs.readyState === WebSocket.OPEN) {
        upstreamWs.send(data);
      } else {
        // 上游未就绪，缓冲消息
        messageBuffer.push(data);
        console.log(`[WebSocket] 上游未就绪，缓冲消息 (${data.byteLength} bytes)`);
      }
    } catch (error) {
      console.error(`[WebSocket] 消息处理错误:`, error);
    }
  });

  clientWs.on('close', () => {
    console.log(`[WebSocket] 客户端 ${clientId} 断开`);
    if (upstreamWs) {
      upstreamWs.close();
      upstreamWs = null;
    }
  });

  clientWs.on('error', (error) => {
    console.error(`[WebSocket] 客户端 ${clientId} 错误:`, error);
  });
});

// 启动服务器
server.listen(PORT, () => {
  console.log('==========================================');
  console.log(`本地代理服务已启动`);
  console.log(`HTTP: http://localhost:${PORT}`);
  console.log(`WebSocket: ws://localhost:${PORT}/proxy`);
  console.log('==========================================');
});

// 优雅关闭
process.on('SIGINT', () => {
  console.log('\n正在关闭服务器...');
  wss.clients.forEach(client => client.close());
  server.close(() => {
    console.log('服务器已关闭');
    process.exit(0);
  });
});
