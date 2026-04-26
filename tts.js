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
const FLAG_WITH_EVENT = 0b0100;

// Events
const EVT_START_CONNECTION = 1;
const EVT_FINISH_CONNECTION = 2;
const EVT_CONNECTION_STARTED = 50;
const EVT_START_SESSION = 100;
const EVT_FINISH_SESSION = 102;
const EVT_SESSION_STARTED = 150;
const EVT_SESSION_FINISHED = 152;
const EVT_TASK_REQUEST = 200;
const EVT_TTS_SENTENCE_START = 350;
const EVT_TTS_SENTENCE_END = 351;
const EVT_TTS_RESPONSE = 352;

function createTtsConfigError(detail = '') {
  const suffix = detail ? `原始错误：${detail}` : '请查看控制台或 Zeabur 日志获取原始错误。';
  return new Error(`TTS 配置或接口调用失败，请检查火山 TTS API Key、Resource ID、音色和服务额度。${suffix}`);
}

/**
 * Build a binary frame for V3 TTS bidirectional protocol.
 *
 * Frame layout:
 *   [4-byte header] [4-byte event] [4-byte connect_id_size + connect_id bytes]? [4-byte payload_size] [payload]
 *
 * - StartConnection: no connect_id (server hasn't assigned one yet)
 * - All subsequent messages (StartSession, TaskRequest, FinishSession, FinishConnection):
 *   include connect_id field after the event.
 */
function buildFrame(eventCode, payload, connectId = null) {
  const payloadBytes = typeof payload === 'string'
    ? new TextEncoder().encode(payload)
    : new Uint8Array(payload);

  const connectIdBytes = connectId ? new TextEncoder().encode(connectId) : null;

  let total = 4 + 4; // header + event
  if (connectIdBytes) total += 4 + connectIdBytes.length;
  total += 4 + payloadBytes.length; // payload_size + payload

  const buf = new ArrayBuffer(total);
  const view = new DataView(buf);
  const bytes = new Uint8Array(buf);
  let offset = 0;

  // Header
  view.setUint8(offset++, (PROTOCOL_VERSION << 4) | HEADER_SIZE); // 0x11
  view.setUint8(offset++, (MSG_FULL_CLIENT_REQUEST << 4) | FLAG_WITH_EVENT); // 0x14
  view.setUint8(offset++, (SER_JSON << 4) | COMP_NONE); // 0x10
  view.setUint8(offset++, 0x00); // reserved

  // Event number (big-endian)
  view.setUint32(offset, eventCode, false);
  offset += 4;

  // Connect ID (length-prefixed, only after ConnectionStarted)
  if (connectIdBytes) {
    view.setUint32(offset, connectIdBytes.length, false);
    offset += 4;
    bytes.set(connectIdBytes, offset);
    offset += connectIdBytes.length;
  }

  // Payload size + payload
  view.setUint32(offset, payloadBytes.length, false);
  offset += 4;
  bytes.set(payloadBytes, offset);

  return buf;
}

/**
 * Parse a server response frame.
 *
 * Response frame layout:
 *   [4-byte header]
 *   [4-byte event]?           (if flag 0b0100 set)
 *   [string fields]*          (connect_id, session_id, etc. - length-prefixed)
 *   [4-byte payload_size]
 *   [payload]
 *
 * For error frames (type=0b1111):
 *   [4-byte header] [4-byte error_code] [4-byte payload_size] [payload]
 */
