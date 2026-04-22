/**
 * 豆包 TTS WebSocket 客户端
 * 基于火山引擎 V3 双向流式 API
 */

// 协议常量
const PROTOCOL_VERSION = 0b0001;
const HEADER_SIZE = 0b0001;

// Message Types
const MSG_FULL_CLIENT_REQUEST = 0b0001;
const MSG_AUDIO_ONLY_REQUEST = 0b0010;
const MSG_FULL_SERVER_RESPONSE = 0b1001;
const MSG_AUDIO_ONLY_RESPONSE = 0b1011;
const MSG_SERVER_ERROR = 0b1111;

// Serialization & Compression
const SER_JSON = 0b0001;
const SER_RAW = 0b0000;
const COMP_NONE = 0b0000;

// Flags
const FLAG_WITH_SEQUENCE = 0b0001;
const FLAG_LAST_NO_SEQ = 0b0010;
const FLAG_LAST_WITH_SEQ = 0b0011;

// Events
const EVT_START_CONNECTION = 1;
const EVT_FINISH_CONNECTION = 2;
const EVT_CONNECTION_STARTED = 50;
const EVT_START_SESSION = 100;
const EVT_FINISH_SESSION = 102;
const EVT_SESSION_STARTED = 150;
const EVT_SESSION_FINISHED = 152;
const EVT_TASK_REQUEST = 200;

const ERR_SUCCESS = 20000000;

function buildHeader(type, flags = 0, ser = SER_JSON, comp = COMP_NONE) {
  const buf = new ArrayBuffer(4);
  const v = new DataView(buf);
  v.setUint8(0, (PROTOCOL_VERSION << 4) | HEADER_SIZE);
  v.setUint8(1, (type << 4) | (flags & 0x0F));
  v.setUint8(2, ((ser & 0x0F) << 4) | (comp & 0x0F));
  v.setUint8(3, 0);
  return buf;
}

function buildFrame(type, payload, flags = 0) {
  const payloadBytes = typeof payload === 'string' ? new TextEncoder().encode(payload) : new Uint8Array(payload);
  const header = buildHeader(type, flags);
  const sizeBuf = new ArrayBuffer(4);
  new DataView(sizeBuf).setUint32(0, payloadBytes.length, false);

  const total = header.byteLength + sizeBuf.byteLength + payloadBytes.length;
  const buf = new ArrayBuffer(total);
  const bytes = new Uint8Array(buf);

  bytes.set(new Uint8Array(header), 0);
  bytes.set(new Uint8Array(sizeBuf), header.byteLength);
  bytes.set(payloadBytes, header.byteLength + sizeBuf.byteLength);

  return buf;
}

function parseFrame(buffer) {
  const view = new DataView(buffer);
  let offset = 0;

  if (buffer.byteLength < 4) return null;

  const byte0 = view.getUint8(offset++);
  const protocolVersion = (byte0 >> 4) & 0x0F;
  const headerSize = byte0 & 0x0F;

  const byte1 = view.getUint8(offset++);
  const messageType = (byte1 >> 4) & 0x0F;
  const messageFlags = byte1 & 0x0F;

  const byte2 = view.getUint8(offset++);
  const serialization = (byte2 >> 4) & 0x0F;
  const compression = byte2 & 0x0F;

  offset = headerSize * 4;

  let payloadSize = 0;
  let sequenceId = 0;
  let payloadOffset = offset;
  let errorCode = null;

  if (messageType === MSG_SERVER_ERROR) {
    errorCode = view.getUint32(offset);
    offset += 4;
    payloadSize = view.getUint32(offset);
    offset += 4;
    payloadOffset = offset;
  } else if (messageType === MSG_FULL_SERVER_RESPONSE || messageType === MSG_AUDIO_ONLY_RESPONSE) {
    const hasSeq = messageFlags === FLAG_WITH_SEQUENCE || messageFlags === FLAG_LAST_WITH_SEQ;
    if (hasSeq) {
      sequenceId = view.getInt32(offset);
      offset += 4;
    }
    payloadSize = view.getUint32(offset);
    offset += 4;
    payloadOffset = offset;
  } else if (messageType === MSG_AUDIO_ONLY_REQUEST) {
    payloadSize = view.getUint32(offset);
    offset += 4;
    payloadOffset = offset;
  } else if (messageType === MSG_FULL_CLIENT_REQUEST) {
    payloadSize = view.getUint32(offset);
    offset += 4;
    const hasSeq = messageFlags === FLAG_WITH_SEQUENCE || messageFlags === FLAG_LAST_WITH_SEQ;
    if (hasSeq) {
      sequenceId = view.getInt32(offset);
      offset += 4;
    }
    payloadOffset = offset;
  }

  const payload = buffer.slice(payloadOffset, payloadOffset + payloadSize);

  return {
    protocolVersion,
    messageType,
    messageFlags,
    serialization,
    compression,
    payloadSize,
    sequenceId,
    payload,
    errorCode,
    isLast: messageFlags === FLAG_LAST_NO_SEQ || messageFlags === FLAG_LAST_WITH_SEQ
  };
}

