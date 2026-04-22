# 阿里云百炼 - 流式输出 API 文档

## 简介

在实时聊天或长文本生成应用中，长时间的等待会损害用户体验。流式输出通过持续返回模型生成的文本片段，解决了这两个核心问题：

1. **减少首字等待时间** - 用户无需等待完整响应即可看到内容
2. **提升长文本体验** - 逐步显示生成内容，避免长时间空白

## 工作原理

流式输出基于 **Server-Sent Events (SSE)** 协议：

- 服务端与客户端建立持久化 HTTP 连接
- 模型每生成一个文本块（称为 chunk），立即通过连接推送
- 客户端监听事件流，实时接收并处理文本块

## 计费说明

流式输出计费规则与非流式调用完全相同：

- 根据请求的输入 Token 数和输出 Token 数计费
- 请求中断时，输出 Token 仅计算服务端收到终止请求前已生成的部分

---

## 如何使用

### 步骤一：配置 API Key 并选择地域

需要已获取 API Key 并配置到环境变量。**将 API Key 配置为环境变量（`DASHSCOPE_API_KEY`）比在代码中硬编码更安全。**

### 步骤二：发起流式请求

> **重要**：Qwen3 开源版、QwQ 商业版与开源版等模型仅支持流式输出方式调用。

---

## OpenAI 兼容方式调用

### 如何开启

设置 `stream` 为 `true` 即可。

### 查看 Token 消耗

需设置 `stream_options={"include_usage": true}`，使最后一个返回的数据块包含 Token 消耗信息。

### Python 示例

```python
from openai import OpenAI

client = OpenAI(
    api_key="sk-xxx",  # 替换为您的 API Key
    base_url="https://dashscope.aliyuncs.com/compatible-mode/v1"
)

completion = client.chat.completions.create(
    model="qwen-plus",
    messages=[
        {"role": "system", "content": "You are a helpful assistant."},
        {"role": "user", "content": "你好，请介绍一下你自己。"}
    ],
    stream=True,
    stream_options={"include_usage": True}
)

for chunk in completion:
    # 获取增量内容
    delta = chunk.choices[0].delta.content
    if delta:
        print(delta, end="", flush=True)
    
    # 最后一个 chunk 包含 usage 信息
    if chunk.usage:
        print(f"\n\nToken 消耗：{chunk.usage}")
```

### Node.js 示例

```javascript
import OpenAI from "openai";

const client = new OpenAI({
    apiKey: "sk-xxx", // 替换为您的 API Key
    baseURL: "https://dashscope.aliyuncs.com/compatible-mode/v1"
});

async function run() {
    const completion = client.chat.completions.create({
        model: "qwen-plus",
        messages: [
            { role: "system", content: "You are a helpful assistant." },
            { role: "user", content: "你好，请介绍一下你自己。" }
        ],
        stream: true,
        stream_options: { include_usage: true }
    });

    for await (const chunk of completion) {
        const delta = chunk.choices[0].delta.content;
        if (delta) {
            process.stdout.write(delta);
        }
        if (chunk.usage) {
            console.log(`\n\nToken 消耗：${JSON.stringify(chunk.usage)}`);
        }
    }
}

run();
```

### curl 示例

```bash
curl -X POST https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer sk-xxx" \
  -d '{
    "model": "qwen-plus",
    "messages": [
      {"role": "system", "content": "You are a helpful assistant."},
      {"role": "user", "content": "你好，请介绍一下你自己。"}
    ],
    "stream": true,
    "stream_options": {"include_usage": true}
  }'
```

响应数据为符合 SSE 协议的流式响应，格式如下：

```
data: {"id":"chatcmpl-xxx","choices":[{"delta":{"content":"你"},"index":0}]}

data: {"id":"chatcmpl-xxx","choices":[{"delta":{"content":"好"},"index":0}]}

data: {"id":"chatcmpl-xxx","choices":[],"usage":{"prompt_tokens":10,"completion_tokens":20}}
```

---

## DashScope 原生方式调用

### 如何开启

- **Python SDK**：设置 `stream` 参数为 `True`
- **Java SDK**：通过 `streamCall` 接口调用

### 是否启动增量输出

设置 `incremental_output` 为 `true` 启动增量式流式输出。**每个数据块仅包含新生成的内容，性能更佳。**

### 查看 Token 消耗

每个数据块都包含实时的 Token 消耗信息。

### Python 示例

```python
from http import HTTPStatus
from dashscope import Generation


def call_with_stream():
    responses = Generation.call(
        model="qwen-plus",
        messages=[
            {"role": "system", "content": "You are a helpful assistant."},
            {"role": "user", "content": "你好，请介绍一下你自己。"}
        ],
        stream=True,
        incremental_output=True  # 开启增量输出
    )
    
    for resp in responses:
        if resp.status_code == HTTPStatus.OK:
            # 获取增量内容
            content = resp.output.choices[0].message.content
            print(content, end="", flush=True)
            
            # 每个 chunk 都包含 usage 信息
            print(f"\nToken 消耗：{resp.usage}")
        else:
            print(f"请求失败：{resp.code}, {resp.message}")


if __name__ == "__main__":
    call_with_stream()
```

