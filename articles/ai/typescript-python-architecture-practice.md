# TypeScript + Python 双语言架构实践：jojo-code 项目深度解析

> **摘要**：本文深入剖析 jojo-code 项目的双语言架构设计，探讨如何结合 TypeScript 的前端交互优势与 Python 的 AI/ML 生态构建现代化代码助手。文章涵盖架构设计哲学、通信协议实现、类型系统集成、开发工作流及性能优化等硬核内容，为架构师提供可复用的双语言系统设计模式。

---

## 一、双语言架构设计哲学

### 1.1 为什么不选择单语言？

在软件架构领域，单语言方案如 Electron + Node.js 或纯 Python CLI 看似简洁，但面临以下根本性挑战：

| 维度 | TypeScript (Node.js) | Python |
|------|-------------------|--------|
| **AI/ML 生态** | llm-api SDK 有限 | LangChain、LangGraph、PyTorch、TensorFlow 原生支持 |
| **类型安全** | TypeScript 一流支持 | Type Hint 演进中，运行时验证弱 |
| **UI 交互** | React 生态强大，Ink/Blitzar 成熟 | TUI 框架 (Rich/Textual) 功能有限 |
| **部署** | 需要 Node.js 环境 | 零依赖部署 (uv pip) |
| **学习曲线** | 前端开发者熟悉 | Python 开发者熟悉 |

**核心洞察**：AI 原生应用需要强大的 ML 库支持（LangGraph、LangChain），而用户交互需要现代化的终端 UI 框架。两种需求在单一语言生态下均无法完美满足。

### 1.2 TypeScript 的战略定位

jojo-code 选择 TypeScript 构建 CLI 层，发挥以下优势：

```typescript
// packages/cli/src/client/jsonrpc.ts - TypeScript 客户端核心
export class JsonRpcClient {
  private process: ChildProcess | null = null;
  private requestId = 0;
  private pendingRequests = new Map<
    string | number,
    { resolve: (value: unknown) => void; reject: (error: Error) => void; }
  >();

  constructor(
    private pythonPath: string = 'python3',
    private serverModule: string = 'jojo_code.server.main'
  ) {
    // 智能查找 venv 中的 Python 解释器
    const possiblePaths = [
      process.cwd() + '/../../.venv/bin/python3',
      process.cwd() + '/.venv/bin/python3',
      '/home/admin/.openclaw/workspace/jojo-code/.venv/bin/python3',
    ];
    
    for (const path of possiblePaths) {
      if (existsSync(path)) {
        this.pythonPath = path;
        break;
      }
    }
    this.startServer();
  }
}
```

**TypeScript 优势总结**：
1. **类型安全**：完整的 IDE 支持和编译时检查
2. **UI 框架**：Ink + React 构建交互式 TUI
3. **生态丰富**：VS Code 插件、Vite 构建工具链
4. **跨平台**：一致的 Node.js 运行环境

### 1.3 Python 的战略定位

Python 负责核心 Agent 逻辑，充分利用其 AI 生态优势：

```python
# src/jojo_code/agent/graph.py - LangGraph 状态图
from langgraph.graph import END, StateGraph
from langgraph.graph.state import CompiledStateGraph

from jojo_code.agent.nodes import execute_node, should_continue, thinking_node
from jojo_code.agent.state import AgentState

def build_agent_graph() -> CompiledStateGraph[AgentState, None, AgentState, AgentState]:
    """构建 Agent 状态图
    
    图结构:
        START -> thinking -> [continue -> execute -> thinking] or [end -> END]
    """
    workflow = StateGraph(AgentState)
    
    workflow.add_node("thinking", thinking_node)
    workflow.add_node("execute", execute_node)
    
    workflow.set_entry_point("thinking")
    
    workflow.add_conditional_edges(
        "thinking",
        should_continue,
        {
            "continue": "execute",
            "end": END,
        },
    )
    
    workflow.add_edge("execute", "thinking")
    
    return workflow.compile()
```

**Python 优势总结**：
1. **LangGraph**：复杂 Agent 工作流编排
2. **LangChain**：统一的 LLM API 抽象
3. **工具生态**：DuckDuckGo Search、TikToken、Pydantic
4. **数据处理**：NumPy、Pandas 无缝集成

### 1.4 边界划分原则

```
┌─────────────────────────────────────────────────────────────┐
│                    TypeScript CLI 层                         │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────────┐   │
│  │   TUI 组件   │  │  状态管理    │  │   JSON-RPC 客户端 │   │
│  └──────────────┘  └──────────────┘  └──────────────────┘   │
└─────────────────────────────────────────────────────────────┘
                            │ JSON-RPC over stdio
                            ▼
┌─────────────────────────────────────────────────────────────┐
│                    Python Agent 核心                         │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────────┐   │
│  │ LangGraph    │  │  工具注册    │  │   权限管理       │   │
│  │   状态图     │  │   registry   │  │   permission     │   │
│  └──────────────┘  └──────────────┘  └──────────────────┘   │
└─────────────────────────────────────────────────────────────┘
```

**边界划分原则**：
- **TypeScript 负责**：用户输入处理、UI 渲染、会话状态管理
- **Python 负责**：LLM 调用、工具执行、安全审计
- **通信协议**：JSON-RPC 2.0 over stdio

---

## 二、架构设计模式

### 2.1 分层架构设计

jojo-code 采用经典的三层架构：

