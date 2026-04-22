import DoubaoASR from '../asr.js';
import DoubaoTTS from '../tts.js';
import QwenClient from '../qwen.js';

export function createSpeechServices() {
  return {
    asr: new DoubaoASR(),
    qwen: new QwenClient(),
    tts: new DoubaoTTS()
  };
}

export function applyConfigToServices(services, config) {
  services.qwen.updateConfig({
    apiKey: config.qwenApiKey,
    model: config.qwenModel
  });

  services.asr.updateConfig({
    appId: config.volcAppId,
    accessToken: config.volcAccessToken,
    apiKey: config.volcApiKey || config.volcSecretKey,
    resourceId: config.volcResourceId,
    proxyUrl: config.volcProxyUrl
  });

  services.tts.updateConfig({
    appId: config.volcAppId,
    accessToken: config.volcAccessToken,
    apiKey: config.volcApiKey || config.volcSecretKey,
    resourceId: config.volcTtsResourceId,
    proxyUrl: config.volcProxyUrl
  });
}
