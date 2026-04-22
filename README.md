# 豆包语音对话 - QWEN

语音输入 → 豆包 ASR 识别 → 阿里云 QWEN 回答 → 豆包 TTS 播报

## 功能

- 🎤 豆包流式语音识别 2.0（WebSocket 双向流式）
- 🤖 阿里云通义千问 QWEN 流式回复
- 🔊 豆包 TTS 2.0（WebSocket 双向流式）
- 💬 实时文本与语音对话
- ⚙️ 本地设置面板，可保存密钥与资源配置

## 快速开始

### 1. 安装依赖

```bash
npm install
```

### 2. 配置环境变量

在项目根目录创建或编辑 `.env`，填写你自己的配置，例如：

```env
VITE_ALYUN_API_KEY=your_qwen_api_key
VITE_QWEN_MODEL=qwen3.6-max-preview
VITE_VOLC_APP_ID=your_volc_app_id
VITE_VOLC_ACCESS_TOKEN=your_volc_access_token
VITE_VOLC_API_KEY=your_volc_api_key
VITE_VOLC_RESOURCE_ID=volc.seedasr.sauc.duration
VITE_VOLC_TTS_RESOURCE_ID=seed-tts-2.0
VITE_VOLC_PROXY_URL=ws://localhost:3001/proxy
```

也可以在页面右上角的“设置”面板里保存这些配置，保存后会写回本地 `.env`。

### 3. 启动本地代理服务

```bash
npm run server
```

默认会监听 `3001` 端口；如果端口已被占用，可以改用其他端口启动：

```bash
PORT=3002 npm run server
```

前端设置里的代理地址和本地配置接口会跟随这个代理地址工作。

如果启动失败并提示端口占用，先关闭已有的代理进程，或换一个未占用端口重启。

### 4. 启动前端开发服务器

```bash
npm run dev
```

默认访问地址通常是 http://localhost:5173

## 使用方法

1. 启动本地代理服务和前端开发服务器
2. 打开页面，确认设置中的 QWEN 与豆包配置正确
3. 点击 **开始录音** 按钮
4. 对着麦克风说话
5. 豆包 ASR 会实时输出识别结果
6. 识别到完整语句后，自动发送给 QWEN 并播报回复

## 技术栈

- **前端构建**: Vite
- **语音识别**: 火山引擎豆包 ASR 2.0（WebSocket）
- **大模型**: 阿里云通义千问 QWEN
- **语音合成**: 火山引擎豆包 TTS 2.0（WebSocket）
- **本地代理与配置服务**: Node.js + ws

## 目录结构

```text
DouBao-QWEN-talk/
├── index.html          # 主页面
├── package.json
├── server.js           # 本地代理与配置服务
├── .env                # 本地环境变量
└── src/
    ├── main.js         # 主逻辑
    ├── asr.js          # 豆包 ASR 模块
    ├── qwen.js         # QWEN 模块
    ├── tts.js          # 豆包 TTS 模块
    └── style.css       # 样式
```

## 注意事项

1. **浏览器要求**: 需要支持麦克风、WebSocket 与 Web Audio API 的现代浏览器
2. **麦克风权限**: 首次使用需要允许麦克风访问
3. **HTTPS**: 部署到生产环境时，浏览器通常要求 HTTPS 才能访问麦克风
4. **密钥安全**: 不要把真实 API Key、Access Token、APP ID 提交到公开仓库

## 许可证

MIT