```
┌──────────────────────────────────────────────────────────────────┐
│                      CLI 层 (TypeScript)                        │
│  ┌─────────────────────────────────────────────────────────┐ │
│  │ src/index.tsx (入口)                                       │ │
│  │   └── src/app.tsx (主应用)                                  │ │
│  │       ├── components/ChatView.tsx                         │ │
│  │       ├── components/InputBox.tsx                         │ │
│  │       └── components/PermissionRequest.tsx                │ │
│  │   └── hooks/useAgent.ts (状态管理)                          │ │
│  └─────────────────────────────────────────────────────────┘ │
└──────────────────────────────────────────────────────────────────┘
                              │ JSON-RPC
                              ▼
┌──────────────────────────────────────────────────────────────────┐
│                    通信层 (JSON-RPC over stdio)                  │
│  ┌─────────────────────────────────────────────────────────┐ │
│  │ TypeScript: src/client/jsonrpc.ts                         │ │
│  │   ├── JsonRpcClient 类                                 │ │
│  │   ├── 流式响应生成器                                  │ │
│  │   └── 类型定义 src/client/types.ts                  │ │
│  │ Python: src/jojo_code/server/jsonrpc.py             │ │
│  │   ├── JsonRpcServer 类                               │ │
│  │   ├── 方法装饰器                                    │ │
│  │   └── 请求解析器                                   │ │
│  └─────────────────────────────────────────────────────────┘ │
└──────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌──────────────────────────────────────────────────────────────────┐
│                      核心层 (Python)                          │
│  ┌─────────────────────────────────────────────────────────┐ │
│  │ src/jojo_code/                                          │ │
│  │   ├── agent/ (Agent 状态图和节点)                        │ │
│  │   │   ├── graph.py, nodes.py, state.py, modes.py       │ │
│  │   ├── tools/ (工具注册和执行)                           │ │
│  │   │   ├── registry.py, shell_tools.py, file_tools.py │ │
│  │   ├── security/ (权限和审计)                          │ │
│  │   │   ├── permission.py, audit.py, guards.py           │ │
│  │   ├── session/ (会话管理)                              │ │
│  │   │   ├── manager.py, models.py                        │ │
│  │   ├── memory/ (对话内存)                              │ │
│  │   │   └── conversation.py                             │ │
│  │   └── core/ (LLM 配置、缓存、验证)                     │ │
│  │       └── llm.py, config.py, cache.py                    │ │
│  └─────────────────────────────────────────────────────────┘ │
└──────────────────────────────────────────────────────────────────┘
```

### 2.2 进程间通信机制

#### 2.2.1 通信模式选择

| 通信方式 | 优点 | 缺点 | 适用场景 |
|---------|------|------|---------|
| **HTTP/REST** | 简单、标准 | 每次建立连接 | 需暴露外部 API |
| **WebSocket** | 双向通信 | 需要额外端口 | 实时双向交互 |
| **Unix Socket** | 高性能 | 无 Windows 支持 | 本地快速通信 |
| **stdio** | 零配置、管道化 | 半双工 | **CLI 工具首选** |

**选择理由**：jojo-code 是本地 CLI 工具，stdio 是最自然的交互模式，无���额���端口配置，支持管道和重定向。

#### 2.2.2 stdio 通信实现

```typescript
// packages/cli/src/client/jsonrpc.ts - TypeScript 客户端
private startServer() {
  const proc = spawn(this.pythonPath, ['-m', this.serverModule], {
    stdio: ['pipe', 'pipe', 'pipe'],
  });

  if (!proc.stdout || !proc.stdin || !proc.stderr) {
    throw new Error('Failed to create stdio pipes');
  }

  this.process = proc;

  // 处理 stdout (JSON-RPC 响应)
  proc.stdout.on('data', (data: Buffer) => {
    this.buffer += data.toString();
    this.processBuffer();
  });

  // 处理 stderr (日志)
  proc.stderr.on('data', (data: Buffer) => {
    console.error('[Python]', data.toString());
  });

  // 处理进程退出
  proc.on('close', (code) => {
    console.error(`Python server exited with code ${code}`);
    this.process = null;
  });
}
```

```python
# src/jojo_code/server/jsonrpc.py - Python 服务端
class JsonRpcServer:
    """JSON-RPC Server via stdio"""

    def __init__(self):
        self.handlers: dict[str, Callable] = {}
        self._buffer = ""

    def method(self, name: str):
        """装饰器：注册方法处理器"""
        def decorator(func: Callable) -> Callable:
            self.handlers[name] = func
            return func
        return decorator

    def run(self):
        """运行服务器"""
        for line in sys.stdin:
            line = line.strip()
            if not line:
                continue

            request = self._parse_request(line)
            if request is None:
                continue

            response = self._handle_request(request)
            print(response.to_json(), flush=True)
```

### 2.3 数据流设计

```
用户输入 (CLI)
    │
    ▼
┌────────────────────────┐
│  TypeScript 客户端      │
│  client.request()       │
│  - 序列化 JSON-RPC    │
│  - 写入 stdin          │
└────────────────────────┘
    │
    ▼ JSON-RPC Request
┌────────────────────────┐
│  Python 服务端         │
│  - 解析请求           │
│  - 分发到 handler    │
│  - LangGraph 执行     │
└────────────────────────┘
    │
    ▼ JSON-RPC Response
┌────────────────────────┐
│  TypeScript 客户端     │
│  - 反序列化          │
│  - Promise resolve   │
│  - 触发 UI 更新      │
└────────────────────────┘
    │
    ▼
┌────────────────────────┐
│  React 组件渲染       │
│  ChatView / InputBox   │
└────────────────────────┘
```

---

## 三、通信协议深度实现

### 3.1 JSON-RPC 2.0 协议详解

#### 3.1.1 协议规范

JSON-RPC 2.0 是轻量级远程过程调用协议，具备以下特性：

```json
// 请求格式
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "chat",
  "params": { "message": "Hello" }
}

// 响应格式 (成功)
{
  "jsonrpc": "2.0",
  "id": 1,
  "result": { "content": "Hi, how can I help?" }
}

// 响应格式 (错误)
{
  "jsonrpc": "2.0",
  "id": 1,
  "error": {
    "code": -32603,
    "message": "Internal error",
    "data": "具体错误信息"
  }
}
```

#### 3.1.2 错误码规范

| 错误码 | 含义 | 说明 |
|--------|------|------|
| -32700 | Parse Error | JSON 解析失败 |
| -32600 | Invalid Request | 无效请求格式 |
| -32601 | Method Not Found | 方法不存在 |
| -32602 | Invalid Params | 参数无效 |
| -32603 | Internal Error | 内部错误 |

### 3.2 TypeScript 客户端实现

#### 3.2.1 完整源码

```typescript
// packages/cli/src/client/types.ts
// JSON-RPC 类型定义

export interface JsonRpcRequest {
  jsonrpc: '2.0';
  id: string | number;
  method: string;
  params?: Record<string, unknown>;
}

export interface JsonRpcResponse<T = unknown> {
  jsonrpc: '2.0';
  id: string | number;
  result?: T;
  error?: {
    code: number;
    message: string;
    data?: unknown;
  };
}

export interface JsonRpcNotification {
  jsonrpc: '2.0';
  method: string;
  params?: Record<string, unknown>;
}

// Agent 相关类型

export interface AgentState {
  messages: AgentMessage[];
  current_tool_calls: ToolCallInfo[];
  iteration_count: number;
  max_iterations: number;
  mode: 'plan' | 'build';
}

export interface AgentMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
  tool_calls?: ToolCallInfo[];
}

export interface ToolCallInfo {
  id: string;
  name: string;
  args: Record<string, unknown>;
  result?: string;
}

// 流式响应类型

export type StreamChunk = 
  | { type: 'content'; text: string }
  | { type: 'tool_call'; tool_name: string; args: Record<string, unknown> }
  | { type: 'tool_result'; tool_name: string; result: string }
  | { type: 'thinking'; text: string }
  | { type: 'done' }
  | { type: 'error'; message: string };
```

