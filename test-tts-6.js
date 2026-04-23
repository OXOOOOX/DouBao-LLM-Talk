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
    
    tts.buildStartConnection = function() {
        const payload = JSON.stringify({
            user: { uid: `tts-${this.connectId}` },
            event: 1 // EVT_START_CONNECTION
        });
        const payloadBytes = new TextEncoder().encode(payload);
        
        const header = new ArrayBuffer(4);
        const v = new DataView(header);
        v.setUint8(0, (0b0001 << 4) | 0b0001); 
        v.setUint8(1, (0b0001 << 4) | 0b0100); // flag 4! EVENT NO.
        v.setUint8(2, (0b0001 << 4) | 0); 
        v.setUint8(3, 0);
        
        const eventBuf = new ArrayBuffer(4);
        new DataView(eventBuf).setUint32(0, 1, false); // Event: 1
        
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
    
    let originalOnMessage;
    tts.onOpen = () => {
        console.log("Opened!");
        originalOnMessage = tts.ws.onmessage;
        tts.ws.onmessage = (event) => {
           console.log("Raw Response bytes:", Buffer.from(event.data).toString('hex').match(/../g).join(' '));
           
           const textChars = Buffer.from(event.data).toString('ascii');
           console.log("ASCII representation:\n", textChars);
           
           process.exit(0);
        };
    }
    tts.onError = (err) => console.error("Error:", err);
    await tts.connect();
}

test();
