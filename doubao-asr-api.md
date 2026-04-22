# 豆包流式语音识别大模型 API 文档

## 简介

本文档介绍如何通过 WebSocket 协议实时访问大模型流式语音识别服务 (ASR)，主要包含鉴权相关、协议详情、常见问题和使用 Demo 四部分。

### 接口地址

| 模式 | 接口地址 | 说明 |
|---|---|---|
| 双向流式模式 | `wss://openspeech.bytedance.com/api/v3/sauc/bigmodel` | 每输入一个包返回一个包，尽快返回识别到的字符，速度较快 |
| 流式输入模式 | `wss://openspeech.bytedance.com/api/v3/sauc/bigmodel_nostream` | 输入音频大于 15s 或发送最后一包后返回识别结果，准确率更高 |
| 双向流式模式（优化版本） | `wss://openspeech.bytedance.com/api/v3/sauc/bigmodel_async` | 只有当结果有变化时才会返回新的数据包，性能更优 |

### 性能说明

1. 无论是哪种模式，单包音频大小建议在 100~200ms 左右，发包间隔建议 100～200ms
2. 针对双向流式模式，单包为 200ms 大小时性能最优
3. 流式输入模式在平均音频时长 5s 时，可以做到 300~400ms 以内返回
4. 双向流式优化版本推荐使用，性能相对更优（rtf 和首字、尾字时延均有一定程度提升）

---

## 鉴权

在 websocket 建连的 HTTP 请求头（Header 中）添加以下信息：

| Key | 说明 | Value 示例 |
|---|---|---|
| X-Api-App-Key | 使用火山引擎控制台获取的 APP ID | 123456789 |
| X-Api-Access-Key | 使用火山引擎控制台获取的 Access Token | your-access-key |
| X-Api-Resource-Id | 表示调用服务的资源信息 ID | 豆包流式语音识别模型 1.0：<br>• 小时版：`volc.bigasr.sauc.duration`<br>• 并发版：`volc.bigasr.sauc.concurrent`<br><br>豆包流式语音识别模型 2.0：<br>• 小时版：`volc.seedasr.sauc.duration`<br>• 并发版：`volc.seedasr.sauc.concurrent` |
| X-Api-Connect-Id | 用于追踪当前连接的标志 ID，推荐设置 UUID 等 | 67ee89ba-7050-4c04-a3d7-ac61a63499b3 |

websocket 握手成功后，会返回这些 Response header。**强烈建议记录 X-Tt-Logid（logid）作为排错线索。**

| Key | 说明 | Value 示例 |
|---|---|---|
| X-Api-Connect-Id | 用于追踪当前调用信息的标志 ID | 67ee89ba-7050-4c04-a3d7-ac61a63499b3 |
| X-Tt-Logid | 服务端返回的 logid，建议用户获取和打印方便定位问题 | 202407261553070FACFE6D19421815D605 |

### 请求头示例

```http
GET /api/v3/sauc/bigmodel
Host: openspeech.bytedance.com
X-Api-App-Key: 123456789
X-Api-Access-Key: your-access-key
X-Api-Resource-Id: volc.bigasr.sauc.duration
X-Api-Connect-Id: 随机生成的 UUID

## 返回 Header
X-Tt-Logid: 202407261553070FACFE6D19421815D605
```

---

## 协议详情

### 交互流程

```
客户端                              服务端
  |                                   |
  |--- WebSocket 握手 (HTTP GET) ------->|
  |<-- 握手成功 (101 Switching) --------|
  |                                   |
  |--- Full Client Request (首包) ------>|
  |<-- Full Server Response -------------|
  |                                   |
  |--- Audio Only Request (音频包 1) ---->|
  |<-- Full Server Response -------------|
  |                                   |
  |--- Audio Only Request (音频包 2) ---->|
  |<-- Full Server Response -------------|
  |                                   |
  |--- Audio Only Request (最后一包) ---->|
  |<-- Full Server Response (最终结果) ---|
  |                                   |
  |--- 关闭连接 ----------------------->|
```

### WebSocket 二进制协议

在 WebSocket frame payload 中，使用二进制协议传输数据，包括 header、data size 和 data 三部分。

**注意：协议中整数类型的字段都使用大端表示。**

#### header 数据格式

| Byte \ Bit | 7 | 6 | 5 | 4 | 3 | 2 | 1 | 0 |
|---|---|---|---|---|---|---|---|---|
| **0** | Protocol version (4 bits) | Header size (4 bits) |
| **1** | Message type (4 bits) | Message type specific flags (4 bits) |
| **2** | Message serialization method (4 bits) | Message compression (4 bits) |
| **3** | Reserved (8 bits) |
| **4** | [Optional header extensions] |
| **5+** | [Payload, depending on the Message Type] |

#### header 字段描述

