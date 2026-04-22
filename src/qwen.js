// 阿里云通义千问 QWEN API
const DEFAULT_QWEN_CONFIG = {
  apiKey: import.meta.env.VITE_ALYUN_API_KEY || import.meta.env.VITE_DASHSCOPE_API_KEY || '',
  model: import.meta.env.VITE_QWEN_MODEL || 'qwen3.6-max-preview',
  baseUrl: 'https://dashscope.aliyuncs.com/api/v1'
};

const TEXT_GENERATION_MODELS = ['qwen3.6-max-preview'];
const MULTIMODAL_MODELS = ['qwen3.6-plus', 'qwen3.6-flash'];

export const AVAILABLE_QWEN_MODELS = [
  ...TEXT_GENERATION_MODELS,
  ...MULTIMODAL_MODELS
];

export class QwenClient {
  constructor() {
    this.apiKey = DEFAULT_QWEN_CONFIG.apiKey;
    this.model = DEFAULT_QWEN_CONFIG.model;
    this.baseUrl = DEFAULT_QWEN_CONFIG.baseUrl;
    this.conversationHistory = [
      { role: 'system', content: '你是一个有帮助的助手。' }
    ];
    this.currentAbortController = null;
  }

  updateConfig(config = {}) {
    if (typeof config.apiKey === 'string') {
      this.apiKey = config.apiKey.trim();
    }
    if (typeof config.baseUrl === 'string' && config.baseUrl.trim()) {
      this.baseUrl = config.baseUrl.trim();
    }
    if (typeof config.model === 'string') {
      this.setModel(config.model.trim());
    }
  }

  getConfig() {
    return {
      apiKey: this.apiKey,
      model: this.model,
      baseUrl: this.baseUrl
    };
  }

  getEndpoint() {
    if (MULTIMODAL_MODELS.includes(this.model)) {
      return `${this.baseUrl}/services/aigc/multimodal-generation/generation`;
    }
    return `${this.baseUrl}/services/aigc/text-generation/generation`;
  }

  getRequestBody() {
    return {
      model: this.model,
      input: {
        messages: this.conversationHistory
      },
      parameters: {
        result_format: 'message',
        enable_search: false,
        temperature: 0.7,
        top_p: 0.8,
        max_tokens: 1500,
        enable_thinking: true
      },
      stream: true
    };
  }

  extractText(value) {
    if (typeof value === 'string') {
      return value;
    }

    if (Array.isArray(value)) {
      return value.map((item) => this.extractText(item)).join('');
    }

    if (!value || typeof value !== 'object') {
      return '';
    }

    if (typeof value.text === 'string') {
      return value.text;
    }

    if (typeof value.content === 'string') {
      return value.content;
    }

    if (Array.isArray(value.content)) {
      return this.extractText(value.content);
    }

    if (typeof value.output_text === 'string') {
      return value.output_text;
    }

    if (typeof value.value === 'string') {
      return value.value;
    }

    return '';
  }

  extractChoiceMessage(data) {
    const choice = data.output?.choices?.[0];
    return choice?.message || choice?.delta || null;
  }

  setModel(model) {
    if (AVAILABLE_QWEN_MODELS.includes(model)) {
      this.model = model;
    }
  }

  getModel() {
    return this.model;
  }

  normalizeUserMessage(content) {
    return String(content ?? '').trim();
  }

  parseStreamLine(line, onStreamChunk, assistantContentRef) {
    let jsonStr = line.trim();
    if (!jsonStr) {
      return;
    }

    if (jsonStr.startsWith('data:')) {
      jsonStr = jsonStr.slice(5).trim();
    }

    if (!jsonStr || jsonStr === '[DONE]') {
      return;
    }

    try {
      const data = JSON.parse(jsonStr);
      const message = this.extractChoiceMessage(data);
      const content = this.extractText(message?.content);
      if (content) {
        assistantContentRef.value += content;
        if (onStreamChunk) {
          onStreamChunk(content, assistantContentRef.value);
        }
      }
    } catch {
    }
  }

