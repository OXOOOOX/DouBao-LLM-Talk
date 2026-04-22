# 重建进度

## 已完成
- 保留现有 UI：`index.html`、`src/style.css`
- 新建基础骨架：
  - `src/app.bootstrap.js`
  - `src/app.config.js`
  - `src/state/appState.js`
  - `src/ui/dom.js`
  - `src/services/configService.js`
  - `src/services/speechService.js`
  - `src/controllers/settingsController.js`
  - `src/controllers/appController.js`
  - `src/controllers/recordingController.js`
- `src/main.js` 已切换为新入口
- 设置面板已接入新骨架
- 模型选择 / 音色选择 / 清空按钮已接入新骨架
- 录音控制器已完成
  - 麦克风权限申请
  - 音频流采集与 PCM 转换
  - ASR 连接与数据发送
  - 录音状态管理
- ASR 结果处理已接入
  - 流式识别结果实时更新
  - 识别完成自动触发 QWEN 对话
  - 错误处理与状态显示
- QWEN 对话流程已接入
  - 流式响应更新 UI
  - 历史记录管理
- TTS 播报流程已接入
  - 自动播放 QWEN 回复
  - PCM 音频队列播放

## 当前状态
- UI 保留
- 配置初始化已接线
- 录音 / ASR / QWEN / TTS 主流程已重写完成
- 打断逻辑与耗时统计尚未重写
- 错误展示与调试面板尚未统一

## 下一步建议
1. 重写打断逻辑（录音时听到 TTS 可打断）
2. 重写耗时统计（首字延迟、总响应时间等）
3. 统一错误展示与调试面板
4. 端到端测试验证完整流程
