/**
 * 豆包语音对话应用 - 主入口
 * 语音输入 → 豆包识别 → QWEN 回答 → TTS 播报
 */

import { DoubaoClient } from './doubao.js';
import { QwenClient } from './qwen.js';
import { TTSClient } from './tts.js';

// ==================== 状态管理 ====================

const state = {
  // 配置
  config: {
    qwenApiKey: '',
    qwenModel: 'qwen-max',
    volcAppKey: '',
    volcAccessKey: '',
    volcApiKey: '',
    volcResourceId: 'volc.seedasr.sauc.duration',
    volcTtsResourceId: 'seed-tts-2.0',
    volcTtsVoice: 'zh_female_vv_uranus_bigtts',
    volcProxyUrl: 'ws://localhost:3001/proxy'
  },

  // 录音状态
  isRecording: false,
  isAwaitingFinalAsr: false,
  audioContext: null,
  mediaStream: null,
  scriptProcessor: null,

  // 客户端实例
  asrClient: null,
  qwenClient: null,
  ttsClient: null,

  // TTS 播放状态
  ttsAudioQueue: [],
  isPlaying: false,
  audioContext: null,

  // 对话状态
  isProcessing: false,
  isSpeaking: false,
  conversationHistory: [],

  // 计时
  timers: {
    start: 0,
    asrComplete: 0,
    qwenFirstToken: 0,
    qwenComplete: 0,
    ttsStart: 0
  },

  // 当前助手消息元素
  currentAssistantMessage: null
};

// ==================== DOM 元素 ====================

const elements = {
  settingsToggle: document.getElementById('settings-toggle-btn'),
  settingsPanel: document.getElementById('settings-panel'),
  settingsSave: document.getElementById('settings-save-btn'),
  settingsStatus: document.getElementById('settings-status'),
  startBtn: document.getElementById('start-btn'),
  stopBtn: document.getElementById('stop-btn'),
  clearBtn: document.getElementById('clear-btn'),
  modelSelect: document.getElementById('model-select'),
  voiceSelect: document.getElementById('voice-select'),
  chatMessages: document.getElementById('chat-messages'),
  statusText: document.getElementById('status-text'),
  latencyText: document.getElementById('latency-text'),
  realtimeText: document.getElementById('realtime-text'),

  // 设置输入
  qwenApiKey: document.getElementById('settings-qwen-api-key'),
  qwenModel: document.getElementById('settings-qwen-model'),
  volcAppKey: document.getElementById('settings-volc-app-key'),
  volcAccessKey: document.getElementById('settings-volc-access-key'),
  volcApiKey: document.getElementById('settings-volc-api-key'),
  volcTtsVoice: document.getElementById('settings-volc-tts-voice')
};

// ==================== 工具函数 ====================

function updateStatus(text, latency = '') {
  elements.statusText.textContent = text;
  elements.statusText.className = state.isRecording ? 'recording' : '';
  elements.latencyText.textContent = latency;
}

function appendMessage(role, content) {
  const div = document.createElement('div');
  div.className = `message ${role}`;
  div.textContent = content;
  elements.chatMessages.appendChild(div);
  elements.chatMessages.scrollTop = elements.chatMessages.scrollHeight;
  return div;
}

function updateAssistantMessage(content) {
  if (state.currentAssistantMessage) {
    state.currentAssistantMessage.textContent = content;
    elements.chatMessages.scrollTop = elements.chatMessages.scrollHeight;
  }
}

function setLatency(label, value) {
  const current = elements.latencyText.textContent;
  const parts = current ? current.split(' | ') : [];
  const newPart = `${label}: ${value}ms`;

  // 更新或添加该标签
  const existingIndex = parts.findIndex(p => p.startsWith(label));
  if (existingIndex >= 0) {
    parts[existingIndex] = newPart;
  } else {
    parts.push(newPart);
  }

  elements.latencyText.textContent = parts.join(' | ');
}

function clearLatency() {
  elements.latencyText.textContent = '';
}