```typescript
// packages/cli/src/client/jsonrpc.ts
// 完整 JSON-RPC 客户端实现

import { spawn, ChildProcess } from 'child_process';
import { existsSync } from 'fs';
import type { JsonRpcRequest, JsonRpcResponse, StreamChunk } from './types.js';

export class JsonRpcClient {
  private process: ChildProcess | null = null;
  private requestId = 0;
  private pendingRequests = new Map<
    string | number,
    { resolve: (value: unknown) => void; reject: (error: Error) => void; }
  >();
  private buffer = '';

  constructor(
    private pythonPath: string = 'python3',
    private serverModule: string = 'jojo_code.server.main'
  ) {
    const possiblePaths = [
      process.cwd() + '/../../.venv/bin/python3',
      process.cwd() + '/.venv/bin/python3',
      '/home/admin/.openclaw/workspace/jojo-code/.venv/bin/python3',
    ];
    
    for (const path of possiblePaths) {
      if (existsSync(path)) {
        this.pythonPath = path;
        break;
      }
    }
    this.startServer();
  }

  private startServer() {
    const proc = spawn(this.pythonPath, ['-m', this.serverModule], {
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    if (!proc.stdout || !proc.stdin || !proc.stderr) {
      throw new Error('Failed to create stdio pipes');
    }

    this.process = proc;

    proc.stdout.on('data', (data: Buffer) => {
      this.buffer += data.toString();
      this.processBuffer();
    });

    proc.stderr.on('data', (data: Buffer) => {
      console.error('[Python]', data.toString());
    });

    proc.on('close', (code) => {
      console.error(`Python server exited with code ${code}`);
      this.process = null;
    });
  }

  private processBuffer() {
    const lines = this.buffer.split('\n');
    this.buffer = lines.pop() || '';

    for (const line of lines) {
      if (!line.trim()) continue;
      
      try {
        const response: JsonRpcResponse = JSON.parse(line);
        const pending = this.pendingRequests.get(response.id);
        
        if (pending) {
          this.pendingRequests.delete(response.id);
          
          if (response.error) {
            pending.reject(new Error(response.error.message));
          } else {
            pending.resolve(response.result);
          }
        }
      } catch (e) {
        console.error('Failed to parse response:', line, e);
      }
    }
  }

  async request<T>(method: string, params: Record<string, unknown> = {}): Promise<T> {
    return new Promise((resolve, reject) => {
      const proc = this.process;
      if (!proc?.stdin) {
        reject(new Error('Server not running'));
        return;
      }

      const id = ++this.requestId;
      const request: JsonRpcRequest = {
        jsonrpc: '2.0',
        id,
        method,
        params,
      };

      this.pendingRequests.set(id, {
        resolve: resolve as (value: unknown) => void,
        reject,
      });

      proc.stdin.write(JSON.stringify(request) + '\n');
    });
  }

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
        if (resolveNext) {
          const chunk = value as StreamChunk;
          if (chunk.type === 'done') {
            done = true;
            resolveNext({ value: chunk, done: true });
          } else {
            queue.push(chunk);
            resolveNext({ value: chunk, done: false });
          }
          resolveNext = null;
        } else {
          const chunk = value as StreamChunk;
          if (chunk.type !== 'done') {
            queue.push(chunk);
          }
        }
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

  close() {
    if (this.process) {
      this.process.kill();
      this.process = null;
    }
  }

  // ========== 权限相关方法 ==========

  async getPermissionMode(): Promise<string> {
    const result = await this.request<{ status: string; mode: string }>(
      'permission/mode',
      {}
    );
    return result.mode;
  }

  async setPermissionMode(mode: string): Promise<void> {
    await this.request('permission/mode', { mode });
  }

  async permissionConfirm(sessionId: string, approved: boolean): Promise<void> {
    await this.request('permission/confirm', { session_id: sessionId, approved });
  }

  async queryAudit(params: {
    start_date?: string;
    end_date?: string;
    tool?: string;
    allowed?: boolean;
    risk_level?: string;
    limit?: number;
  }): Promise<any[]> {
    const result = await this.request<{ status: string; results: any[] }>(
      'audit/query',
      params
    );
    return result.results;
  }

  async getAuditStats(date?: string): Promise<any> {
    const result = await this.request<{ status: string; statistics: any }>(
      'audit/stats',
      { date }
    );
    return result.statistics;
  }

  async getRecentAudit(limit: number = 20): Promise<any[]> {
    const result = await this.request<{ status: string; results: any[] }>(
      'audit/recent',
      { limit }
    );
    return result.results;
  }
}
```

### 3.3 Python 服务端实现

#### 3.3.1 完整源码

```python
# src/jojo_code/server/jsonrpc.py
"""JSON-RPC Server for jojo-code CLI.

This module implements a JSON-RPC server that communicates via stdio,
allowing TypeScript CLI to interact with Python Agent core.
"""

import json
import sys
from collections.abc import Callable
from dataclasses import dataclass
from typing import Any


@dataclass
class JsonRpcRequest:
    """JSON-RPC 请求"""
    jsonrpc: str
    id: str | int
    method: str
    params: dict[str, Any] | None = None


@dataclass
class JsonRpcResponse:
    """JSON-RPC 响应"""
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
    """JSON-RPC Server via stdio"""

    def __init__(self):
        self.handlers: dict[str, Callable] = {}
        self._buffer = ""

    def method(self, name: str):
        """装饰器：注册方法处理器"""
        def decorator(func: Callable) -> Callable:
            self.handlers[name] = func
            return func
        return decorator

    def register(self, name: str, handler: Callable):
        """注册方法处理器"""
        self.handlers[name] = handler

    def _parse_request(self, line: str) -> JsonRpcRequest | None:
        """解析 JSON-RPC 请求"""
        try:
            data = json.loads(line)
            return JsonRpcRequest(
                jsonrpc=data.get("jsonrpc", "2.0"),
                id=data.get("id"),
                method=data["method"],
                params=data.get("params"),
            )
        except (json.JSONDecodeError, KeyError):
            return None

    def _handle_request(self, request: JsonRpcRequest) -> JsonRpcResponse:
        """处理请求"""
        handler = self.handlers.get(request.method)

        if handler is None:
            return JsonRpcResponse(
                id=request.id,
                error={
                    "code": -32601,
                    "message": f"Method not found: {request.method}",
                },
            )

        try:
            params = request.params or {}
            result = handler(**params)
            return JsonRpcResponse(id=request.id, result=result)
        except Exception as e:
            return JsonRpcResponse(
                id=request.id,
                error={
                    "code": -32603,
                    "message": str(e),
                },
            )

    def run(self):
        """运行服务器"""
        for line in sys.stdin:
            line = line.strip()
            if not line:
                continue

            request = self._parse_request(line)
            if request is None:
                continue

            response = self._handle_request(request)
            print(response.to_json(), flush=True)

    def send_notification(self, method: str, params: dict[str, Any]):
        """发送通知"""
        notification = {
            "jsonrpc": "2.0",
            "method": method,
            "params": params,
        }
        print(json.dumps(notification), flush=True)

    def send_stream_chunk(self, request_id: str | int, chunk: dict[str, Any]):
        """发送流式响应块"""
        response = {
            "jsonrpc": "2.0",
            "id": request_id,
            "result": chunk,
        }
        print(json.dumps(response), flush=True)


# 全局服务器实例
_server: JsonRpcServer | None = None


def get_server() -> JsonRpcServer:
    """获取全局服务器实例"""
    global _server
    if _server is None:
        _server = JsonRpcServer()
    return _server
```

