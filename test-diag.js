/**
 * Test the fixed TTSClient end-to-end
 */
import { TTSClient } from './tts.js';
import WebSocket from 'ws';
import fs from 'fs';

globalThis.window = { AudioContext: class {}, webkitAudioContext: class {} };
globalThis.WebSocket = WebSocket;

async function test() {
    const tts = new TTSClient({
        apiKey: '47995645-3553-4480-8d45-d769f5beb94d',
        resourceId: 'seed-tts-2.0',
        voiceType: 'zh_female_vv_uranus_bigtts',
        proxyUrl: 'ws://localhost:3001/proxy'
    });
    
    let audioChunks = [];
    let totalBytes = 0;
    
    tts.onOpen = () => {
        console.log("✓✓ Session started! Sending text...");
        tts.sendText("你好，这是一个语音合成的测试。今天天气很好！");
        
        setTimeout(() => {
            console.log("\nSending FinishSession...");
            tts.finishSession();
        }, 5000);
    };
    
    tts.onAudio = (buf) => {
        audioChunks.push(Buffer.from(buf));
        totalBytes += buf.byteLength;
        process.stdout.write(`\rAudio: ${audioChunks.length} chunks, ${totalBytes} bytes`);
    };
    
    tts.onEvent = (evt, json) => {
        console.log(`\nEvent ${evt}:`, JSON.stringify(json).substring(0, 100));
        
        if (evt === 152) { // SessionFinished
            console.log(`\n✓✓✓ Done! ${audioChunks.length} chunks, ${totalBytes} bytes`);
            
            if (audioChunks.length > 0) {
                const combined = Buffer.concat(audioChunks);
                fs.writeFileSync('test-output.mp3', combined);
                console.log(`Saved test-output.mp3 (${combined.length} bytes)`);
            }
            
            setTimeout(() => {
                tts.close();
                process.exit(0);
            }, 500);
        }
    };
    
    tts.onError = (err) => {
        console.error("\nError:", err.message);
    };
    
    tts.onClose = () => {
        console.log("\nConnection closed");
    };
    
    try {
        console.log("Connecting...");
        await tts.connect();
        console.log("Connected!");
    } catch (e) {
        console.error("Connect failed:", e.message);
        process.exit(1);
    }
}

test();

// Timeout
setTimeout(() => {
    console.log("\nGlobal timeout");
    process.exit(1);
}, 30000);
