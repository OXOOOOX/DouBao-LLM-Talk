// 豆包 TTS 2.0 - WebSocket 双向流式
// 接口地址：wss://openspeech.bytedance.com/api/v3/tts/bidirection

const DEFAULT_VOLC_TTS_CONFIG = {
  appId: import.meta.env.VITE_VOLC_APP_ID || '',
  accessToken: import.meta.env.VITE_VOLC_ACCESS_TOKEN || '',
  apiKey: import.meta.env.VITE_VOLC_API_KEY || '',
  resourceId: import.meta.env.VITE_VOLC_TTS_RESOURCE_ID || 'seed-tts-2.0',
  proxyUrl: import.meta.env.VITE_VOLC_PROXY_URL || 'ws://localhost:3001/proxy'
};

// Event 定义
const TTS_EVENT = {
  StartConnection: 1,
  FinishConnection: 2,
  ConnectionStarted: 50,
  ConnectionFailed: 51,
  ConnectionFinished: 52,
  StartSession: 100,
  CancelSession: 101,
  FinishSession: 102,
  SessionStarted: 150,
  SessionCanceled: 151,
  SessionFinished: 152,
  SessionFailed: 153,
  TaskRequest: 200,
  TTSSentenceStart: 350,
  TTSSentenceEnd: 351,
  TTSResponse: 352
};

export class DoubaoTTS {
  constructor() {
    this.proxyWs = null;
    this.isConnected = false;
    this.isSessionActive = false;
    this.sessionId = null;
    this.connectionId = null;
    this.onAudioData = null;
    this.onError = null;
    this.onOpen = null;
    this.onClose = null;
    this.onSessionStarted = null;
    this.onSessionFinished = null;
    this.audioQueue = [];
    this.isPlaying = false;
    this.audioContext = null;
    this.nextPlaybackTime = 0;
    this.pendingText = null;
    this.pendingVoiceType = null;
    this.currentSpeakReject = null;
    this.currentSpeakResolve = null;
    this.activeSources = new Set();
    this.currentSpeakToken = 0;
    this.interruptedSpeakToken = null;
    this.config = { ...DEFAULT_VOLC_TTS_CONFIG };
  }

  updateConfig(config = {}) {
    this.config = {
      ...this.config,
      ...Object.fromEntries(
        Object.entries(config).filter(([, value]) => typeof value === 'string')
      )
    };
  }

  getConfig() {
    return { ...this.config };
  }

  resetPlaybackState() {
    this.audioQueue = [];
    this.isPlaying = false;
    this.nextPlaybackTime = 0;
  }

  stopPlaybackSources() {
    for (const source of this.activeSources) {
      try {
        source.stop();
      } catch {
      }
    }
    this.activeSources.clear();
    this.resetPlaybackState();
  }

  isSpeakTokenActive(token) {
    return token && token === this.currentSpeakToken && token !== this.interruptedSpeakToken;
  }

  createInterruptedError() {
    const error = new Error('语音播报已打断');
    error.code = 'TTS_INTERRUPTED';
    return error;
  }

  isInterruptedError(error) {
    return error?.code === 'TTS_INTERRUPTED';
  }

  finishInterruptedSpeak(token) {
    if (!this.isSpeakTokenActive(token) && this.interruptedSpeakToken !== token) {
      return;
    }

    this.cleanupSpeakCallbacks();
    this.stopPlaybackSources();
    this.resetForNextSession();

    if (this.currentSpeakResolve) {
      this.currentSpeakResolve({ interrupted: true });
    }
    this.currentSpeakResolve = null;
    this.currentSpeakReject = null;

    if (this.currentSpeakToken === token) {
      this.currentSpeakToken = 0;
    }
  }

  interrupt() {
    const token = this.currentSpeakToken;
    if (!token) {
      this.stopPlaybackSources();
      return false;
    }

    this.interruptedSpeakToken = token;

    if (this.isSessionActive && this.sessionId) {
      this.sendCancelSession();
    }

    this.finishInterruptedSpeak(token);
    return true;
  }