#### 3.3.2 处理器注册

```python
# src/jojo_code/server/handlers.py
"""Agent handlers for JSON-RPC server."""

from collections.abc import Generator

from .jsonrpc import get_server

# 全局 Agent 实例
_agent = None
_conversation_memory = None
_audit_logger = None


def init_agent():
    """初始化 Agent"""
    global _agent, _conversation_memory, _audit_logger

    from jojo_code.agent.graph import get_agent_graph
    from jojo_code.memory.conversation import ConversationMemory
    from jojo_code.security.audit import AuditLogger

    _agent = get_agent_graph()
    _conversation_memory = ConversationMemory()
    _audit_logger = AuditLogger()


def handle_chat(message: str, stream: bool = False) -> dict | Generator:
    """处理聊天请求"""
    if _agent is None:
        init_agent()

    from jojo_code.agent.state import create_initial_state

    state = create_initial_state(message)

    if stream:
        return _stream_chat(state)
    else:
        return _sync_chat(state)


def _sync_chat(state: dict) -> dict:
    """同步聊天"""
    try:
        for chunk in _agent.stream(state):
            for node_name, node_state in chunk.items():
                if node_name == "thinking":
                    messages = node_state.get("messages", [])
                    if messages:
                        last_message = messages[-1]
                        content = last_message.get("content", "")
                        if content:
                            return {"content": content}
                    if node_state.get("is_complete"):
                        return {"content": "任务完成"}

        return {"content": "No response from agent"}
    except Exception as e:
        import traceback
        traceback.print_exc()
        return {"content": f"Error: {e}"}


def _stream_chat(state: dict) -> Generator[dict, None, None]:
    """流式聊天"""
    for event in _agent.stream(state):
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


def handle_clear() -> dict:
    """清空对话历史"""
    global _conversation_memory
    if _conversation_memory:
        _conversation_memory.clear()
    return {"status": "ok"}


def handle_get_model() -> dict:
    """获取当前模型"""
    from jojo_code.core.config import get_settings

    settings = get_settings()
    return {"model": settings.model}


def handle_get_stats() -> dict:
    """获取会话统计"""
    if _conversation_memory is None:
        return {"messages": 0, "tokens": 0}

    return {
        "messages": len(_conversation_memory.messages),
        "tokens": _conversation_memory.total_tokens,
    }


# ========== 权限相关 Handlers ==========

def handle_permission_mode(params: dict) -> dict:
    """获取或设置权限模式"""
    from jojo_code.security.manager import get_permission_manager

    pm = get_permission_manager()
    if pm is None:
        return {"status": "error", "error": "Permission manager not initialized"}

    mode = params.get("mode")
    if mode:
        try:
            pm.set_mode(mode)
            return {"status": "ok", "mode": mode}
        except ValueError as e:
            return {"status": "error", "error": str(e)}

    return {"status": "ok", "mode": pm.mode.value}


def handle_permission_confirm(params: dict) -> dict:
    """处理权限确认响应"""
    session_id = params.get("session_id")
    approved = params.get("approved", False)
    return {"status": "ok", "session_id": session_id, "approved": approved}


def handle_audit_query(params: dict) -> dict:
    """查询审计日志"""
    from jojo_code.security.audit import AuditQuery

    query = AuditQuery()
    results = query.query(
        start_date=params.get("start_date"),
        end_date=params.get("end_date"),
        tool=params.get("tool"),
        allowed=params.get("allowed"),
        risk_level=params.get("risk_level"),
        limit=params.get("limit", 100),
    )
    return {"status": "ok", "results": results, "count": len(results)}


def handle_audit_stats(params: dict) -> dict:
    """获取审计统计"""
    from jojo_code.security.audit import AuditQuery

    query = AuditQuery()
    stats = query.get_statistics(params.get("date"))
    return {"status": "ok", "statistics": stats}


def handle_audit_recent(params: dict) -> dict:
    """获取最近的审计事件"""
    from jojo_code.security.audit import AuditQuery

    query = AuditQuery()
    limit = params.get("limit", 20)
    results = query.get_recent(limit=limit)
    return {"status": "ok", "results": results}


def register_handlers():
    """注册所有处理器"""
    server = get_server()

    # Agent handlers
    server.register("chat", handle_chat)
    server.register("clear", handle_clear)
    server.register("get_model", handle_get_model)
    server.register("get_stats", handle_get_stats)

    # Permission handlers
    server.register("permission/mode", handle_permission_mode)
    server.register("permission/confirm", handle_permission_confirm)

    # Audit handlers
    server.register("audit/query", handle_audit_query)
    server.register("audit/stats", handle_audit_stats)
    server.register("audit/recent", handle_audit_recent)
```

```python
# src/jojo_code/server/main.py
"""JSON-RPC Server main entry point.

Usage:
    python -m jojo_code.server.main

This starts the JSON-RPC server that communicates via stdio.
"""

# 加载 .env 文件（必须在其他导入之前）
from dotenv import load_dotenv

load_dotenv()

from jojo_code.server.handlers import register_handlers
from jojo_code.server.jsonrpc import get_server


def main():
    """运行 JSON-RPC 服务器"""
    # 注册处理器
    register_handlers()

    # 获取服务器并运行
    server = get_server()
    server.run()


if __name__ == "__main__":
    main()
```

### 3.4 流式响应实现

