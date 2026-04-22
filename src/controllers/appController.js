import { AVAILABLE_QWEN_MODELS, AVAILABLE_TTS_VOICES } from '../app.config.js';

export function createAppController({ state, dom, services, settingsController, recordingController }) {
  let currentASRText = '';

  function initializePickers() {
    dom.modelSelect.innerHTML = AVAILABLE_QWEN_MODELS
      .map((model) => `<option value="${model}">${model}</option>`)
      .join('');
    dom.modelSelect.value = state.config.qwenModel;

    dom.voiceSelect.innerHTML = AVAILABLE_TTS_VOICES
      .map((voice) => `<option value="${voice.value}">${voice.label}</option>`)
      .join('');
    dom.voiceSelect.value = state.selectedVoice;
  }

  function appendUserMessage(text) {
    const bubble = document.createElement('div');
    bubble.className = 'message user';
    bubble.textContent = text;
    dom.chatMessages.appendChild(bubble);
    dom.chatMessages.scrollTop = dom.chatMessages.scrollHeight;
  }

  function appendAssistantMessage(text = '') {
    const bubble = document.createElement('div');
    bubble.className = 'message assistant';
    bubble.innerHTML = text || '<span class="typing">...</span>';
    dom.chatMessages.appendChild(bubble);
    dom.chatMessages.scrollTop = dom.chatMessages.scrollHeight;
    return bubble;
  }

  function updateRealtimeText(text) {
    if (dom.realtimeTextEl) {
      dom.realtimeTextEl.textContent = text || '';
    }
  }

  function handleASRResult(response) {
    const utterances = response?.utterances || [];
    const lastUtterance = utterances[utterances.length - 1];
    const text = lastUtterance?.text || '';

    if (text) {
      currentASRText = text;
      updateRealtimeText(text);
    }

    if (response.status === 'complete' || response.is_finished) {
      updateRealtimeText('');
      if (currentASRText) {
        handleUserSpeech(currentASRText);
        currentASRText = '';
      }
    }
  }

  function handleASRError(error) {
    console.error('[App] ASR error:', error);
    if (dom.statusText) {
      dom.statusText.textContent = `识别错误：${error.message || error}`;
      dom.statusText.classList.add('error');
    }
  }

  function handleASRClose() {
    console.log('[App] ASR connection closed');
  }

  async function handleUserSpeech(text) {
    appendUserMessage(text);

    const assistantBubble = appendAssistantMessage();
    let fullResponse = '';

    try {
      await services.qwen.chat(text, (chunk, accumulated) => {
        fullResponse = accumulated;
        assistantBubble.textContent = accumulated || '...';
        dom.chatMessages.scrollTop = dom.chatMessages.scrollHeight;
      });

      assistantBubble.textContent = fullResponse;
      state.currentMessage = fullResponse;
      state.lastDefiniteText = fullResponse;

      await services.tts.speak(fullResponse, state.selectedVoice);
    } catch (error) {
      console.error('[App] Qwen/TTS error:', error);
      assistantBubble.textContent = `错误：${error.message}`;
      assistantBubble.classList.add('error');
    }
  }

  function bind() {
    dom.modelSelect.addEventListener('change', () => {
      state.config.qwenModel = dom.modelSelect.value;
      services.qwen.setModel(dom.modelSelect.value);
      if (dom.settingsQwenModelSelect) {
        dom.settingsQwenModelSelect.value = dom.modelSelect.value;
      }
    });

    dom.voiceSelect.addEventListener('change', () => {
      state.selectedVoice = dom.voiceSelect.value;
    });

    dom.startBtn.addEventListener('click', async () => {
      const result = await recordingController.startRecording();
      if (!result.success) {
        console.error('[App] Failed to start recording:', result.error);
      }
    });

    dom.stopBtn.addEventListener('click', () => {
      recordingController.stopRecording();
    });

    dom.clearBtn.addEventListener('click', () => {
      dom.chatMessages.innerHTML = '';
      dom.realtimeTextEl.textContent = '';
      state.currentMessage = '';
      state.lastDefiniteText = '';
      services.qwen.clearHistory();
    });

    recordingController.setOnASRResult(handleASRResult);
    recordingController.setOnASRError(handleASRError);
    recordingController.setOnASRClose(handleASRClose);
  }

  async function initialize() {
    initializePickers();
    settingsController.bind();
    bind();
    await settingsController.initialize();
    console.log('[App] Rebuild scaffold initialized');
  }

  return {
    initialize
  };
}
