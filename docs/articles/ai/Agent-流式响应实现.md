# Agent 流式响应实现

流式响应（Streaming Response）是现代 AI Agent 交互的核心能力，它让用户能够实时看到 AI 的思考过程和输出，提升交互体验。本文深入解析 jojo-code 项目中流式响应的完整实现。

## 1. 流式响应的必要性

### 1.1 用户体验

传统的请求-响应模式需要等待 AI 完成全部生成后才返回结果，用户面对长时间的空白等待。流式响应让 AI 可以边想边说：

```
等待响应... →  [传统模式]
啊，我看到→ 你提→ 了一个关于→ Agent→ 流式→ 响应→ 的问题→ ...

啊，我看到 [流式模式，边想边说]
```

### 1.2 首字延迟（Time To First Token）

流式响应的核心优势是大幅降低**首字延迟（TTFT）**：

| 模式 | TTFT | 用户感知 |
|------|------|----------|
| 传统 | 2-5s+ | 长时间无响应 |
| 流式 | <500ms | 快速响应体验 |

首字延迟主要来自：
- LLM 首次 token 生成时间
- 网络往返延迟
- 服务端处理时间

### 1.3 Token 限制与成本

以 GPT-4 为例，每分钟 Token 限制（TPM）约 30,000-120,000。流式响应通过：
- 分批处理降低峰值压力
- 用户可在生成中途取消
- 更早检测并终止无效生成

## 2. 流式响应技术原理

### 2.1 Server-Sent Events (SSE)

SSE 是最简单的服务端推送方案，基于 HTTP 长连接：

```http
HTTP/1.1 200 OK
Content-Type: text/event-stream
Connection: keep-alive

data: {"type": "content", "text": "Hello"}

data: {"type": "content", "text": " World"}

data: [DONE]
```

**优点**：简单、轻量、浏览器原生支持  
**缺点**：仅支持单向推送、需轮询重连

### 2.2 WebSocket

全双工通信协议，适合实时双向交互：

```javascript
// 客户端
const ws = new WebSocket('ws://localhost:8080');

ws.onmessage = (event) => {
  const chunk = JSON.parse(event.data);
  console.log(chunk.type, chunk.text);
};

ws.send(JSON.stringify({
  method: 'chat',
  params: { message: 'Hello' }
}));
```

**优点**：全双工、低延迟、自带重连  
**缺点**：需要特殊协议支持

### 2.3 JSON-RPC 2.0 流式模式

jojo-code 采用的方案，结合 JSON-RPC 与生成器模式：

```python
# 服务端使用生成器 yield 分块返回
def handle_chat(message: str, stream: bool = False):
    if stream:
        for chunk in _agent.stream(state):
            yield chunk  # 每次 yield 一个块
    else:
        return final_result  # 一次性返回
```

**优点**：标准化、类型安全、stdio 友好  
**缺点**：需要自行处理流式解析

## 3. jojo-code 的流式实现

### 3.1 架构概览

```
┌─────────────────────────────────────────────────────────────┐
│                      TypeScript CLI                        │
│  ┌─────────────┐    ┌─────────────┐    ┌─────────────────┐  │
│  │  useAgent   │───▶│ JsonRpcClient│───▶│ stdin/stdout    │  │
│  │   Hook      │    │             │    │    pipes        │  │
│  └─────────────┘    └─────────────┘    └─────────────────┘  │
└─────────────────────────────────────────────────────────────┘
                              │
                              │ stdio
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                      Python Server                         │
│  ┌─────────────┐    ┌─────────────┐    ┌─────────────────┐  │
│  │  handlers   │◀───│ JsonRpcServer│◀───│ stdin           │  │
│  │  (stream)  │    │             │    │                 │  │
│  └─────────────┘    └─────────────┘    └─────────────────┘  │
│         │                              ▲                    │
│         ▼                              │                    │
│  ┌─────────────┐                       │                    │
│  │  Agent     │─────────────────────────┘                    │
│  │  Graph     │                                          │
│  └─────────────┘                                          │
└─────────────────────────────────────────────────────────────┘
```

### 3.2 JSON-RPC Server 实现

`jojo-code/src/jojo_code/server/jsonrpc.py` 核心代码：

```python
@dataclass
class JsonRpcResponse:
    jsonrpc: str = "2.0"
    id: str | int | None = None
    result: Any = None
    error: dict | None = None

    def to_json(self) -> str:
        data = {"jsonrpc": self.jsonrpc, "id": self.id}
        if self.error:
            data["error"] = self.error
        else:
            data["result"] = self.result
        return json.dumps(data)


class JsonRpcServer:
    def __init__(self):
        self.handlers: dict[str, Callable] = {}
        self._buffer = ""

    def send_stream_chunk(self, request_id: str | int, chunk: dict[str, Any]):
        """发送流式响应块"""
        response = {
            "jsonrpc": "2.0",
            "id": request_id,
            "result": chunk,
        }
        print(json.dumps(response), flush=True)
```

