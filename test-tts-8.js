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
    
    // Rewrite buildFrame to send FULL optional fields: Event + ConnectID!
    tts.buildStartConnection = function() {
        return buildReq(this.connectId, 1, `tts-${this.connectId}`, {user: {uid: `tts-${this.connectId}`}, event: 1});
    };
    tts.buildStartSession = function() { 
        return buildReq(this.connectId, 100, `tts-${this.connectId}`, {
            user: { uid: `tts-${this.connectId}` },
            event: 100,
            req_params: { model: 'seed-tts-2.0-expressive', speaker: this.voiceType, audio_params: { format: 'mp3', sample_rate: 24000 } }
        });
    }
    
    function buildReq(connectIdStr, ev, sid, obj) {
        const payloadBytes = new TextEncoder().encode(JSON.stringify(obj));
        const header = new ArrayBuffer(4);
        const v = new DataView(header);
        v.setUint8(0, 0x11); v.setUint8(1, 0x14); v.setUint8(2, 0x10); v.setUint8(3, 0); // 0b0100
        
        const eventBuf = new ArrayBuffer(4);
        new DataView(eventBuf).setUint32(0, ev, false);
        
        const connectIdBytes = new TextEncoder().encode(connectIdStr);
        const connectIdSizeBuf = new ArrayBuffer(4);
        new DataView(connectIdSizeBuf).setUint32(0, connectIdBytes.length, false);
        
        const sizeBuf = new ArrayBuffer(4);
        new DataView(sizeBuf).setUint32(0, payloadBytes.length, false);
        
        const total = header.byteLength + eventBuf.byteLength + connectIdSizeBuf.byteLength + connectIdBytes.length + sizeBuf.byteLength + payloadBytes.length;
        const buf = new ArrayBuffer(total);
        const bytes = new Uint8Array(buf);
        
        let offset = 0;
        bytes.set(new Uint8Array(header), offset); offset += header.byteLength;
        bytes.set(new Uint8Array(eventBuf), offset); offset += eventBuf.byteLength;
        bytes.set(new Uint8Array(connectIdSizeBuf), offset); offset += connectIdSizeBuf.byteLength;
        bytes.set(connectIdBytes, offset); offset += connectIdBytes.length;
        bytes.set(new Uint8Array(sizeBuf), offset); offset += sizeBuf.byteLength;
        bytes.set(payloadBytes, offset);
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
