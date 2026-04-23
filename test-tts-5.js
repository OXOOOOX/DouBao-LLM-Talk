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
    
    // Override buildFrame to insert EVENT NUMBER for ALL frames?
    // Let's just override it to insert the event number!
    tts.buildStartConnection = function() {
        const payload = JSON.stringify({
            user: { uid: `tts-${this.connectId}` },
            event: 1 // EVT_START_CONNECTION
        });
        
        const payloadBytes = new TextEncoder().encode(payload);
        
        // Header
        const type = 0b0001; // MSG_FULL_CLIENT_REQUEST
        const flags = 0b0100; // HAS EVENT NUMBER
        
        const header = new ArrayBuffer(4);
        const v = new DataView(header);
        v.setUint8(0, (0b0001 << 4) | 0b0001); // ver 1, size 1
        v.setUint8(1, (type << 4) | (flags & 0x0F));
        v.setUint8(2, (0b0001 << 4) | 0); // JSON, No compression
        v.setUint8(3, 0);
        
        // Optional field: Event Number (4 bytes)
        const eventBuf = new ArrayBuffer(4);
        new DataView(eventBuf).setUint32(0, 1, false);
        
        // Payload Size
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
    };
    
    tts.onOpen = () => {
        console.log("Opened!");
        setTimeout(() => { tts.finishSession(); }, 2000);
    }
    tts.onEvent = (evt, json) => console.log("Event:", evt, json);
    tts.onError = (err) => console.error("Error:", err);
    await tts.connect();
    console.log("Connect OK!");
}

test();
