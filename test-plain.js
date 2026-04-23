import WebSocket from 'ws';

function buildReq(type, flags, ev, obj) {
    const payloadBytes = new TextEncoder().encode(JSON.stringify(obj));
    const header = new ArrayBuffer(4);
    const v = new DataView(header);
    v.setUint8(0, 0x11); 
    v.setUint8(1, (type << 4) | flags); 
    v.setUint8(2, 0x10); 
    v.setUint8(3, 0);
    
    let optBufs = [];
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
    
    console.log(`Sending: type=${type.toString(2)} flags=${flags.toString(2)} ev=${ev}`);
    console.log(`Buffer Hex:`, Buffer.from(buf).toString('hex').match(/../g).join(' '));
    return buf;
}

const ws = new WebSocket('ws://localhost:3001/proxy?api_key=47995645-3553-4480-8d45-d769f5beb94d&resource_id=seed-tts-2.0&connect_id=123');

ws.on('open', () => {
    ws.send(buildReq(1, 0b0100, 1, {"user":{"uid":"user1"}}));
});

ws.on('message', (data) => {
    console.log("Received Hex:", Buffer.from(data).toString('hex').match(/../g).join(' '));
    const v = new DataView(new Uint8Array(data).buffer);
    const type = (v.getUint8(1) >> 4) & 0xf;
    if (type === 0b1111) {
       const size = v.getUint32(8, false); // size could be at offset 8
       const msg = Buffer.from(data.slice(12)).toString();
       console.log("Error frame!", msg);
       process.exit(1);
    }
    
    const ev = v.getUint32(4, false);
    console.log("Got Event:", ev);
    if (ev === 50) {
        // Send StartSession
        const reqBuf = buildReq(1, 0b0100, 100, {
            "user":{"uid":"user1"},
            "event": 100,
            "req_params": {
                "model":"seed-tts-2.0-expressive",
                "speaker":"zh_female_vv_uranus_bigtts",
                "audio_params":{"format":"mp3","sample_rate":24000}
            }
        });
        ws.send(reqBuf);
    }
});

ws.on('close', () => process.exit(0));
ws.on('error', (e) => console.error(e));