export class TTSClient {
  constructor(config) {
    this.appKey = config.appKey;
    this.accessKey = config.accessKey;
    this.resourceId = config.resourceId || 'seed-tts-2.0';
    this.voiceType = config.voiceType || 'zh_female_vv_uranus_bigtts';
    this.proxyUrl = config.proxyUrl || 'ws://localhost:3001/proxy';

    this.ws = null;
    this.connectId = `${Date.now()}-${Math.random().toString(36).substring(2, 15)}`;
    this.sequenceId = 0;

    // 回调
    this.onOpen = null;
    this.onClose = null;
    this.onError = null;
    this.onAudio = null;
    this.onEvent = null;

    // 状态
    this.isConnected = false;
    this.isSessionActive = false;
    this.connectionResolved = false;
  }

  buildUrl() {
    const params = new URLSearchParams({
      app_key: this.appKey,
      access_key: this.accessKey,
      resource_id: this.resourceId,
      connect_id: this.connectId
    });
    return `${this.proxyUrl}?${params.toString()}`;
  }

  buildStartConnection() {
    const payload = JSON.stringify({
      user: { uid: `tts-${this.connectId}` },
      event: EVT_START_CONNECTION
    });
    return buildFrame(MSG_FULL_CLIENT_REQUEST, payload);
  }

  buildStartSession() {
    const payload = JSON.stringify({
      user: { uid: `tts-${this.connectId}` },
      event: EVT_START_SESSION,
      req_params: {
        model: 'seed-tts-2.0-expressive',
        speaker: this.voiceType,
        audio_params: {
          format: 'mp3',
          sample_rate: 24000
        }
      }
    });
    return buildFrame(MSG_FULL_CLIENT_REQUEST, payload);
  }

  buildTaskRequest(text, isLast = false) {
    const payload = JSON.stringify({
      user: { uid: `tts-${this.connectId}` },
      event: EVT_TASK_REQUEST,
      req_params: { text }
    });
    const flags = isLast ? FLAG_LAST_NO_SEQ : 0;
    return buildFrame(MSG_FULL_CLIENT_REQUEST, payload, flags);
  }

  buildFinishSession() {
    const payload = JSON.stringify({
      user: { uid: `tts-${this.connectId}` },
      event: EVT_FINISH_SESSION
    });
    return buildFrame(MSG_FULL_CLIENT_REQUEST, payload, FLAG_LAST_NO_SEQ);
  }

  buildFinishConnection() {
    const payload = JSON.stringify({
      user: { uid: `tts-${this.connectId}` },
      event: EVT_FINISH_CONNECTION
    });
    return buildFrame(MSG_FULL_CLIENT_REQUEST, payload, FLAG_LAST_NO_SEQ);
  }