function resetConversationTimers() {
  state.timers.start = 0;
  state.timers.asrComplete = 0;
  state.timers.qwenFirstToken = 0;
  state.timers.qwenComplete = 0;
  state.timers.ttsStart = 0;
}

function generateConnectId() {
  return `${Date.now()}-${Math.random().toString(36).substring(2, 15)}`;
}

// ==================== 配置管理 ====================

async function loadConfig() {
  console.log('[Config] 开始加载配置...');

  // 从服务器加载配置（服务器会读取 .env.local）
  try {
    const response = await fetch('/config');
    console.log('[Config] 响应状态:', response.status);

    if (response.ok) {
      const data = await response.json();
      console.log('[Config] 服务器返回数据:', data);

      if (data.config) {
        state.config = { ...state.config, ...data.config };
        console.log('[Config] 合并后配置:', state.config);
      }
    } else {
      console.error('[Config] 响应失败:', response.status);
    }
  } catch (e) {
    console.error('[Config] 加载异常:', e);
  }

  // 填充设置表单
  console.log('[Config] 填充表单');
  elements.qwenApiKey.value = state.config.qwenApiKey || '';
  elements.qwenModel.value = state.config.qwenModel || 'qwen-max';
  elements.volcAppKey.value = state.config.volcAppKey || '';
  elements.volcAccessKey.value = state.config.volcAccessKey || '';
  elements.volcApiKey.value = state.config.volcApiKey || '';
  elements.volcTtsVoice.value = state.config.volcTtsVoice || 'zh_female_vv_uranus_bigtts';

  // 同步到主控件
  elements.modelSelect.value = state.config.qwenModel || 'qwen-max';
  elements.voiceSelect.value = state.config.volcTtsVoice || 'zh_female_vv_uranus_bigtts';

  console.log('[Config] 配置加载完成');
}

async function saveConfig() {
  elements.settingsStatus.textContent = '保存中...';
  elements.settingsStatus.className = 'settings-status';

  try {
    const config = {
      qwenApiKey: elements.qwenApiKey.value.trim(),
      qwenModel: elements.qwenModel.value,
      volcAppKey: elements.volcAppKey.value.trim(),
      volcAccessKey: elements.volcAccessKey.value.trim(),
      volcApiKey: elements.volcApiKey.value.trim(),
      volcResourceId: state.config.volcResourceId,
      volcTtsResourceId: state.config.volcTtsResourceId,
      volcTtsVoice: elements.volcTtsVoice.value,
      volcProxyUrl: state.config.volcProxyUrl
    };

    console.log('[Config] 保存配置:', config);

    const response = await fetch('/config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ config })
    });

    if (response.ok) {
      const data = await response.json();
      state.config = { ...state.config, ...data.config };
      console.log('[Config] 已保存，服务器返回:', data.config);
      elements.settingsStatus.textContent = '✓ 已保存';

      // 同步到主控件
      elements.modelSelect.value = state.config.qwenModel;
      elements.voiceSelect.value = state.config.volcTtsVoice;

      // 更新客户端配置
      if (state.qwenClient) {
        state.qwenClient.setApiKey(state.config.qwenApiKey);
        state.qwenClient.setModel(state.config.qwenModel);
      }
    } else {
      const error = await response.json();
      throw new Error(error.error || '保存失败');
    }
  } catch (e) {
    console.error('[Config] 保存失败:', e);
    elements.settingsStatus.textContent = '✗ 保存失败：' + e.message;
    elements.settingsStatus.className = 'settings-status error';
  }
}

// ==================== 录音控制 ====================

