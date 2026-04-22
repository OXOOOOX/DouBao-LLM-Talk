// 豆包流式语音识别 2.0 - WebSocket 双向流式优化版
// 接口地址：wss://openspeech.bytedance.com/api/v3/sauc/bigmodel_async
// 通过本地代理服务器连接

const DEFAULT_VOLC_CONFIG = {
  appId: import.meta.env.VITE_VOLC_APP_ID || '',
  accessToken: import.meta.env.VITE_VOLC_ACCESS_TOKEN || '',
  apiKey: import.meta.env.VITE_VOLC_API_KEY || '',
  resourceId: import.meta.env.VITE_VOLC_RESOURCE_ID || 'volc.bigasr.sauc.duration',
  proxyUrl: import.meta.env.VITE_VOLC_PROXY_URL || 'ws://localhost:3001/proxy'
};

export class DoubaoASR {
  constructor() {
    this.ws = null;
    this.proxyWs = null;
    this.sequence = 0;
    this.onResult = null;
    this.onError = null;
    this.onOpen = null;
    this.onClose = null;
    this.isConnected = false;
    this.config = { ...DEFAULT_VOLC_CONFIG };
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

  generateUUID() {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
      const r = Math.random() * 16 | 0;
      const v = c === 'x' ? r : (r & 0x3 | 0x8);
      return v.toString(16);
    });
  }

  connect() {
    return new Promise((resolve, reject) => {
      console.log('[ASR] Connecting to proxy:', this.config.proxyUrl);

      this.proxyWs = new WebSocket(this.config.proxyUrl);
      this.proxyWs.binaryType = 'arraybuffer';

      this.proxyWs.onopen = () => {
        console.log('[ASR] Connected to proxy server');

        const config = {
          appId: this.config.appId,
          accessToken: this.config.accessToken,
          apiKey: this.config.apiKey,
          resourceId: this.config.resourceId
        };

        this.proxyWs.send(JSON.stringify(config));
      };

      this.proxyWs.onmessage = (event) => {
        console.log('[ASR] Received message type:', typeof event.data, event.data.constructor.name);

        if (typeof event.data === 'string') {
          try {
            const msg = JSON.parse(event.data);
            console.log('[ASR] JSON message:', msg);
            if (msg.type === 'connected') {
              console.log('[ASR] Connected to Volcengine via proxy');
              this.isConnected = true;
              if (this.onOpen) this.onOpen();
              resolve();
              return;
            } else if (msg.type === 'error') {
              console.error('[ASR] Proxy error:', msg.message, msg.details || '');
              const error = new Error(msg.message);
              if (msg.details) {
                error.details = msg.details;
              }
              if (this.onError) this.onError(error);
              reject(error);
              return;
            }
          } catch (e) {
            console.log('[ASR] Failed to parse JSON:', e);
          }
          return;
        }

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
        console.error('[ASR] Proxy error:', error);
        if (this.onError) this.onError(error);
        reject(error);
      };

      this.proxyWs.onclose = () => {
        console.log('[ASR] Proxy connection closed');
        this.isConnected = false;
        if (this.onClose) this.onClose();
      };
    });
  }

  sendFullClientRequest() {
    if (!this.isConnected) {
      console.error('[ASR] Not connected, cannot send request');
      return;
    }

    const requestPayload = {
      user: {
        uid: navigator.userAgent,
        did: 'browser-' + Date.now(),
        platform: 'Web',
        sdk_version: '1.0.0',
        app_version: '0.0.1'
      },
      audio: {
        format: 'pcm',
        codec: 'raw',
        rate: 16000,
        bits: 16,
        channel: 1,
        language: 'zh-CN'
      },
      request: {
        model_name: 'bigmodel',
        enable_itn: true,
        enable_punc: true,
        enable_ddc: false,
        enable_nonstream: false,
        ssd_version: '200',
        result_type: 'full',
        end_window_size: 800,
        force_to_speech_time: 1000,
        show_utterances: true
      }
    };

    const payloadJson = JSON.stringify(requestPayload);
    const payloadData = new TextEncoder().encode(payloadJson);

    const header = this.buildHeader(0x01, 0x00, 0x01, 0x00);
    const payloadSize = new Uint8Array(4);
    this.setUint32BigEndian(payloadSize, 0, payloadData.length);

    const message = new Uint8Array(header.length + 4 + payloadData.length);
    message.set(header, 0);
    message.set(payloadSize, header.length);
    message.set(payloadData, header.length + 4);

    this.send(message);
    console.log('[ASR] Sent full client request');
  }

  sendAudioData(audioBuffer, isLast = false) {
    if (!this.isConnected) return;

    const header = this.buildHeader(0x02, isLast ? 0x02 : 0x00, 0x00, 0x00);
    const payloadSize = new Uint8Array(4);
    this.setUint32BigEndian(payloadSize, 0, audioBuffer.byteLength);

    const message = new Uint8Array(header.length + 4 + audioBuffer.byteLength);
    message.set(header, 0);
    message.set(payloadSize, header.length);
    message.set(new Uint8Array(audioBuffer), header.length + 4);

    this.send(message);
  }

  sendLastPackage() {
    if (!this.isConnected) return;

    const header = this.buildHeader(0x02, 0x03, 0x00, 0x00);
    const payloadSize = new Uint8Array(4);
    this.setUint32BigEndian(payloadSize, 0, 0);

    const message = new Uint8Array(header.length + 4);
    message.set(header, 0);
    message.set(payloadSize, header.length);

    this.send(message);
    console.log('[ASR] Sent last package');
  }

  buildHeader(messageType, typeFlags, serialization, compression) {
    const header = new Uint8Array(4);
    header[0] = (0x01 << 4) | 0x01;
    header[1] = (messageType << 4) | typeFlags;
    header[2] = (serialization << 4) | compression;
    header[3] = 0x00;
    return header;
  }

  setUint32BigEndian(array, offset, value) {
    array[offset] = (value >> 24) & 0xFF;
    array[offset + 1] = (value >> 16) & 0xFF;
    array[offset + 2] = (value >> 8) & 0xFF;
    array[offset + 3] = value & 0xFF;
  }

  send(data) {
    if (this.proxyWs && this.proxyWs.readyState === WebSocket.OPEN) {
      this.proxyWs.send(data);
    }
  }

  handleMessage(data) {
    const buffer = data;
    if (buffer.byteLength < 4) {
      console.error('[ASR] Invalid message length');
      return;
    }

    const view = new DataView(buffer);
    const headerByte1 = view.getUint8(1);
    const headerByte2 = view.getUint8(2);

    const messageType = (headerByte1 >> 4) & 0x0F;
    const typeFlags = headerByte1 & 0x0F;
    const serialization = (headerByte2 >> 4) & 0x0F;
    const compression = headerByte2 & 0x0F;

    console.log('[ASR] Message received:', { messageType, typeFlags, serialization, compression });

    if (messageType === 0x09) {
      let offset = 4;

      if ((typeFlags & 0x01) !== 0 || (typeFlags & 0x02) !== 0) {
        offset += 4;
      }

      console.log('[ASR] typeFlags:', typeFlags, 'offset:', offset);

      const payloadSize = view.getUint32(offset, false);
      const payloadStart = offset + 4;

      console.log('[ASR] Payload size:', payloadSize, 'buffer byteLength:', buffer.byteLength);

      try {
        const payloadData = new Uint8Array(buffer, payloadStart, payloadSize);
        const payloadJson = new TextDecoder().decode(payloadData);
        const response = JSON.parse(payloadJson);

        console.log('[ASR] Response:', response);

        if (this.onResult) {
          this.onResult(response);
        }
      } catch (e) {
        console.error('[ASR] Parse response error:', e);
      }
      return;
    }

    if (messageType === 0x0F) {
      const errorCode = view.getUint32(4);
      const errorSize = view.getUint32(8);
      const errorMessage = new TextDecoder().decode(
        new Uint8Array(buffer, 12, errorSize)
      );

      console.error('[ASR] Error:', errorCode, errorMessage);
      if (this.onError) {
        this.onError({ code: errorCode, message: errorMessage });
      }
    }
  }

  close() {
    if (this.proxyWs) {
      this.proxyWs.close();
      this.proxyWs = null;
    }
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    this.isConnected = false;
  }
}

export default DoubaoASR;
