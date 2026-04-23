/**
 * 豆包 Doubao WebSocket 客户端
 * 支持 ASR 语音识别和 TTS 语音合成的双向流式通信
 */

// 协议常量
const PROTOCOL_VERSION = 0b0001;
const MESSAGE_TYPE_FULL_CLIENT_REQUEST = 0b0001;
const MESSAGE_TYPE_AUDIO_ONLY_REQUEST = 0b0010;
const MESSAGE_TYPE_FULL_SERVER_RESPONSE = 0b1001;
const MESSAGE_TYPE_SERVER_ERROR = 0b1111;

const SERIALIZATION_JSON = 0b0001;
const COMPRESSION_NONE = 0b0000;

// FullClientRequest payload type
const PAYLOAD_TYPE_FULL_CLIENT_REQUEST = 0b001;
const FLAG_WITH_SEQUENCE = 0b0001;
const FLAG_LAST_NO_SEQUENCE = 0b0010;
const FLAG_LAST_WITH_SEQUENCE = 0b0011;

const ERROR_MESSAGE_CODE_SUCCESS = 20000000;

function readInt32(view, offset) {
  return view.getInt32(offset, false);
}

function readUint32(view, offset) {
  return view.getUint32(offset, false);
}

function decodeUtf8(buffer) {
  return new TextDecoder().decode(buffer);
}

function extractResultText(payload) {
  if (!payload || typeof payload !== 'object') return '';
  if (typeof payload.result?.text === 'string') return payload.result.text;
  if (Array.isArray(payload.result) && typeof payload.result[0]?.text === 'string') return payload.result[0].text;
  return payload.text || '';
}

function extractIsFinal(payload) {
  if (!payload || typeof payload !== 'object') return false;
  if (typeof payload.is_final === 'boolean') return payload.is_final;
  if (typeof payload.is_definite === 'boolean') return payload.is_definite;
  if (Array.isArray(payload.result?.utterances)) {
    return payload.result.utterances.some(item => item?.definite === true);
  }
  return false;
}

function normalizeAsrPayload(payload) {
  return {
    ...payload,
    text: extractResultText(payload),
    is_final: extractIsFinal(payload)
  };
}

function parseServerResponsePayload(parsed) {
  if (parsed.payload.byteLength === 0) return null;
  const text = decodeUtf8(parsed.payload);
  const json = JSON.parse(text);
  return normalizeAsrPayload(json);
}

function parseServerErrorPayload(view, payloadOffset, payloadSize) {
  if (payloadOffset + 8 > view.byteLength) {
    throw new Error('服务端错误帧长度不足');
  }
  const errorCode = readUint32(view, payloadOffset);
  const errorMessageSize = readUint32(view, payloadOffset + 4);
  const messageStart = payloadOffset + 8;
  const messageEnd = Math.min(messageStart + errorMessageSize, view.byteLength);
  const errorMessage = decodeUtf8(view.buffer.slice(messageStart, messageEnd));
  return {
    errorCode,
    errorMessage,
    payloadSize
  };
}

function describeMessageType(messageType) {
  switch (messageType) {
    case MESSAGE_TYPE_FULL_CLIENT_REQUEST:
      return 'full_client_request';
    case MESSAGE_TYPE_AUDIO_ONLY_REQUEST:
      return 'audio_only_request';
    case MESSAGE_TYPE_FULL_SERVER_RESPONSE:
      return 'full_server_response';
    case MESSAGE_TYPE_SERVER_ERROR:
      return 'server_error';
    default:
      return `unknown_${messageType.toString(2).padStart(4, '0')}`;
  }
}

function hasSequenceField(messageFlags) {
  return messageFlags === FLAG_WITH_SEQUENCE || messageFlags === FLAG_LAST_WITH_SEQUENCE;
}

function isLastFrameFlag(messageFlags) {
  return messageFlags === FLAG_LAST_NO_SEQUENCE || messageFlags === FLAG_LAST_WITH_SEQUENCE;
}

function shouldUseSequenceBeforePayloadSize(messageType) {
  return messageType === MESSAGE_TYPE_FULL_SERVER_RESPONSE;
}

function shouldUsePayloadSizeBeforeSequence(messageType) {
  return messageType === MESSAGE_TYPE_FULL_CLIENT_REQUEST;
}

