export function getDomRefs() {
  return {
    startBtn: document.getElementById('start-btn'),
    stopBtn: document.getElementById('stop-btn'),
    clearBtn: document.getElementById('clear-btn'),
    modelSelect: document.getElementById('model-select'),
    voiceSelect: document.getElementById('voice-select'),
    chatMessages: document.getElementById('chat-messages'),
    statusText: document.getElementById('status-text'),
    latencyText: document.getElementById('latency-text'),
    realtimeTextEl: document.getElementById('realtime-text'),
    settingsToggleBtn: document.getElementById('settings-toggle-btn'),
    settingsPanel: document.getElementById('settings-panel'),
    settingsSaveBtn: document.getElementById('settings-save-btn'),
    settingsStatus: document.getElementById('settings-status'),
    settingsQwenApiKeyInput: document.getElementById('settings-qwen-api-key'),
    settingsQwenModelSelect: document.getElementById('settings-qwen-model'),
    settingsVolcAppIdInput: document.getElementById('settings-volc-app-id'),
    settingsVolcAccessTokenInput: document.getElementById('settings-volc-access-token'),
    settingsVolcApiKeyInput: document.getElementById('settings-volc-api-key'),
    settingsVolcResourceIdInput: document.getElementById('settings-volc-resource-id'),
    settingsVolcTtsResourceIdInput: document.getElementById('settings-volc-tts-resource-id'),
    settingsVolcProxyUrlInput: document.getElementById('settings-volc-proxy-url')
  };
}