流式响应是现代 AI CLI 的核心需求，jojo-code 通过以下机制实现：

```typescript
// TypeScript 客户端流式响应
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
      if (resolveNext) {
        const chunk = value as StreamChunk;
        if (chunk.type === 'done') {
          done = true;
          resolveNext({ value: chunk, done: true });
        } else {
          queue.push(chunk);
          resolveNext({ value: chunk, done: false });
        }
        resolveNext = null;
      }
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
}
```

```python
# Python 服务端流式响应 (_stream_chat)
def _stream_chat(state: dict) -> Generator[dict, None, None]:
    """流式聊天"""
    for event in _agent.stream(state):
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

### 3.5 错误处理机制

```python
# Python 服务端错误处理
def _handle_request(self, request: JsonRpcRequest) -> JsonRpcResponse:
    """处理请求"""
    handler = self.handlers.get(request.method)

    if handler is None:
        return JsonRpcResponse(
            id=request.id,
            error={
                "code": -32601,
                "message": f"Method not found: {request.method}",
            },
        )

    try:
        params = request.params or {}
        result = handler(**params)
        return JsonRpcResponse(id=request.id, result=result)
    except Exception as e:
        return JsonRpcResponse(
            id=request.id,
            error={
                "code": -32603,
                "message": str(e),
            },
        )
```

---

## 四、类型系统集成

### 4.1 TypeScript 类型定义

```typescript
// packages/cli/src/client/types.ts - 完整类型定义
// JSON-RPC 类型定义

export interface JsonRpcRequest {
  jsonrpc: '2.0';
  id: string | number;
  method: string;
  params?: Record<string, unknown>;
}

export interface JsonRpcResponse<T = unknown> {
  jsonrpc: '2.0';
  id: string | number;
  result?: T;
  error?: {
    code: number;
    message: string;
    data?: unknown;
  };
}

export interface JsonRpcNotification {
  jsonrpc: '2.0';
  method: string;
  params?: Record<string, unknown>;
}

// Agent 相关类型

export interface AgentState {
  messages: AgentMessage[];
  current_tool_calls: ToolCallInfo[];
  iteration_count: number;
  max_iterations: number;
  mode: 'plan' | 'build';
}

export interface AgentMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
  tool_calls?: ToolCallInfo[];
}

export interface ToolCallInfo {
  id: string;
  name: string;
  args: Record<string, unknown>;
  result?: string;
}

// 流式响应类型

export type StreamChunk = 
  | { type: 'content'; text: string }
  | { type: 'tool_call'; tool_name: string; args: Record<string, unknown> }
  | { type: 'tool_result'; tool_name: string; result: string }
  | { type: 'thinking'; text: string }
  | { type: 'done' }
  | { type: 'error'; message: string };
```

### 4.2 Python 类型提示

```python
# src/jojo_code/server/jsonrpc.py - Python 端类型定义
from dataclasses import dataclass
from typing import Any


@dataclass
class JsonRpcRequest:
    """JSON-RPC 请求"""
    jsonrpc: str
    id: str | int
    method: str
    params: dict[str, Any] | None = None


@dataclass
class JsonRpcResponse:
    """JSON-RPC 响应"""
    jsonrpc: str = "2.0"
    id: str | int | None = None
    result: Any = None
    error: dict | None = None
```

```python
# src/jojo_code/agent/state.py - Agent 状态类型
from typing import Annotated, Any
from typing_extensions import TypedDict


def merge_lists(left: list[Any] | None, right: list[Any] | None) -> list[Any]:
    """合并两个列表（用于 Annotated reducer）"""
    if left is None:
        left = []
    if right is None:
        right = []
    return left + right


class AgentState(TypedDict):
    """Agent 状态
    
    Attributes:
        messages: 对话历史
        tool_calls: 待执行的工具调用
        tool_results: 工具执行结果
        is_complete: 任务是否完成
        iteration: 当前循环次数
    """

    messages: Annotated[list[dict[str, Any]], merge_lists]
    tool_calls: list[dict[str, Any]]
    tool_results: list[str]
    is_complete: bool
    iteration: int
    mode: str
```

### 4.3 跨语言类型同步策略

| 策略 | 描述 | 优点 | 缺点 |
|------|------|------|------|
| **手动同步** | 开发者维护两套类型 | 完全控制 | 容易不同步 |
| **代码生成** | 从一方生成另一方 | 自动同步 | 需要额外工具 |
| **Schema 生成** | 使用 JSON Schema | 标准化 | 粒度粗 |
| **文档约定** | 通过文档约定字段 | 简单 | 无编译器检查 |

**jojo-code 采用手动同步策略**，因为：
1. 协议简单（JSON-RPC 2.0）
2. 类型数量有限
3. 开发者可控制范围

### 4.4 类型安全保证

```typescript
// TypeScript 端 - 编译时类型安全
async request<T>(method: string, params: Record<string, unknown> = {}): Promise<T> {
  // 编译器检查返回类型 T
}
```

```python
# Python 端 - 使用 Pydantic 进行运行时验证
from pydantic import BaseModel, Field


class ChatRequest(BaseModel):
    message: str = Field(..., min_length=1)
    stream: bool = False


class ChatResponse(BaseModel):
    content: str
```

```bash
# mypy 类型检查 (Python)
$ mypy src/jojo_code --strict
Success: no issues found

# tsc 类型检查 (TypeScript)
$ tsc --noEmit
# 编译通过
```

---

## 五、开发工作流

### 5.1 项目结构设计

```
jojo-code/
├── packages/
│   └── cli/                      # TypeScript CLI
│       ├── src/
│       │   ├── client/
│       │   │   ├── jsonrpc.ts   # JSON-RPC 客户端
│       │   │   └── types.ts    # 类型定义
│       │   ├── components/     # React 组件
│       │   ├── hooks/         # 自定义 Hooks
│       │   └── index.tsx      # 入口文件
│       ├── tests/             # 单元测试
│       ├── package.json
│       └── tsconfig.json
├── src/
│   └── jojo_code/              # Python 核心
│       ├── agent/              # Agent 图定义
│       ├── tools/             # 工具注册
│       ├── security/          # 权限管理
│       ├── session/          # 会话管理
│       ├── memory/           # 对话内存
│       ├── server/           # JSON-RPC 服务端
│       └── core/             # 核心功能
├── tests/                    # Python 测试
├── pyproject.toml           # Python 配置
├── package.json            # pnpm 工作区
└── pnpm-workspace.yaml
```

### 5.2 依赖管理

#### 5.2.1 Python 依赖管理 (uv)

```toml
# pyproject.toml
[project]
name = "jojo-code"
version = "0.1.0"
requires-python = ">=3.11"
dependencies = [
    "langgraph>=0.2",
    "langchain>=0.3",
    "langchain-openai>=0.2",
    "pydantic>=2",
    "pydantic-settings>=2",
    "tiktoken>=0.5",
    "python-dotenv>=1",
    "duckduckgo-search>=0.8.0",
]

