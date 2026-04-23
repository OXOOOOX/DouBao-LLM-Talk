import { TTSClient } from './tts.js';
import WebSocket from 'ws';

globalThis.window = { AudioContext: class {}, webkitAudioContext: class {} };
globalThis.WebSocket = WebSocket;

// override the global buildFrame in tts? tts.js doesn't export it.
// I will just copy tts.js to tts-test.js and patch it.
import fs from 'fs';
let code = fs.readFileSync('./tts.js', 'utf8');

// I will modify buildStartConnection to pass flag = 4 (0b0100) or check what happens
// if I change the payload size. Wait, in V3 protocol, if flag 0b0100 is set, an Event number MUST precede payload size?

