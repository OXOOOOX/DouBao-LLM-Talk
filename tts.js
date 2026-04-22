/**
 * 豆包 TTS WebSocket 客户端
 * 支持双向流式语音合成
 */

// 协议常量
const TTS_PROTOCOL_VERSION = 0b0001;
const TTS_MESSAGE_TYPE_FULL_CLIENT_REQUEST = 0b0001;
const TTS_MESSAGE_TYPE_AUDIO_ONLY_REQUEST = 0b0010;
const TTS_MESSAGE_TYPE_FULL_SERVER_RESPONSE = 0b1001;
const TTS_MESSAGE_TYPE_AUDIO_ONLY_RESPONSE = 0b1011;
const TTS_MESSAGE_TYPE_SERVER_ERROR = 0b1111;

const TTS_SERIALIZATION_JSON = 0b0001;
const TTS_SERIALIZATION_RAW = 0b0000;
const TTS_COMPRESSION_NONE = 0b0000;

// Event 定义
const TTS_EVENT_START_CONNECTION = 1;
const TTS_EVENT_FINISH_CONNECTION = 2;
const TTS_EVENT_CONNECTION_STARTED = 50;
const TTS_EVENT_CONNECTION_FAILED = 51;
const TTS_EVENT_CONNECTION_FINISHED = 52;
const TTS_EVENT_START_SESSION = 100;
const TTS_EVENT_CANCEL_SESSION = 101;
const TTS_EVENT_FINISH_SESSION = 102;
const TTS_EVENT_SESSION_STARTED = 150;
const TTS_EVENT_SESSION_CANCELED = 151;
const TTS_EVENT_SESSION_FINISHED = 152;
const TTS_EVENT_SESSION_FAILED = 153;
const TTS_EVENT_TASK_REQUEST = 200;
const TTS_EVENT_TTS_SENTENCE_START = 350;
const TTS_EVENT_TTS_SENTENCE_END = 351;
const TTS_EVENT_TTS_RESPONSE = 352;

const TTS_ERROR_CODE_SUCCESS = 20000000;

// Frame flags
const TTS_FLAG_WITH_SEQUENCE = 0b0001;
const TTS_FLAG_LAST_NO_SEQUENCE = 0b0010;
const TTS_FLAG_LAST_WITH_SEQUENCE = 0b0011;

function readTtsInt32(view, offset) {
  return view.getInt32(offset, false);
}

function readTtsUint32(view, offset) {
  return view.getUint32(offset, false);
}

function decodeTtsUtf8(buffer) {
  return new TextDecoder().decode(buffer);
}

function buildTtsProtocolHeader(messageType, flags = 0, serializationMethod = TTS_SERIALIZATION_JSON, compressionMethod = TTS_COMPRESSION_NONE) {
  const header = new ArrayBuffer(4);
  const view = new DataView(header);
  view.setUint8(0, (TTS_PROTOCOL_VERSION << 4) | 0x01);
  view.setUint8(1, (messageType << 4) | (flags & 0x0F));
  view.setUint8(2, ((serializationMethod & 0x0F) << 4) | (compressionMethod & 0x0F));
  view.setUint8(3, 0x00);
  return header;
}

function buildTtsPayloadSizeHeader(payloadSize) {
  const header = new ArrayBuffer(4);
  new DataView(header).setUint32(0, payloadSize, false);
  return header;
}

function buildTtsSequenceHeader(sequenceId) {
  const header = new ArrayBuffer(4);
  new DataView(header).setInt32(0, sequenceId, false);
  return header;
}

export class TTSClient {
  constructor(config) {
    this.appKey = config.appKey;
    this.accessKey = config.accessKey;
    this.resourceId = config.resourceId;
    this.voiceType = config.voiceType || 'zh_female_vv_uranus_bigtts';
    this.proxyUrl = config.proxyUrl;

    this.ws = null;
    this.connectId = this.generateConnectId();
    this.sequenceId = 0;
    this.sessionId = 0;

    // 回调函数
    this.onOpen = null;
    this.onClose = null;
    this.onError = null;
    this.onAudio = null;
    this.onEvent = null;
    this.onSentenceStart = null;
    this.onSentenceEnd = null;

    // 状态
    this.isConnected = false;
    this.isSessionActive = false;
    this.currentText = '';
  }