| 字段 (size in bits) | 说明 | 值 |
|---|---|---|
| Protocol version (4) | 协议版本 | `0b0001` - version 1 (目前只有该版本) |
| Header size (4) | Header 大小（以字节为单位是 header size value x 4） | `0b0001` - header size = 4 (1 x 4) |
| Message type (4) | 消息类型 | `0b0001` - 端上发送包含请求参数的 full client request<br>`0b0010` - 端上发送包含音频数据的 audio only request<br>`0b1001` - 服务端下发包含识别结果的 full server response<br>`0b1111` - 服务端处理错误时下发的消息类型 |
| Message type specific flags (4) | Message type 的补充信息 | `0b0000` - header 后 4 个字节不为 sequence number<br>`0b0001` - header 后 4 个字节为 sequence number 且为正<br>`0b0010` - header 后 4 个字节不为 sequence number，仅指示此为最后一包（负包）<br>`0b0011` - header 后 4 个字节为 sequence number 且需要为负数（最后一包/负包） |
| Message serialization method (4) | full client request 的 payload 序列化方法 | `0b0000` - 无序列化<br>`0b0001` - JSON 格式 |
| Message compression (4) | 定义 payload 的压缩方法 | `0b0000` - no compression<br>`0b0001` - Gzip 压缩 |
| Reserved (8) | 保留字段 | - |

---

## 请求流程

### 建立连接

根据 WebSocket 协议本身的机制，client 会发送 HTTP GET 请求和 server 建立连接做协议升级，需要在其中根据身份认证协议加入鉴权签名头。

### 发送 full client request

WebSocket 建立连接后，发送的第一个请求是 full client request。格式是：

| 31 ... 24 | 23 ... 16 | 15 ... 8 | 7 ... 0 |
|---|---|---|---|
| Header (4 字节) |
| Payload size (4B, unsigned int32) |
| Payload |

**Payload 参数说明：**