  connect() {
    return new Promise((resolve, reject) => {
      const url = this.buildUrl();
      console.log('[TTS] 连接:', url);

      this.ws = new WebSocket(url);
      this.ws.binaryType = 'arraybuffer';

      const connectionTimeout = setTimeout(() => {
        if (!this.connectionResolved) {
          this.connectionResolved = true;
          reject(new Error('TTS 连接超时'));
        }
      }, 10000);

      this.ws.onopen = () => {
        console.log('[TTS] WebSocket 已连接');
        this.isConnected = true;
        this.ws.send(this.buildStartConnection());
      };

      this.ws.onmessage = (event) => {
        const parsed = parseFrame(event.data);
        if (!parsed) return;

        console.log('[TTS] 收到:', {
          type: parsed.messageType.toString(2).padStart(4, '0'),
          size: parsed.payloadSize
        });

        // 错误处理
        if (parsed.messageType === MSG_SERVER_ERROR) {
          const errorMsg = new TextDecoder().decode(parsed.payload);
          console.error('[TTS] 服务端错误:', parsed.errorCode, errorMsg);
          if (this.onError) {
            this.onError(new Error(`TTS 错误 ${parsed.errorCode}: ${errorMsg}`));
          }
          return;
        }

        // JSON payload
        if (parsed.payload && parsed.payload.byteLength > 0 &&
            (parsed.messageType === MSG_FULL_SERVER_RESPONSE)) {
          try {
            const text = new TextDecoder().decode(parsed.payload);
            const json = JSON.parse(text);
            console.log('[TTS] 事件:', json.event, json);

            if (this.onEvent) this.onEvent(json.event, json);

            if (json.event === EVT_CONNECTION_STARTED) {
              console.log('[TTS] 连接已建立，发送 StartSession');
              this.ws.send(this.buildStartSession());
            } else if (json.event === EVT_SESSION_STARTED) {
              this.isSessionActive = true;
              if (!this.connectionResolved) {
                this.connectionResolved = true;
                clearTimeout(connectionTimeout);
                if (this.onOpen) this.onOpen();
                resolve();
              }
            } else if (json.event === EVT_SESSION_FINISHED || json.event === EVT_SESSION_STARTED) {
              // Session 状态变化
            }
          } catch (e) {
            console.warn('[TTS] JSON 解析失败:', e);
          }
        }

        // 音频 payload
        if (parsed.payload && parsed.payload.byteLength > 0) {
          if (this.onAudio) {
            this.onAudio(parsed.payload);
          }
        }
      };

      this.ws.onclose = (event) => {
        console.log('[TTS] 连接关闭:', event.code, event.reason);
        this.isConnected = false;
        this.isSessionActive = false;
        this.ws = null;
        if (this.onClose) this.onClose(event);
      };

      this.ws.onerror = (error) => {
        console.error('[TTS] WebSocket 错误:', error);
        this.isConnected = false;
        if (!this.connectionResolved) {
          this.connectionResolved = true;
          clearTimeout(connectionTimeout);
          reject(error);
        }
        if (this.onError) this.onError(error);
      };
    });
  }

  sendText(text, isLast = false) {
    if (!this.isConnected || !this.ws) {
      console.warn('[TTS] 未连接，无法发送');
      return false;
    }
    console.log('[TTS] 发送文本:', text.substring(0, 50));
    this.ws.send(this.buildTaskRequest(text, isLast));
    return true;
  }

  finishSession() {
    if (!this.isConnected || !this.ws) return false;
    console.log('[TTS] 发送 FinishSession');
    this.ws.send(this.buildFinishSession());
    this.isSessionActive = false;
    return true;
  }

  cancelSession() {
    // 简单实现：直接 finish
    return this.finishSession();
  }

  close() {
    if (this.isSessionActive) {
      this.finishSession();
    }
    if (this.ws) {
      this.ws.send(this.buildFinishConnection());
      setTimeout(() => this.ws?.close(), 100);
      this.ws = null;
    }
    this.isConnected = false;
    this.isSessionActive = false;
  }

  setVoice(voice) {
    this.voiceType = voice;
  }
}
