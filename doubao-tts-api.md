# 语音合成大模型 API 列表

根据具体场景选择合适的语音合成大模型 API。

| 接口 | 推荐场景 | 接口功能 | 文档链接 |
|---|---|---|---|
| `wss://openspeech.bytedance.com/api/v3/tts/bidirection` | WebSocket 协议，实时交互场景，支持文本实时流式输入，流式输出音频。 | 语音合成、声音复刻、混音 | [V3 WebSocket 双向流式文档](https://www.volcengine.com/docs/6561/1329505) |
| `wss://openspeech.bytedance.com/api/v3/tts/unidirectional/stream` | WebSocket 协议，一次性输入合成文本，流式输出音频。 | 语音合成、声音复刻、混音 | [V3 WebSocket 单向流式文档](https://www.volcengine.com/docs/6561/1719100) |
| `https://openspeech.bytedance.com/api/v3/tts/unidirectional` | HTTP Chunked 协议，一次性输入全部合成文本，流式输出音频。 | 语音合成、声音复刻、混音 | [V3 HTTP Chunked 单向流式文档](https://www.volcengine.com/docs/6561/1598757?lang=zh#_2-http-chunked%E6%A0%BC%E5%BC%8F%E6%8E%A5%E5%8F%A3%E8%AF%B4%E6%98%8E) |
| `https://openspeech.bytedance.com/api/v3/tts/unidirectional/sse` | HTTP SSE 协议，一次性输入全部合成文本，流式输出音频。 | 语音合成、声音复刻、混音 | [V3 Server Sent Events（SSE）单向流式文档](https://www.volcengine.com/docs/6561/1598757?lang=zh#_3-sse%E6%A0%BC%E5%BC%8F%E6%8E%A5%E5%8F%A3%E8%AF%B4%E6%98%8E) |

# 1 接口功能

双向流式 API 为用户提供文本转语音能力，支持多语种、多方言，支持 WebSocket 协议流式调用，同时支持一包发送请求数据或者边发边收数据的流式交互方式。

## 1.1 最佳实践

该接口会处理碎片化的文本或者过长的文本，整理为长度合适的句子。因此最大的优势是平衡延迟和合成效果。

在对接大文本模型时，推荐将流式输出的文本直接输入该接口，而不要额外增加切句或者攒句的逻辑。同样的文本调用一次该接口与多次调用合成接口相比，前者会更为自然，情绪更饱满。

推荐使用链接复用的方式接入，在每次使用时只需要建立一次 websocket 连接，即发送 startconnection，在收到 ConnectionStarted 后，即为链接建立成功。此时，发送 startsession，通过 taskrequest 发送文本，同时接收音频。在没有文本可以发送时，需立即发送 finish session。如果还有文本发送需要合成，此时无需断开链接，待收到 SessionFinished 后（必须），重新发送 startsession，开启新一轮 session。如果再没有文本需要合成，即可发送 finish connection 断开链接。具体流程可参考该页交互示例。

注意，同一个 WebSocket 链接下支持多次 session，但不支持同时多个 session。

# 2 接口说明

## 2.1 请求 Request

### 请求路径

服务使用的请求路径：`wss://openspeech.bytedance.com/api/v3/tts/bidirection`

### 建连&鉴权

#### 鉴权 Request Headers

在 websocket 建连的 HTTP 请求头（Request Header 中）添加以下信息

使用 [新版控制台](https://console.volcengine.com/speech/new) 时，推荐采用以下更简化的鉴权方式。

| Key | 说明 | 参数类型 | 是否必须 | Value 示例 |
|---|---|---|---|---|
| X-Api-Key | 使用火山引擎控制台获取的 API Key | string | 必须 | "your-api-key" |
| X-Api-Resource-Id | 表示调用服务的资源信息 ID，可以用来选择不同的模型版本效果，也决定了计费方式。 | string | 必须 | 见下方说明 |
| X-Api-Connect-Id | 用于追踪当前连接情况的标志 ID，建议用户传递，便于排查连接情况。该 session id 不可复用，每个 session 需保证 ID 是唯一的。 | string | 可选 | "67ee89ba-7050-4c04-a3d7-ac61a63499b3" |

**豆包语音合成大模型**

语音合成接口通过 `X-Api-Resource-Id` 参数来选择不同的版本效果：

- `seed-tts-2.0` 仅支持调用 ["豆包语音合成模型 2.0"的音色](https://www.volcengine.com/docs/6561/1257544?lang=zh#%E8%B1%86%E5%8C%85%E8%AF%AD%E9%9F%B3%E5%90%88%E6%88%90%E6%A8%A1%E5%9E%8B2-0-%E9%9F%B3%E8%89%B2%E5%88%97%E8%A1%A8)
- `seed-tts-1.0` / `seed-tts-1.0-concurr` 仅支持调用 ["豆包语音合成模型 1.0"的音色](https://www.volcengine.com/docs/6561/1257544?lang=zh#%E8%B1%86%E5%8C%85%E8%AF%AD%E9%9F%B3%E5%90%88%E6%88%90%E6%A8%A1%E5%9E%8B1-0-%E9%9F%B3%E8%89%B2%E5%88%97%E8%A1%A8)

同时，`X-Api-Resource-Id` 也决定了计费方式：

- `seed-tts-2.0`：对应计费商品为"语音合成 2.0 字符版"
- `seed-tts-1.0`：对应计费商品为"语音合成 1.0 字符版"
- `seed-tts-1.0-concurr`：对应计费商品为"声音复刻 1.0 并发版"

**豆包声音复刻大模型**

语音合成接口通过 `X-Api-Resource-Id` 参数来选择不同的版本效果：

- `seed-icl-2.0`：对应声音复刻 2.0 版本效果
- `seed-icl-1.0` / `seed-icl-1.0-concurr`：对应声音复刻 1.0 版本效果

同时，`X-Api-Resource-Id` 也决定了计费方式：

- `seed-icl-2.0`：对应计费商品为"声音复刻 2.0 字符版"
- `seed-icl-1.0`：对应计费商品为"声音复刻 1.0 字符版"
- `seed-icl-1.0-concurr`：对应计费商品为"声音复刻 1.0 并发版"

```python
headers = {
    "X-Api-Key": "your-api-key",
    "X-Api-Resource-Id": "seed-tts-2.0"
}
```

若使用 [旧版控制台](https://console.volcengine.com/speech/app) 鉴权方式如下（建议尽快切换至新版）：

| Key | 说明 | 参数类型 | 是否必须 | Value 示例 |
|---|---|---|---|---|
| X-Api-App-Id | 使用火山引擎控制台获取的 APP ID | string | 必须 | "123456789" |
| X-Api-Access-Key | 使用火山引擎控制台获取的 Access Token | string | 必须 | "your-access-key" |
| X-Api-Resource-Id | 表示调用服务的资源信息 ID | string | 必须 | 见上方说明 |
| X-Api-Connect-Id | 用于追踪当前连接情况的标志 ID | string | 可选 | "67ee89ba-7050-4c04-a3d7-ac61a63499b3" |

```python
headers = {
    "X-Api-App-Id": "123456789",
    "X-Api-Access-Key": "your-access-key",
    "X-Api-Resource-Id": "seed-tts-2.0"
}
```

### 额外 Request Headers

| Key | 说明 | 是否必须 | Value 示例 |
|---|---|---|---|
| X-Control-Require-Usage-Tokens-Return | 请求消耗的用量返回控制标记。当携带此字段，在 SessionFinish 事件（152）中会携带用量数据 | 否 | 设置为*，表示返回已支持的用量数据；也设置为具体的用量数据标记，如 text_words；多个用逗号分隔。当前已支持的用量数据：text_words（表示计费字符数） |

### Response Headers

在 websocket 握手成功后，会返回这些 Response header

| Key | 说明 | Value 示例 |
|---|---|---|
| X-Tt-Logid | 服务端返回的 logid，建议用户获取和打印方便定位问题 | 202407261553070FACFE6D19421815D605 |

### WebSocket 二进制协议

WebSocket 使用二进制协议传输数据。

协议的组成由至少 4 个字节的可变 header、payload size 和 payload 三部分组成，其中：

- header 描述消息类型、序列化方式以及压缩格式等信息
- 可选字段：event 字段、connect id size/connect id 字段、session id size/session id 字段、error code（仅用于错误帧）
- payload size 是 payload 的长度
- payload 是具体负载内容，依据消息类型不同 payload 内容不同

需注意：协议中整数类型的字段都使用**大端**表示。

#### 二进制帧

| Byte | Left 4-bit | Right 4-bit | 说明 |
|---|---|---|---|
| 0 - Left half | Protocol version | - | 目前只有 v1，始终填 `0b0001` |
| 0 - Right half | - | Header size (4x) | 目前只有 4 字节，始终填 `0b0001` |
| 1 | Message type | Message type specific flags | 下文详细说明 |
| 2 - Left half | Serialization method | - | `0b0000`：Raw（无特殊序列化方式，主要针对二进制音频数据）；`0b0001`：JSON（主要针对文本类型消息） |
| 2 - Right half | - | Compression method | `0b0000`：无压缩；`0b0001`：gzip |
| 3 | Reserved | - | 留空（`0b0000 0000`） |
| [4 ~ 7] | [Optional field,like event number,...] | - | 取决于 Message type specific flags，可能有、也可能没有 |
| ... | Payload | - | 可能是音频数据、文本数据、音频文本混合数据 |

##### Message type & specific flags

| Message type | 含义 | Message type specific flags | 是否包含 Event number | 备注 |
|---|---|---|---|---|
| 0b0001 | Full-client request | 0b0100 | 是 | 完整请求体，用于触发服务端 session 初始化 |
| 0b1001 | Full-server response | 0b0100 | 是 | TTS：前端信息、文本音频混合数据等（Serialization=JSON） |
| 0b1011 | Audio-only response | 0b0100 | 是 | - |
| 0b1111 | Error information | None | 否 | - |

##### Payload 请求参数

注意：TTS 服务参数设置仅在 StartSession 时生效，每次发送的文本在 TaskRequest 时生效。

TTS 服务参数具体如下：

| 字段 | 描述 | 是否必须 | 类型 | 默认值 |
|---|---|---|---|---|
| user | 用户信息 | - | - | - |
| user.uid | 用户 uid | - | - | - |
| event | 请求的事件 | √ | - | - |
| namespace | 请求方法 | - | string | BidirectionalTTS |
| req_params.text | 输入文本（双向流式不支持 ssml） | √ | string | - |
| req_params.model | 模型版本 | - | string | seed-tts-2.0-expressive |
| req_params.speaker | 发音人 | √ | string | - |
| req_params.audio_params | 音频参数 | √ | object | - |
| req_params.audio_params.format | 音频编码格式，mp3/ogg_opus/pcm | - | string | mp3 |
| req_params.audio_params.sample_rate | 音频采样率，可选值 [8000,16000,22050,24000,32000,44100,48000] | - | number | 24000 |
| req_params.audio_params.bit_rate | 音频比特率 | - | number | - |
| req_params.audio_params.emotion | 设置音色的情感 | - | string | - |
| req_params.audio_params.emotion_scale | 情绪值，范围 1~5 | - | number | 4 |
| req_params.audio_params.speech_rate | 语速，取值范围 [-50,100] | - | number | 0 |
| req_params.audio_params.loudness_rate | 音量，取值范围 [-50,100] | - | number | 0 |
| req_params.audio_params.enable_timestamp | 返回句级别字的时间戳 | - | bool | false |
| req_params.audio_params.enable_subtitle | 返回句级别字幕 | - | bool | false |
| req_params.additions | 用户自定义参数 | - | jsonstring | - |
| req_params.additions.silence_duration | 句尾增加静音时长，范围 0~30000ms | - | number | 0 |
| req_params.additions.enable_language_detector | 自动识别语种 | - | bool | false |
| req_params.additions.disable_markdown_filter | 是否开启 markdown 解析过滤 | - | bool | false |
| req_params.additions.disable_emoji_filter | 开启 emoji 表情在文本中不过滤显示 | - | bool | false |
| req_params.additions.mute_cut_remain_ms | 需配合 mute_cut_threshold 参数一起使用 | - | string | - |
| req_params.additions.enable_latex_tn | 是否可以播报 latex 公式 | - | bool | false |
| req_params.additions.latex_parser | 是否使用 lid 能力播报 latex 公式 | - | string | - |
| req_params.additions.max_length_to_filter_parenthesis | 是否过滤括号内的部分，0 为不过滤，100 为过滤 | - | int | 100 |
| req_params.additions.explicit_language | 仅读指定语种的文本 | - | string | - |
| req_params.additions.context_language | 给模型提供参考的语种 | - | string | - |
| req_params.additions.explicit_dialect | 明确方言 | - | string | - |
| req_params.additions.unsupported_char_ratio_thresh | 不支持合成的文本超过设置的比例则返回错误 | - | float | 0.3 |
| req_params.additions.aigc_watermark | 是否在合成结尾增加音频节奏标识 | - | bool | false |
| req_params.additions.aigc_metadata | 在合成音频 header 加入元数据隐式表示 | - | object | - |
| req_params.additions.cache_config | 开启缓存 | - | object | - |
| req_params.additions.post_process | 后处理配置 | - | object | - |
| req_params.additions.post_process.pitch | 音调取值范围是 [-12,12] | - | int | 0 |
| req_params.additions.context_texts | 语音合成的辅助信息（仅 TTS2.0 支持） | - | string list | null |
| req_params.additions.section_id | 历史上下文的 session_id（仅 TTS2.0 支持） | - | string | "" |
| req_params.additions.use_tag_parser | 是否开启 cot 解析能力 | - | bool | false |
| req_params.mix_speaker | 混音参数结构（仅 TTS1.0 支持） | - | object | - |

单音色请求参数示例：

```json
{
    "user": {
        "uid": "12345"
    },
    "event": 100,
    "req_params": {
        "text": "明朝开国皇帝朱元璋也称这本书为，万物之根",
        "speaker": "zh_female_shuangkuaisisi_moon_bigtts",
        "audio_params": {
            "format": "mp3",
            "sample_rate": 24000
        }
    }
}
```

mix 请求参数示例：

```json
{
    "user": {
        "uid": "12345"
    },
    "req_params": {
        "text": "明朝开国皇帝朱元璋也称这本书为万物之根",
        "speaker": "custom_mix_bigtts",
        "audio_params": {
            "format": "mp3",
            "sample_rate": 24000
        },
        "mix_speaker": {
            "speakers": [{
                "source_speaker": "zh_male_bvlazysheep",
                "mix_factor": 0.3
            }, {
                "source_speaker": "BV120_streaming",
                "mix_factor": 0.3
            }, {
                "source_speaker": "zh_male_ahu_conversation_wvae_bigtts",
                "mix_factor": 0.4
            }]
        }
    }
}
```

## 2.2 响应 Response

### 建连响应

- 建连成功：状态码为 200
- 建连失败：状态码不为 200，Body 中提供错误原因说明

### WebSocket 传输响应

#### 文本帧

主要通过文本内容反馈异常错误信息

#### 二进制帧

主要通过协议约定的方式，结构化返回正常响应和一般错误信息

##### 正常响应帧

| Byte | Left 4-bit | Right 4-bit | 说明 |
|---|---|---|---|
| 0 - Left half | Protocol version | - | 目前只有 v1，始终填 `0b0001` |
| 0 - Right half | - | Header size (4x) | 目前只有 4 字节，始终填 `0b0001` |
| 1 | Message type | Message type specific flags | 下文详细说明 |
| 2 - Left half | Serialization method | - | `0b0000`：Raw；`0b0001`：JSON |
| 2 - Right half | - | Compression method | `0b0000`：无压缩；`0b0001`：gzip |
| 3 | Reserved | - | 留空（`0b0000 0000`） |
| [4 ~ 7] | [Optional field,like event number,...] | - | 取决于 Message type specific flags |
| ... | Payload | - | 可能是音频数据、文本数据、音频文本混合数据 |

###### Payload 响应参数

| 字段 | 描述 | 类型 | 默认值 |
|---|---|---|---|
| data | 返回的二进制数据包 | []byte | - |
| event | 返回的事件类型 | number | - |
| res_params.text | 经文本分句后的句子 | string | - |

##### 错误响应帧

| Byte | Left 4-bit | Right 4-bit | 说明 |
|---|---|---|---|
| 0 - Left half | Protocol version | - | 目前只有 v1，始终填 `0b0001` |
| 0 - Right half | - | Header size (4x) | 目前只有 4 字节，始终填 `0b0001` |
| 1 | Message type | Message type specific flags | 固定为 `0b11110000` |
| 2 - Left half | Serialization method | - | `0b0001`：JSON |
| 2 - Right half | - | Compression method | `0b0000`：无压缩 |
| 3 | Reserved | - | 留空（`0b0000 0000`） |
| [4 ~ 7] | Error code | - | 错误码 |
| ... | Payload | - | 错误消息对象 |

## 2.3 Event 定义

在 TTS 场景中，Event 是正常数据帧（包括上行和下行）的必要字段，事件定义了请求过程中必要的状态转移。

| Event code | 含义 | 事件类型 | 应用阶段 |
|---|---|---|---|
| 1 | StartConnection | Connect 类 | 上行 |
| 2 | FinishConnection | Connect 类 | 上行 |
| 50 | ConnectionStarted | Connect 类 | 下行 |
| 51 | ConnectionFailed | Connect 类 | 下行 |
| 52 | ConnectionFinished | Connect 类 | 下行 |
| 100 | StartSession | Connect 类 | 上行 |
| 101 | CancelSession | Session 类 | 上行 |
| 102 | FinishSession | Session 类 | 上行 |
| 150 | SessionStarted | Session 类 | 下行 |
| 151 | SessionCanceled | Session 类 | 下行 |
| 152 | SessionFinished | Session 类 | 下行 |
| 153 | SessionFailed | Session 类 | 下行 |
| 200 | TaskRequest | 数据类 | 上行 |
| 350 | TTSSentenceStart | 数据类 | 下行 |
| 351 | TTSSentenceEnd | 数据类 | 下行 |
| 352 | TTSResponse | 数据类 | 下行 |

## 2.4 时间戳句子格式说明

| | TTS1.0 / ICL1.0 | TTS2.0 / ICL2.0 |
|---|---|---|
| 事件交互区别 | 合成有多个子句会多次返回 `TTSSentenceStart` 和 `TTSSentenceEnd`。开启字幕后字幕跟随 `TTSSentenceEnd` 返回。 | 合成有多个子句，仅返回一次 `TTSSentenceStart` 和 `TTSSentenceEnd`。开启字幕后会多次返回 `TTSSubtitle`。 |
| 返回时机 | 一个子句的时间戳返回之后才会开始返回下一句音频。 | 在一句音频合成之后，不会立即返回该句的字幕。合成进度不会被字幕识别阻塞。 |
| 句子返回格式 | 字幕信息是基于 tn 打轴，words 内文本字段对应于 tn | 字幕信息是基于原文打轴，words 内文本字段对应于原文 |
| 语种 | 中、英，不支持小语种、方言 | 中、英，不支持小语种、方言 |
| latex | enable_latex_tn=true，有字幕返回 | enable_latex_tn=true，无字幕返回，接口不报错 |
| ssml | req_params.ssml 不为空，有字幕返回 | req_params.ssml 不为空，无字幕返回，接口不报错 |

# 3 交互示例

## TTS1.0、ICL1.0 交互

（请参考原文档中的交互流程图）

## TTS2.0、ICL2.0 交互

注：连接建立和断开的部分相同。

（请参考原文档中的交互流程图）

`CancelSession` 注意事项：

1. `CancelSession` 支持客户端主动放弃当前 session，结束合成，并且释放服务端资源。
2. `CancelSession` 包发送的最佳时机：收到 SessionStarted 后，发送 FinishSession 之前。
3. 客户端在收到 `SessionCanceled` 包之后，如果想要继续合成，需要重新创建 session，即重新执行 `StartSession`。

**Connection 类：**

- `StartConnection` 包（RequestMeta）
- `FinishConnection` 包（RequestMeta）
- `ConnectionStarted` 包
- `ConnectionFailed` 包（ResponseMeta）

**Session 类：**

- `StartSession` 包（RequestMeta）
- `FinishSession` 包（RequestMeta）
- `CancelSession` 包（RequestMeta）
- `SessionStarted` 包（ResponseMeta）
- `SessionFinished` 包（ResponseMeta）
- `SessionFailed` 包（ResponseMeta）：与 `SessionFinished` 类似
- `SessionCanceled` 包（ResponseMeta）：与 `SessionFinished` 类似

**数据类：**

- 音频，含 Event
- 文本，含 Event（以上行 `Event_TaskRequest` 事件为例）

# 4 错误码

## 新框架错误码

```json
CodeOK Code = 20000000          // 成功
CodeClientError Code = 45000000 // 客户端通用错误
CodeServerError Code = 55000000 // 服务端通用错误
CodeSessionError Code = 55000001 // 服务端 session 错误
CodeInvalidReqError Code = 45000001 // 客户端请求参数错误
```

# 5 调用示例

## Python 调用示例

### 前提条件

- 调用之前，您需要获取以下信息：
  - `<appid>`：使用控制台获取的 APP ID
  - `<access_token>`：使用控制台获取的 Access Token
  - `<voice_type>`：您预期使用的音色 ID

### Python 环境

- Python：3.9 版本及以上
- Pip：25.1.1 版本及以上

```bash
python3 -m pip install --upgrade pip
```

### 下载代码示例

```bash
mkdir -p volcengine_bidirection_demo
tar xvzf volcengine_bidirection_demo.tar.gz -C ./volcengine_bidirection_demo
cd volcengine_bidirection_demo
python3 -m venv .venv
source .venv/bin/activate
python3 -m pip install --upgrade pip
pip3 install -e .
```

### 发起调用

```bash
python3 examples/volcengine/bidirection.py --appid <appid> --access_token <access_token> --voice_type <voice_type> --text "你好，我是火山引擎的语音合成服务。这是一个美好的旅程。"
```

## Java 调用示例

### 前提条件

- Java：21 版本及以上
- Maven：3.9.10 版本及以上

## Go 调用示例

### 前提条件

- Go：1.21.0 版本及以上

## C# 调用示例

### 前提条件

- .Net 9.0 版本

## TypeScript 调用示例

### 前提条件

- node：v24.0 版本及以上
- TypeScript：最新

```bash
npm install
npm install -g typescript
npm install -g ts-node
```

### 发起调用

```bash
npx ts-node src/volcengine/bidirection.ts --appid <appid> --access_token <access_token> --voice_type <voice_type> --text "**你好**，我是火山引擎的语音合成服务。"
```