async function startRecording() {
  if (state.isRecording) return;

  // 先重新加载配置，确保使用最新的配置
  await loadConfig();

  // 打断当前输出
  stopCurrentOutput();

  state.timers.start = Date.now();
  clearLatency();

  console.log('[Recording] 检查配置:', state.config);

  if (!state.config.volcAppKey || !state.config.volcAccessKey) {
    updateStatus('错误：请先配置豆包 ASR 鉴权');
    appendMessage('system', '请在设置中配置豆包 ASR 的 App Key 和 Access Key');
    return;
  }

  if (!state.config.qwenApiKey) {
    updateStatus('错误：请先配置 Qwen API Key');
    appendMessage('system', '请先在设置中配置 Qwen API Key');
    return;
  }

  updateStatus('连接 ASR...');

  try {
    // 获取麦克风权限
    state.mediaStream = await navigator.mediaDevices.getUserMedia({
      audio: {
        sampleRate: 16000,
        channelCount: 1,
        echoCancellation: true,
        noiseSuppression: true
      }
    });

    state.asrClient = new DoubaoClient({
      appKey: state.config.volcAppKey,
      accessKey: state.config.volcAccessKey,
      resourceId: state.config.volcResourceId,
      proxyUrl: state.config.volcProxyUrl
    });

    // 设置回调
    state.asrClient.onOpen = () => {
      console.log('[ASR] 已连接');
      updateStatus('正在录音...');
      state.isRecording = true;
      elements.startBtn.disabled = true;
      elements.stopBtn.disabled = false;
    };

    state.asrClient.onText = (data) => {
      console.log('[ASR] 文本:', data);
      handleAsrText(data);
    };

    state.asrClient.onAudio = (audioData) => {
      console.log('[ASR] 音频数据:', audioData.byteLength, 'bytes');
    };

    state.asrClient.onEvent = (event) => {
      console.log('[ASR] 事件:', event);
    };

    state.asrClient.onError = (error) => {
      console.error('[ASR] 错误:', error);
      state.isAwaitingFinalAsr = false;
      updateStatus('ASR 错误');
      appendMessage('system', 'ASR 连接失败，请检查配置和网络');
    };

    state.asrClient.onClose = () => {
      console.log('[ASR] 连接关闭');
      state.isAwaitingFinalAsr = false;
      state.asrClient = null;
      if (!state.isProcessing) {
        updateStatus('就绪');
      }
    };

    // 连接
    await state.asrClient.connect();

    // 创建 AudioContext
    state.audioContext = new AudioContext({ sampleRate: 16000 });
    const source = state.audioContext.createMediaStreamSource(state.mediaStream);

    // 使用 ScriptProcessor 处理音频
    state.scriptProcessor = state.audioContext.createScriptProcessor(4096, 1, 1);
    source.connect(state.scriptProcessor);
    state.scriptProcessor.connect(state.audioContext.destination);

    state.scriptProcessor.onaudioprocess = (e) => {
      if (!state.isRecording || !state.asrClient?.isConnected) return;

      const inputData = e.inputBuffer.getChannelData(0);
      const pcmData = floatToPCM16(inputData);
      state.asrClient.sendAudio(pcmData.buffer);
    };

  } catch (error) {
    console.error('[Recording] 启动失败:', error);
    updateStatus('错误：' + error.message);
    appendMessage('system', '录音启动失败：' + error.message);
    stopRecording();
  }
}

function stopRecording() {
  if (!state.isRecording && !state.asrClient && !state.mediaStream && !state.audioContext && !state.scriptProcessor) {
    return;
  }

  state.isRecording = false;
  state.isAwaitingFinalAsr = Boolean(state.asrClient?.isConnected);
  updateStatus(state.isAwaitingFinalAsr || state.isProcessing ? '处理中...' : '就绪');

  // 发送结束帧
  if (state.asrClient?.isConnected) {
    state.asrClient.sendEndRequest();
  }

  // 停止音频处理
  if (state.scriptProcessor) {
    state.scriptProcessor.disconnect();
    state.scriptProcessor.onaudioprocess = null;
    state.scriptProcessor = null;
  }

  if (state.audioContext) {
    state.audioContext.close();
    state.audioContext = null;
  }

  if (state.mediaStream) {
    state.mediaStream.getTracks().forEach(track => track.stop());
    state.mediaStream = null;
  }

  elements.startBtn.disabled = false;
  elements.stopBtn.disabled = true;
}