| 字段 | 说明 | 层级 | 格式 | 是否必填 | 备注 |
|---|---|---|---|---|---|
| user | 用户相关配置 | 1 | dict | - | 提供后可供服务端过滤日志 |
| user.uid | 用户标识 | 2 | string | - | 建议采用 IMEI 或 MAC |
| user.did | 设备名称 | 2 | string | - | - |
| user.platform | 操作系统及 API 版本号 | 2 | string | - | iOS/Android/Linux |
| user.sdk_version | sdk 版本 | 2 | string | - | - |
| user.app_version | app 版本 | 2 | string | - | - |
| audio | 音频相关配置 | 1 | dict | ✓ | - |
| audio.language | 指定可识别的语言 | 2 | string | - | **仅流式输入模式 (bigmodel_nostream) 支持**<br>为空时支持中英文、上海话、闽南语、四川话、陕西话、粤语<br>可选值：zh-CN, en-US, ja-JP, id-ID, es-MX, pt-BR, de-DE, fr-FR, ko-KR, fil-PH, ms-MY, th-TH, ar-SA, it-IT, bn-BD, el-GR, nl-NL, ru-RU, tr-TR, vi-VN, pl-PL, ro-RO, ne-NP, uk-UA, yue-CN |
| audio.format | 音频容器格式 | 2 | string | ✓ | pcm / wav / ogg / mp3（pcm 和 wav 内部音频流必须是 pcm_s16le） |
| audio.codec | 音频编码格式 | 2 | string | - | raw / opus（当 format 为 ogg 时，codec 必须是 opus；当 format 为 mp3 时，codec 传 raw） |
| audio.rate | 音频采样率 | 2 | int | - | 默认 16000，目前只支持 16000 |
| audio.bits | 音频采样点位数 | 2 | int | - | 默认 16，暂只支持 16bits |
| audio.channel | 音频声道数 | 2 | int | - | 1(mono) / 2(stereo)，默认 1 |
| request | 请求相关配置 | 1 | dict | ✓ | - |
| request.model_name | 模型名称 | 2 | string | ✓ | 目前只有 bigmodel |
| request.enable_nonstream | 开启二遍识别 | 2 | bool | - | **仅双向流式优化版支持**<br>开启后既实时返回逐字文本，又在最终结果中保证识别准确率<br>会默认开启 VAD 分句（默认 800ms 判停，可通过 end_window_size 配置） |
| request.enable_itn | 启用 ITN（文本规范化） | 2 | bool | - | 默认 true<br>将 ASR 原始输出转换为书面形式，如"一九七零年"→"1970 年" |
| request.enable_speaker_info | 启用说话人聚类分离 | 2 | bool | - | 默认不开启，需同时配置 ssd_version="200" |
| request.ssd_version | ssd 版本号 | 2 | string | - | "200" 时启动大模型 SSD 能力（建议 ASR2.0 时开启） |
| request.enable_punc | 启用标点 | 2 | bool | - | 默认 true |
| request.enable_ddc | 启用语义顺滑 | 2 | bool | - | 默认 false<br>删除或修改 ASR 结果中的不流畅部分（停顿词、语气词、重复词等） |
| request.output_zh_variant | 输出繁体中文 | 2 | string | - | `traditional`：简体→繁体（大陆）<br>`tw`：简体→台湾正体<br>`hk`：简体→香港繁体 |
| request.show_utterances | 输出语音停顿、分句、分词信息 | 2 | bool | - | - |
| request.show_speech_rate | 分句信息携带语速 | 2 | bool | - | 仅 nostream 接口和双向流式优化版支持<br>单位为 token/s，默认 false |
| request.show_volume | 分句信息携带音量 | 2 | bool | - | 仅 nostream 接口和双向流式优化版支持<br>单位为分贝，默认 false |
| request.enable_lid | 启用语种检测 | 2 | bool | - | 仅 nostream 接口和双向流式优化版支持<br>支持标签：singing_en, singing_mand, singing_dia_cant, speech_en, speech_mand, speech_dia_nan, speech_dia_wuu, speech_dia_cant, speech_dia_xina, speech_dia_zgyu, other_langs, others 等 |
| request.enable_emotion_detection | 启用情绪检测 | 2 | bool | - | 仅 nostream 接口和双向流式优化版支持<br>支持标签：angry, happy, neutral, sad, surprise |
| request.enable_gender_detection | 启用性别检测 | 2 | bool | - | 仅 nostream 接口和双向流式优化版支持<br>返回 male/female |
| request.result_type | 结果返回方式 | 2 | string | - | `full`（全量返回，默认）/ `single`（增量结果返回） |
| request.enable_accelerate_text | 是否启动首字返回加速 | 2 | bool | - | 默认 false，设为 true 会尽量加速首字返回但会降低准确率 |
| request.accelerate_score | 首字返回加速率 | 2 | int | - | 配合 enable_accelerate_text 使用，取值范围 [0-20]，值越大首字出字越快 |
| request.vad_segment_duration | 语义切句的最大静音阈值 | 2 | int | - | 单位 ms，默认 3000 |
| request.end_window_size | 强制判停时间 | 2 | int | - | 单位 ms，默认 800，最小 200<br>静音时长超过该值会直接判停，输出 definite |
| request.force_to_speech_time | 强制语音时间 | 2 | int | - | 单位 ms，最小 1<br>音频时长超过该值后才会尝试判停并返回 definite=true |
| request.sensitive_words_filter | 敏感词过滤 | 2 | string | - | 支持开启/关闭/自定义敏感词<br>示例：`{"system_reserved_filter":true,"filter_with_empty":["敏感词"],"filter_with_signed":["敏感词"]}` |
| request.enable_poi_fc | 开启 POI function call | 2 | bool | - | 对语音识别困难的词语调用地图领域推荐词服务<br>可配合 corpus.context 传入 loc_info.loc_info.city_name |
| request.enable_music_fc | 开启音乐 function call | 2 | bool | - | 对语音识别困难的词语调用音乐领域推荐词服务 |
| request.corpus | 语料/干预词等 | 2 | dict | - | - |
| request.corpus.boosting_table_name | 自学习平台热词词表名称 | 3 | string | - | - |
| request.corpus.boosting_table_id | 自学习平台热词词表 id | 3 | string | - | - |
| request.corpus.correct_table_name | 自学习平台替换词词表名称 | 3 | string | - | - |
| request.corpus.correct_table_id | 自学习平台替换词词表 id | 3 | string | - | - |
| request.corpus.context | 热词或上下文 | 3 | string | - | 1. 热词直传（优先级高于传热词表）：双向流式支持 100tokens，nostream 支持 5000 个词<br>2. 上下文：限制 800 tokens 及 20 轮内，可包含文本和图片（image_url，500k 以内 jpeg/jpg/png） |

### full client request 参数示例

```json
{
    "user": {
        "uid": "388808088185088"
    },
    "audio": {
        "format": "wav",
        "rate": 16000,
        "bits": 16,
        "channel": 1,
        "language": "zh-CN"
    },
    "request": {
        "model_name": "bigmodel",
        "enable_itn": false,
        "enable_ddc": false,
        "enable_punc": false,
        "corpus": {
            "boosting_table_id": "通过自学习平台配置热词的词表 id",
            "context": "{\"context_type\": \"dialog_ctx\",\"context_data\":[{\"text\": \"text1\"},{\"text\": \"text2\"},{\"text\": \"text3\"},{\"text\": \"text4\"}]}"
        }
    }
}
```

### 发送 audio only request

Client 发送 full client request 后，再发送包含音频数据的 audio-only client request。音频应采用 full client request 中指定的格式。

格式如下：

