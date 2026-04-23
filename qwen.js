/**
 * Qwen 流式对话客户端
 * 使用阿里云 DashScope API
 */

export class QwenClient {
  constructor(config = {}) {
    this.apiKey = config.apiKey || '';
    this.model = config.model || 'qwen-max';
    this.baseUrl = 'https://dashscope.aliyuncs.com/compatible-mode/v1';
    this.abortController = null;
  }

  setApiKey(apiKey) {
    this.apiKey = apiKey;
  }

  setModel(model) {
    this.model = model;
  }

  stop() {
    if (this.abortController) {
      this.abortController.abort();
      this.abortController = null;
    }
  }

  /**
   * 流式对话
   * @param {Array} messages - 对话历史 [{role: 'user'|'assistant'|'system', content: string}]
   * @param {function} onChunk - 接收到每个 chunk 时的回调
   * @returns {Promise<string>} 完整回复内容
   */
  async chat(messages, onChunk) {
    if (!this.apiKey) {
      throw new Error('Qwen API Key 未设置');
    }

    this.abortController = new AbortController();

    const response = await fetch(`${this.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.apiKey}`
      },
      body: JSON.stringify({
        model: this.model,
        messages: messages,
        stream: true
      }),
      signal: this.abortController.signal
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Qwen API 错误：${response.status} - ${error}`);
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let fullContent = '';

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value, { stream: true });
        const lines = chunk.split('\n');

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const data = line.slice(6);
            if (data === '[DONE]') continue;

            try {
              const parsed = JSON.parse(data);
              const content = parsed.choices?.[0]?.delta?.content || '';
              if (content) {
                fullContent += content;
                if (onChunk) {
                  onChunk(content, fullContent);
                }
              }
            } catch (e) {
              // 跳过无法解析的行
            }
          }
        }
      }
    } finally {
      reader.releaseLock();
    }

    return fullContent;
  }

  /**
   * 简单对话（无历史）
   * @param {string} prompt - 用户输入
   * @param {function} onChunk - 接收到每个 chunk 时的回调
   * @returns {Promise<string>} 完整回复内容
   */
  async ask(prompt, onChunk) {
    return this.chat([
      { role: 'system', content: '你是一个有帮助的助手。' },
      { role: 'user', content: prompt }
    ], onChunk);
  }
}
