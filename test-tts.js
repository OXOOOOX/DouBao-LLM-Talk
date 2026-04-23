import { TTSClient } from './tts.js';

// mock location/network
globalThis.window = {
    AudioContext: class {},
    webkitAudioContext: class {}
};

// Use node ws
import WebSocket from 'ws';
globalThis.WebSocket = WebSocket;

async function test() {
    const tts = new TTSClient({
        apiKey: '47995645-3553-4480-8d45-d769f5beb94d',
        resourceId: 'seed-tts-2.0',
        voiceType: 'zh_female_vv_uranus_bigtts',
        proxyUrl: 'ws://localhost:3001/proxy'
    });
    
    tts.onOpen = () => {
        console.log("Opened, sending text");
        tts.sendText("测试一下语音合成", true);
        
        setTimeout(() => {
            tts.finishSession();
        }, 1000);
    }
    tts.onAudio = (buf) => {
        console.log("Audio received! bytes:", buf.byteLength);
    }
    tts.onEvent = (evt, json) => {
        console.log("Event:", evt, json);
    }
    tts.onError = (err) => {
        console.error("Error:", err);
    }
    await tts.connect();
    console.log("connect finished");
}

test();
