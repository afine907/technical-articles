---
sidebar_position: 1
title: TypeScript + Python，跨语言架构实践
---

# TypeScript + Python，跨语言架构实践

前端用 TypeScript，AI 后端用 Python，怎么协作？

我之前做一个 Agent CLI，纠结了很久：前端用 TypeScript 写界面更顺手，但 AI 相关的库都是 Python 的。最后我选了双语言架构：TypeScript CLI + Python Agent。

这篇文章，我来分享跨语言架构的设计和实现。

## 架构图

```
┌─────────────────────────────────────────┐
│         TypeScript CLI (ink)            │
│  ┌─────────────┐  ┌─────────────┐       │
│  │  ChatView   │  │  InputBox   │       │
│  └─────────────┘  └─────────────┘       │
│         │                │              │
│         └────────┬───────┘              │
│                  ▼                      │
│         ┌──────────────┐                │
│         │ JsonRpcClient│                │
│         └──────────────┘                │
└─────────────────┬───────────────────────┘
                  │ stdin/stdout
                  ▼
┌─────────────────────────────────────────┐
│         Python Agent Server             │
│  ┌─────────────┐  ┌─────────────┐       │
│  │ JsonRpcServer│ │ LangGraph   │       │
│  └─────────────┘  └─────────────┘       │
└─────────────────────────────────────────┘
```

核心：**JSON-RPC over stdio**。

TypeScript 通过标准输入输出与 Python 通信，协议用 JSON-RPC 2.0。

## 为什么这样设计？

**TypeScript 的优势**：
- ink (React CLI) 生态成熟
- TypeScript 类型安全
- 前端开发者熟悉

**Python 的优势**：
- LangChain/LangGraph 等 AI 库
- 数据处理库丰富
- AI 领域事实标准

**为什么不合并成一种语言？**

Python 也能写 CLI（Rich、Textual），但不如 ink 灵活。
TypeScript 也能调用 LLM（OpenAI SDK），但 Agent 相关的库不成熟。

所以各取所长：TypeScript 负责 UI，Python 负责 AI 逻辑。

## 通信协议：JSON-RPC

JSON-RPC 2.0 是一个简单的 RPC 协议：

**请求格式**：
```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "chat",
  "params": {"message": "你好"}
}
```

**响应格式**：
```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "result": {"content": "你好！有什么可以帮你的？"}
}
```

**错误格式**：
```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "error": {"code": -32600, "message": "Invalid Request"}
}
```

## Python Server 实现

```python
import json
import sys
from typing import Any

class JsonRpcServer:
    def __init__(self):
        self.handlers = {}
    
    def register(self, method: str, handler):
        self.handlers[method] = handler
    
    def start(self):
        for line in sys.stdin:
            request = json.loads(line)
            
            method = request.get("method")
            params = request.get("params", {})
            req_id = request.get("id")
            
            if method in self.handlers:
                result = self.handlers[method](**params)
                response = {"jsonrpc": "2.0", "id": req_id, "result": result}
            else:
                response = {"jsonrpc": "2.0", "id": req_id, "error": {"code": -32601, "message": "Method not found"}}
            
            print(json.dumps(response), flush=True)

# 使用
server = JsonRpcServer()
server.register("chat", lambda message: agent.chat(message))
server.start()
```

关键点：`flush=True`，确保立即输出，不缓冲。

## TypeScript Client 实现

```typescript
import { spawn, ChildProcess } from 'child_process';

class JsonRpcClient {
  private proc: ChildProcess;
  private requestId = 0;
  private pending = new Map<number, { resolve, reject }>();

  constructor(command: string) {
    this.proc = spawn(command, [], { stdio: ['pipe', 'pipe', 'inherit'] });
    
    this.proc.stdout?.on('data', (data) => {
      const response = JSON.parse(data.toString());
      const pending = this.pending.get(response.id);
      if (pending) {
        if (response.error) {
          pending.reject(response.error);
        } else {
          pending.resolve(response.result);
        }
        this.pending.delete(response.id);
      }
    });
  }

  call(method: string, params: any): Promise<any> {
    const id = ++this.requestId;
    const request = { jsonrpc: '2.0', id, method, params };
    
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.proc.stdin?.write(JSON.stringify(request) + '\n');
    });
  }
}

// 使用
const client = new JsonRpcClient('python server.py');
const result = await client.call('chat', { message: '你好' });
console.log(result);
```

## 类型同步

最大的痛点：Python 和 TypeScript 的类型定义需要手动同步。

解决：用 JSON Schema 定义共享类型，或者用工具自动生成。

简单方案：在 TypeScript 里定义，Python 里手动同步。

```typescript
// types.ts
export interface ChatRequest {
  message: string;
  stream?: boolean;
}

export interface ChatResponse {
  content: string;
  toolCalls?: ToolCall[];
}
```

```python
# types.py（手动同步）
from dataclasses import dataclass

@dataclass
class ChatRequest:
    message: str
    stream: bool = False

@dataclass
class ChatResponse:
    content: str
    tool_calls: list = None
```

## 我踩过的坑

**坑一：缓冲问题**

一开始没加 `flush=True`，TypeScript 收不到响应。Python 默认会缓冲输出，只有缓冲区满了或程序结束才会输出。

**坑二：进程管理**

忘记处理子进程的退出，导致僵尸进程。

解决：在 TypeScript 里监听进程退出事件，清理资源。

**坑三：错误处理**

Python 抛异常时，TypeScript 收不到错误信息。

解决：Python 用 try-catch 捕获所有异常，转成 JSON-RPC error 格式返回。

## 下一步行动

1. **确定职责分工**：TypeScript 负责 UI，Python 负责 AI
2. **定义接口**：列出所有 RPC 方法
3. **实现最小 Demo**：一个 echo 方法跑通通信

完整代码在 jojo-code 项目，`packages/cli` 是 TypeScript，`src/jojo_code` 是 Python。

---

跨语言架构增加了复杂度，但各取所长是值得的。