function parseFrame(buffer) {
  if (buffer.byteLength < 4) return null;

  const view = new DataView(buffer);
  const byte0 = view.getUint8(0);
  const byte1 = view.getUint8(1);
  const byte2 = view.getUint8(2);

  const protocolVersion = (byte0 >> 4) & 0x0F;
  const headerSize = byte0 & 0x0F;
  const messageType = (byte1 >> 4) & 0x0F;
  const messageFlags = byte1 & 0x0F;
  const serialization = (byte2 >> 4) & 0x0F;
  const compression = byte2 & 0x0F;

  let offset = headerSize * 4;
  let event = null;
  let errorCode = null;

  // Error frame
  if (messageType === MSG_SERVER_ERROR) {
    errorCode = view.getUint32(offset, false);
    offset += 4;
    const payloadSize = view.getUint32(offset, false);
    offset += 4;
    const payload = buffer.slice(offset, offset + payloadSize);
    return {
      protocolVersion,
      messageType,
      messageFlags,
      serialization,
      compression,
      event: null,
      errorCode,
      payloadSize,
      payload,
      isAudio: false,
      isLast: false
    };
  }

  // Event number
  if (messageFlags & FLAG_WITH_EVENT) {
    event = view.getUint32(offset, false);
    offset += 4;
  }

  // Skip length-prefixed string fields (connect_id, session_id, etc.)
  // until we find the actual payload.
  //
  // Strategy: each field is [4-byte size][content]. For JSON responses,
  // the payload starts with '{' or '['. For audio responses, the payload
  // is the LAST size+content block — any preceding blocks are string fields
  // (connect_id, session_id, etc.) to skip.
  let payloadSize = 0;
  let payload = new ArrayBuffer(0);
  let isAudio = false;

  while (offset + 4 <= buffer.byteLength) {
    const sizeVal = view.getUint32(offset, false);

    if (sizeVal === 0) {
      // Empty payload
      offset += 4;
      break;
    }

    if (offset + 4 + sizeVal > buffer.byteLength) {
      // Size exceeds remaining data - invalid
      break;
    }

    const firstByte = view.getUint8(offset + 4);
    const endOfThisField = offset + 4 + sizeVal;
    const hasMoreData = endOfThisField < buffer.byteLength;

    if (firstByte === 0x7B || firstByte === 0x5B) {
      // JSON payload (starts with '{' or '[')
      payloadSize = sizeVal;
      payload = buffer.slice(offset + 4, endOfThisField);
      break;
    } else if (hasMoreData) {
      // There's more data after this field → it's a string field (connect_id, etc.)
      offset = endOfThisField;
    } else {
      // This is the last field → it's the actual payload (audio or raw data)
      payloadSize = sizeVal;
      payload = buffer.slice(offset + 4, endOfThisField);
      isAudio = (messageType === MSG_AUDIO_ONLY_RESPONSE);
      break;
    }
  }

  return {
    protocolVersion,
    messageType,
    messageFlags,
    serialization,
    compression,
    event,
    errorCode,
    payloadSize,
    payload,
    isAudio,
    isLast: false
  };
}