function shouldUsePayloadSizeOnly(messageType) {
  return messageType === MESSAGE_TYPE_AUDIO_ONLY_REQUEST;
}

function shouldUseErrorFrame(messageType) {
  return messageType === MESSAGE_TYPE_SERVER_ERROR;
}

function buildProtocolByte2(serializationMethod = SERIALIZATION_JSON, compressionMethod = COMPRESSION_NONE) {
  return ((serializationMethod & 0x0F) << 4) | (compressionMethod & 0x0F);
}

function formatServerError({ errorCode, errorMessage }) {
  return `Doubao ASR 错误 ${errorCode}: ${errorMessage || '未知错误'}`;
}

function shouldTreatAsAudioPayload(parsed) {
  return false;
}

function shouldTreatAsServerError(parsed) {
  return parsed.messageType === MESSAGE_TYPE_SERVER_ERROR;
}

function shouldTreatAsJsonPayload(parsed) {
  return parsed.messageType === MESSAGE_TYPE_FULL_SERVER_RESPONSE;
}

function isSuccessfulServerErrorCode(errorCode) {
  return errorCode === ERROR_MESSAGE_CODE_SUCCESS;
}

function getPayloadSlice(buffer, start, size) {
  return buffer.slice(start, Math.min(start + size, buffer.byteLength));
}

function getErrorMessageSlice(buffer, start, size) {
  return buffer.slice(start, Math.min(start + size, buffer.byteLength));
}

function loggablePayloadSize(size, fallback) {
  return Number.isFinite(size) && size >= 0 ? size : fallback;
}

function getHeaderByteLength(headerSize) {
  return headerSize * 4;
}

function shouldParsePayloadAsJson(parsed) {
  return shouldTreatAsJsonPayload(parsed) && parsed.payload.byteLength > 0;
}

function shouldForwardAudioPayload(parsed) {
  return shouldTreatAsAudioPayload(parsed) && parsed.payload.byteLength > 0;
}

function shouldThrowServerError(parsed) {
  return shouldTreatAsServerError(parsed);
}

function createServerError(parsed) {
  return new Error(formatServerError(parsed.serverError));
}

function getSequenceValue(view, offset) {
  return readInt32(view, offset);
}

function getPayloadSizeValue(view, offset) {
  return readUint32(view, offset);
}

function getMessageFlagsDescription(messageFlags) {
  return messageFlags.toString(2).padStart(4, '0');
}

function getMessageTypeDescription(messageType) {
  return describeMessageType(messageType);
}

function isBufferTooShort(offset, required, total) {
  return offset + required > total;
}

function getPayloadOffsetAfterServerResponse(offset) {
  return offset + 8;
}

function getPayloadOffsetAfterErrorCode(offset) {
  return offset + 8;
}

function getPayloadOffsetAfterClientSequence(offset) {
  return offset + 8;
}

function getPayloadOffsetAfterAudioOnly(offset) {
  return offset + 4;
}

function buildBinaryHeaderByte0() {
  return (PROTOCOL_VERSION << 4) | 0x01;
}

function getReservedByte() {
  return 0x00;
}

function getProtocolSummary(parsed) {
  return {
    messageType: getMessageTypeDescription(parsed.messageType),
    messageFlags: getMessageFlagsDescription(parsed.messageFlags),
    payloadSize: loggablePayloadSize(parsed.payloadSize, parsed.payload?.byteLength ?? 0),
    sequenceId: parsed.sequenceId,
    isLastFrame: parsed.isLastFrame,
    payloadBytes: parsed.payload?.byteLength ?? 0
  };
}

function getServerErrorSummary(serverError) {
  return {
    errorCode: serverError.errorCode,
    errorMessage: serverError.errorMessage
  };
}

function getServerResponsePayload(parsed) {
  return parseServerResponsePayload(parsed);
}

function getServerErrorPayload(parsed, view, payloadOffset) {
  return parseServerErrorPayload(view, payloadOffset, parsed.payloadSize);
}

function shouldEmitTextPayload(payload) {
  return Boolean(payload?.text || payload?.result?.text || payload?.result?.utterances?.length);
}