function stopCurrentOutput() {
  state.isSpeaking = false;
  state.isProcessing = false;
  state.isAwaitingFinalAsr = false;
  state.currentAssistantMessage = null;
  resetConversationTimers();

  // 停止 TTS
  if (state.isPlaying || state.ttsClient) {
    stopTTS();
  }

  // 停止 Qwen
  if (state.qwenClient?.stop) {
    state.qwenClient.stop();
  }
}

// ==================== ASR 处理 ====================

let currentRealtimeText = '';
let lastDefiniteText = '';

function handleAsrText(data) {
  // data 结构可能为：
  // { result: { text: "..." }, is_final: true/false }
  // 或 { text: "...", is_definite: true }
  // 注意：result.text 是累积文本（包含本次会话所有已识别文字）

  const text = data.result?.text || data.text || '';
  const isFinal = data.is_final || data.is_definite || false;

  if (text) {
    if (isFinal) {
      // 最终识别结果（累积文本）
      currentRealtimeText = text;
      elements.realtimeText.textContent = text;

      if (text !== lastDefiniteText && text.trim()) {
        // 提取新增部分：如果新文本以旧文本开头，只取新增的部分
        let newText = text;
        if (lastDefiniteText && text.startsWith(lastDefiniteText)) {
          newText = text.substring(lastDefiniteText.length).trim();
        }
        lastDefiniteText = text;
        state.isAwaitingFinalAsr = false;

        if (newText.trim()) {
          handleUserMessage(newText);
        }
      }
    } else {
      // 中间识别结果
      currentRealtimeText = text;
      elements.realtimeText.textContent = text + '...';
    }
  }
}

// ==================== 对话处理 ====================

// 记录当前处理的请求ID，防止并发打断时的状态冲突
let currentProcessId = 0;

async function handleUserMessage(text) {
  const processId = ++currentProcessId;

  if (state.isProcessing) {
    console.log('[App] 收到新输入，打断当前输出');
    stopCurrentOutput();
    // 稍微等待一下前一个异步流程清理完毕
    await sleep(100);
  }

  state.isProcessing = true;
  state.timers.asrComplete = Date.now();
  state.timers.qwenFirstToken = 0;
  state.timers.qwenComplete = 0;
  state.timers.ttsStart = 0;
  setLatency('识别完成', Date.now() - state.timers.start);

  // 添加用户消息
  appendMessage('user', text);
  state.conversationHistory.push({ role: 'user', content: text });

  // 创建助手消息占位
  state.currentAssistantMessage = appendMessage('assistant', '...');

  updateStatus('思考中...');

  try {
    // 创建 Qwen 客户端
    if (!state.qwenClient) {
      state.qwenClient = new QwenClient({
        apiKey: state.config.qwenApiKey,
        model: state.config.qwenModel
      });
    }

    // 先建立 TTS 连接，这样 LLM 一出文字就能立刻送入 TTS
    await startTTSStream();

    let fullResponse = '';

    await state.qwenClient.chat(state.conversationHistory, (chunk, full) => {
      fullResponse = full;
      updateAssistantMessage(full);

      if (state.timers.qwenFirstToken === 0) {
        state.timers.qwenFirstToken = Date.now();
        setLatency('首字', Date.now() - state.timers.asrComplete);
        updateStatus('TTS 播报中...');
      }

      // 流式将完整句子喂给 TTS
      feedTTSFromStream(full);
    });

    state.timers.qwenComplete = Date.now();
    setLatency('Qwen 完成', Date.now() - state.timers.qwenFirstToken);

    // 保存助手回复到历史
    state.conversationHistory.push({ role: 'assistant', content: fullResponse });
    state.currentAssistantMessage = null;

    // LLM 输出完毕，发送剩余文本并等待 TTS 播放完成
    console.log('[Pipeline] LLM 完成，等待 TTS 播放完成');
    await endTTSStream();

  } catch (error) {
    if (error.name === 'AbortError' || processId !== currentProcessId) {
      console.log('[App] 流程被打断');
      return;
    }
    console.error('[Qwen] 错误:', error);
    updateAssistantMessage('抱歉，出错了：' + error.message);
    // 出错时清理 TTS
    cleanupTTS();
  } finally {
    if (processId === currentProcessId) {
      state.isProcessing = false;
      resetConversationTimers();
      updateStatus('就绪');
    }
  }
}