  generateConnectId() {
    return `${Date.now()}-${Math.random().toString(36).substring(2, 15)}`;
  }

  nextSequenceId() {
    return this.sequenceId++;
  }

  buildUrl() {
    const baseUrl = this.proxyUrl || 'ws://localhost:3001/proxy';
    return baseUrl;
  }

  buildAuthParams() {
    return {
      app_key: this.appKey,
      access_key: this.accessKey,
      resource_id: this.resourceId,
      connect_id: this.connectId
    };
  }

  /**
   * 构建 StartConnection 请求
   */
  buildStartConnectionRequest() {
    const payloadJson = JSON.stringify({
      user: {
        uid: `tts-user-${this.connectId}`
      },
      event: TTS_EVENT_START_CONNECTION
    });
    return this.buildTtsFrame(payloadJson, TTS_MESSAGE_TYPE_FULL_CLIENT_REQUEST, 0);
  }

  /**
   * 构建 StartSession 请求
   */
  buildStartSessionRequest() {
    const payloadJson = JSON.stringify({
      user: {
        uid: `tts-user-${this.connectId}`
      },
      event: TTS_EVENT_START_SESSION,
      req_params: {
        model: 'seed-tts-2.0-expressive',
        speaker: this.voiceType,
        audio_params: {
          format: 'mp3',
          sample_rate: 24000
        },
        additions: {
          enable_subtitle: true
        }
      }
    });
    return this.buildTtsFrame(payloadJson, TTS_MESSAGE_TYPE_FULL_CLIENT_REQUEST, 0);
  }

  /**
   * 构建 TaskRequest 请求（发送文本）
   */
  buildTaskRequest(text, isLast = false) {
    const payloadJson = JSON.stringify({
      user: {
        uid: `tts-user-${this.connectId}`
      },
      event: TTS_EVENT_TASK_REQUEST,
      req_params: {
        text: text
      }
    });
    const flags = isLast ? TTS_FLAG_LAST_NO_SEQUENCE : 0;
    return this.buildTtsFrame(payloadJson, TTS_MESSAGE_TYPE_FULL_CLIENT_REQUEST, flags);
  }

  /**
   * 构建 FinishSession 请求
   */
  buildFinishSessionRequest() {
    const payloadJson = JSON.stringify({
      user: {
        uid: `tts-user-${this.connectId}`
      },
      event: TTS_EVENT_FINISH_SESSION
    });
    return this.buildTtsFrame(payloadJson, TTS_MESSAGE_TYPE_FULL_CLIENT_REQUEST, TTS_FLAG_LAST_NO_SEQUENCE);
  }

  /**
   * 构建 FinishConnection 请求
   */
  buildFinishConnectionRequest() {
    const payloadJson = JSON.stringify({
      user: {
        uid: `tts-user-${this.connectId}`
      },
      event: TTS_EVENT_FINISH_CONNECTION
    });
    return this.buildTtsFrame(payloadJson, TTS_MESSAGE_TYPE_FULL_CLIENT_REQUEST, TTS_FLAG_LAST_NO_SEQUENCE);
  }

  /**
   * 构建 TTS 协议帧
   */
  buildTtsFrame(payloadJson, messageType, flags = 0) {
    const payloadData = new TextEncoder().encode(payloadJson);
    const protocolHeader = buildTtsProtocolHeader(messageType, flags);
    const payloadSizeHeader = buildTtsPayloadSizeHeader(payloadData.length);

    const totalSize = protocolHeader.byteLength + payloadSizeHeader.byteLength + payloadData.length;
    const buffer = new ArrayBuffer(totalSize);
    const bytes = new Uint8Array(buffer);

    bytes.set(new Uint8Array(protocolHeader), 0);
    bytes.set(new Uint8Array(payloadSizeHeader), protocolHeader.byteLength);
    bytes.set(payloadData, protocolHeader.byteLength + payloadSizeHeader.byteLength);

    return buffer;
  }

