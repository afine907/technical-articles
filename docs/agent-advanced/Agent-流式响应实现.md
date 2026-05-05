---
slug: streaming-response
sidebar_position: 1
title: Agent 流式输出，用户体验翻倍
---

# Agent 流式输出，用户体验翻倍

用户输入问题后，界面卡住 30 秒才突然蹦出一大段文字——这是没做流式响应的典型表现。改成流式输出后，首字延迟从 30 秒降到 0.5 秒，用户体验完全不同。

流式输出怎么实现？

## 为什么流式输出体验更好？

核心指标：**首字延迟（TTFT）**。

传统模式：等 LLM 生成完所有内容才返回，用户盯着空白等30秒。
流式模式：LLM 生成第一个字就返回，用户0.5秒就看到反馈。

打个比方：

- 传统模式：像下载电影，下载完才能看
- 流式模式：像在线播放，边下边看

用户心理上感觉后者"更快"，虽然总时间是一样的。

## 流式输出的原理

最简单的方案：**Server-Sent Events (SSE)**。

服务端不断推送数据块，客户端实时接收：

```http
HTTP/1.1 200 OK
Content-Type: text/event-stream

data: {"text": "你"}

data: {"text": "好"}

data: {"text": "！"}

data: [DONE]
```

客户端每收到一个 `data:` 就更新 UI。

## 简单实现（Python）

服务端：

```python
from flask import Flask, Response
import json

app = Flask(__name__)

@app.route('/chat')
def chat():
    def generate():
        for word in ["你", "好", "！", "这是", "流式", "输出"]:
            yield f"data: {json.dumps({'text': word})}\n\n"
        yield "data: [DONE]\n\n"
    
    return Response(generate(), mimetype='text/event-stream')
```

客户端：

```javascript
const eventSource = new EventSource('/chat');

eventSource.onmessage = (event) => {
  if (event.data === '[DONE]') {
    eventSource.close();
    return;
  }
  
  const data = JSON.parse(event.data);
  document.getElementById('output').textContent += data.text;
};
```

就这么简单。

## 实际项目中的流式处理

jojo-code 用的是 JSON-RPC + stdio 的方式，适合 CLI 场景：

**服务端（Python）**：

```python
def handle_chat(message: str, stream: bool = False):
    if stream:
        # 返回生成器
        for chunk in agent.stream(message):
            yield {"type": "content", "text": chunk}
        yield {"type": "done"}
    else:
        # 同步返回
        return agent.invoke(message)
```

**客户端（TypeScript）**：

```typescript
async function* streamChat(message: string) {
  for await (const chunk of client.stream('chat', { message })) {
    if (chunk.type === 'done') break;
    yield chunk;
  }
}

// 使用
for await (const chunk of streamChat('你好')) {
  console.log(chunk.text);
}
```

关键点：
1. 服务端用 `yield` 返回数据块
2. 客户端用 `for await` 消费
3. 最后发一个 `done` 信号表示结束

## 我踩过的坑

**坑一：忘了 flush**

Python 的 `print()` 默认会缓冲，不会立即输出。

```python
# 错误：不会立即输出
print(json.dumps(chunk))

# 正确：立即输出
print(json.dumps(chunk), flush=True)
```

**坑二：没有错误处理**

流式传输中，任何一步都可能出错。但客户端不知道，会一直等。

解决：定义错误类型：

```python
yield {"type": "error", "message": "LLM 调用失败"}
```

客户端检查：

```typescript
if (chunk.type === 'error') {
  showError(chunk.message);
}
```

**坑三：消息分片**

TCP 可能会把一个消息拆成多个包，或把多个消息合并成一个包。

解决：用换行符分隔消息，每个消息一行：

```python
print(json.dumps(chunk), flush=True)  # 自带换行
```

客户端按行解析：

```typescript
buffer += data;
const lines = buffer.split('\n');
buffer = lines.pop(); // 保留不完整的
for (const line of lines) {
  const chunk = JSON.parse(line);
}
```

## 下一步行动

1. **改造你的 Agent**：把同步调用改成流式
2. **监控 TTFT**：测量首字延迟，目标 < 1秒
3. **加加载动画**：流式输出时显示"正在思考..."

---

核心就一点：不要等完整生成，生成一点就输出一点。用户体验立刻提升。