关键设计：
1. **stdio 通信**：通过标准输入输出管道
2. **每行一个 JSON**：使用 `\n` 分隔消息
3. **flush=True**：立即推送，不缓冲

### 3.3 Stream Handler 实现

`jojo-code/src/jojo_code/server/handlers.py` 流式处理：

```python
def handle_chat(message: str, stream: bool = False) -> dict | Generator:
    """处理聊天请求"""
    if _agent is None:
        init_agent()

    state = create_initial_state(message)

    if stream:
        return _stream_chat(state)  # 返回生成器
    else:
        return _sync_chat(state)    # 同步返回


def _stream_chat(state: dict) -> Generator[dict, None, None]:
    """流式聊天"""
    for event in _agent.stream(state):
        # 处理不同类型的事件
        if "thinking" in event:
            yield {"type": "thinking", "text": event["thinking"]}

        if "tool_calls" in event:
            for tool_call in event["tool_calls"]:
                yield {
                    "type": "tool_call",
                    "tool_name": tool_call.get("name"),
                    "args": tool_call.get("args", {}),
                }

        if "tool_results" in event:
            for result in event["tool_results"]:
                yield {
                    "type": "tool_result",
                    "tool_name": result.get("name"),
                    "result": result.get("result"),
                }

        if "content" in event:
            yield {"type": "content", "text": event["content"]}

    yield {"type": "done"}
```

流式事件类型：

```typescript
// packages/cli/src/client/types.ts
export type StreamChunk = 
  | { type: 'content'; text: string }      // 内容块
  | { type: 'tool_call'; tool_name: string; args: Record<string, unknown> }
  | { type: 'tool_result'; tool_name: string; result: string }
  | { type: 'thinking'; text: string }      // 思考过程
  | { type: 'done' }                       // 完成信号
  | { type: 'error'; message: string };    // 错误
```

### 3.4 客户端实现

`jojo-code/packages/cli/src/client/jsonrpc.ts` 流式消费：

```typescript
async *stream(
  method: string,
  params: Record<string, unknown> = {}
): AsyncGenerator<StreamChunk> {
  const streamId = `stream-${++this.requestId}`;
  
  const proc = this.process;
  if (!proc?.stdin) {
    throw new Error('Server not running');
  }

  const request: JsonRpcRequest = {
    jsonrpc: '2.0',
    id: streamId,
    method,
    params: { ...params, stream: true },
  };

  const queue: StreamChunk[] = [];
  let done = false;
  let resolveNext: ((value: IteratorResult<StreamChunk>) => void) | null = null;

  this.pendingRequests.set(streamId, {
    resolve: (value) => {
      const chunk = value as StreamChunk;
      if (chunk.type === 'done') {
        done = true;
        resolveNext?.({ value: chunk, done: true });
      } else {
        queue.push(chunk);
        resolveNext?.({ value: chunk, done: false });
      }
      resolveNext = null;
    },
    reject: (error) => {
      done = true;
      queue.push({ type: 'error', message: error.message });
    },
  });

  proc.stdin.write(JSON.stringify(request) + '\n');

  while (!done) {
    if (queue.length > 0) {
      yield queue.shift()!;
    } else {
      await new Promise<void>((resolve) => {
        resolveNext = () => resolve();
      });
    }
  }

  while (queue.length > 0) {
    yield queue.shift()!;
  }
}
```

**核心流程**：

```
1. 发送请求 with stream: true
        │
        ▼
2. 客户端创建 queue + resolveNext 回调
        │
        ▼
3. 服务端每次 yield 一个 chunk
        │
        ▼
4. 客户端接收 → 放入 queue → resolve Promise
        │
        ▼
5. yield queue.shift() 给消费者
        │
        ▼
6. 重复直到收到 {type: 'done'}
```

## 4. TypeScript CLI 的流式处理

### 4.1 useAgent Hook

`jojo-code/packages/cli/src/hooks/useAgent.ts`：

```typescript
export function useAgent(): UseAgentReturn {
  const [messages, setMessages] = useState<Message[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [toolCalls, setToolCalls] = useState<ToolCall[]>([]);
  
  const client = useState(() => new JsonRpcClient())[0];

  const sendMessage = useCallback(async (input: string) => {
    const userMessage: Message = {
      id: `msg-${Date.now()}`,
      role: 'user',
      content: input,
      timestamp: new Date(),
    };

    setMessages(prev => [...prev, userMessage]);
    setIsLoading(true);
    setToolCalls([]);

    try {
      // 使用流式响应
      for await (const chunk of client.stream('chat', { message: input })) {
        switch (chunk.type) {
          case 'content':
            // 实时更新内容
            updateAssistantMessage(chunk.text);
            break;
          case 'tool_call':
            setToolCalls(prev => [...prev, {
              name: chunk.tool_name,
              args: chunk.args,
            }]);
            break;
          case 'tool_result':
            updateToolResult(chunk.tool_name, chunk.result);
            break;
          case 'thinking':
            updateThinking(chunk.text);
            break;
          case 'done':
            // 完成
            break;
        }
      }
    } catch (error) {
      // 错误处理
    } finally {
      setIsLoading(false);
    }
  }, [client]);

  return { /* ... */ };
}
```