  /**
   * 构建音频帧
   */
  buildAudioFrame(audioData, isLastFrame = false) {
    const flags = isLastFrame ? TTS_FLAG_LAST_NO_SEQUENCE : 0;
    const protocolHeader = buildTtsProtocolHeader(
      TTS_MESSAGE_TYPE_AUDIO_ONLY_REQUEST,
      flags,
      TTS_SERIALIZATION_RAW,
      TTS_COMPRESSION_NONE
    );

    const payloadSizeBuffer = new ArrayBuffer(4);
    new DataView(payloadSizeBuffer).setUint32(0, audioData.byteLength, false);

    const totalSize = protocolHeader.byteLength + payloadSizeBuffer.byteLength + audioData.byteLength;
    const buffer = new ArrayBuffer(totalSize);
    const view = new DataView(buffer);

    let offset = 0;
    const protocolBytes = new Uint8Array(protocolHeader);
    for (let i = 0; i < protocolBytes.length; i++) {
      view.setUint8(offset++, protocolBytes[i]);
    }

    const payloadSizeBytes = new Uint8Array(payloadSizeBuffer);
    for (let i = 0; i < payloadSizeBytes.length; i++) {
      view.setUint8(offset++, payloadSizeBytes[i]);
    }

    const audioBytes = new Uint8Array(audioData);
    for (let i = 0; i < audioBytes.length; i++) {
      view.setUint8(offset++, audioBytes[i]);
    }

    return buffer;
  }

  /**
   * 解析收到的消息
   */
  parseMessage(buffer) {
    if (!(buffer instanceof ArrayBuffer)) {
      return null;
    }

    const view = new DataView(buffer);
    let offset = 0;

    if (offset + 4 > buffer.byteLength) {
      throw new Error('TTS 消息太短，无法解析协议头');
    }

    const byte0 = view.getUint8(offset++);
    const protocolVersion = (byte0 >> 4) & 0x0F;
    const headerSize = byte0 & 0x0F;

    const byte1 = view.getUint8(offset++);
    const messageType = (byte1 >> 4) & 0x0F;
    const messageFlags = byte1 & 0x0F;

    const byte2 = view.getUint8(offset++);
    const serializationMethod = (byte2 >> 4) & 0x0F;
    const compressionMethod = byte2 & 0x0F;

    offset += 1; // reserved
    offset = headerSize * 4;

    let payloadSize = 0;
    let sequenceId = 0;
    let payloadOffset = offset;

    if (messageType === TTS_MESSAGE_TYPE_FULL_SERVER_RESPONSE ||
        messageType === TTS_MESSAGE_TYPE_AUDIO_ONLY_RESPONSE) {
      // 先读 sequence（可选）
      if (messageFlags === TTS_FLAG_WITH_SEQUENCE || messageFlags === TTS_FLAG_LAST_WITH_SEQUENCE) {
        sequenceId = readTtsInt32(view, offset);
        offset += 4;
        payloadSize = readTtsUint32(view, offset);
        offset += 4;
      } else {
        payloadSize = readTtsUint32(view, offset);
        offset += 4;
      }
      payloadOffset = offset;
    } else if (messageType === TTS_MESSAGE_TYPE_SERVER_ERROR) {
      const errorCode = readTtsUint32(view, offset);
      offset += 4;
      const errorMessageSize = readTtsUint32(view, offset);
      offset += 4;
      payloadOffset = offset;
      payloadSize = errorMessageSize;

      const errorMessage = decodeTtsUtf8(buffer.slice(payloadOffset, payloadOffset + payloadSize));
      return {
        messageType,
        event: null,
        payload: null,
        error: { errorCode, errorMessage }
      };
    } else if (messageType === TTS_MESSAGE_TYPE_AUDIO_ONLY_REQUEST) {
      payloadSize = readTtsUint32(view, offset);
      offset += 4;
      payloadOffset = offset;
    }

    const payload = buffer.slice(payloadOffset, payloadOffset + payloadSize);

    return {
      protocolVersion,
      messageType,
      messageFlags,
      serializationMethod,
      compressionMethod,
      payloadSize,
      sequenceId,
      payload,
      isLastFrame: messageFlags === TTS_FLAG_LAST_NO_SEQUENCE || messageFlags === TTS_FLAG_LAST_WITH_SEQUENCE
    };
  }

