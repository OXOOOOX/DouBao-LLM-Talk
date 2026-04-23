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
    
    // Override buildFrame to ALWAYS inject Event
    // But we need the event! Where is it?
    // StartConnection: event 1
    // StartSession: event 100
    // TaskRequest: event 200
    // FinishSession: event 102
    
    tts.buildStartConnection = function() { return buildReq(1, `tts-${this.connectId}`, {user: {uid: `tts-${this.connectId}`}, event: 1}); };
    tts.buildStartSession = function() { 
        return buildReq(100, `tts-${this.connectId}`, {
            user: { uid: `tts-${this.connectId}` },
            event: 100,
            req_params: { model: 'seed-tts-2.0-expressive', speaker: this.voiceType, audio_params: { format: 'mp3', sample_rate: 24000 } }
        });
    }
    
    function buildReq(ev, sid, obj) {
        const payloadBytes = new TextEncoder().encode(JSON.stringify(obj));
        const header = new ArrayBuffer(4);
        const v = new DataView(header);
        v.setUint8(0, 0x11); v.setUint8(1, 0x14); v.setUint8(2, 0x10); v.setUint8(3, 0);
        
        const eventBuf = new ArrayBuffer(4);
        new DataView(eventBuf).setUint32(0, ev, false);
        
        const sizeBuf = new ArrayBuffer(4);
        new DataView(sizeBuf).setUint32(0, payloadBytes.length, false);
        
        const total = header.byteLength + eventBuf.byteLength + sizeBuf.byteLength + payloadBytes.length;
        const buf = new ArrayBuffer(total);
        const bytes = new Uint8Array(buf);
        bytes.set(new Uint8Array(header), 0);
        bytes.set(new Uint8Array(eventBuf), 4);
        bytes.set(new Uint8Array(sizeBuf), 8);
        bytes.set(payloadBytes, 12);
        return buf;
    }

    let originalOnMessage;
    tts.onOpen = () => {
        console.log("Opened!");
        originalOnMessage = tts.ws.onmessage;
        tts.ws.onmessage = (event) => {
           console.log("Raw Response bytes:", Buffer.from(event.data).toString('hex').match(/../g).join(' '));
           
           const view = new DataView(event.data);
           const ev = view.getUint32(4, false);
           console.log("Event received:", ev);
           if (ev === 50) {
               console.log("Got Event 50, sending StartSession");
               tts.ws.send(tts.buildStartSession());
           } else {
               process.exit(0);
           }
        };
    }
    tts.onError = (err) => console.error("Error:", err);
    await tts.connect();
}

test();
