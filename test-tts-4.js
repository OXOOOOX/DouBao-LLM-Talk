import { TTSClient } from './tts.js';

// mock location/network
globalThis.window = {
    AudioContext: class {},
    webkitAudioContext: class {}
};

import WebSocket from 'ws';
globalThis.WebSocket = class extends WebSocket {
    constructor(url, options) {
        super(url, options); // The server.js connects upstream!
    }
}

async function test() {
    const tts = new TTSClient({
        apiKey: '47995645-3553-4480-8d45-d769f5beb94d',
        resourceId: 'seed-tts-2.0',
        voiceType: 'zh_female_vv_uranus_bigtts',
        proxyUrl: 'ws://localhost:3001/proxy'
    });
    
    tts.onOpen = () => {
        console.log("Opened, sending StartSession directly");
        tts.ws.send(tts.buildStartSession());
        setTimeout(() => tts.finishSession(), 1000);
    }
    tts.onEvent = (evt, json) => console.log("Event:", evt, json);
    tts.onError = (err) => console.error("Error:", err);
    await tts.connect();
    console.log("Connect OK!");
}

test();
