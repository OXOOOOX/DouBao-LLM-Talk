import { AVAILABLE_TTS_VOICES, createDefaultConfig, normalizeConfig } from '../app.config.js';

export function createAppState() {
  return {
    config: normalizeConfig(createDefaultConfig()),
    selectedVoice: AVAILABLE_TTS_VOICES[0]?.value || '',
    isRecording: false,
    isProcessing: false,
    settingsOpen: false,
    currentMessage: '',
    lastDefiniteText: '',
    processingRunId: 0,
    currentTimings: null,
    error: null
  };
}