[project.optional-dependencies]
dev = [
    "pytest>=8",
    "pytest-asyncio>=0.23",
    "pytest-cov>=4",
    "mypy>=1",
    "ruff>=0.4",
]
```

```bash
# 安装 Python 依赖
$ uv sync

# 安装开发依赖
$ uv sync --dev
```

#### 5.2.2 TypeScript 依赖管理 (pnpm)

```json
// packages/cli/package.json
{
  "name": "@jojo-code/cli",
  "version": "0.1.0",
  "type": "module",
  "dependencies": {
    "chalk": "^5.3.0",
    "ink": "^4.4.1",
    "react": "^18.2.0",
    "react-markdown": "^9.0.1"
  },
  "devDependencies": {
    "typescript": "^5.3.0",
    "vitest": "^1.2.0",
    "tsx": "^4.7.0"
  }
}
```

```bash
# 安装 TypeScript 依赖
$ pnpm install

# 构建
$ pnpm --filter @jojo-code/cli build
```

### 5.3 开发环境配置

```bash
# 创建虚拟环境
$ cd jojo-code
$ uv venv .venv

# 激活并同步依赖
$ source .venv/bin/activate
$ uv sync

# 运行 CLI
$ pnpm cli dev

# 或直接运行 Python
$ python -m jojo_code.server.main
```

### 5.4 测试策略

#### 5.4.1 TypeScript 测试 (Vitest)

```typescript
// packages/cli/tests/jsonrpc.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { JsonRpcClient } from '../src/client/jsonrpc.js';

vi.mock('child_process', () => ({
  spawn: vi.fn(() => ({
    stdin: { write: vi.fn(), end: vi.fn() },
    stdout: { 
      on: vi.fn((event, callback) => {
        if (event === 'data') {
          setTimeout(() => callback(JSON.stringify({
            jsonrpc: '2.0',
            result: { content: 'Test response' },
            id: 1,
          }) + '\n'), 10);
        }
      }),
    },
    stderr: { on: vi.fn() },
    on: vi.fn(),
    kill: vi.fn(),
  })),
}));

describe('JsonRpcClient', () => {
  let client: JsonRpcClient;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('can be instantiated', () => {
    client = new JsonRpcClient();
    expect(client).toBeDefined();
    client.close();
  });
});
```

```bash
# 运行 TypeScript 测试
$ pnpm --filter @jojo-code/cli test
```

#### 5.4.2 Python 测试 (pytest)

```python
# tests/test_server/test_jsonrpc_server.py
import pytest
from jojo_code.server.jsonrpc import JsonRpcServer, JsonRpcRequest


def test_parse_request():
    """测试请求解析"""
    server = JsonRpcServer()
    line = '{"jsonrpc": "2.0", "id": 1, "method": "test", "params": {"a": 1}}'
    
    request = server._parse_request(line)
    
    assert request is not None
    assert request.method == "test"
    assert request.params == {"a": 1}


def test_handle_not_found():
    """测试方法未找到"""
    server = JsonRpcServer()
    request = JsonRpcRequest(jsonrpc="2.0", id=1, method="nonexistent")
    
    response = server._handle_request(request)
    
    assert response.error is not None
    assert response.error["code"] == -32601
```

```bash
# 运行 Python 测试
$ pytest tests/ -v

# 带覆盖率
$ pytest tests/ --cov=jojo_code
```

### 5.5 CI/CD 配置

```yaml
# .github/workflows/ci.yml
name: CI

on: [push, pull_request]

jobs:
  test:
    runs-on: ubuntu-latest
    
    steps:
    - uses: actions/checkout@v4
    
    - name: Set up Python
      uses: actions/setup-python@v5
      with:
        python-version: '3.11'
    
    - name: Install uv
      uses: astral-sh/setup-uv@v4
    
    - name: Install dependencies
      run: uv sync --dev
    
    - name: Run Python tests
      run: pytest tests/ -v
    
    - name: Type check (mypy)
      run: mypy src/jojo_code
    
    - name: Set up Node.js
      uses: actions/setup-node@v4
      with:
        node-version: '20'
        package-manager: pnpm
    
    - name: Install pnpm
      uses: pnpm/action-setup@v2
    
    - name: Install dependencies
      run: pnpm install
    
    - name: Run TypeScript tests
      run: pnpm --filter @jojo-code/cli test
```

---

## 六、性能优化

### 6.1 进程启动优化

#### 6.1.1 问题分析

首次启动 Python 进程时，存在以下开销：
- Python 解释器启动 (~200ms)
- 模块导入和初始化 (~500ms-2s)
- LangChain/LangGraph 加载 (~1-3s)

#### 6.1.2 解决方案：进程复用

```typescript
// packages/cli/src/client/jsonrpc.ts
// 在单个进程中复用连接
export class JsonRpcClient {
  private process: ChildProcess | null = null;
  private pendingRequests = new Map<...>();
  
  constructor(...) {
    this.startServer();
  }
  
  // 复用进程，避免重复启动
  async request<T>(method: string, params: ...): Promise<T> {
    // 检查进程是否存活
    if (!this.process || !this.process.stdin) {
      // 重启进程（而非每次都创建新的）
      this.startServer();
    }
    // 发送请求...
  }
}
```

#### 6.1.3 解决方案：预热

```python
# 启动时预热
def main():
    # 预热导入
    from jojo_code.agent.graph import get_agent_graph
    from jojo_code.memory.conversation import ConversationMemory
    
    # 预热创建实例
    get_agent_graph()  # 预编译状态图
    
    # 注册处理器
    register_handlers()
    
    # 运行服务器
    server = get_server()
    server.run()
