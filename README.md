# 豆包语音对话应用

一个基于豆包（Doubao）语音识别和语音合成技术的语音对话应用。

## 功能特点

- 🎤 **语音输入**：通过浏览器麦克风采集音频
- 🔊 **实时识别**：豆包 ASR 流式语音识别
- 🤖 **智能对话**：阿里云 Qwen 大模型流式回复
- 🔈 **语音播报**：豆包 TTS 流式语音合成
- ⚡ **实时打断**：支持在播报过程中打断

## 技术架构

```
语音输入 → 豆包 ASR 识别 → Qwen 大模型 → 豆包 TTS 播报
```

## 快速开始

### 1. 安装依赖

```bash
npm install
```

### 2. 配置环境变量

编辑 `.env.local` 文件，配置以下变量：

```bash
# 阿里云百炼（Qwen）
VITE_DASHSCOPE_KEY=your-qwen-api-key

# 豆包 ASR/TTS 配置
VITE_VOLC_APP_ID=your-app-id
VITE_VOLC_ACCESS_TOKEN=your-access-token
VITE_VOLC_API_KEY=your-api-key
VITE_VOLC_SECRET_KEY=your-secret-key

# 资源 ID
VITE_VOLC_RESOURCE_ID=volc.bigasr.sauc.duration
VITE_VOLC_TTS_RESOURCE_ID=seed-tts-2.0

# 代理地址
VITE_VOLC_PROXY_URL=ws://localhost:3001/proxy
```

### 3. 启动服务

启动本地代理服务器（终端 1）：
```bash
npm run server
```

启动前端开发服务器（终端 2）：
```bash
npm run dev
```

### 4. 访问应用

打开浏览器访问：http://localhost:5173

## 配置说明

### 大模型设置

| 配置项 | 说明 | 默认值 |
|--------|------|--------|
| QWEN API Key | 阿里云百炼 API Key | - |
| 默认模型 | Qwen 模型版本 | qwen-max |

### 豆包设置

| 配置项 | 说明 | 默认值 |
|--------|------|--------|
| APP ID | 豆包应用 ID | - |
| Access Token | 访问令牌 | - |
| API Key | API 密钥 | - |
| ASR Resource ID | 语音识别资源 ID | volc.bigasr.sauc.duration |
| TTS Resource ID | 语音合成资源 ID | seed-tts-2.0 |
| TTS 音色 | 语音合成音色 | zh_female_vv_uranus_bigtts |

## 可用音色

| 音色 ID | 名称 |
|---------|------|
| zh_female_vv_uranus_bigtts | 温柔女声 |
| zh_female_cancan_mars_bigtts | 灿灿女声 |
| zh_male_ahu_raphael_bigtts | 阿虎男声 |
| zh_male_qingshu_raphael_bigtts | 青叔男声 |
| zh_female_shuangkuaisisi_moon_bigtts | 双快思思 |

## 项目结构

```
├── index.html          # 主页面
├── style.css           # 样式文件
├── main.js             # 应用主入口
├── doubao.js           # 豆包 WebSocket 客户端
├── qwen.js             # Qwen API 客户端
├── server.js           # 本地代理服务
├── package.json        # 项目配置
├── vite.config.js      # Vite 配置
└── .env.local          # 环境变量（不提交）
```

## 开发命令

```bash
# 安装依赖
npm install

# 启动开发服务器（前端）
npm run dev

# 启动本地代理服务
npm run server

# 构建生产版本
npm run build

# 预览生产版本
npm run preview
```

## 注意事项

1. 确保 `.env.local` 文件已正确配置所有必需的 API 密钥
2. 本地代理服务和前端服务需要同时运行
3. 使用 Chrome 或 Edge 等现代浏览器以获得最佳兼容性
4. 首次使用需要授权麦克风权限

## 故障排除

### ASR 连接失败
- 检查 APP ID、Access Token、API Key 是否正确
- 确认豆包服务已开通且有可用额度
- 检查网络连接是否正常

### Qwen API 错误
- 检查 API Key 是否正确
- 确认阿里云账户余额充足
- 检查模型名称是否正确

### TTS 播报失败
- 检查 TTS Resource ID 是否正确
- 确认豆包 TTS 服务已开通

## License

MIT