| 31 ... 24 | 23 ... 16 | 15 ... 8 | 7 ... 0 |
|---|---|---|---|
| Header (4 字节) |
| Payload size (4B, unsigned int32) |
| Payload |

Payload 是使用指定压缩方法压缩音频数据后的内容。可以多次发送 audio only request 请求。

### full server response

Client 发送的 full client request 和 audio only request，服务端都会返回 full server response。

格式如下：

| 31 ... 24 | 23 ... 16 | 15 ... 8 | 7 ... 0 |
|---|---|---|---|
| Header (4 字节) |
| Sequence (4 字节) |
| Payload size (4B, unsigned int32) |
| Payload |

Payload 内容是包含识别结果的 JSON 格式，字段说明如下：

| 字段 | 说明 | 层级 | 格式 | 是否必填 | 备注 |
|---|---|---|---|---|---|
| result | 识别结果 | 1 | list | - | 仅当识别成功时填写 |
| result.text | 整个音频的识别结果文本 | 2 | string | - | - |
| result.utterances | 识别结果语音分句信息 | 2 | list | - | 仅当开启 show_utterances 时填写 |
| result.utterances[].text | utterance 级的文本内容 | 3 | string | - | - |
| result.utterances[].start_time | 起始时间（毫秒） | 3 | int | - | - |
| result.utterances[].end_time | 结束时间（毫秒） | 3 | int | - | - |
| result.utterances[].definite | 是否是一个确定分句 | 3 | bool | - | - |
| result.utterances[].words | 字词级别信息 | 3 | list | - | - |
| audio_info | 音频信息 | 1 | dict | - | - |
| audio_info.duration | 音频时长（毫秒） | 2 | int | - | - |

### 响应示例

```json
{
  "audio_info": {"duration": 3696},
  "result": {
      "text": "这是字节跳动，今日头条母公司。",
      "utterances": [
        {
          "definite": true,
          "end_time": 1705,
          "start_time": 0,
          "text": "这是字节跳动，",
          "words": [
            {"blank_duration": 0, "end_time": 860, "start_time": 740, "text": "这"},
            {"blank_duration": 0, "end_time": 1020, "start_time": 860, "text": "是"},
            {"blank_duration": 0, "end_time": 1200, "start_time": 1020, "text": "字"},
            {"blank_duration": 0, "end_time": 1400, "start_time": 1200, "text": "节"},
            {"blank_duration": 0, "end_time": 1560, "start_time": 1400, "text": "跳"},
            {"blank_duration": 0, "end_time": 1640, "start_time": 1560, "text": "动"}
          ]
        },
        {
          "definite": true,
          "end_time": 3696,
          "start_time": 2110,
          "text": "今日头条母公司。",
          "words": [
            {"blank_duration": 0, "end_time": 3070, "start_time": 2910, "text": "今"},
            {"blank_duration": 0, "end_time": 3230, "start_time": 3070, "text": "日"},
            {"blank_duration": 0, "end_time": 3390, "start_time": 3230, "text": "头"},
            {"blank_duration": 0, "end_time": 3550, "start_time": 3390, "text": "条"},
            {"blank_duration": 0, "end_time": 3670, "start_time": 3550, "text": "母"},
            {"blank_duration": 0, "end_time": 3696, "start_time": 3670, "text": "公"},
            {"blank_duration": 0, "end_time": 3696, "start_time": 3696, "text": "司"}
          ]
        }
      ]
   }
}
```

### Error message from server

当 server 发现无法解决的二进制/传输协议问题时，将发送 Error message from server 消息。

格式如下：

| 31 ... 24 | 23 ... 16 | 15 ... 8 | 7 ... 0 |
|---|---|---|---|
| Header (4 字节) |
| Error message code (4B, unsigned int32) |
| Error message size (4B, unsigned int32) |
| Error message (UTF8 string) |

---

## 错误码

| 错误码 | 含义 | 说明 |
|---|---|---|
| 20000000 | 成功 | - |
| 45000001 | 请求参数无效 | 请求参数缺失必需字段 / 字段值无效 / 重复请求 |
| 45000002 | 空音频 | - |
| 45000081 | 等包超时 | - |
| 45000151 | 音频格式不正确 | - |
| 550xxxxx | 服务内部处理错误 | - |
| 55000031 | 服务器繁忙 | 服务过载，无法处理当前请求 |

---

## Demo

### Python Demo

下载地址：[sauc_python.zip](https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/9a5371db0dbb4fc389115e8808a5ac73~tplv-goo7wpa0wc-image.image)

### Go Demo

下载地址：[sauc_go.zip](https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/11e65137790c4ecb8651e01221adc8e9~tplv-goo7wpa0wc-image.image)

### Java Demo

下载地址：[sauc.zip](https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/9bf64204b30b4ba8be3099c5c5193bdc~tplv-goo7wpa0wc-image.image)