```

### 6.2 通信延迟优化

#### 6.2.1 行协议 (Line Protocol)

```
┌─────────────────────────────────────────────────────┐
│  问题：多个 JSON 对象混在一起如何解析？              │
├─────────────────────────────────────────────────────┤
│  解决：使用行协议，每行一个 JSON 对象               │
├─────────────────────────────────────────────────────┤
│  输入:                                            │
│  {"jsonrpc":"2.0","id":1,"method":"chat"}         │
│  {"jsonrpc":"2.0","id":2,"method":"clear"}         │
│  {"jsonrpc":"2.0","id":3,"params":{"message":"hi"}} │
│                                                     │
│  按行分割后:                                        │
│  1. {"jsonrpc":"2.0","id":1,"method":"chat"}      │
│  2. {"jsonrpc":"2.0","id":2,"method":"clear"}     │
│  3. {"jsonrpc":"2.0","id":3,"params":{"message":  │
│     "hi"}}                                        │
└─────────────────────────────────────────────────────┘
```

```python
# Python 服务端 - 按行解析
def run(self):
    for line in sys.stdin:        # 按行读取
        line = line.strip()
        if not line:
            continue
        
        request = self._parse_request(line)
        if request is None:
            continue
        
        response = self._handle_request(request)
        print(response.to_json(), flush=True)  # 按行输出
```

#### 6.2.2 缓冲区处理

```python
# 避免行分割问题：使用缓冲区
private processBuffer() {
  const lines = this.buffer.split('\n');
  this.buffer = lines.pop() || '';  // 保留未完成行
  
  for (const line of lines) {
    if (!line.trim()) continue;
    // 处理每行...
  }
}
```

### 6.3 内存管理

```python
# 避免内存泄漏：定期清理
class ConversationMemory:
    def __init__(self, max_messages: int = 100):
        self.max_messages = max_messages
        self._messages: list[Message] = []
    
    def add_message(self, message: Message) -> None:
        self._messages.append(message)
        
        # 超过限制时删除旧消息
        if len(self._messages) > self.max_messages:
            self._messages = self._messages[-self.max_messages:]
```

### 6.4 并发处理

```python
# 使用异步处理并发请求
import asyncio


async def handle_concurrent():
    """并���处���多个请求"""
    tasks = [
        agent.chat("任务1"),
        agent.chat("任务2"),
        agent.chat("任务3"),
    ]
    
    results = await asyncio.gather(*tasks)
    return results
```

---

## 七、实战经验

### 7.1 遇到的坑和解决方案

#### 7.1.1 坑 #1：stdio 阻塞问题

**问题**：当 Python 服务端等待输入时，Node.js 进程会一直等待。

**原因**：stdio 是同步的，Python 端使用 `for line in sys.stdin` 会阻塞。

**解决方案**：使用非阻塞 I/O 或预先设计好通信协议。

```python
# 解决方案：提前加载 .env，在模块级别执行
from dotenv import load_dotenv
load_dotenv()  # 在导入之前加载

def main():
    server = get_server()
    server.run()
```

#### 7.1.2 坑 #2：进程无法正常退出

**问题**：Python 进程在 CLI 退出后仍在运行。

**解决方案**：正确处理进程退出信号。

```typescript
proc.on('close', (code) => {
  console.error(`Python server exited with code ${code}`);
  this.process = null;
});

// 退出时杀死子进程
process.on('exit', () => {
  if (this.process) {
    this.process.kill();
  }
});
```

#### 7.1.3 坑 #3：类型不匹配

**问题**：TypeScript 和 Python 类型定义不一致。

**解决方案**：制定协议文档并手动同步。

```typescript
// 严格类型定义
export interface JsonRpcResponse<T = unknown> {
  jsonrpc: '2.0';
  id: string | number;
  result?: T;
  error?: {
    code: number;
    message: string;
    data?: unknown;
  };
}
```

```python
# 使用 Pydantic 验证
from pydantic import BaseModel


class JsonRpcError(BaseModel):
    code: int
    message: str
    data: Any | None = None
```

### 7.2 最佳实践总结

| 实践 | 描述 | 优先级 |
|------|------|--------|
| **严格类型定义** | 两端都使用强类型 | 高 |
| **行协议** | 使用 `\n` 分隔 JSON | 高 |
| **预热机制** | 启动时预热 LangGraph | 中 |
| **进程复用** | 避免重复创建进程 | 中 |
| **错误码规范** | 遵循 JSON-RPC 2.0 | 高 |
| **流式响应** | 支持实时输出 | 中 |
| **日志分离** | stderr 用于日志 | 低 |

### 7.3 架构演进历程

```
v0.1.0 (初始版本)
├── 直接调用 Python 模块
├── 简单 subprocess 调用
└── 缺乏类型安全

v0.2.0 (架构升级)
├── 引入 JSON-RPC 协议
├── 处理分离 (CLI / Core)
└── 类型系统引入

v0.3.0 (生产就绪)
├── 进程复用
├── 错误处理
├── 流式响应
└── 权限管理

v0.4.0 (性能优化)
├── 预热机制
├── 缓冲区优化
├── 异步支持
└── 测试覆盖
```

---

## 八、附录

### A. 完整的项目结构

```
jojo-code/
├── packages/
│   └── cli/
│       ├── src/
│       │   ├── client/
│       │   │   ├── jsonrpc.ts     # 260 行
│       │   │   └── types.ts       # 58 行
│       │   ├── components/
│       │   │   ├── ChatView.tsx
│       │   │   ├── InputBox.tsx
│       │   │   └── PermissionRequest.tsx
│       │   ├── hooks/
│       │   │   └── useAgent.ts    # 137 行
│       │   ├── app.tsx
│       │   └── index.tsx
│       ├── tests/
│       │   ├── jsonrpc.test.ts   # 79 行
│       │   ├── useAgent.test.ts
│       │   ├── e2e.test.ts
│       │   └── e2e-pty.test.ts
│       ├── package.json
│       ├── tsconfig.json
│       └── vitest.config.ts
├── src/
│   └── jojo_code/
│       ├── __init__.py
│       ├── __main__.py
│       ├── agent/
│       ���   ���── __init__.py
│       │   ├── graph.py           # 60 行
│       │   ├── nodes.py
│       │   ├── state.py         # 71 行
│       │   ├── modes.py
│       │   └── state.py
│       ├── tools/
│       │   ├── __init__.py
│       │   ├── registry.py
│       │   ├── shell_tools.py
│       │   ├── file_tools.py
│       │   ├── git_tools.py
│       │   ├── web_tools.py
│       │   └── search_tools.py
│       ├── security/
│       │   ├── __init__.py
│       │   ├── permission.py   # 57 行
│       │   ├── audit.py
│       │   ├── guards.py
│       │   └── manager.py
│       ├── session/
│       │   ├── __init__.py
│       │   ├── manager.py
│       │   └── models.py       # 64 行
│       ├── memory/
│       │   ├── __init__.py
│       │   └── conversation.py
│       ├── server/
│       │   ├── __init__.py
│       │   ├── jsonrpc.py      # 143 行
│       │   ├── handlers.py     # 248 行
│       │   └── main.py         # 29 行
│       └── core/
│           ├── __init__.py
│           ├── config.py
│           ├── llm.py
│           ├── cache.py
│           └── database.py
├── tests/
│   ├── conftest.py
│   ├── test_agent.py
│   ├── test_tools.py
│   ├── test_session/
│   ├── test_memory/
│   ├── test_security/
│   ├── test_server/
│   └── test_e2e/
├── pyproject.toml
├── package.json
├── pnpm-workspace.yaml
└── README.md
```

### B. 配置文件示例

#### B.1 pyproject.toml

```toml
[project]
name = "jojo-code"
version = "0.1.0"
description = "A coding agent powered by jojo AI"
readme = "README.md"
requires-python = ">=3.11"
dependencies = [
    "langgraph>=0.2",
    "langchain>=0.3",
    "langchain-openai>=0.2",
    "pydantic>=2",
    "pydantic-settings>=2",
    "tiktoken>=0.5",
    "python-dotenv>=1",
    "duckduckgo-search>=0.8.0",
]