  clearSessionState() {
    this.isSessionActive = false;
    this.sessionId = null;
    this.pendingText = null;
    this.pendingVoiceType = null;
  }

  failCurrentSpeak(error) {
    if (this.currentSpeakReject) {
      this.currentSpeakReject(error);
    }
    this.currentSpeakReject = null;
    this.currentSpeakResolve = null;
  }

  resolveCurrentSpeak() {
    if (this.currentSpeakResolve) {
      this.currentSpeakResolve();
    }
    this.currentSpeakReject = null;
    this.currentSpeakResolve = null;
  }

  readLengthPrefixedString(buffer, offset) {
    const view = new DataView(buffer);
    const length = view.getUint32(offset, false);
    const start = offset + 4;
    const end = start + length;
    const value = new TextDecoder().decode(new Uint8Array(buffer, start, length));
    return {
      length,
      value,
      nextOffset: end
    };
  }

  readLengthPrefixedPayload(buffer, offset) {
    const view = new DataView(buffer);
    const length = view.getUint32(offset, false);
    const start = offset + 4;
    const end = start + length;
    return {
      length,
      bytes: new Uint8Array(buffer, start, length),
      nextOffset: end
    };
  }

  parseJsonPayload(bytes) {
    if (!bytes || bytes.length === 0) {
      return null;
    }

    try {
      return JSON.parse(new TextDecoder().decode(bytes));
    } catch {
      return null;
    }
  }

