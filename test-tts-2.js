import { TTSClient } from './tts.js';
import WebSocket from 'ws';

globalThis.window = { AudioContext: class {}, webkitAudioContext: class {} };
globalThis.WebSocket = WebSocket;

async function test() {
    const tts = new TTSClient({
        apiKey: '47995645-3553-4480-8d45-d769f5beb94d',
        resourceId: 'seed-tts-2.0',
        voiceType: 'zh_female_vv_uranus_bigtts',
        proxyUrl: 'ws://localhost:3001/proxy'
    });
    
    // OVERRIDE buildHeader to force flags to what I want!
    // MSG_FULL_CLIENT_REQUEST (0b0001) needs flag 0b0100 (4) ? No, maybe it just needs the flag!
    
    tts.onOpen = () => {
        console.log("Opened!");
        tts.sendText("测试一下语音合成", true);
        setTimeout(() => { tts.finishSession(); }, 1000);
    }
    tts.onError = (err) => { console.error("Error:", err); }
    await tts.connect();
    console.log("connect finished");
}

test();