function shouldEmitAudioPayload(payload) {
  return payload?.byteLength > 0;
}

function getErrorPayloadDescription(parsed) {
  return parsed.serverError ? getServerErrorSummary(parsed.serverError) : null;
}

function shouldLogServerError(parsed) {
  return Boolean(parsed.serverError) && !isSuccessfulServerErrorCode(parsed.serverError.errorCode);
}

function getPayloadSizeOrBufferLength(parsed) {
  return loggablePayloadSize(parsed.payloadSize, parsed.payload?.byteLength ?? 0);
}

function shouldUseSignedSequence(messageFlags) {
  return messageFlags === FLAG_LAST_WITH_SEQUENCE;
}

function getSequenceForLog(sequenceId) {
  return sequenceId;
}

function createPayloadError(message) {
  return new Error(message);
}

function getPayloadFromOffsets(buffer, payloadOffset, payloadSize) {
  return getPayloadSlice(buffer, payloadOffset, payloadSize);
}

function getErrorMessageFromOffsets(buffer, payloadOffset, errorMessageSize) {
  return getErrorMessageSlice(buffer, payloadOffset, errorMessageSize);
}

function shouldHandleAsrResult(payload) {
  return shouldEmitTextPayload(payload);
}

function shouldHandleServerAudio(parsed) {
  return shouldForwardAudioPayload(parsed);
}

function shouldHandleServerJson(parsed) {
  return shouldParsePayloadAsJson(parsed);
}

function getPayloadSerializationDescription(serializationMethod) {
  return serializationMethod.toString(2).padStart(4, '0');
}

function getPayloadCompressionDescription(compressionMethod) {
  return compressionMethod.toString(2).padStart(4, '0');
}

function getProtocolVersionDescription(protocolVersion) {
  return protocolVersion.toString(2).padStart(4, '0');
}

function createUnsupportedFrameError(messageType) {
  return new Error(`不支持的 Doubao 帧类型: ${describeMessageType(messageType)}`);
}

function getPayloadSizeFieldOffset(offset) {
  return offset;
}

function getSequenceFieldOffset(offset) {
  return offset;
}

function getJsonTextFromPayload(payload) {
  return decodeUtf8(payload);
}

function parseJsonText(text) {
  return JSON.parse(text);
}

function getServerErrorMessageText(buffer, start, size) {
  return decodeUtf8(getErrorMessageFromOffsets(buffer, start, size));
}

function shouldRejectServerError(serverError) {
  return !isSuccessfulServerErrorCode(serverError.errorCode);
}

function getLastFrameStatus(messageFlags) {
  return isLastFrameFlag(messageFlags);
}

function getSequencePresenceStatus(messageFlags) {
  return hasSequenceField(messageFlags);
}

function buildJsonProtocolByte() {
  return buildProtocolByte2();
}

function getBinaryHeaderSizeUnits() {
  return 1;
}

function getFullClientRequestMessageType() {
  return MESSAGE_TYPE_FULL_CLIENT_REQUEST;
}

function getAudioOnlyRequestMessageType() {
  return MESSAGE_TYPE_AUDIO_ONLY_REQUEST;
}

function getServerResponseMessageType() {
  return MESSAGE_TYPE_FULL_SERVER_RESPONSE;
}

function getServerErrorMessageType() {
  return MESSAGE_TYPE_SERVER_ERROR;
}

function getSequenceFlag() {
  return FLAG_WITH_SEQUENCE;
}

function getLastFrameFlagWithSequence() {
  return FLAG_LAST_WITH_SEQUENCE;
}

function getLastFrameFlagWithoutSequence() {
  return FLAG_LAST_NO_SEQUENCE;
}

function getJsonSerializationCode() {
  return SERIALIZATION_JSON;
}

function getNoCompressionCode() {
  return COMPRESSION_NONE;
}

function getSuccessErrorCode() {
  return ERROR_MESSAGE_CODE_SUCCESS;
}

function shouldUseServerResponseLayout(messageType) {
  return shouldUseSequenceBeforePayloadSize(messageType);
}

function shouldUseClientRequestLayout(messageType) {
  return shouldUsePayloadSizeBeforeSequence(messageType);
}