  // 生成 UUID
  generateUUID() {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
      const r = Math.random() * 16 | 0;
      const v = c === 'x' ? r : (r & 0x3 | 0x8);
      return v.toString(16);
    });
  }

  // 连接代理服务器
  connect() {
    return new Promise((resolve, reject) => {

      // 存储 resolve 函数，等 ConnectionStarted 时调用
      this._connectResolve = resolve;

      this.proxyWs = new WebSocket(this.config.proxyUrl);
      this.proxyWs.binaryType = 'arraybuffer';

      this.proxyWs.onopen = () => {

        // 发送鉴权配置给代理
        const config = {
          serviceType: 'tts',
          appId: this.config.appId,
          accessToken: this.config.accessToken,
          apiKey: this.config.apiKey,
          resourceId: this.config.resourceId
        };

        this.proxyWs.send(JSON.stringify(config));
      };

      this.proxyWs.onmessage = (event) => {
  
        // 处理文本消息（JSON 配置响应）
        if (typeof event.data === 'string') {
          try {
            const msg = JSON.parse(event.data);
            if (msg.type === 'connected') {
              this.isConnected = true;
              this.sendStartConnection();
              return;
            } else if (msg.type === 'error') {
              console.error('[TTS] Proxy error:', msg.message);
              this._connectResolve = null;
              if (this.onError) this.onError(new Error(msg.message));
              reject(new Error(msg.message));
              return;
            }
          } catch (e) {
          }
          return;
        }

        // 处理二进制消息
        const handleBinary = (arrayBuffer) => {
          this.handleMessage(arrayBuffer);
        };

        if (event.data instanceof Blob) {
          event.data.arrayBuffer().then(handleBinary);
        } else if (event.data instanceof ArrayBuffer) {
          handleBinary(event.data);
        }
      };

      this.proxyWs.onerror = (error) => {
        console.error('[TTS] Proxy error:', error);
        this._connectResolve = null;
        if (this.onError) this.onError(error);
        reject(error);
      };

      this.proxyWs.onclose = () => {
        this.isConnected = false;
        this.isSessionActive = false;
        if (this.onClose) this.onClose();
      };
    });
  }

  // 构建 4 字节 header
  buildHeader(messageType, typeFlags, serialization, compression) {
    const header = new Uint8Array(4);
    header[0] = (0x01 << 4) | 0x01; // version=1, header_size=1
    header[1] = (messageType << 4) | typeFlags;
    header[2] = (serialization << 4) | compression;
    header[3] = 0x00;
    return header;
  }

  // 大端序 Uint32
  setUint32BigEndian(array, offset, value) {
    array[offset] = (value >> 24) & 0xFF;
    array[offset + 1] = (value >> 16) & 0xFF;
    array[offset + 2] = (value >> 8) & 0xFF;
    array[offset + 3] = value & 0xFF;
  }

  // 大端序读 Uint32
  getUint32BigEndian(array, offset) {
    return (array[offset] << 24) | (array[offset + 1] << 16) | (array[offset + 2] << 8) | array[offset + 3];
  }

  // 发送 StartConnection
  sendStartConnection() {
    if (!this.proxyWs || this.proxyWs.readyState !== WebSocket.OPEN) {
      console.error('[TTS] WebSocket not ready');
      return;
    }

    const event = TTS_EVENT.StartConnection;
    const payloadJson = '{}';
    const payloadData = new TextEncoder().encode(payloadJson);

    // header: version(4bits) | header_size(4bits) = 0x11
    // message_type(4bits) | type_flags(4bits) = 0x14 (Full-client request with event)
    // serialization(4bits) | compression(4bits) = 0x10 (JSON, no compression)
    // reserved = 0x00
    const header = new Uint8Array([0x11, 0x14, 0x10, 0x00]);

    const eventBuf = new Uint8Array(4);
    this.setUint32BigEndian(eventBuf, 0, event);

    const payloadLen = new Uint8Array(4);
    this.setUint32BigEndian(payloadLen, 0, payloadData.length);

    const message = new Uint8Array(header.length + 4 + 4 + payloadData.length);
    message.set(header, 0);
    message.set(eventBuf, header.length);
    message.set(payloadLen, header.length + 4);
    message.set(payloadData, header.length + 8);

    this.proxyWs.send(message);
  }

  // 发送 StartSession（不包含文本，文本通过 TaskRequest 发送）
  sendStartSession(voiceType = 'zh_female_vv_uranus_bigtts') {
    if (!this.isConnected) {
      console.error('[TTS] Not connected');
      return;
    }

    this.sessionId = this.generateUUID();
    const sessionIdBytes = new TextEncoder().encode(this.sessionId);

    const event = TTS_EVENT.StartSession;

    // Session meta: user + req_params（不包含 text）
    const sessionMeta = {
      user: {
        uid: 'browser-' + Date.now()
      },
      req_params: {
        speaker: voiceType,
        audio_params: {
          format: 'pcm',
          sample_rate: 24000
        }
      }
    };

    const metaJson = JSON.stringify(sessionMeta);
    const metaData = new TextEncoder().encode(metaJson);

    // 构建消息：header(4) + event(4) + session_id_len(4) + session_id + meta_len(4) + meta
    const header = this.buildHeader(0x01, 0x04, 0x01, 0x00);
    const eventBuf = new Uint8Array(4);
    this.setUint32BigEndian(eventBuf, 0, event);
    const sessionIdLen = new Uint8Array(4);
    this.setUint32BigEndian(sessionIdLen, 0, sessionIdBytes.length);
    const metaLen = new Uint8Array(4);
    this.setUint32BigEndian(metaLen, 0, metaData.length);

    const message = new Uint8Array(header.length + 4 + 4 + sessionIdBytes.length + 4 + metaData.length);
    message.set(header, 0);
    message.set(eventBuf, header.length);
    message.set(sessionIdLen, header.length + 4);
    message.set(sessionIdBytes, header.length + 8);
    message.set(metaLen, header.length + 8 + sessionIdBytes.length);
    message.set(metaData, header.length + 12 + sessionIdBytes.length);

    this.send(message);
  }

  // 发送文本（TaskRequest）
  sendText(text) {
    if (!this.isSessionActive || !this.sessionId) {
      console.error('[TTS] No active session');
      return;
    }

    const sessionIdBytes = new TextEncoder().encode(this.sessionId);
    const event = TTS_EVENT.TaskRequest;
    const payload = {
      req_params: {
        text
      }
    };
    const payloadJson = JSON.stringify(payload);
    const payloadData = new TextEncoder().encode(payloadJson);

    const header = this.buildHeader(0x01, 0x04, 0x01, 0x00);
    const eventBuf = new Uint8Array(4);
    this.setUint32BigEndian(eventBuf, 0, event);
    const sessionIdLen = new Uint8Array(4);
    this.setUint32BigEndian(sessionIdLen, 0, sessionIdBytes.length);
    const payloadLen = new Uint8Array(4);
    this.setUint32BigEndian(payloadLen, 0, payloadData.length);

    const totalLen = header.length + 4 + 4 + sessionIdBytes.length + 4 + payloadData.length;
    const message = new Uint8Array(totalLen);
    message.set(header, 0);
    message.set(eventBuf, header.length);
    message.set(sessionIdLen, header.length + 4);
    message.set(sessionIdBytes, header.length + 8);
    message.set(payloadLen, header.length + 8 + sessionIdBytes.length);
    message.set(payloadData, header.length + 8 + sessionIdBytes.length + 4);

    this.send(message);
  }

  sendFinishConnection() {
    if (!this.proxyWs || this.proxyWs.readyState !== WebSocket.OPEN) {
      return;
    }

    const header = new Uint8Array([0x11, 0x14, 0x10, 0x00]);
    const eventBuf = new Uint8Array(4);
    this.setUint32BigEndian(eventBuf, 0, TTS_EVENT.FinishConnection);
    const payloadData = new TextEncoder().encode('{}');
    const payloadLen = new Uint8Array(4);
    this.setUint32BigEndian(payloadLen, 0, payloadData.length);

    const message = new Uint8Array(header.length + 4 + 4 + payloadData.length);
    message.set(header, 0);
    message.set(eventBuf, header.length);
    message.set(payloadLen, header.length + 4);
    message.set(payloadData, header.length + 8);

    this.proxyWs.send(message);
  }

  sendCancelSession() {
    if (!this.sessionId || !this.proxyWs || this.proxyWs.readyState !== WebSocket.OPEN) {
      return;
    }

    const sessionIdBytes = new TextEncoder().encode(this.sessionId);
    const payloadData = new TextEncoder().encode('{}');
    const header = this.buildHeader(0x01, 0x04, 0x01, 0x00);
    const eventBuf = new Uint8Array(4);
    this.setUint32BigEndian(eventBuf, 0, TTS_EVENT.CancelSession);
    const sessionIdLen = new Uint8Array(4);
    this.setUint32BigEndian(sessionIdLen, 0, sessionIdBytes.length);
    const payloadLen = new Uint8Array(4);
    this.setUint32BigEndian(payloadLen, 0, payloadData.length);

    const totalLen = header.length + 4 + 4 + sessionIdBytes.length + 4 + payloadData.length;
    const message = new Uint8Array(totalLen);
    message.set(header, 0);
    message.set(eventBuf, header.length);
    message.set(sessionIdLen, header.length + 4);
    message.set(sessionIdBytes, header.length + 8);
    message.set(payloadLen, header.length + 8 + sessionIdBytes.length);
    message.set(payloadData, header.length + 8 + sessionIdBytes.length + 4);

    this.send(message);
  }

  handleResponseEvent(event, buffer) {
    let offset = 8;

    if (event === TTS_EVENT.ConnectionStarted || event === TTS_EVENT.ConnectionFailed || event === TTS_EVENT.ConnectionFinished) {
      const connection = this.readLengthPrefixedString(buffer, offset);
      offset = connection.nextOffset;
      const payload = this.readLengthPrefixedPayload(buffer, offset);
      const payloadJson = this.parseJsonPayload(payload.bytes);

      if (connection.value) {
        this.connectionId = connection.value;
      }

      if (event === TTS_EVENT.ConnectionStarted) {
        if (this._connectResolve) {
          this._connectResolve();
          this._connectResolve = null;
        }
        if (this.pendingText && this.pendingVoiceType) {
          const voiceType = this.pendingVoiceType;
          this.pendingVoiceType = null;
          setTimeout(() => {
            this.sendStartSession(voiceType);
          }, 50);
        }
        return;
      }

      if (event === TTS_EVENT.ConnectionFailed) {
        const message = payloadJson?.message || 'Connection failed';
        const error = new Error(message);
        console.error('[TTS] ConnectionFailed:', payloadJson || message);
        if (this.onError) this.onError(error);
        this.failCurrentSpeak(error);
        return;
      }

      if (event === TTS_EVENT.ConnectionFinished) {
        this.isConnected = false;
        this.connectionId = null;
      }
      return;
    }

    const session = this.readLengthPrefixedString(buffer, offset);
    offset = session.nextOffset;
    const payload = this.readLengthPrefixedPayload(buffer, offset);
    const payloadJson = this.parseJsonPayload(payload.bytes);

    if (session.value) {
      this.sessionId = session.value;
    }

    if (event === TTS_EVENT.SessionStarted) {
      this.isSessionActive = true;
      this.resetPlaybackState();
      if (this.onSessionStarted) this.onSessionStarted();
      return;
    }

    if (event === TTS_EVENT.SessionFinished) {
      this.isSessionActive = false;
      if (this.onSessionFinished) this.onSessionFinished(payloadJson || {});
      this.sessionId = null;
      return;
    }

    if (event === TTS_EVENT.SessionCanceled) {
      this.isSessionActive = false;
      this.sessionId = null;
      return;
    }

    if (event === TTS_EVENT.SessionFailed) {
      const message = payloadJson?.message || 'Session failed';
      const error = new Error(message);
      console.error('[TTS] Session error:', payloadJson || message);
      this.isSessionActive = false;
      if (this.onError) this.onError(error);
      this.failCurrentSpeak(error);
      this.sessionId = null;
      return;
    }

    if (event === TTS_EVENT.TTSSentenceStart || event === TTS_EVENT.TTSSentenceEnd) {
    }
  }

  handleAudioEvent(event, buffer) {
    if (event !== TTS_EVENT.TTSResponse) {
      return;
    }

    let offset = 8;
    const session = this.readLengthPrefixedString(buffer, offset);
    offset = session.nextOffset;
    const payload = this.readLengthPrefixedPayload(buffer, offset);

    if (!this.sessionId || session.value !== this.sessionId || this.interruptedSpeakToken === this.currentSpeakToken) {
      return;
    }

    if (payload.length > 0 && this.onAudioData) {
      this.onAudioData(payload.bytes);
    }
  }

  // 发送 FinishSession
  sendFinishSession() {
    if (!this.sessionId) return;

    const sessionIdBytes = new TextEncoder().encode(this.sessionId);
    const event = TTS_EVENT.FinishSession;

    // payload 必须是空 JSON 对象
    const payloadJson = '{}';
    const payloadData = new TextEncoder().encode(payloadJson);

    const header = this.buildHeader(0x01, 0x04, 0x01, 0x00);
    const eventBuf = new Uint8Array(4);
    this.setUint32BigEndian(eventBuf, 0, event);
    const sessionIdLen = new Uint8Array(4);
    this.setUint32BigEndian(sessionIdLen, 0, sessionIdBytes.length);
    const payloadLen = new Uint8Array(4);
    this.setUint32BigEndian(payloadLen, 0, payloadData.length);

    const totalLen = header.length + 4 + 4 + sessionIdBytes.length + 4 + payloadData.length;
    const message = new Uint8Array(totalLen);
    message.set(header, 0);
    message.set(eventBuf, header.length);
    message.set(sessionIdLen, header.length + 4);
    message.set(sessionIdBytes, header.length + 8);
    message.set(payloadLen, header.length + 8 + sessionIdBytes.length);
    message.set(payloadData, header.length + 8 + sessionIdBytes.length + 4);

    this.send(message);
  }

  // 发送数据
  send(data) {
    if (this.proxyWs && this.proxyWs.readyState === WebSocket.OPEN) {
      this.proxyWs.send(data);
    }
  }

  // 处理接收到的消息
  handleMessage(data) {
    const buffer = data;
    if (buffer.byteLength < 4) {
      console.error('[TTS] Invalid message length');
      return;
    }

    const view = new DataView(buffer);
    const headerByte1 = view.getUint8(1);
    const headerByte2 = view.getUint8(2);
    const messageType = (headerByte1 >> 4) & 0x0F;
    const typeFlags = headerByte1 & 0x0F;
    const serialization = (headerByte2 >> 4) & 0x0F;
    const compression = headerByte2 & 0x0F;

    if ((messageType === 0x09 || messageType === 0x0B) && typeFlags === 0x04) {
      const event = view.getUint32(4, false);

      if (messageType === 0x09) {
        this.handleResponseEvent(event, buffer);
        return;
      }

      if (messageType === 0x0B) {
        this.handleAudioEvent(event, buffer);
        return;
      }
    }

    if (messageType === 0x0F) {
      const errorCode = view.getUint32(4, false);
      const payload = this.readLengthPrefixedPayload(buffer, 8);
      const errorPayload = this.parseJsonPayload(payload.bytes);
      const errorMessage = errorPayload?.message || new TextDecoder().decode(payload.bytes);
      const error = new Error(errorMessage);
      error.code = errorCode;

      console.error('[TTS] Error:', errorCode, errorMessage);
      if (this.onError) {
        this.onError(error);
      }
      this.failCurrentSpeak(error);
    }
  }

  // 播放音频
  async playAudio(audioBuffer, speakToken = this.currentSpeakToken) {
    if (!this.isSpeakTokenActive(speakToken)) {
      return;
    }

    if (!this.audioContext) {
      this.audioContext = new AudioContext({ sampleRate: 24000 });
    }

    if (this.audioContext.state === 'suspended') {
      await this.audioContext.resume();
    }

    const pcmData = audioBuffer.byteOffset === 0 && audioBuffer.byteLength === audioBuffer.buffer.byteLength
      ? audioBuffer.buffer
      : audioBuffer.buffer.slice(audioBuffer.byteOffset, audioBuffer.byteOffset + audioBuffer.byteLength);

    const sampleCount = audioBuffer.length / 2;
    const audioData = new Float32Array(sampleCount);
    const view = new DataView(pcmData);
    for (let i = 0; i < sampleCount; i++) {
      const sample = view.getInt16(i * 2, true);
      audioData[i] = sample / 32768.0;
    }

    const decodedBuffer = this.audioContext.createBuffer(1, audioData.length, 24000);
    decodedBuffer.copyToChannel(audioData, 0);

    const source = this.audioContext.createBufferSource();
    source.buffer = decodedBuffer;
    source.connect(this.audioContext.destination);
    this.activeSources.add(source);
    source.onended = () => {
      this.activeSources.delete(source);
    };

    const now = this.audioContext.currentTime;
    const startAt = Math.max(now, this.nextPlaybackTime || now);
    source.start(startAt);
    this.nextPlaybackTime = startAt + decodedBuffer.duration;
  }

  cleanupSpeakCallbacks() {
    this.onSessionStarted = null;
    this.onAudioData = null;
    this.onSessionFinished = null;
    this.onError = null;
  }

  startPendingSession() {
    if (!this.pendingVoiceType) {
      return;
    }

    const voiceType = this.pendingVoiceType;
    this.sendStartSession(voiceType);
  }

  handleSpeakError(error) {
    if (this.isInterruptedError(error)) {
      this.finishInterruptedSpeak(this.currentSpeakToken);
      return;
    }
    this.cleanupSpeakCallbacks();
    this.stopPlaybackSources();
    this.failCurrentSpeak(error instanceof Error ? error : new Error(String(error)));
    this.currentSpeakToken = 0;
    this.interruptedSpeakToken = null;
  }

  finishSpeak() {
    this.cleanupSpeakCallbacks();
    this.interruptedSpeakToken = null;
    setTimeout(() => {
      this.resolveCurrentSpeak();
      this.currentSpeakToken = 0;
    }, 300);
  }

  beginSpeak() {
    this.currentSpeakToken += 1;
    this.interruptedSpeakToken = null;
    return this.currentSpeakToken;
  }

  isSpeaking() {
    return Boolean(this.currentSpeakToken);
  }

  resetForNextSession() {
    this.isSessionActive = false;
    this.sessionId = null;
    this.pendingText = null;
    this.pendingVoiceType = null;
  }

  // 合成并播放文本
  async speak(text, voiceType = 'zh_female_vv_uranus_bigtts') {
    return new Promise((resolve, reject) => {
      let sessionFinished = false;
      const speakToken = this.beginSpeak();

      this.currentSpeakResolve = resolve;
      this.currentSpeakReject = reject;
      this.pendingText = text;
      this.pendingVoiceType = voiceType;

      this.onSessionStarted = () => {
        if (!this.isSpeakTokenActive(speakToken)) {
          return;
        }
        this.sendText(this.pendingText);
        this.sendFinishSession();
      };

      this.onAudioData = (audioData) => {
        if (!this.isSpeakTokenActive(speakToken)) {
          return;
        }
        this.playAudio(audioData, speakToken).catch((error) => this.handleSpeakError(error));
      };

      this.onSessionFinished = () => {
        if (!this.isSpeakTokenActive(speakToken)) {
          return;
        }
        sessionFinished = true;
        this.resetForNextSession();
        this.finishSpeak();
      };

      this.onError = (error) => {
        this.resetForNextSession();
        this.handleSpeakError(error);
      };

      if (!this.isConnected) {
        this.connect().catch((error) => this.handleSpeakError(error));
      } else if (this.connectionId) {
        this.startPendingSession();
      }

      setTimeout(() => {
        if (!sessionFinished && this.currentSpeakResolve === resolve && this.isSpeakTokenActive(speakToken)) {
          this.resetForNextSession();
          this.cleanupSpeakCallbacks();
          this.resolveCurrentSpeak({ interrupted: false });
          this.currentSpeakToken = 0;
        }
      }, 15000);
    });
  }

  destroy() {
    this.close();
  }

  close() {
    this.interruptedSpeakToken = this.currentSpeakToken || this.interruptedSpeakToken;
    this.stopPlaybackSources();
    if (this.isSessionActive) {
      this.sendFinishSession();
    }
    if (this.proxyWs && this.proxyWs.readyState === WebSocket.OPEN) {
      this.sendFinishConnection();
      this.proxyWs.close();
    } else if (this.proxyWs) {
      this.proxyWs.close();
    }
    this.proxyWs = null;
    if (this.audioContext) {
      this.audioContext.close();
      this.audioContext = null;
    }
    this.resetPlaybackState();
    this.isConnected = false;
    this.connectionId = null;
    this.clearSessionState();
    this.cleanupSpeakCallbacks();
    this.currentSpeakResolve = null;
    this.currentSpeakReject = null;
    this.currentSpeakToken = 0;
    this.interruptedSpeakToken = null;
  }

}

export default DoubaoTTS;