  flushStreamBuffer(buffer, onStreamChunk, assistantContentRef, flushRemainder = false) {
    const normalizedBuffer = flushRemainder ? buffer : buffer.replace(/\r\n/g, '\n');
    const lines = normalizedBuffer.split('\n');
    const remainder = flushRemainder ? '' : lines.pop() || '';

    for (const line of lines) {
      this.parseStreamLine(line, onStreamChunk, assistantContentRef);
    }

    if (flushRemainder && remainder.trim()) {
      this.parseStreamLine(remainder, onStreamChunk, assistantContentRef);
    }

    return remainder;
  }

  decodeChunk(decoder, value) {
    return decoder.decode(value, { stream: true }).replace(/\r\n/g, '\n');
  }

  finalizeChunk(decoder) {
    return decoder.decode().replace(/\r\n/g, '\n');
  }

  async parseErrorResponse(response) {
    try {
      const errorPayload = await response.json();
      return errorPayload.message || errorPayload.code || JSON.stringify(errorPayload);
    } catch {
      try {
        const text = await response.text();
        return text || `HTTP ${response.status}`;
      } catch {
        return `HTTP ${response.status}`;
      }
    }
  }

  abortCurrentChat() {
    if (!this.currentAbortController) {
      return false;
    }

    this.currentAbortController.abort();
    this.currentAbortController = null;
    return true;
  }

  async sendMessage(userMessage, onStreamChunk, { persist = true } = {}) {
    const content = this.normalizeUserMessage(userMessage);
    if (!content) {
      throw new Error('消息不能为空');
    }

    this.abortCurrentChat();

    const userMessageEntry = {
      role: 'user',
      content
    };
    if (persist) {
      this.conversationHistory.push(userMessageEntry);
    }

    const requestBody = persist
      ? this.getRequestBody()
      : {
          ...this.getRequestBody(),
          input: {
            messages: [
              this.conversationHistory[0],
              userMessageEntry
            ]
          }
        };
    const endpoint = this.getEndpoint();
    const abortController = new AbortController();
    this.currentAbortController = abortController;
    let reader = null;

    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.apiKey}`
        },
        body: JSON.stringify(requestBody),
        signal: abortController.signal
      });

      if (!response.ok) {
        const message = await this.parseErrorResponse(response);
        throw new Error(message);
      }

      if (!response.body) {
        throw new Error('QWEN 返回体为空');
      }

      reader = response.body.getReader();
      const decoder = new TextDecoder();
      const assistantContentRef = { value: '' };
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) {
          break;
        }

        buffer += this.decodeChunk(decoder, value);
        buffer = this.flushStreamBuffer(buffer, onStreamChunk, assistantContentRef, false);
      }

      buffer += this.finalizeChunk(decoder);
      this.flushStreamBuffer(buffer, onStreamChunk, assistantContentRef, true);

      if (abortController.signal.aborted) {
        const error = new Error('QWEN 请求已打断');
        error.code = 'QWEN_ABORTED';
        throw error;
      }

      if (persist) {
        this.conversationHistory.push({
          role: 'assistant',
          content: assistantContentRef.value
        });
      }

      return assistantContentRef.value;
    } catch (error) {
      if (error?.name === 'AbortError' || error?.code === 'QWEN_ABORTED') {
        const lastMessage = this.conversationHistory[this.conversationHistory.length - 1];
        if (persist && lastMessage === userMessageEntry) {
          this.conversationHistory.pop();
        }
        const abortedError = new Error('QWEN 请求已打断');
        abortedError.code = 'QWEN_ABORTED';
        throw abortedError;
      }
      console.error('[QWEN] Chat error:', error);
      throw error;
    } finally {
      if (reader && abortController.signal.aborted) {
        reader.cancel().catch(() => {});
      }
      if (this.currentAbortController === abortController) {
        this.currentAbortController = null;
      }
    }
  }

  async checkAvailability() {
    await this.sendMessage('你好', null, { persist: false });
  }

  async chat(userMessage, onStreamChunk) {
    return this.sendMessage(userMessage, onStreamChunk, { persist: true });
  }

  clearHistory() {
    this.conversationHistory = [
      { role: 'system', content: '你是一个有帮助的助手。' }
    ];
  }
}

export default QwenClient;
