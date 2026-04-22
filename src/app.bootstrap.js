import { createAppState } from './state/appState.js';
import { getDomRefs } from './ui/dom.js';
import { createSpeechServices } from './services/speechService.js';
import { createSettingsController } from './controllers/settingsController.js';
import { createAppController } from './controllers/appController.js';
import { createRecordingController } from './controllers/recordingController.js';

export async function bootstrapApp() {
  const state = createAppState();
  const dom = getDomRefs();
  const services = createSpeechServices();

  const settingsController = createSettingsController({
    state,
    dom,
    services
  });

  const recordingController = createRecordingController({
    state,
    dom,
    services
  });

  const appController = createAppController({
    state,
    dom,
    services,
    settingsController,
    recordingController
  });

  await appController.initialize();

  window.addEventListener('beforeunload', () => {
    services.asr.close();
    services.tts.close();
    recordingController.cleanup();
  });
}