### Java 示例

```java
import com.alibaba.dashscope.aigc.generation.Generation;
import com.alibaba.dashscope.aigc.generation.GenerationParam;
import com.alibaba.dashscope.aigc.generation.GenerationResult;
import com.alibaba.dashscope.common.Message;
import com.alibaba.dashscope.common.Role;
import io.reactivex.Flowable;

public class StreamExample {
    public static void main(String[] args) {
        Generation gen = new Generation();
        
        Message systemMsg = Message.builder()
            .role(Role.SYSTEM.getValue())
            .content("You are a helpful assistant.")
            .build();
            
        Message userMsg = Message.builder()
            .role(Role.USER.getValue())
            .content("你好，请介绍一下你自己。")
            .build();
        
        GenerationParam param = GenerationParam.builder()
            .model("qwen-plus")
            .messages(java.util.Arrays.asList(systemMsg, userMsg))
            .resultFormat(GenerationParam.ResultFormat.MESSAGE)
            .incrementalOutput(true)  // 开启增量输出
            .build();
        
        // 流式调用
        Flowable<GenerationResult> result = gen.streamCall(param);
        
        result.blockingForEach(resp -> {
            if (resp.getStatusCode() == 200) {
                String content = resp.getOutput().getChoices().get(0).getMessage().getContent();
                System.out.print(content);
                System.out.println("\nToken 消耗：" + resp.getUsage());
            } else {
                System.out.println("请求失败：" + resp.getCode() + ", " + resp.getMessage());
            }
        });
    }
}
```

### curl 示例（DashScope 原生）

```bash
curl -X POST https://dashscope.aliyuncs.com/api/v1/services/aigc/text-generation/generation \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer sk-xxx" \
  -H "X-DashScope-SSE: enable" \
  -d '{
    "model": "qwen-plus",
    "input": {
      "messages": [
        {"role": "system", "content": "You are a helpful assistant."},
        {"role": "user", "content": "你好，请介绍一下你自己。"}
      ]
    },
    "parameters": {
      "incremental_output": true
    }
  }'
```

响应遵循 Server-Sent Events (SSE) 格式，每条消息包含 `id`、`event`、`data` 等字段：

```
id: 0
event: incremental
data: {"output":{"text":"你"},"usage":{...}}

id: 1
event: incremental
data: {"output":{"text":"好"},"usage":{...}}
```

---

## 多模态模型的流式输出

> **说明**：适用于 Qwen-VL、Qwen-Audio 等模型。多模态模型的输入不仅包括文本，还包含图片、音频等多模态信息。

DashScope SDK 接口需调用 `MultiModalConversation` 接口。

### OpenAI 兼容方式

```python
from openai import OpenAI

client = OpenAI(
    api_key="sk-xxx",
    base_url="https://dashscope.aliyuncs.com/compatible-mode/v1"
)

completion = client.chat.completions.create(
    model="qwen3-vl-plus",
    messages=[
        {
            "role": "user",
            "content": [
                {"type": "image_url", "image_url": {"url": "https://example.com/image.jpg"}},
                {"type": "text", "text": "请描述这张图片的内容。"}
            ]
        }
    ],
    stream=True
)

for chunk in completion:
    delta = chunk.choices[0].delta.content
    if delta:
        print(delta, end="", flush=True)
```

### DashScope 原生方式（Python）

```python
from http import HTTPStatus
from dashscope import MultiModalConversation


def call_multimodal_stream():
    messages = [{
        "role": "user",
        "content": [
            {"image": "https://example.com/image.jpg"},
            {"text": "请描述这张图片的内容。"}
        ]
    }]
    
    responses = MultiModalConversation.call(
        model="qwen3-vl-plus",
        messages=messages,
        stream=True,
        incremental_output=True
    )
    
    for resp in responses:
        if resp.status_code == HTTPStatus.OK:
            content = resp.output.choices[0].message.content[0]["text"]
            print(content, end="", flush=True)
        else:
            print(f"请求失败：{resp.code}, {resp.message}")
```

### DashScope 原生方式（Java）

```java
import com.alibaba.dashscope.aigc.multimodalconversation.MultiModalConversation;
import com.alibaba.dashscope.aigc.multimodalconversation.MultiModalConversationParam;
import com.alibaba.dashscope.aigc.multimodalconversation.MultiModalConversationResult;
import io.reactivex.Flowable;

public class MultimodalStreamExample {
    public static void main(String[] args) {
        MultiModalConversation conv = new MultiModalConversation();
        
        // 构造多模态消息（包含图片和文本）
        // ... 构建 messages 列表
        
        MultiModalConversationParam param = MultiModalConversationParam.builder()
            .model("qwen3-vl-plus")
            .messages(messages)
            .incrementalOutput(true)
            .build();
        
        Flowable<MultiModalConversationResult> result = conv.streamCall(param);
        
        result.blockingForEach(resp -> {
            if (resp.getStatusCode() == 200) {
                // 处理响应内容
            }
        });
    }
}
```

