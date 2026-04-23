/**
 * TTS 端到端测试脚本
 * 测试完整流程：连接 → 会话 → 发送文本 → 接收音频 → 保存文件
 */
import { TTSClient } from './tts.js';
import WebSocket from 'ws';
import fs from 'fs';

// Node.js 环境 polyfill
globalThis.window = { AudioContext: class {}, webkitAudioContext: class {} };
globalThis.WebSocket = WebSocket;

const TIMEOUT_MS = 15000;
const TEST_TEXT = '你好，这是一个语音合成测试。';

async function test() {
    console.log('=== TTS 端到端测试 ===');
    console.log(`测试文本: "${TEST_TEXT}"`);
    console.log(`超时时间: ${TIMEOUT_MS}ms`);
    console.log('');

    const tts = new TTSClient({
        apiKey: '47995645-3553-4480-8d45-d769f5beb94d',
        resourceId: 'seed-tts-2.0',
        voiceType: 'zh_female_vv_uranus_bigtts',
        proxyUrl: 'ws://localhost:3001/proxy'
    });

    const audioChunks = [];
    let sessionStarted = false;
    let audioReceived = false;
    let testResult = 'UNKNOWN';

    // 超时保护
    const timeout = setTimeout(() => {
        console.error(`\n❌ 测试超时 (${TIMEOUT_MS}ms)`);
        console.log(`  sessionStarted: ${sessionStarted}`);
        console.log(`  audioReceived: ${audioReceived}`);
        console.log(`  audioChunks: ${audioChunks.length}`);
        testResult = 'TIMEOUT';
        printResult();
        tts.close();
        process.exit(1);
    }, TIMEOUT_MS);

    tts.onOpen = () => {
        sessionStarted = true;
        console.log('✅ [Step 2] 会话已建立 (SessionStarted)');
        console.log('📤 [Step 3] 发送文本...');
        tts.sendText(TEST_TEXT, true);

        // 发送后等一会再关闭会话
        setTimeout(() => {
            console.log('📤 [Step 4] 发送 FinishSession...');
            tts.finishSession();
        }, 2000);
    };

    tts.onAudio = (buf) => {
        audioReceived = true;
        const bytes = buf.byteLength || buf.length;
        audioChunks.push(Buffer.from(buf));
        console.log(`🔊 [Audio] 收到音频数据: ${bytes} bytes (累计 ${audioChunks.length} 个块)`);
    };

    tts.onEvent = (evt, json) => {
        console.log(`📩 [Event ${evt}]`, JSON.stringify(json).substring(0, 200));

        // SessionFinished → 测试完成
        if (evt === 152 || evt === 153 || evt === 151) {
            console.log('\n✅ [Step 5] 会话已结束');
            clearTimeout(timeout);

            if (audioChunks.length > 0) {
                // 保存音频文件
                const audioBuffer = Buffer.concat(audioChunks);
                const outputPath = './test-tts-output.mp3';
                fs.writeFileSync(outputPath, audioBuffer);
                console.log(`💾 音频已保存: ${outputPath} (${audioBuffer.length} bytes)`);
                testResult = 'SUCCESS';
            } else {
                console.log('⚠️  未收到音频数据');
                testResult = 'NO_AUDIO';
            }

            printResult();
            setTimeout(() => {
                tts.close();
                process.exit(testResult === 'SUCCESS' ? 0 : 1);
            }, 500);
        }
    };

    tts.onError = (err) => {
        console.error('❌ [Error]', err.message || err);
        testResult = 'ERROR';
    };

    tts.onClose = (event) => {
        console.log(`🔌 [Close] 连接关闭: code=${event?.code}, reason=${event?.reason}`);
        if (testResult === 'UNKNOWN') {
            clearTimeout(timeout);
            if (audioChunks.length > 0) {
                const audioBuffer = Buffer.concat(audioChunks);
                fs.writeFileSync('./test-tts-output.mp3', audioBuffer);
                console.log(`💾 音频已保存 (${audioBuffer.length} bytes)`);
                testResult = 'SUCCESS';
            } else if (sessionStarted) {
                testResult = 'CLOSED_NO_AUDIO';
            } else {
                testResult = 'CONNECT_FAILED';
            }
            printResult();
            process.exit(testResult === 'SUCCESS' ? 0 : 1);
        }
    };

    function printResult() {
        console.log('\n========== 测试结果 ==========');
        console.log(`结果: ${testResult}`);
        console.log(`会话建立: ${sessionStarted ? '✅' : '❌'}`);
        console.log(`音频接收: ${audioReceived ? '✅' : '❌'}`);
        console.log(`音频块数: ${audioChunks.length}`);
        const totalBytes = audioChunks.reduce((sum, c) => sum + c.length, 0);
        console.log(`音频总量: ${totalBytes} bytes`);
        console.log('==============================');
    }

    try {
        console.log('🔗 [Step 1] 连接代理服务器...');
        await tts.connect();
        console.log('   connect() resolved');
    } catch (err) {
        clearTimeout(timeout);
        console.error('❌ 连接失败:', err.message || err);
        testResult = 'CONNECT_FAILED';
        printResult();
        process.exit(1);
    }
}

test();