[project.optional-dependencies]
dev = [
    "pytest>=8",
    "pytest-asyncio>=0.23",
    "mypy>=1",
    "ruff>=0.4",
]

[tool.ruff]
line-length = 100
target-version = "py311"

[tool.mypy]
python_version = "3.11"
strict = true

[tool.pytest.ini_options]
asyncio_mode = "auto"
testpaths = ["tests"]
pythonpath = ["src"]
```

#### B.2 packages/cli/package.json

```json
{
  "name": "@jojo-code/cli",
  "version": "0.1.0",
  "type": "module",
  "main": "dist/index.js",
  "bin": {
    "jojo-code": "./dist/index.js"
  },
  "scripts": {
    "dev": "tsx watch src/index.tsx",
    "build": "tsc",
    "test": "vitest",
    "lint": "eslint src --ext .ts,.tsx",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "chalk": "^5.3.0",
    "ink": "^4.4.1",
    "react": "^18.2.0",
    "react-markdown": "^9.0.1"
  },
  "devDependencies": {
    "@types/node": "^20.11.0",
    "@types/react": "^18.2.0",
    "typescript": "^5.3.0",
    "vitest": "^1.2.0"
  }
}
```

#### B.3 TypeScript tsconfig.json

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "lib": ["ES2022"],
    "jsx": "react-jsx",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "outDir": "dist",
    "rootDir": "src",
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true,
    "resolveJsonModule": true
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist", "tests"]
}
```

### C. 测试代码

#### C.1 TypeScript 单元测试

```typescript
// packages/cli/tests/jsonrpc.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { JsonRpcClient } from '../src/client/jsonrpc.js';
import type { JsonRpcResponse } from '../src/client/types.js';

vi.mock('child_process', () => ({
  spawn: vi.fn(() => ({
    stdin: { 
      write: vi.fn(),
      end: vi.fn(),
    },
    stdout: { 
      on: vi.fn((event, callback) => {
        if (event === 'data') {
          const response: JsonRpcResponse = {
            jsonrpc: '2.0',
            result: { content: 'Test response' },
            id: 1,
          };
          setTimeout(() => callback(JSON.stringify(response) + '\n'), 10);
        }
      }),
    },
    stderr: { on: vi.fn() },
    on: vi.fn((event, callback) => {
      if (event === 'close') {
        setTimeout(() => callback(0), 100);
      }
    }),
    kill: vi.fn(),
  })),
}));

vi.mock('fs', () => ({
  existsSync: vi.fn(() => false),
}));

describe('JsonRpcClient', () => {
  let client: JsonRpcClient;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('can be instantiated', () => {
    client = new JsonRpcClient();
    expect(client).toBeDefined();
    client.close();
  });

  it('generates unique request ids', async () => {
    client = new JsonRpcClient();
    client.close();
  });
});
```

#### C.2 Python 集成测试

```python
# tests/test_server/test_jsonrpc_server.py
import pytest
from jojo_code.server.jsonrpc import JsonRpcServer, JsonRpcRequest


def test_parse_request():
    """测试请求解析"""
    server = JsonRpcServer()
    line = '{"jsonrpc": "2.0", "id": 1, "method": "test", "params": {"a": 1}}'
    
    request = server._parse_request(line)
    
    assert request is not None
    assert request.jsonrpc == "2.0"
    assert request.id == 1
    assert request.method == "test"
    assert request.params == {"a": 1}


def test_parse_invalid_json():
    """测试无效 JSON"""
    server = JsonRpcServer()
    line = "not valid json"
    
    request = server._parse_request(line)
    
    assert request is None


def test_handle_not_found():
    """测试方法未找到"""
    server = JsonRpcServer()
    request = JsonRpcRequest(jsonrpc="2.0", id=1, method="nonexistent")
    
    response = server._handle_request(request)
    
    assert response.error is not None
    assert response.error["code"] == -32601
    assert "Method not found" in response.error["message"]


def test_handle_with_params():
    """测试带参数的处理"""
    server = JsonRpcServer()
    
    def add(a: int, b: int) -> int:
        return a + b
    
    server.register("add", add)
    
    request = JsonRpcRequest(
        jsonrpc="2.0",
        id=1,
        method="add",
        params={"a": 2, "b": 3}
    )
    
    response = server._handle_request(request)
    
    assert response.result == 5


def test_handle_exception():
    """测试异常处理"""
    server = JsonRpcServer()
    
    def raise_error() -> None:
        raise ValueError("test error")
    
    server.register("raise_error", raise_error)
    
    request = JsonRpcRequest(jsonrpc="2.0", id=1, method="raise_error")
    
    response = server._handle_request(request)
    
    assert response.error is not None
    assert response.error["code"] == -32603
    assert "test error" in response.error["message"]
```

---

## 总结

本文深入剖析了 jojo-code 项目的 TypeScript + Python 双语言架构设计，涵盖：

1. **双语言架构设计哲学**：为什么选择双语言，边界划分原则
2. **架构设计模式**：三层架构、stdio 通信、数据流设计
3. **通信协议深度实现**：完整源码展示 JSON-RPC 2.0 实现
4. **类型系统集成**：跨语言类型同步策略
5. **开发工作流**：项目结构、依赖管理、测试策略
6. **性能优化**：进程启动、通信延迟、内存管理
7. **实战经验**：坑和解决方案、最佳实践

这种双语言架构为 AI 原生应用提供了最佳实践：TypeScript 负责现代化 UI 交互，Python 负责核心 AI 能力，两者通过 JSON-RPC 协议解耦，各自发挥优势。

---

> **参考实现**：jojo-code 项目 https://github.com/afine907/jojo-code