export class TTSClient {
  constructor(config) {
    this.apiKey = config.apiKey;
    this.resourceId = config.resourceId || 'seed-tts-2.0';
    this.voiceType = config.voiceType || 'zh_female_vv_uranus_bigtts';
    this.proxyUrl = config.proxyUrl || `${window.location.protocol === 'https:' ? 'wss:' : 'ws:'}//${window.location.host}/proxy`;

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
      api_key: this.apiKey,
      resource_id: this.resourceId,
      connect_id: this.connectId
    });
    return `${this.proxyUrl}?${params.toString()}`;
  }

  // StartConnection: no connect_id in frame (server hasn't assigned one yet)
  buildStartConnection() {
    const payload = JSON.stringify({
      user: { uid: `tts-${this.connectId}` },
      event: EVT_START_CONNECTION
    });
    return buildFrame(EVT_START_CONNECTION, payload);
  }

  // StartSession: includes connect_id
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
    console.log('[TTS] 发送 StartSession:', payload);
    return buildFrame(EVT_START_SESSION, payload, this.connectId);
  }

  // TaskRequest: includes connect_id
  buildTaskRequest(text, isLast = false) {
    const payload = JSON.stringify({
      user: { uid: `tts-${this.connectId}` },
      event: EVT_TASK_REQUEST,
      req_params: { text }
    });
    return buildFrame(EVT_TASK_REQUEST, payload, this.connectId);
  }

  // FinishSession: includes connect_id
  buildFinishSession() {
    const payload = JSON.stringify({
      user: { uid: `tts-${this.connectId}` },
      event: EVT_FINISH_SESSION
    });
    return buildFrame(EVT_FINISH_SESSION, payload, this.connectId);
  }

  // FinishConnection: includes connect_id
  buildFinishConnection() {
    const payload = JSON.stringify({
      user: { uid: `tts-${this.connectId}` },
      event: EVT_FINISH_CONNECTION
    });
    return buildFrame(EVT_FINISH_CONNECTION, payload, this.connectId);
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
          reject(createTtsConfigError('连接超时，可能是 TTS 鉴权失败或上游接口无响应。'));
        }
      }, 10000);

      this.ws.onopen = () => {
        console.log('[TTS] WebSocket 已连接');
        this.isConnected = true;
        // 发送 StartConnection (不带 connect_id)
        this.ws.send(this.buildStartConnection());
      };

      this.ws.onmessage = (event) => {
        const parsed = parseFrame(event.data);
        if (!parsed) return;

        console.log('[TTS] 收到:', {
          type: parsed.messageType.toString(2).padStart(4, '0'),
          event: parsed.event,
          size: parsed.payloadSize,
          isAudio: parsed.isAudio
        });

        // 错误处理
        if (parsed.messageType === MSG_SERVER_ERROR) {
          const errorMsg = new TextDecoder().decode(parsed.payload);
          const error = createTtsConfigError(`TTS 错误 ${parsed.errorCode}: ${errorMsg}`);
          console.error('[TTS] 服务端错误:', parsed.errorCode, errorMsg);
          if (!this.connectionResolved) {
            this.connectionResolved = true;
            clearTimeout(connectionTimeout);
            reject(error);
          }
          if (this.onError) {
            this.onError(error);
          }
          return;
        }

        // 音频数据 (Audio-only response)
        if (parsed.isAudio && parsed.payload && parsed.payloadSize > 0) {
          if (this.onAudio) {
            this.onAudio(parsed.payload);
          }
          return;
        }

        // JSON payload (Full server response)
        if (parsed.payload && parsed.payloadSize > 0 &&
            parsed.messageType === MSG_FULL_SERVER_RESPONSE) {
          try {
            const text = new TextDecoder().decode(parsed.payload);
            const json = JSON.parse(text);
            const evtId = parsed.event || json.event;
            console.log('[TTS] 事件:', evtId, json);

            if (this.onEvent) this.onEvent(evtId, json);

            if (evtId === EVT_CONNECTION_STARTED) {
              console.log('[TTS] 连接已启动，发送 StartSession');
              this.ws.send(this.buildStartSession());
            } else if (evtId === EVT_SESSION_STARTED) {
              this.isSessionActive = true;
              if (!this.connectionResolved) {
                this.connectionResolved = true;
                clearTimeout(connectionTimeout);
                if (this.onOpen) this.onOpen();
                resolve();
              }
            } else if (evtId === EVT_SESSION_FINISHED || evtId === 153 || evtId === 151) {
              this.isSessionActive = false;
            }
          } catch (e) {
            console.warn('[TTS] JSON 解析失败:', e);
          }
        }
      };

      this.ws.onclose = (event) => {
        console.log('[TTS] 连接关闭:', event.code, event.reason);
        this.isConnected = false;
        this.isSessionActive = false;
        this.ws = null;
        if (!this.connectionResolved) {
          this.connectionResolved = true;
          clearTimeout(connectionTimeout);
          reject(createTtsConfigError(`连接提前关闭${event.reason ? `：${event.reason}` : ''}`));
        }
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
      try {
        this.ws.close();
      } catch (e) {
        // ignore close errors
      }
      this.ws = null;
    }
    this.isConnected = false;
    this.isSessionActive = false;
  }

  setVoice(voice) {
    this.voiceType = voice;
  }
}