function shouldUseAudioOnlyLayout(messageType) {
  return shouldUsePayloadSizeOnly(messageType);
}

function shouldUseServerErrorLayout(messageType) {
  return shouldUseErrorFrame(messageType);
}

function getPayloadOffsetForLayout(messageType, offset) {
  if (shouldUseServerResponseLayout(messageType)) return getPayloadOffsetAfterServerResponse(offset);
  if (shouldUseClientRequestLayout(messageType)) return getPayloadOffsetAfterClientSequence(offset);
  if (shouldUseAudioOnlyLayout(messageType)) return getPayloadOffsetAfterAudioOnly(offset);
  if (shouldUseServerErrorLayout(messageType)) return getPayloadOffsetAfterErrorCode(offset);
  throw createUnsupportedFrameError(messageType);
}

function getSafePayloadSize(view, offset, total) {
  if (isBufferTooShort(offset, 4, total)) {
    throw createPayloadError('数据太短，无法解析 payload size');
  }
  return getPayloadSizeValue(view, getPayloadSizeFieldOffset(offset));
}

function getSafeSequence(view, offset, total) {
  if (isBufferTooShort(offset, 4, total)) {
    throw createPayloadError('数据太短，无法解析 sequence');
  }
  return getSequenceValue(view, getSequenceFieldOffset(offset));
}

function parseByMessageType(buffer, view, messageType, messageFlags, offset, total) {
  if (shouldUseServerResponseLayout(messageType)) {
    const hasSequence = getSequencePresenceStatus(messageFlags);
    if (hasSequence) {
      const sequenceId = getSafeSequence(view, offset, total);
      const payloadSizeOffset = offset + 4;
      const payloadSize = getSafePayloadSize(view, payloadSizeOffset, total);
      const payloadOffset = offset + 8;
      return {
        sequenceId,
        payloadSize,
        payloadOffset,
        payload: getPayloadFromOffsets(buffer, payloadOffset, payloadSize)
      };
    }

    const payloadSize = getSafePayloadSize(view, offset, total);
    const payloadOffset = offset + 4;
    return {
      sequenceId: 0,
      payloadSize,
      payloadOffset,
      payload: getPayloadFromOffsets(buffer, payloadOffset, payloadSize)
    };
  }


  if (shouldUseClientRequestLayout(messageType)) {
    const payloadSize = getSafePayloadSize(view, offset, total);
    let nextOffset = offset + 4;
    let sequenceId = 0;
    if (getSequencePresenceStatus(messageFlags)) {
      sequenceId = getSafeSequence(view, nextOffset, total);
      nextOffset += 4;
    }
    return {
      sequenceId,
      payloadSize,
      payloadOffset: nextOffset,
      payload: getPayloadFromOffsets(buffer, nextOffset, payloadSize)
    };
  }

  if (shouldUseAudioOnlyLayout(messageType)) {
    const payloadSize = getSafePayloadSize(view, offset, total);
    const payloadOffset = offset + 4;
    return {
      sequenceId: 0,
      payloadSize,
      payloadOffset,
      payload: getPayloadFromOffsets(buffer, payloadOffset, payloadSize)
    };
  }

  if (shouldUseServerErrorLayout(messageType)) {
    const errorCode = getSafePayloadSize(view, offset, total);
    const errorMessageSize = getSafePayloadSize(view, offset + 4, total);
    const payloadOffset = offset + 8;
    return {
      sequenceId: 0,
      payloadSize: errorMessageSize,
      payloadOffset,
      payload: getErrorMessageFromOffsets(buffer, payloadOffset, errorMessageSize),
      serverError: {
        errorCode,
        errorMessage: getServerErrorMessageText(buffer, payloadOffset, errorMessageSize)
      }
    };
  }

  throw createUnsupportedFrameError(messageType);
}

function buildProtocolHeaderByte0() {
  return buildBinaryHeaderByte0();
}

function buildProtocolHeaderByte2(serializationMethod = SERIALIZATION_JSON, compressionMethod = COMPRESSION_NONE) {
  return buildProtocolByte2(serializationMethod, compressionMethod);
}

function getDefaultProtocolVersion() {
  return PROTOCOL_VERSION;
}

function getDefaultHeaderSizeUnits() {
  return getBinaryHeaderSizeUnits();
}