// ==================== 音频工具 ====================

function floatToPCM16(float32Array) {
  const int16Array = new Int16Array(float32Array.length);
  for (let i = 0; i < float32Array.length; i++) {
    const s = Math.max(-1, Math.min(1, float32Array[i]));
    int16Array[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
  }
  return int16Array;
}

// ==================== TTS 流式播放 ====================

// 音频缓冲区 - 用于累积小音频块
let audioBuffer = [];
let audioBufferSize = 0;
let isDecodingAudio = false;
const MIN_DECODE_SIZE = 1024; // 最小解码大小（字节）

// 顺序播放控制
let scheduledEndTime = 0;      // 下一段音频应该开始播放的时间
let currentPlayingSource = null; // 当前正在播放的音频源
let isAudioPlaying = false;     // 是否有音频正在播放

// 流式 TTS 句子缓冲
let ttsSentenceBuffer = '';    // 尚未凑成完整句子的文本
let ttsSentCharCount = 0;     // 已经发送给 TTS 的字符总数

/**
 * 初始化 TTS 流式连接（在 LLM 开始流式输出之前调用）
 */
async function startTTSStream() {
  state.isPlaying = true;
  state.timers.ttsStart = Date.now();
  state.ttsAudioQueue = [];
  audioBuffer = [];
  audioBufferSize = 0;
  isDecodingAudio = false;
  scheduledEndTime = 0;
  currentPlayingSource = null;
  isAudioPlaying = false;
  ttsSentenceBuffer = '';
  ttsSentCharCount = 0;

  // 创建 TTS 客户端
  state.ttsClient = new TTSClient({
    apiKey: state.config.volcApiKey,
    resourceId: state.config.volcTtsResourceId,
    voiceType: state.config.volcTtsVoice,
    proxyUrl: state.config.volcProxyUrl
  });

  // 初始化 AudioContext
  state.audioContext = new (window.AudioContext || window.webkitAudioContext)();

  // 设置音频回调 - 累积音频块
  state.ttsClient.onAudio = (audioData) => {
    console.log('[TTS] 收到音频:', audioData.byteLength, 'bytes');
    audioBuffer.push(new Uint8Array(audioData));
    audioBufferSize += audioData.byteLength;

    // 当累积足够数据时尝试解码
    if (audioBufferSize >= MIN_DECODE_SIZE && !isDecodingAudio) {
      flushAudioBuffer();
    }
  };

  // 当 session 结束时，刷新剩余音频
  state.ttsClient.onEvent = (evtId, json) => {
    if (evtId === 152 || evtId === 151 || evtId === 153) {
      if (audioBufferSize > 0) {
        flushAudioBuffer();
      }
    }
  };

  state.ttsClient.onOpen = () => {
    console.log('[TTS] 连接已建立');
  };

  state.ttsClient.onError = (error) => {
    console.error('[TTS] 错误:', error.message);
  };

  state.ttsClient.onClose = () => {
    console.log('[TTS] 连接关闭');
    if (audioBufferSize > 0) {
      flushAudioBuffer();
    }
  };

  // 连接
  updateStatus('TTS 连接中...');
  await state.ttsClient.connect();
  console.log('[TTS] 流式连接就绪，等待 LLM 输出');
}

/**
 * 从 LLM 流式输出中提取完整句子并实时发送给 TTS
 * @param {string} fullText - LLM 目前累计的完整文本
 */
function feedTTSFromStream(fullText) {
  if (!state.ttsClient?.isConnected) return;

  // 计算新增的文本（fullText 中还没处理过的部分）
  const processedLength = ttsSentCharCount + ttsSentenceBuffer.length;
  const newText = fullText.substring(processedLength);
  if (!newText) return;

  ttsSentenceBuffer += newText;

  // 从缓冲中提取完整句子
  const { sentences, remaining } = extractCompleteSentences(ttsSentenceBuffer);

  for (const sentence of sentences) {
    if (sentence.trim().length > 0) {
      console.log('[TTS] 流式发送句子:', sentence.substring(0, 60));
      state.ttsClient.sendText(sentence, false);
      ttsSentCharCount += sentence.length;
    }
  }

  ttsSentenceBuffer = remaining;
}

/**
 * 从文本中提取完整句子（以标点结尾）
 */
function extractCompleteSentences(text) {
  const sentences = [];
  let current = '';
  for (const char of text) {
    current += char;
    if (/[。！？!?；;：:，,]/.test(char)) {
      sentences.push(current);
      current = '';
    }
  }
  return { sentences, remaining: current };
}

/**
 * LLM 输出完毕后调用：发送剩余文本，等待所有音频播放完成，清理资源
 */
async function endTTSStream() {
  try {
    // 发送剩余未凑成句子的文本
    if (ttsSentenceBuffer.trim().length > 0 && state.ttsClient?.isConnected) {
      console.log('[TTS] 发送剩余文本:', ttsSentenceBuffer.substring(0, 60));
      state.ttsClient.sendText(ttsSentenceBuffer, true);
      ttsSentenceBuffer = '';
    }

    // 结束 TTS session
    state.ttsClient?.finishSession();

    // 等待所有音频播放完成
    await waitForPlayback();

    const duration = Date.now() - state.timers.ttsStart;
    console.log('[TTS] 播报完成，耗时:', duration, 'ms');
    setLatency('TTS 完成', `${duration}ms`);

  } catch (error) {
    console.error('[TTS] 结束错误:', error);
  } finally {
    cleanupTTS();
  }
}

/**
 * 清理 TTS 资源
 */
function cleanupTTS() {
  state.isPlaying = false;
  if (state.ttsClient) {
    state.ttsClient.close();
    state.ttsClient = null;
  }
  if (state.audioContext) {
    state.audioContext.close();
    state.audioContext = null;
  }
  audioBuffer = [];
  audioBufferSize = 0;
  ttsSentenceBuffer = '';
  ttsSentCharCount = 0;
}

/**
 * 合并音频缓冲区并加入播放队列
 */
function flushAudioBuffer() {
  if (audioBuffer.length === 0 || audioBufferSize === 0) return;

  // 合并所有小块为一个大块
  const combined = new Uint8Array(audioBufferSize);
  let offset = 0;
  for (const chunk of audioBuffer) {
    combined.set(chunk, offset);
    offset += chunk.length;
  }

  console.log('[TTS] 合并音频块:', audioBuffer.length, '块 →', audioBufferSize, 'bytes');

  // 清空缓冲
  audioBuffer = [];
  audioBufferSize = 0;

  // 加入播放队列
  state.ttsAudioQueue.push(combined.buffer);
  playNextAudio();
}

function playNextAudio() {
  if (state.ttsAudioQueue.length === 0 || !state.audioContext || isDecodingAudio) return;

  isDecodingAudio = true;
  const audioData = state.ttsAudioQueue.shift();

  state.audioContext.decodeAudioData(audioData.slice(0), (decodedBuffer) => {
    isDecodingAudio = false;

    if (!state.audioContext) return; // 已被关闭

    const source = state.audioContext.createBufferSource();
    source.buffer = decodedBuffer;
    source.connect(state.audioContext.destination);

    // 顺序排列：每段音频在上一段结束后才开始
    const now = state.audioContext.currentTime;
    const startAt = Math.max(now, scheduledEndTime);
    scheduledEndTime = startAt + decodedBuffer.duration;

    isAudioPlaying = true;
    currentPlayingSource = source;

    source.start(startAt);
    source.onended = () => {
      // 检查是否还有更多音频在排队播放
      if (state.audioContext && state.audioContext.currentTime >= scheduledEndTime - 0.05) {
        isAudioPlaying = false;
        currentPlayingSource = null;
      }
      playNextAudio();
    };

    // 继续解码队列中的下一个（提前解码，排队播放）
    playNextAudio();
  }, (error) => {
    isDecodingAudio = false;
    console.error('[Audio] 解码失败:', error, '(', audioData.byteLength, 'bytes)');
    playNextAudio();
  });
}

async function waitForPlayback() {
  const startTime = Date.now();
  const timeout = 60000;

  // 等待所有数据接收完毕
  while (state.ttsAudioQueue.length > 0 || audioBufferSize > 0 || state.ttsClient?.isSessionActive) {
    if (Date.now() - startTime > timeout) {
      console.log('[TTS] 等待数据超时');
      break;
    }
    await sleep(100);
  }

  // 等待解码完成
  while (isDecodingAudio) {
    await sleep(50);
  }

  // 等待音频实际播放完毕
  while (isAudioPlaying) {
    if (Date.now() - startTime > timeout) {
      console.log('[TTS] 等待播放超时');
      break;
    }
    await sleep(100);
  }
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function stopTTS() {
  console.log('[TTS] 停止播报');
  if (state.ttsClient) {
    state.ttsClient.cancelSession();
  }
  state.ttsAudioQueue = [];
  audioBuffer = [];
  audioBufferSize = 0;
  isDecodingAudio = false;
  isAudioPlaying = false;
  scheduledEndTime = 0;
  ttsSentenceBuffer = '';
  ttsSentCharCount = 0;
  if (currentPlayingSource) {
    try { currentPlayingSource.stop(); } catch (e) { /* ignore */ }
    currentPlayingSource = null;
  }
  state.isPlaying = false;
}

// ==================== 事件绑定 ====================

function bindEvents() {
  // 设置面板切换
  elements.settingsToggle.addEventListener('click', () => {
    const isHidden = elements.settingsPanel.hidden;
    elements.settingsPanel.hidden = !isHidden;
    elements.settingsToggle.setAttribute('aria-expanded', String(isHidden));
  });

  // 保存设置
  elements.settingsSave.addEventListener('click', saveConfig);

  // 开始录音
  elements.startBtn.addEventListener('click', startRecording);

  // 停止录音
  elements.stopBtn.addEventListener('click', stopRecording);

  // 清空对话
  elements.clearBtn.addEventListener('click', () => {
    state.conversationHistory = [];
    state.currentAssistantMessage = null;
    state.isAwaitingFinalAsr = false;
    lastDefiniteText = '';
    currentRealtimeText = '';
    resetConversationTimers();
    elements.chatMessages.innerHTML = '';
    elements.realtimeText.textContent = '';
    clearLatency();
    updateStatus('就绪');
    appendMessage('system', '对话已清空');
  });

  // 模型选择变化
  elements.modelSelect.addEventListener('change', (e) => {
    state.config.qwenModel = e.target.value;
    if (state.qwenClient) {
      state.qwenClient.setModel(e.target.value);
    }
  });

  // 音色选择变化
  elements.voiceSelect.addEventListener('change', (e) => {
    state.config.volcTtsVoice = e.target.value;
  });
}

// ==================== 初始化 ====================

async function init() {
  console.log('[App] 初始化...');

  bindEvents();
  resetConversationTimers();
  await loadConfig();

  // 初始化 Qwen 客户端
  state.qwenClient = new QwenClient({
    apiKey: state.config.qwenApiKey,
    model: state.config.qwenModel
  });

  updateStatus('就绪');
  appendMessage('system', '欢迎使用豆包语音对话！请点击"开始录音"按钮。');

  console.log('[App] 初始化完成');
}

// 启动应用
init();
