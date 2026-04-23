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
        
        // Sequence ID first!
        if (flags & 0b0001) { 
            const seqb = new ArrayBuffer(4);
            new DataView(seqb).setInt32(0, seq++, false);
            optBufs.push(seqb);
        }

        // Event Number second!
        if (flags & 0b0100) {
            const eb = new ArrayBuffer(4);
            new DataView(eb).setUint32(0, ev, false);
            optBufs.push(eb);
        }
        
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
        return buildReq(1, {user: {uid: `tts-test`}, event: 1}, 0b0101); // Event+Seq
    };

    tts.buildStartSession = function() { 
        return buildReq(100, {
            user: { uid: `tts-test` },
            event: 100,
            req_params: { model: 'seed-tts-2.0-expressive', speaker: this.voiceType, audio_params: { format: 'mp3', sample_rate: 24000 } }
        }, 0b0101); // Event+Seq
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
               const size = v.getUint32(event.data.byteLength - Buffer.from(event.data).toString().indexOf('{"error') - 4); // hack
               const errStr = Buffer.from(event.data.slice(event.data.byteLength - 200)).toString();
               console.log("Error:", errStr);
               process.exit(0);
           }
           if (type === 0b1001) {
                // event number is usually at offset 4 or 8!
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