function getDefaultReservedByte() {
  return getReservedByte();
}

function getDefaultProtocolSummary(parsed) {
  return getProtocolSummary(parsed);
}

function getDefaultErrorSummary(parsed) {
  return getErrorPayloadDescription(parsed);
}

function getDefaultPayloadSize(parsed) {
  return getPayloadSizeOrBufferLength(parsed);
}

function shouldUseNegativeSequence(messageFlags) {
  return shouldUseSignedSequence(messageFlags);
}

function getJsonPayload(parsed) {
  return getServerResponsePayload(parsed);
}

function getServerErrorFromParsed(parsed) {
  return parsed.serverError;
}

function shouldHandleError(parsed) {
  return shouldThrowServerError(parsed);
}

function shouldHandleJson(parsed) {
  return shouldHandleServerJson(parsed);
}

function shouldHandleAudio(parsed) {
  return shouldHandleServerAudio(parsed);
}

function getSequenceLogValue(parsed) {
  return getSequenceForLog(parsed.sequenceId);
}

function getPayloadBytesValue(parsed) {
  return parsed.payload?.byteLength ?? 0;
}

function getProtocolDebugInfo(parsed) {
  return {
    protocolVersion: getProtocolVersionDescription(parsed.protocolVersion),
    serializationMethod: getPayloadSerializationDescription(parsed.serializationMethod),
    compressionMethod: getPayloadCompressionDescription(parsed.compressionMethod)
  };
}

function getProtocolTraceInfo(parsed) {
  return {
    ...getDefaultProtocolSummary(parsed),
    ...getProtocolDebugInfo(parsed)
  };
}

function getServerErrorLog(parsed) {
  return getDefaultErrorSummary(parsed);
}

function shouldRejectParsedFrame(parsed) {
  return shouldHandleError(parsed) && shouldRejectServerError(parsed.serverError);
}

function createParsedFrameError(parsed) {
  return createServerError(parsed);
}

function getParsedPayload(parsed) {
  return parsed.payload;
}

function getParsedMessageType(parsed) {
  return parsed.messageType;
}

function getParsedServerError(parsed) {
  return parsed.serverError;
}

function shouldEmitJsonPayload(payload) {
  return shouldHandleAsrResult(payload);
}

function shouldEmitBinaryPayload(payload) {
  return shouldEmitAudioPayload(payload);
}

function getServerPayload(parsed) {
  return getParsedPayload(parsed);
}

function getServerPayloadType(parsed) {
  return getParsedMessageType(parsed);
}

function getServerPayloadError(parsed) {
  return getParsedServerError(parsed);
}

function createFrameParseError(message) {
  return new Error(message);
}

function getRequiredHeaderBytes() {
  return 4;
}

function ensureHeaderBytes(offset, total) {
  if (isBufferTooShort(offset, getRequiredHeaderBytes(), total)) {
    throw createFrameParseError('数据太短，无法解析协议头');
  }
}

function ensureProtocolVersion(protocolVersion) {
  if (protocolVersion !== getDefaultProtocolVersion()) {
    console.warn('[Doubao] 未识别的协议版本:', protocolVersion);
  }
}

function ensurePayloadWithinBounds(payloadOffset, payloadSize, total) {
  if (payloadOffset > total) {
    throw createFrameParseError('payload 起始位置越界');
  }
  if (payloadOffset + payloadSize > total) {
    throw createFrameParseError('payload 长度越界');
  }
}

function parseBinaryMessage(buffer) {
  const view = new DataView(buffer);
  let offset = 0;
  ensureHeaderBytes(offset, buffer.byteLength);

  const byte0 = view.getUint8(offset++);
  const protocolVersion = (byte0 >> 4) & 0x0F;
  const headerSize = byte0 & 0x0F;
  const byte1 = view.getUint8(offset++);
  const messageType = (byte1 >> 4) & 0x0F;
  const messageFlags = byte1 & 0x0F;
  const byte2 = view.getUint8(offset++);
  const serializationMethod = (byte2 >> 4) & 0x0F;
  const compressionMethod = byte2 & 0x0F;
  offset += 1;

  ensureProtocolVersion(protocolVersion);

  const headerByteLength = getHeaderByteLength(headerSize);
  offset = headerByteLength;

  const parsedBody = parseByMessageType(buffer, view, messageType, messageFlags, offset, buffer.byteLength);
  ensurePayloadWithinBounds(parsedBody.payloadOffset, parsedBody.payloadSize, buffer.byteLength);

  return {
    protocolVersion,
    headerSize,
    messageType,
    messageFlags,
    serializationMethod,
    compressionMethod,
    payloadSize: parsedBody.payloadSize,
    sequenceId: parsedBody.sequenceId,
    payload: parsedBody.payload,
    remainingBytes: buffer.byteLength - parsedBody.payloadOffset,
    isLastFrame: getLastFrameStatus(messageFlags),
    serverError: parsedBody.serverError || null
  };
}

