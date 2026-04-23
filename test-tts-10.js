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
    
    // We send sequence 1, 2, 3
    let seq = 1;
    function buildReq(ev, obj, flags) {
        const payloadBytes = new TextEncoder().encode(JSON.stringify(obj));
        const header = new ArrayBuffer(4);
        const v = new DataView(header);
        v.setUint8(0, 0x11); 
        v.setUint8(1, (1 << 4) | flags); 
        v.setUint8(2, 0x10); 
        v.setUint8(3, 0);
        
        let optBufs = [];
        if (flags & 0b0001) { // Sequence
            const seqb = new ArrayBuffer(4);
            new DataView(seqb).setInt32(0, seq++, false);
            optBufs.push(seqb);
        }
        
        // Let's NOT use 0b0100 for request
        
        const sizeBuf = new ArrayBuffer(4);
        new DataView(sizeBuf).setUint32(0, payloadBytes.length, false);
        
        const total = 4 + optBufs.reduce((a, b) => a + b.byteLength, 0) + 4 + payloadBytes.length;
        const buf = new ArrayBuffer(total);
        const bytes = new Uint8Array(buf);
        let offset = 0;
        bytes.set(new Uint8Array(header), offset); offset += 4;
        optBufs.forEach(b => { bytes.set(new Uint8Array(b), offset); offset += b.byteLength; });
        bytes.set(new Uint8Array(sizeBuf), offset); offset += 4;
        bytes.set(payloadBytes, offset);
        return buf;
    }

    tts.buildStartConnection = function() {
        return buildReq(1, {user: {uid: `tts-test`}, event: 1}, 0b0001); // seq=1
    };

    tts.buildStartSession = function() { 
        return buildReq(100, {
            user: { uid: `tts-test` },
            event: 100,
            req_params: { model: 'seed-tts-2.0-expressive', speaker: this.voiceType, audio_params: { format: 'mp3', sample_rate: 24000 } }
        }, 0b0001); // seq=2
    }

    let originalOnMessage;
    tts.onOpen = () => {
        console.log("Opened!");
        tts.ws.onmessage = (event) => {
           console.log("Response bytes:", Buffer.from(event.data).toString('hex').match(/../g).join(' '));
           if (event.data.byteLength < 4) return;
           const v = new DataView(event.data);
           const type = (v.getUint8(1) >> 4) & 0xf;
           if (type === 0b1111) {
               console.log("Error frame received!");
               const size = v.getUint32(8); // approx
               const errStr = Buffer.from(event.data.slice(event.data.byteLength - size)).toString();
               console.log("Error:", errStr);
               process.exit(0);
           }
           if (type === 0b1001) {
                const ev = v.getUint32(4, false);
                console.log("Event:", ev);
                if (ev === 50) tts.ws.send(tts.buildStartSession());
                if (ev === 150) {
                    console.log("SUCCESS! START SESSION ACCEPTED!");
                    process.exit(0);
                }
           }
        };
    }
    tts.onError = (err) => {}; // ignore output
    await tts.connect();
}

test();