  /**
   * 处理收到的消息
   */
  handleMessage(data) {
    try {
      const parsed = this.parseMessage(data);
      if (!parsed) return;

      console.log('[TTS] 收到消息:', {
        messageType: parsed.messageType.toString(2).padStart(4, '0'),
        payloadSize: parsed.payloadSize,
        sequenceId: parsed.sequenceId
      });

      if (parsed.error) {
        console.error('[TTS] 服务端错误:', parsed.error);
        if (this.onError) {
          this.onError(new Error(`TTS 错误 ${parsed.error.errorCode}: ${parsed.error.errorMessage}`));
        }
        return;
      }

      // 解析 JSON payload
      if (parsed.payload && parsed.payload.byteLength > 0 &&
          parsed.messageType === TTS_MESSAGE_TYPE_FULL_SERVER_RESPONSE) {
        try {
          const text = decodeTtsUtf8(parsed.payload);
          const json = JSON.parse(text);
          const event = json.event;

          console.log('[TTS] 事件:', event, json);

          if (this.onEvent) {
            this.onEvent(event, json);
          }

          switch (event) {
            case TTS_EVENT_SESSION_STARTED:
              this.isSessionActive = true;
              break;
            case TTS_EVENT_SESSION_FINISHED:
            case TTS_EVENT_SESSION_CANCELED:
            case TTS_EVENT_SESSION_FAILED:
              this.isSessionActive = false;
              break;
            case TTS_EVENT_TTS_SENTENCE_START:
              if (this.onSentenceStart) {
                this.onSentenceStart(json);
              }
              break;
            case TTS_EVENT_TTS_SENTENCE_END:
              if (this.onSentenceEnd) {
                this.onSentenceEnd(json);
              }
              break;
            case TTS_EVENT_TTS_RESPONSE:
              // 可能包含音频数据或文本
              break;
          }
        } catch (e) {
          console.warn('[TTS] 解析 JSON 失败:', e);
        }
      }

      // 音频 payload
      if (parsed.payload && parsed.payload.byteLength > 0 &&
          (parsed.messageType === TTS_MESSAGE_TYPE_AUDIO_ONLY_RESPONSE ||
           (parsed.messageType === TTS_MESSAGE_TYPE_FULL_SERVER_RESPONSE &&
            parsed.payload.byteLength > 0))) {
        if (this.onAudio) {
          this.onAudio(parsed.payload);
        }
      }

    } catch (error) {
      console.error('[TTS] 消息处理错误:', error);
      if (this.onError) {
        this.onError(error);
      }
    }
  }