function logParsedMessage(parsed) {
  console.log('[Doubao] 收到消息:', getProtocolTraceInfo(parsed));
  if (shouldLogServerError(parsed)) {
    console.error('[Doubao] 服务端错误:', getServerErrorLog(parsed));
  }
}

function emitParsedMessage(client, parsed) {
  if (shouldRejectParsedFrame(parsed)) {
    const error = createParsedFrameError(parsed);
    if (client.onError) client.onError(error);
    return;
  }

  if (shouldHandleJson(parsed)) {
    const payload = getJsonPayload(parsed);
    if (shouldEmitJsonPayload(payload) && client.onText) {
      client.onText(payload);
    }
    return;
  }

  if (shouldHandleAudio(parsed)) {
    const payload = getServerPayload(parsed);
    if (shouldEmitBinaryPayload(payload) && client.onAudio) {
      client.onAudio(payload);
    }
  }
}

function getRequestMessageType() {
  return getFullClientRequestMessageType();
}

function getAudioMessageType() {
  return getAudioOnlyRequestMessageType();
}

function getDefaultSequenceFlag() {
  return getSequenceFlag();
}

function getDefaultLastFrameFlag() {
  return getLastFrameFlagWithSequence();
}

function getDefaultHeaderByte0() {
  return buildProtocolHeaderByte0();
}

function getDefaultHeaderByte2(serializationMethod = SERIALIZATION_JSON, compressionMethod = COMPRESSION_NONE) {
  return buildProtocolHeaderByte2(serializationMethod, compressionMethod);
}

function getJsonSerializationMethod() {
  return getJsonSerializationCode();
}

function getCompressionMethod() {
  return getNoCompressionCode();
}

function getSuccessCode() {
  return getSuccessErrorCode();
}

function getRequestLayoutType() {
  return getRequestMessageType();
}

function getAudioLayoutType() {
  return getAudioMessageType();
}

function getSequenceFlagValue() {
  return getDefaultSequenceFlag();
}

function getLastFrameFlagValue() {
  return getDefaultLastFrameFlag();
}

function getHeaderVersionByte() {
  return getDefaultHeaderByte0();
}

function getHeaderSerializationByte(serializationMethod = SERIALIZATION_JSON, compressionMethod = COMPRESSION_NONE) {
  return getDefaultHeaderByte2(serializationMethod, compressionMethod);
}

function getSuccessCodeValue() {
  return getSuccessCode();
}

function getBinaryMessageParser() {
  return parseBinaryMessage;
}

function getParsedMessageEmitter() {
  return emitParsedMessage;
}

function getParsedMessageLogger() {
  return logParsedMessage;
}

function getProtocolHeaderByte0() {
  return getHeaderVersionByte();
}

function getProtocolHeaderByte2Value(serializationMethod = SERIALIZATION_JSON, compressionMethod = COMPRESSION_NONE) {
  return getHeaderSerializationByte(serializationMethod, compressionMethod);
}

function getClientRequestMessageType() {
  return getRequestLayoutType();
}

function getClientAudioMessageType() {
  return getAudioLayoutType();
}

function getClientSequenceFlag() {
  return getSequenceFlagValue();
}

function getClientLastFrameFlag() {
  return getLastFrameFlagValue();
}

function getServerSuccessCode() {
  return getSuccessCodeValue();
}

function getMessageParser() {
  return getBinaryMessageParser();
}

function getMessageEmitter() {
  return getParsedMessageEmitter();
}

