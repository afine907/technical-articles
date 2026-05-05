---
sidebar_position: 2
title: agent-sse-flow Agent 流式可视化
slug: agent-sse-flow
---

# agent-sse-flow Agent 流式可视化

> Agent 在"思考"的时候，用户看到的只是一个 loading 动画——不知道它在干什么、用了哪些工具、花了多少 Token。这种黑盒体验让用户很焦虑。于是我做了一个 React 组件，能把 Agent 的 SSE 流实时可视化：思考过程、工具调用、Token 消耗，一目了然。

## 一、项目定位

agent-sse-flow 是一个轻量级 React 组件，用于可视化 Agent 的 SSE（Server-Sent Events）流：

```
┌──────────────────────────────────────────────────────┐
│  agent-sse-flow                                       │
│                                                       │
│  输入：Agent 的 SSE 事件流                              │
│  输出：实时可视化的 Agent 思考过程                       │
│                                                       │
│  ┌─────────────────────────────────────────────────┐  │
│  │ 🤔 思考中...                                      │  │
│  │                                                   │  │
│  │ ├─ 🔍 搜索知识库... (2.1s, 342 tokens)          │  │
│  │ ├─ 📝 分析文档... (1.5s, 128 tokens)            │  │
│  │ ├─ 🔧 调用 get_weather("北京")... (0.8s)        │  │
│  │ └─ 💬 生成回答... (3.2s, 567 tokens)            │  │
│  │                                                   │  │
│  │ 总耗时: 7.6s | 总 Token: 1,037                   │  │
│  └─────────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────┘
```

**核心特性**：
- 零依赖（仅需 React）
- TypeScript 类型安全
- 支持自定义渲染器
- 性能优化（虚拟滚动支持大量事件）
- 开源免费，无限使用

## 二、技术架构

```
┌─────────────────────────────────────────────────┐
│                  前端（React）                     │
│                                                  │
│  ┌──────────┐    ┌──────────────┐               │
│  │ SSE      │───→│ EventParser  │               │
│  │ Client   │    │ (事件解析)    │               │
│  └──────────┘    └──────┬───────┘               │
│                         ↓                        │
│                  ┌──────────────┐               │
│                  │ StateManager │               │
│                  │ (状态管理)    │               │
│                  └──────┬───────┘               │
│                         ↓                        │
│                  ┌──────────────┐               │
│                  │ Renderer     │               │
│                  │ (可视化渲染)  │               │
│                  └──────────────┘               │
└─────────────────────────────────────────────────┘
                        ↑
                   SSE 事件流
                        ↑
┌─────────────────────────────────────────────────┐
│                  后端（Agent）                     │
│                                                  │
│  LLM 调用 → 工具执行 → 结果返回                    │
│  每个步骤都通过 SSE 推送事件                        │
└─────────────────────────────────────────────────┘
```

## 三、核心实现

### 3.1 SSE 事件类型定义

```typescript
// 事件类型
interface AgentEvent {
  type: 'thinking' | 'tool_call' | 'tool_result' | 'answer' | 'error' | 'usage';
  data: any;
  timestamp: number;
}

// 思考事件
interface ThinkingEvent extends AgentEvent {
  type: 'thinking';
  data: {
    content: string;       // 思考内容
    model?: string;        // 使用的模型
  };
}

// 工具调用事件
interface ToolCallEvent extends AgentEvent {
  type: 'tool_call';
  data: {
    toolName: string;      // 工具名称
    args: Record<string, any>;  // 工具参数
    status: 'pending' | 'running' | 'completed' | 'error';
  };
}

// Token 使用事件
interface UsageEvent extends AgentEvent {
  type: 'usage';
  data: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
    cost?: number;         // 费用（如果能计算）
  };
}
```

### 3.2 SSE 流解析

```typescript
import { useState, useEffect, useRef, useCallback } from 'react';

interface UseAgentSSEOptions {
  url: string;
  headers?: Record<string, string>;
  onEvent?: (event: AgentEvent) => void;
  onError?: (error: Error) => void;
}

function useAgentSSE({ url, headers, onEvent, onError }: UseAgentSSEOptions) {
  const [events, setEvents] = useState<AgentEvent[]>([]);
  const [isStreaming, setIsStreaming] = useState(false);
  const [currentEvent, setCurrentEvent] = useState<AgentEvent | null>(null);
  const eventSourceRef = useRef<EventSource | null>(null);

  const connect = useCallback((body?: any) => {
    setIsStreaming(true);
    setEvents([]);

    // 使用 fetch 支持 POST 请求（EventSource 只支持 GET）
    const controller = new AbortController();

    fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify(body),
      signal: controller.signal,
    }).then(async (response) => {
      const reader = response.body?.getReader();
      if (!reader) return;

      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            try {
              const event = JSON.parse(line.slice(6));
              const agentEvent: AgentEvent = {
                ...event,
                timestamp: Date.now(),
              };
              setEvents(prev => [...prev, agentEvent]);
              setCurrentEvent(agentEvent);
              onEvent?.(agentEvent);
            } catch (e) {
              // 忽略解析失败的行
            }
          }
        }
      }
    }).catch((err) => {
      if (err.name !== 'AbortError') {
        onError?.(err);
      }
    }).finally(() => {
      setIsStreaming(false);
    });

    return () => controller.abort();
  }, [url, headers, onEvent, onError]);

  return { events, isStreaming, currentEvent, connect };
}
```