  /**
   * 连接 WebSocket
   */
  connect() {
    return new Promise((resolve, reject) => {
      try {
        const baseUrl = this.buildUrl();
        const authParams = this.buildAuthParams();
        const url = `${baseUrl}?app_key=${encodeURIComponent(authParams.app_key)}&access_key=${encodeURIComponent(authParams.access_key)}&resource_id=${encodeURIComponent(authParams.resource_id)}&connect_id=${encodeURIComponent(authParams.connect_id)}`;

        console.log('[TTS] 连接到:', url);

        this.ws = new WebSocket(url);
        this.ws.binaryType = 'arraybuffer';

        this.ws.onopen = () => {
          console.log('[TTS] WebSocket 已连接');
          this.isConnected = true;

          // 发送 StartConnection
          const startConnFrame = this.buildStartConnectionRequest();
          this.ws.send(startConnFrame);
          console.log('[TTS] 已发送 StartConnection');
        };

        this.ws.onmessage = (event) => {
          const parsed = this.parseMessage(event.data);
          if (!parsed) return;

          // ConnectionStarted 后发送 StartSession
          if (parsed.messageType === TTS_MESSAGE_TYPE_FULL_SERVER_RESPONSE && parsed.payload.byteLength > 0) {
            try {
              const json = JSON.parse(decodeTtsUtf8(parsed.payload));
              if (json.event === TTS_EVENT_CONNECTION_STARTED) {
                console.log('[TTS] ConnectionStarted，发送 StartSession');
                const startSessionFrame = this.buildStartSessionRequest();
                this.ws.send(startSessionFrame);
              }
            } catch (e) {
              // 不是 JSON，忽略
            }
          }

          this.handleMessage(event.data);
        };

        this.ws.onclose = (event) => {
          console.log('[TTS] WebSocket 已关闭:', event.code, event.reason);
          this.isConnected = false;
          this.isSessionActive = false;
          this.ws = null;

          if (this.onClose) {
            this.onClose(event);
          }
        };

        this.ws.onerror = (error) => {
          console.error('[TTS] WebSocket 错误:', error);
          this.isConnected = false;

          if (this.onError) {
            this.onError(error);
          }
          reject(error);
        };

        // 等待 ConnectionStarted
        const connectionTimeout = setTimeout(() => {
          reject(new Error('TTS 连接超时'));
        }, 10000);

        const originalOnMessage = this.ws.onmessage;
        this.ws.onmessage = (event) => {
          const parsed = this.parseMessage(event.data);
          if (parsed && parsed.messageType === TTS_MESSAGE_TYPE_FULL_SERVER_RESPONSE && parsed.payload.byteLength > 0) {
            try {
              const json = JSON.parse(decodeTtsUtf8(parsed.payload));
              if (json.event === TTS_EVENT_CONNECTION_STARTED) {
                clearTimeout(connectionTimeout);
                this.ws.onmessage = originalOnMessage;
                if (this.onOpen) {
                  this.onOpen();
                }
                resolve();
                return;
              }
              if (json.event === TTS_EVENT_CONNECTION_FAILED) {
                clearTimeout(connectionTimeout);
                reject(new Error('TTS 连接失败'));
                return;
              }
            } catch (e) {
              // 不是 JSON，忽略
            }
          }
          originalOnMessage.call(this.ws, event);
        };

      } catch (error) {
        console.error('[TTS] 连接失败:', error);
        reject(error);
      }
    });
  }

  /**
   * 发送文本进行合成
   */
  sendText(text, isLast = false) {
    if (!this.isConnected || !this.ws) {
      console.warn('[TTS] 未连接，无法发送文本');
      return false;
    }

    const frame = this.buildTaskRequest(text, isLast);
    this.ws.send(frame);
    console.log('[TTS] 发送文本:', text.substring(0, 50) + (text.length > 50 ? '...' : ''));
    return true;
  }

  /**
   * 完成 session
   */
  finishSession() {
    if (!this.isConnected || !this.ws) {
      console.warn('[TTS] 未连接，无法发送 FinishSession');
      return false;
    }

    const frame = this.buildFinishSessionRequest();
    this.ws.send(frame);
    console.log('[TTS] 已发送 FinishSession');
    this.isSessionActive = false;
    return true;
  }

  /**
   * 取消 session（用于打断）
   */
  cancelSession() {
    if (!this.isConnected || !this.ws) {
      console.warn('[TTS] 未连接，无法发送 CancelSession');
      return false;
    }

    const payloadJson = JSON.stringify({
      user: {
        uid: `tts-user-${this.connectId}`
      },
      event: TTS_EVENT_CANCEL_SESSION
    });
    const frame = this.buildTtsFrame(payloadJson, TTS_MESSAGE_TYPE_FULL_CLIENT_REQUEST, 0);
    this.ws.send(frame);
    console.log('[TTS] 已发送 CancelSession');
    this.isSessionActive = false;
    return true;
  }

  /**
   * 关闭连接
   */
  close() {
    if (this.isSessionActive) {
      this.finishSession();
    }

    if (this.ws) {
      const frame = this.buildFinishConnectionRequest();
      this.ws.send(frame);
      setTimeout(() => {
        if (this.ws) {
          this.ws.close();
        }
      }, 100);
      this.ws = null;
    }
    this.isConnected = false;
    this.isSessionActive = false;
  }

  /**
   * 设置音色
   */
  setVoiceType(voiceType) {
    this.voiceType = voiceType;
  }
}