function getMessageLogger() {
  return getParsedMessageLogger();
}

function parseIncomingMessage(buffer) {
  return getMessageParser()(buffer);
}

function emitIncomingMessage(client, parsed) {
  return getMessageEmitter()(client, parsed);
}

function logIncomingMessage(parsed) {
  return getMessageLogger()(parsed);
}

function getClientFullRequestType() {
  return getClientRequestMessageType();
}

function getClientAudioOnlyType() {
  return getClientAudioMessageType();
}

function getClientSequenceFlagValue() {
  return getClientSequenceFlag();
}

function getClientLastAudioFlagValue() {
  return getClientLastFrameFlag();
}

function getHeaderByte0Value() {
  return getProtocolHeaderByte0();
}

function getHeaderByte2Value() {
  return getProtocolHeaderByte2Value();
}

function getServerOkCode() {
  return getServerSuccessCode();
}

export class DoubaoClient {
  constructor(config) {
    this.appKey = config.appKey;
    this.accessKey = config.accessKey;
    this.resourceId = config.resourceId;
    this.proxyUrl = config.proxyUrl;

    this.ws = null;
    this.connectId = this.generateConnectId();
    this.sequenceId = 0;

    // 回调函数
    this.onOpen = null;
    this.onClose = null;
    this.onError = null;
    this.onAudio = null;
    this.onText = null;
    this.onEvent = null;

    // 状态
    this.isConnected = false;
    this.isRecording = false;
  }

  generateConnectId() {
    return `${Date.now()}-${Math.random().toString(36).substring(2, 15)}`;
  }

  nextSequenceId() {
    return this.sequenceId++;
  }