---

## 思考模型的流式输出

思考模型（如 QwQ、Qwen3 等）会先返回 `reasoning_content`（思考过程），再返回 `content`（回复内容）。**可根据数据包状态判断当前为思考或是回复阶段。**

### OpenAI 兼容方式

```python
from openai import OpenAI

client = OpenAI(
    api_key="sk-xxx",
    base_url="https://dashscope.aliyuncs.com/compatible-mode/v1"
)

completion = client.chat.completions.create(
    model="qwen-plus",
    messages=[
        {"role": "user", "content": "请解答这道数学题：..."}
    ],
    stream=True,
    extra_body={"enable_thinking": True}  # 开启思考模式
)

for chunk in completion:
    delta = chunk.choices[0].delta
    
    # 判断当前阶段
    if hasattr(delta, 'reasoning_content') and delta.reasoning_content:
        # 思考阶段
        print(f"[思考] {delta.reasoning_content}", end="", flush=True)
    elif delta.content:
        # 回复阶段
        print(delta.content, end="", flush=True)
```

### DashScope 原生方式（Python）

```python
from http import HTTPStatus
from dashscope import Generation


def call_with_thinking():
    responses = Generation.call(
        model="qwen-plus",
        messages=[
            {"role": "user", "content": "请解答这道数学题：..."}
        ],
        stream=True,
        incremental_output=True,
        enable_thinking=True  # 开启思考模式
    )
    
    for resp in responses:
        if resp.status_code == HTTPStatus.OK:
            output = resp.output.choices[0].message
            
            # 判断当前阶段
            if output.reasoning_content:
                # 思考阶段
                print(f"[思考] {output.reasoning_content}", end="", flush=True)
            elif output.content:
                # 回复阶段
                print(output.content, end="", flush=True)
```

### DashScope 原生方式（Java）

```java
GenerationParam param = GenerationParam.builder()
    .model("qwen-plus")
    .messages(messages)
    .resultFormat(GenerationParam.ResultFormat.MESSAGE)
    .incrementalOutput(true)
    .enableThinking(true)  // 开启思考模式
    .build();

Flowable<GenerationResult> result = gen.streamCall(param);

result.blockingForEach(resp -> {
    if (resp.getStatusCode() == 200) {
        String reasoning = resp.getOutput().getChoices().get(0).getMessage().getReasoningContent();
        String content = resp.getOutput().getChoices().get(0).getMessage().getContent();
        
        if (reasoning != null && !reasoning.isEmpty()) {
            // 思考阶段
            System.out.print("[思考] " + reasoning);
        } else if (content != null && !content.isEmpty()) {
            // 回复阶段
            System.out.print(content);
        }
    }
});
```

---

## 应用于生产环境的建议

### 性能与资源管理

- 确保服务配置了合理的连接池大小和超时时间
- 设置适当的最大并发连接数，避免资源耗尽

### 客户端渲染

使用 `ReadableStream` 和 `TextDecoderStream` API 平滑处理 SSE 事件流：

```javascript
async function handleStream(response) {
    const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
    
    while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        
        // 解析 SSE 数据
        const lines = value.split('\n');
        for (const line of lines) {
            if (line.startsWith('data: ')) {
                const data = JSON.parse(line.slice(6));
                // 处理数据块
            }
        }
    }
}
```

### 模型监控

监控 **首 Token 延迟（TTFT - Time To First Token）**。**该指标是衡量流式体验的核心。**

### Nginx 代理配置

如果使用 Nginx 作为反向代理，务必在配置文件中关闭代理缓冲：

```nginx
location /api/ {
    proxy_pass http://backend;
    proxy_buffering off;           # 关闭代理缓冲
    proxy_cache off;               # 关闭缓存
    proxy_read_timeout 300s;       # 设置合理的超时时间
}
```

---

## 错误码

如果模型调用失败并返回报错信息，请参见阿里云百炼官方文档的错误码说明进行解决。

---

## 常见问题

### Q：为什么返回数据中没有 usage 信息？

**A**：OpenAI 协议默认不返回 usage 信息。需要设置 `stream_options` 参数使得最后返回的包中包含 usage 信息。

```python
# OpenAI 兼容方式
stream_options={"include_usage": True}
```

### Q：开启流式输出对模型的回复效果是否有影响？

**A**：无影响。流式输出仅改变响应返回方式，不影响模型生成质量。但部分模型（如 Qwen3 开源版、QwQ 等）仅支持流式输出，建议优先使用流式输出。

### Q：incremental_output 参数有什么作用？

**A**：设置 `incremental_output=true` 后，每个数据块仅包含新生成的内容（增量），而非累积的全部内容。这样可以减少网络传输数据量，提升性能。
