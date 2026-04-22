export function createRecordingController({ state, dom, services }) {
  let mediaStream = null;
  let audioContext = null;
  let scriptProcessor = null;
  let isRecording = false;
  let asrConnected = false;
  let pendingAudioBuffers = [];

  const SAMPLE_RATE = 16000;
  const BUFFER_SIZE = 4096;

  async function requestMicrophonePermission() {
    try {
      mediaStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          sampleRate: SAMPLE_RATE,
          channelCount: 1,
          echoCancellation: true,
          noiseReduction: true,
          autoGainControl: true
        }
      });
      return { success: true };
    } catch (error) {
      console.error('[Recording] Failed to get microphone permission:', error);
      return {
        success: false,
        error: error.name === 'NotAllowedError'
          ? '请允许麦克风权限'
          : error.name === 'NotFoundError'
          ? '未检测到麦克风设备'
          : '无法访问麦克风'
      };
    }
  }

  function createAudioProcessor() {
    if (!mediaStream) return null;

    audioContext = new (window.AudioContext || window.webkitAudioContext)({
      sampleRate: SAMPLE_RATE
    });

    const source = audioContext.createMediaStreamSource(mediaStream);
    scriptProcessor = audioContext.createScriptProcessor(BUFFER_SIZE, 1, 1);

    scriptProcessor.onaudioprocess = (event) => {
      if (!isRecording || !asrConnected) {
        if (isRecording) {
          const inputData = event.inputBuffer.getChannelData(0);
          pendingAudioBuffers.push(floatToPCM(inputData));
        }
        return;
      }

      const inputData = event.inputBuffer.getChannelData(0);
      const pcmData = floatToPCM(inputData);

      if (services.asr && asrConnected) {
        services.asr.sendAudioData(pcmData.buffer);
      }
    };

    source.connect(scriptProcessor);
    scriptProcessor.connect(audioContext.destination);

    return { source, processor: scriptProcessor };
  }

  function floatToPCM(float32Array) {
    const int16Array = new Int16Array(float32Array.length);
    for (let i = 0; i < float32Array.length; i++) {
      const s = Math.max(-1, Math.min(1, float32Array[i]));
      int16Array[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
    }
    return int16Array;
  }

  function updateButtonText() {
    if (!dom.startBtn || !dom.stopBtn) return;

    dom.startBtn.disabled = isRecording;
    dom.stopBtn.disabled = !isRecording;
  }

  function updateStatus(message, isError = false) {
    if (!dom.statusText) return;

    dom.statusText.textContent = message;
    dom.statusText.classList.toggle('error', isError);
  }

  async function startRecording() {
    if (isRecording) {
      console.log('[Recording] Already recording, ignoring start request');
      return { success: false, error: '已在录音中' };
    }

    const permResult = await requestMicrophonePermission();
    if (!permResult.success) {
      updateStatus(permResult.error, true);
      return permResult;
    }

    createAudioProcessor();

    isRecording = true;
    asrConnected = false;
    pendingAudioBuffers = [];

    updateButtonText();
    updateStatus('正在连接语音识别服务...');

    if (services.asr) {
      try {
        await services.asr.connect();
        services.asr.sendFullClientRequest();
        asrConnected = true;

        for (const buffer of pendingAudioBuffers) {
          services.asr.sendAudioData(buffer.buffer);
        }
        pendingAudioBuffers = [];

        updateStatus('正在录音...');
        console.log('[Recording] Started recording');
      } catch (error) {
        isRecording = false;
        updateStatus(`连接失败：${error.message}`, true);
        updateButtonText();
        return { success: false, error: error.message };
      }
    }

    return { success: true };
  }

  function stopRecording() {
    if (!isRecording) {
      console.log('[Recording] Not recording, ignoring stop request');
      return;
    }

    isRecording = false;

    if (services.asr) {
      services.asr.sendLastPackage();
    }

    updateStatus('正在识别...');
    updateButtonText();
    console.log('[Recording] Stopped recording');
  }

  function reset() {
    isRecording = false;
    asrConnected = false;
    pendingAudioBuffers = [];
    updateButtonText();
    updateStatus('');
  }

  function cleanup() {
    if (scriptProcessor) {
      scriptProcessor.disconnect();
      scriptProcessor = null;
    }
    if (audioContext) {
      audioContext.close();
      audioContext = null;
    }
    if (mediaStream) {
      mediaStream.getTracks().forEach(track => track.stop());
      mediaStream = null;
    }
    isRecording = false;
    asrConnected = false;
    updateButtonText();
  }

  function setOnASRReady(callback) {
    if (services.asr) {
      services.asr.onOpen = () => {
        asrConnected = true;
        console.log('[Recording] ASR connection ready');
      };
    }
  }

  function setOnASRResult(callback) {
    if (services.asr) {
      services.asr.onResult = (response) => {
        if (callback) callback(response);
      };
    }
  }

  function setOnASRError(callback) {
    if (services.asr) {
      services.asr.onError = (error) => {
        if (callback) callback(error);
      };
    }
  }

  function setOnASRClose(callback) {
    if (services.asr) {
      services.asr.onClose = () => {
        asrConnected = false;
        if (callback) callback();
      };
    }
  }

  window.addEventListener('beforeunload', cleanup);

  return {
    startRecording,
    stopRecording,
    reset,
    cleanup,
    setOnASRReady,
    setOnASRResult,
    setOnASRError,
    setOnASRClose,
    getIsRecording: () => isRecording,
    getIsASRConnected: () => asrConnected
  };
}
