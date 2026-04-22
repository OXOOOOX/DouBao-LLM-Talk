import { getConfigEndpoint, normalizeConfig } from '../app.config.js';

export async function fetchLocalConfig(config) {
  const response = await fetch(getConfigEndpoint(config));
  const payload = await response.json();

  if (!response.ok) {
    throw new Error(payload.error || '读取配置失败');
  }

  return normalizeConfig(payload.config);
}

export async function saveLocalConfig(config) {
  const normalized = normalizeConfig(config);
  const response = await fetch(getConfigEndpoint(normalized), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(normalized)
  });
  const payload = await response.json();

  if (!response.ok) {
    throw new Error(payload.error || '保存配置失败');
  }

  return normalizeConfig(payload.config);
}