### 4.2 状态管理

流式响应状态机：

```
┌─────────────┐
│   IDLE      │──sendMessage──▶┌──────────────┐
└─────────────┘                  │  LOADING    │
                               │  (streaming│
                               └──────────────┘
                                      │
                    ┌─────────────────┼─────────────────┐
                    ▼                 ▼                 ▼
            ┌──────────────┐  ┌──────────────┐  ┌──────────────┐
            │  content     │  │  tool_call   │  │  thinking   │
            │  received   │  │  detected   │  │  detected   │
            └──────────────┘  └──────────────┘  └──────────────┘
                    │                 │                 │
                    └─────────────────┼─────────────────┘
                                         │
                                         ▼
                                  ┌──────────────┐
                                  │    DONE     │
                                  └──────────────┘
```

### 4.3 实时渲染示例

```typescript
function ChatWindow() {
  const { messages, sendMessage, isLoading } = useAgent();
  const [streamingContent, setStreamingContent] = useState('');

  // 监听最新消息的流式更新
  useEffect(() => {
    if (messages.length > 0) {
      const lastMsg = messages[messages.length - 1];
      if (lastMsg.role === 'assistant') {
        setStreamingContent(lastMsg.content);
      }
    }
  }, [messages]);

  return (
    <div className="chat-window">
      <div className="messages">
        {messages.map(msg => (
          <MessageBubble key={msg.id} message={msg} />
        ))}
        {isLoading && (
          <StreamingIndicator content={streamingContent} />
        )}
      </div>
      <Input onSend={sendMessage} />
    </div>
  );
}
```

## 5. 代码示例和最佳实践

### 5.1 服务端流式生成器

```python
from collections.abc import Generator
from typing import Any

def streaming_handler(message: str) -> Generator[dict[str, Any], None, None]:
    """标准流式处理器模式"""
    
    # 1. 立即返回思考中状态
    yield {"type": "thinking", "text": "正在分析..."}
    
    # 2. 模拟工具调用
    yield {
        "type": "tool_call",
        "tool_name": "search",
        "args": {"query": message}
    }
    
    # 3. 工具结果
    yield {
        "type": "tool_result",
        "tool_name": "search",
        "result": "找到 10 条相关结果"
    }
    
    # 4. 生成内容
    for word in generate_word_by_word():
        yield {"type": "content", "text": word}
    
    # 5. 完成信号（必须有）
    yield {"type": "done"}
```

### 5.2 客户端流式消费

```typescript
async function consumeStream(client: JsonRpcClient, message: string) {
  const chunks: string[] = [];
  
  for await (const chunk of client.stream('chat', { message })) {
    switch (chunk.type) {
      case 'content':
        chunks.push(chunk.text);
        // 实时 UI 更新
        renderContent(chunks.join(''));
        break;
        
      case 'thinking':
        showThinkingIndicator(chunk.text);
        break;
        
      case 'tool_call':
        showToolCall(chunk.tool_name, chunk.args);
        break;
        
      case 'tool_result':
        updateToolResult(chunk.tool_name, chunk.result);
        break;
        
      case 'done':
        // 清理状态
        hideLoading();
        break;
        
      case 'error':
        showError(chunk.message);
        break;
    }
  }
  
  return chunks.join('');
}
```

### 5.3 最佳实践总结

| 方面 | 最佳实践 |
|------|----------|
| **低延迟** | 立即 yield 初始响应（thinking 事件），不等待完整生成 |
| **错误处理** | 每个 chunk 都可能是最后一个，准备好 `error` 类型处理 |
| **内存管理** | 流式消费边收边处理，不要等全部接收后再处理 |
| **取消支持** | 实现 abort 机制，允许用户中断生成 |
| **进度指示** | 使用 `thinking` 类型事件让用户知道 AI 在工作 |
| **类型安全** | 定义明确的 StreamChunk 联合类型 |

### 5.4 注意事项

1. **stdio 缓冲**：`print()` 必须使用 `flush=True`
2. **消息分隔**：每行一个完整 JSON，解析时按 `\n` 分割
3. **请求 ID**：流式请求使用特殊 ID（如 `stream-1`）区分普通请求
4. **完成信号**：必须发送 `{type: 'done'}` 让客户端知道流结束
5. **异常处理**：服务端异常时发送 `{type: 'error', message: ...}`

## 6. 总结

jojo-code 实现了基于 JSON-RPC 的轻量级流式响应方案：

1. **服务端**：Python 生成器 + stdio 输出
2. **协议**：JSON-RPC 2.0 + 流式扩展
3. **客户端**：AsyncGenerator + queue 机制
4. **类型安全**：完整的 TypeScript 类型定义

这种方案特别适合 CLI 场景，通过 stdio 实现了简单可靠的双向通信，同时保持了流式响应的实时性优势。