  /**
   * 构建 WebSocket 连接 URL
   */
  buildUrl() {
    const baseUrl = this.proxyUrl || `ws://${window.location.host}/proxy`;
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
   * 构建 FullClientRequest JSON payload（ASR 2.0）
   */
  buildFullClientRequest(audioFormat = 'pcm', sampleRate = 16000, codec = 'raw') {
    return {
      user: {
        uid: 'user-' + this.connectId
      },
      audio: {
        format: audioFormat,
        rate: sampleRate,
        bits: 16,
        codec: codec,
        channel: 1
      },
      request: {
        reqid: this.connectId,
        workflow: '4001',
        sequence_id: this.nextSequenceId(),
        // ASR 2.0 参数
        model_name: 'bigmodel',
        enable_nonstream: true,  // 开启二遍识别
        enable_itn: true,         // 启用文本规范化
        enable_punc: true,        // 启用标点
        enable_ddc: false,        // 语义顺滑
        force_to_speech_time: 1,  // 强制语音时间
        end_window_size: 800      // 强制判停时间
      }
    };
  }

  /**
   * 构建协议头 (4 bytes) - 根据文档 header 固定 4 字节
   */
  buildProtocolHeader(messageType, flags = 0, serializationMethod = SERIALIZATION_JSON, compressionMethod = COMPRESSION_NONE) {
    const header = new ArrayBuffer(4);
    const view = new DataView(header);

    view.setUint8(0, getHeaderByte0Value());
    view.setUint8(1, (messageType << 4) | (flags & 0x0F));
    view.setUint8(2, getProtocolHeaderByte2Value(serializationMethod, compressionMethod));
    view.setUint8(3, getDefaultReservedByte());

    return header;
  }

  /**
   * 构建 Payload Header (12 bytes) - 大端表示
   */
  buildPayloadHeader(payloadType, sequenceId, payloadSize) {
    const header = new ArrayBuffer(12);
    const view = new DataView(header);

    view.setUint32(0, payloadSize, false);
    view.setUint32(4, payloadType, false);
    view.setInt32(8, sequenceId, false);

    return header;
  }

  /**
   * 构建音频帧 (Audio Only Request)
   * 格式：Protocol Header(4B) + Payload Size(4B) + Payload(音频数据)
   */
  buildAudioFrame(audioData, isLastFrame = false) {
    const flags = isLastFrame ? getLastFrameFlagWithoutSequence() : 0;
    const protocolHeader = this.buildProtocolHeader(
      getClientAudioOnlyType(),
      flags,
      0,
      getNoCompressionCode()
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
   * 构建 FullClientRequest 帧
   * 格式：Protocol Header(4B) + Payload Size(4B) + Payload(JSON)
   */
  buildFullClientRequestFrame() {
    const payloadJson = JSON.stringify(this.buildFullClientRequest());
    const payloadData = new TextEncoder().encode(payloadJson);
    const protocolHeader = this.buildProtocolHeader(
      getClientFullRequestType(),
      0,
      getJsonSerializationCode(),
      getNoCompressionCode()
    );

    const payloadSizeBuffer = new ArrayBuffer(4);
    new DataView(payloadSizeBuffer).setUint32(0, payloadData.length, false);

    const totalSize = protocolHeader.byteLength + payloadSizeBuffer.byteLength + payloadData.length;
    const buffer = new ArrayBuffer(totalSize);
    const bytes = new Uint8Array(buffer);

    bytes.set(new Uint8Array(protocolHeader), 0);
    bytes.set(new Uint8Array(payloadSizeBuffer), protocolHeader.byteLength);
    bytes.set(payloadData, protocolHeader.byteLength + payloadSizeBuffer.byteLength);

    return buffer;
  }

  /**
   * 构建请求结束帧 (最后一包音频)
   */
  buildEndRequestFrame() {
    const emptyAudio = new Int16Array(0);
    return this.buildAudioFrame(emptyAudio.buffer, true);
  }

  parseMessage(data) {
    if (!(data instanceof ArrayBuffer)) {
      console.log('[Doubao] 非 ArrayBuffer 消息:', data);
      return null;
    }

    return parseIncomingMessage(data);
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
        console.log('[Doubao] 连接到:', `${baseUrl}?resource_id=${encodeURIComponent(authParams.resource_id)}&connect_id=${encodeURIComponent(authParams.connect_id)}`);

        this.ws = new WebSocket(url);
        this.ws.binaryType = 'arraybuffer';

        this.ws.onopen = () => {
          console.log('[Doubao] WebSocket 已连接');
          this.isConnected = true;

          const requestFrame = this.buildFullClientRequestFrame();
          this.ws.send(requestFrame);
          console.log('[Doubao] 已发送 FullClientRequest');

          if (this.onOpen) {
            this.onOpen();
          }
          resolve();
        };

        this.ws.onclose = (event) => {
          console.log('[Doubao] WebSocket 已关闭:', event.code, event.reason);
          this.isConnected = false;
          this.ws = null;

          if (this.onClose) {
            this.onClose(event);
          }
        };

        this.ws.onerror = (error) => {
          console.error('[Doubao] WebSocket 错误:', error);
          this.isConnected = false;

          if (this.onError) {
            this.onError(error);
          }
          reject(error);
        };

        this.ws.onmessage = (event) => {
          this.handleMessage(event.data);
        };
      } catch (error) {
        console.error('[Doubao] 连接失败:', error);
        reject(error);
      }
    });
  }


  /**
   * 处理收到的消息
   */
  handleMessage(data) {
    try {
      const parsed = this.parseMessage(data);
      if (!parsed) {
        return;
      }

      logIncomingMessage(parsed);
      emitIncomingMessage(this, parsed);
    } catch (error) {
      console.error('[Doubao] 消息解析失败:', error);
      if (this.onError) {
        this.onError(error);
      }
    }
  }

  /**
   * 发送音频数据
   */
  sendAudio(audioData, isLastFrame = false) {
    if (!this.isConnected || !this.ws) {
      console.warn('[Doubao] 未连接，无法发送音频');
      return false;
    }

    const frame = this.buildAudioFrame(audioData, isLastFrame);
    this.ws.send(frame);
    return true;
  }

  /**
   * 发送结束请求
   */
  sendEndRequest() {
    if (!this.isConnected || !this.ws) {
      console.warn('[Doubao] 未连接，无法发送结束请求');
      return false;
    }

    const frame = this.buildEndRequestFrame();
    this.ws.send(frame);
    console.log('[Doubao] 已发送结束请求');
    return true;
  }

  /**
   * 关闭连接
   */
  close() {
    if (this.ws) {
      this.isRecording = false;
      this.ws.close();
      this.ws = null;
    }
    this.isConnected = false;
  }
}