### 3.3 可视化组件

```tsx
import React from 'react';

interface AgentStreamProps {
  events: AgentEvent[];
  isStreaming: boolean;
  currentEvent: AgentEvent | null;
  theme?: 'light' | 'dark';
}

export function AgentStream({ events, isStreaming, currentEvent, theme = 'light' }: AgentStreamProps) {
  const totalTokens = events
    .filter(e => e.type === 'usage')
    .reduce((sum, e) => sum + (e.data.totalTokens || 0), 0);

  return (
    <div className={`agent-stream ${theme}`}>
      {/* 状态指示器 */}
      <div className="stream-header">
        {isStreaming ? (
          <span className="status streaming">
            <span className="pulse" /> 处理中...
          </span>
        ) : (
          <span className="status completed">已完成</span>
        )}
      </div>

      {/* 事件列表 */}
      <div className="event-list">
        {events.map((event, i) => (
          <EventItem key={i} event={event} />
        ))}
      </div>

      {/* 统计信息 */}
      {totalTokens > 0 && (
        <div className="stream-stats">
          总 Token: {totalTokens.toLocaleString()}
        </div>
      )}
    </div>
  );
}

function EventItem({ event }: { event: AgentEvent }) {
  switch (event.type) {
    case 'thinking':
      return (
        <div className="event thinking">
          <span className="icon">🤔</span>
          <span className="content">{event.data.content}</span>
        </div>
      );
    case 'tool_call':
      return (
        <div className={`event tool-call ${event.data.status}`}>
          <span className="icon">🔧</span>
          <span className="tool-name">{event.data.toolName}</span>
          <span className="args">({JSON.stringify(event.data.args)})</span>
          <span className="status">{event.data.status}</span>
        </div>
      );
    case 'answer':
      return (
        <div className="event answer">
          <span className="icon">💬</span>
          <span className="content">{event.data.content}</span>
        </div>
      );
    case 'error':
      return (
        <div className="event error">
          <span className="icon">❌</span>
          <span className="content">{event.data.message}</span>
        </div>
      );
    default:
      return null;
  }
}
```

## 四、使用示例

```tsx
import { AgentStream, useAgentSSE } from 'agent-sse-flow';

function AgentChat() {
  const { events, isStreaming, currentEvent, connect } = useAgentSSE({
    url: '/api/agent/chat',
    onEvent: (event) => console.log('Event:', event),
  });

  return (
    <div>
      <button onClick={() => connect({ message: "北京今天天气怎么样？" })}>
        发送
      </button>
      <AgentStream
        events={events}
        isStreaming={isStreaming}
        currentEvent={currentEvent}
        theme="dark"
      />
    </div>
  );
}
```

## 五、踩坑记录

### 坑 1：EventSource 只支持 GET

**问题**：浏览器原生 EventSource 只支持 GET 请求，但 Agent API 通常需要 POST（携带消息体）。

**解决**：用 fetch API + ReadableStream 替代 EventSource，支持 POST 请求和自定义 Headers。

### 坑 2：大量事件导致性能问题

**问题**：Agent 运行 10 分钟，产生了 500+ 事件，React 重新渲染导致页面卡顿。

**解决**：
1. 用 `useMemo` 缓存事件列表的渲染结果
2. 限制可见事件数量（只显示最近 100 条）
3. 用虚拟列表（react-window）渲染大量事件

### 坑 3：SSE 连接意外断开

**问题**：网络不稳定时 SSE 连接断开，但组件不知道，还在等待事件。

**解决**：实现心跳检测 + 自动重连：
```typescript
// 每 30 秒发送心跳
const heartbeat = setInterval(() => {
  if (isStreaming) {
    // 发送心跳包
  }
}, 30000);

// 断开后自动重连（最多 3 次）
```

### 坑 4：不同 Agent 框架的 SSE 格式不同

**问题**：LangChain、LlamaIndex、自研框架的 SSE 事件格式都不一样。

**解决**：设计统一的事件解析接口，每个框架实现一个 Parser：
```typescript
interface EventParser {
  parse(rawEvent: any): AgentEvent | null;
}
```

## 七、参考资料

- SSE 规范：https://html.spec.whatwg.org/multipage/server-sent-events.html
- React 官方文档：https://react.dev/
- Vercel AI SDK：https://sdk.vercel.ai/
