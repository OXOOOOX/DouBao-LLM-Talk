import { AVAILABLE_QWEN_MODELS } from '../app.config.js';
import { fetchLocalConfig, saveLocalConfig } from '../services/configService.js';
import { applyConfigToServices } from '../services/speechService.js';

export function createSettingsController({ state, dom, services }) {
  let statusTimer = null;

  function setStatus(message = '', isError = false) {
    if (!dom.settingsStatus) {
      return;
    }

    dom.settingsStatus.textContent = message;
    dom.settingsStatus.classList.toggle('error', isError);

    if (statusTimer) {
      clearTimeout(statusTimer);
      statusTimer = null;
    }

    if (message && !isError) {
      statusTimer = window.setTimeout(() => {
        dom.settingsStatus.textContent = '';
      }, 2500);
    }
  }

  function fillForm(config) {
    dom.settingsQwenApiKeyInput.value = config.qwenApiKey;
    dom.settingsQwenModelSelect.value = config.qwenModel;
    dom.settingsVolcAppIdInput.value = config.volcAppId;
    dom.settingsVolcAccessTokenInput.value = config.volcAccessToken;
    dom.settingsVolcApiKeyInput.value = config.volcApiKey || config.volcSecretKey || '';
    dom.settingsVolcResourceIdInput.value = config.volcResourceId;
    dom.settingsVolcTtsResourceIdInput.value = config.volcTtsResourceId;
    dom.settingsVolcProxyUrlInput.value = config.volcProxyUrl;
  }

  function readForm() {
    return {
      ...state.config,
      qwenApiKey: dom.settingsQwenApiKeyInput.value,
      qwenModel: dom.settingsQwenModelSelect.value,
      volcAppId: dom.settingsVolcAppIdInput.value,
      volcAccessToken: dom.settingsVolcAccessTokenInput.value,
      volcApiKey: dom.settingsVolcApiKeyInput.value,
      volcSecretKey: dom.settingsVolcApiKeyInput.value,
      volcResourceId: dom.settingsVolcResourceIdInput.value,
      volcTtsResourceId: dom.settingsVolcTtsResourceIdInput.value,
      volcProxyUrl: dom.settingsVolcProxyUrlInput.value
    };
  }

  function toggle(forceOpen) {
    state.settingsOpen = typeof forceOpen === 'boolean' ? forceOpen : !state.settingsOpen;
    dom.settingsPanel.hidden = !state.settingsOpen;
    dom.settingsToggleBtn.setAttribute('aria-expanded', String(state.settingsOpen));
  }

  async function initialize() {
    dom.settingsQwenModelSelect.innerHTML = AVAILABLE_QWEN_MODELS
      .map((model) => `<option value="${model}">${model}</option>`)
      .join('');

    applyConfigToServices(services, state.config);
    fillForm(state.config);

    try {
      const config = await fetchLocalConfig(state.config);
      state.config = config;
      applyConfigToServices(services, state.config);
      fillForm(state.config);
      setStatus('已读取本地配置');
    } catch {
      fillForm(state.config);
      setStatus('未连接本地配置服务，已使用当前环境变量', true);
    }
  }

  async function handleSave() {
    dom.settingsSaveBtn.disabled = true;
    setStatus('正在保存...');

    try {
      const config = await saveLocalConfig(readForm());
      state.config = config;
      applyConfigToServices(services, state.config);
      fillForm(state.config);
      setStatus('设置已保存');
    } catch (error) {
      setStatus(`保存失败：${error.message}`, true);
    } finally {
      dom.settingsSaveBtn.disabled = false;
    }
  }

  function bind() {
    dom.settingsToggleBtn.addEventListener('click', () => toggle());
    dom.settingsSaveBtn.addEventListener('click', handleSave);
  }

  return {
    initialize,
    bind,
    toggle,
    setStatus
  };
}
