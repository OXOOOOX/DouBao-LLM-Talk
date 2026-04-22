export const AVAILABLE_QWEN_MODELS = [
  'qwen3.6-max-preview',
  'qwen3.6-plus',
  'qwen3.6-flash'
];

export const AVAILABLE_TTS_VOICES = [
  { value: 'zh_female_vv_uranus_bigtts', label: '温柔女声' },
  { value: 'zh_female_cancan_mars_bigtts', label: '灿灿女声' },
  { value: 'zh_male_ahu_raphael_bigtts', label: '阿虎男声' },
  { value: 'zh_male_qingshu_raphael_bigtts', label: '青叔男声' },
  { value: 'zh_female_shuangkuaisisi_moon_bigtts', label: '双快思思' }
];

export function createDefaultConfig() {
  return {
    qwenApiKey: import.meta.env.VITE_ALYUN_API_KEY || import.meta.env.VITE_DASHSCOPE_API_KEY || import.meta.env.VITE_DASHSCOPE_KEY || '',
    qwenModel: import.meta.env.VITE_QWEN_MODEL || 'qwen3.6-max-preview',
    volcAppId: import.meta.env.VITE_VOLC_APP_ID || '',
    volcAccessToken: import.meta.env.VITE_VOLC_ACCESS_TOKEN || '',
    volcApiKey: import.meta.env.VITE_VOLC_API_KEY || '',
    volcSecretKey: import.meta.env.VITE_VOLC_SECRET_KEY || '',
    volcResourceId: import.meta.env.VITE_VOLC_RESOURCE_ID || 'volc.seedasr.sauc.duration',
    volcTtsResourceId: import.meta.env.VITE_VOLC_TTS_RESOURCE_ID || 'seed-tts-2.0',
    volcProxyUrl: import.meta.env.VITE_VOLC_PROXY_URL || 'ws://localhost:3001/proxy'
  };
}

export function normalizeConfig(config = {}) {
  const normalized = {
    ...createDefaultConfig(),
    ...config
  };

  for (const key of Object.keys(normalized)) {
    normalized[key] = String(normalized[key] ?? '').trim();
  }

  if (!AVAILABLE_QWEN_MODELS.includes(normalized.qwenModel)) {
    normalized.qwenModel = createDefaultConfig().qwenModel;
  }
  if (!normalized.volcResourceId) {
    normalized.volcResourceId = 'volc.seedasr.sauc.duration';
  }
  if (!normalized.volcTtsResourceId) {
    normalized.volcTtsResourceId = 'seed-tts-2.0';
  }
  if (!normalized.volcProxyUrl) {
    normalized.volcProxyUrl = 'ws://localhost:3001/proxy';
  }

  return normalized;
}

export function getConfigEndpoint(config) {
  const normalized = normalizeConfig(config);

  try {
    const proxyUrl = new URL(normalized.volcProxyUrl);
    const protocol = proxyUrl.protocol === 'wss:' ? 'https:' : 'http:';
    return `${protocol}//${proxyUrl.host}/config`;
  } catch {
    return 'http://localhost:3001/config';
  }
}
