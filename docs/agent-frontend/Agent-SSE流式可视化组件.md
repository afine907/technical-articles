---
sidebar_position: 1
title: Agent SSE 流式可视化组件
slug: agent-sse-streaming-component
---

# Agent SSE 流式可视化组件

你做了一个 AI Agent，后端返回的结果是流式的，一个字一个字蹦出来。用户看到的就是一个光标在那里闪啊闪，完全不知道 Agent 在干嘛。它在思考？在调用工具？还是卡住了？

这是我在做 jojo-code 项目时碰到的真实问题。后端的 Agent 能力做得不错，但前端的体验一团糟。于是我做了一个 React 组件库 `agent-sse-flow`，专门用来可视化 Agent 的 SSE 流式响应。

这篇文章把这个组件库的设计思路、实现细节、性能优化和踩过的坑都讲清楚。如果你正在做 Agent 前端开发，或者面试被问到 SSE 流式渲染，这篇文章应该能帮到你。

## SSE 协议基础

### SSE 是什么

SSE（Server-Sent Events）是一种服务端向客户端推送数据的协议。和 WebSocket 不一样，SSE 是单向的——服务端推，客户端收。对 Agent 场景来说，这刚好够用，因为 Agent 的输出就是服务端往客户端吐 token。

SSE 基于 HTTP，所以不需要额外的握手。浏览器原生支持 `EventSource` API，这是它最大的优势。

### SSE 数据格式

SSE 的数据格式长这样：

```
data: {"token": "你"}
data: {"token": "好"}

event: tool_call
data: {"tool": "search", "status": "running"}

event: thinking
data: {"content": "让我分析一下这个问题"}

event: done
data: {"usage": {"prompt_tokens": 120, "completion_tokens": 45}}
```

每条消息以 `data:` 开头，以空行结束。`event:` 字段是可选的，用来区分不同类型的消息。

### SSE 数据流全景

```
┌───────────────────────────────────────────────────────────────┐
│                    Agent SSE 数据流                            │
├───────────────────────────────────────────────────────────────┤
│                                                               │
│  用户输入 ──> 后端 Agent ──> SSE 流 ──> 前端解析 ──> UI 渲染  │
│                                                               │
│  ┌─────────┐    ┌──────────┐    ┌──────────┐    ┌──────────┐ │
│  │  "帮我   │    │  LLM 推理 │    │  EventSource│   │  React   │ │
│  │  查一下  │──>│  工具调用  │──>│  逐条接收 │──>│  组件渲染 │ │
│  │  天气"   │    │  结果汇总  │    │  事件解析  │    │  动画效果 │ │
│  └─────────┘    └──────────┘    └──────────┘    └──────────┘ │
│                                                               │
│  时间线 ──────────────────────────────────────────────>       │
│                                                               │
│  t0: thinking ─> t1: token*100 ─> t2: tool_call              │
│  ─> t3: tool_result ─> t4: token*50 ─> t5: done              │
│                                                               │
└───────────────────────────────────────────────────────────────┘
```

### EventSource 基础用法

浏览器原生的 EventSource API 用起来很简单：

```typescript
const eventSource = new EventSource('/api/agent/stream?query=hello');

// 监听默认的 message 事件
eventSource.onmessage = (event) => {
  const data = JSON.parse(event.data);
  console.log('收到数据:', data);
};

// 监听自定义事件
eventSource.addEventListener('thinking', (event) => {
  const data = JSON.parse(event.data);
  console.log('Agent 思考中:', data.content);
});

eventSource.addEventListener('tool_call', (event) => {
  const data = JSON.parse(event.data);
  console.log('工具调用:', data.tool, data.status);
});

eventSource.onerror = (error) => {
  console.error('SSE 连接出错:', error);
  eventSource.close();
};
```

但原生 EventSource 有个大问题：它只支持 GET 请求，不支持自定义 headers。在实际项目中，你往往需要带 token 认证、传自定义参数。所以 `agent-sse-flow` 底层用了 `fetch` + ReadableStream 来实现 SSE 解析，这样可以发 POST 请求，也能带任意 headers。

## Agent 流式架构

### Agent 输出的事件类型

一个完整的 Agent 交互过程会产生好几种事件。搞清楚这些事件是做可视化的前提。

```
┌───────────────────────────────────────────────────────────────┐
│               Agent SSE 事件类型全景                           │
├───────────────────────────────────────────────────────────────┤
│                                                               │
│  事件类型          时机                    数据内容            │
│  ─────────────────────────────────────────────────────────    │
│  thinking          Agent 开始推理          思考内容文本         │
│  token             LLM 逐 token 输出      单个 token 文本     │
│  tool_call         发起工具调用            工具名 + 参数        │
│  tool_status       工具执行状态变化        pending/running/    │
│                                          completed/failed    │
│  tool_result       工具返回结果            工具执行的输出       │
│  error             发生错误               错误类型 + 消息      │
│  done              流结束                 用量统计信息         │
│                                                               │
│  典型事件序列：                                                │
│  thinking -> thinking -> token*150 -> tool_call ->            │
│  tool_status(running) -> tool_result -> token*80 -> done     │
│                                                               │
└───────────────────────────────────────────────────────────────┘
```

### 为什么 Agent 流式比普通 Chat 流式复杂

普通 Chat 的 SSE 流很简单：就是 token 一个一个蹦出来，没有别的。但 Agent 的流式输出要复杂得多：

1. **多阶段**：Agent 会先"思考"，然后可能调用工具，调用完再继续输出。一个请求会产生多个阶段
2. **工具调用可视化**：用户需要看到 Agent 在调用什么工具、调用状态如何、结果是什么
3. **思考过程展示**：很多 Agent 框架（比如 LangChain 的 ReAct 模式）会暴露 Agent 的思考过程，这需要单独展示
4. **错误恢复**：工具调用可能失败，Agent 可能重试，这些状态变化都需要实时反映

```
┌──────────────────────────────────────────────────────────────┐
│              普通 Chat vs Agent Stream 对比                    │
├──────────────────────────────────────────────────────────────┤
│                                                              │
│  普通 Chat:                                                  │
│  token token token token token ... done                     │
│  |__________________________________________________|       │
│  线性，简单                                                   │
│                                                              │
│  Agent Stream:                                               │
│  [thinking] [token...] [tool_call] [tool_result]            │
│  [token...] [thinking] [tool_call] [tool_result]            │
│  [token...] done                                             │
│  |___|________|___________|____________|___________|         │
│  阶段1  阶段2     阶段3        阶段4       阶段5              │
│  多阶段，非线性                                                │
│                                                              │
└──────────────────────────────────────────────────────────────┘
```

## React 组件设计

### 组件架构

我把整个可视化拆成了几个层级的组件，每个组件只管自己那部分逻辑。

```
┌───────────────────────────────────────────────────────────────┐
│                  AgentSSEFlow 组件架构                         │
├───────────────────────────────────────────────────────────────┤
│                                                               │
│  ┌─────────────────────────────────────────────────────────┐ │
│  │  AgentSSEFlow（根组件）                                  │ │
│  │  - 管理 SSE 连接                                        │ │
│  │  - 解析事件流                                           │ │
│  │  - 维护全局状态                                         │ │
│  │                                                         │ │
│  │  ┌─────────────┐  ┌─────────────┐  ┌────────────────┐ │ │
│  │  │ ThinkingBox │  │ StreamingText│  │ ToolCallList   │ │ │
│  │  │             │  │             │  │                │ │ │
│  │  │ 思考过程    │  │ 流式文本    │  │ 工具调用列表   │ │ │
│  │  │ 折叠/展开   │  │ 打字机效果  │  │ 状态可视化     │ │ │
│  │  └─────────────┘  └─────────────┘  └────────────────┘ │ │
│  │                                                         │ │
│  │  ┌─────────────┐  ┌─────────────┐                      │ │
│  │  │ ToolCallCard│  │ ErrorDisplay│                      │ │
│  │  │             │  │             │                      │ │
│  │  │ 单个工具卡片│  │ 错误展示    │                      │ │
│  │  │ 进度/结果   │  │ 重试按钮    │                      │ │
│  │  └─────────────┘  └─────────────┘                      │ │
│  └─────────────────────────────────────────────────────────┘ │
│                                                               │
│  数据流向：SSE 事件 ──> useAgentStream Hook ──> 组件状态       │
│                                                               │
└───────────────────────────────────────────────────────────────┘
```

### 核心数据结构

先把 TypeScript 类型定义清楚，这是整个组件库的基础。

```typescript
// SSE 事件的基础类型
type SSEEventType = 'thinking' | 'token' | 'tool_call' |
  'tool_status' | 'tool_result' | 'error' | 'done';

// 单个 SSE 事件
interface SSEEvent {
  event: SSEEventType;
  data: Record<string, unknown>;
  id?: string;
  retry?: number;
}

// Agent 流式状态
interface AgentStreamState {
  // 思考内容
  thinking: string;
  // 流式文本（已输出的部分）
  text: string;
  // 工具调用列表
  toolCalls: ToolCall[];
  // 当前状态
  status: 'idle' | 'thinking' | 'streaming' | 'calling_tool' | 'done' | 'error';
  // 错误信息
  error: string | null;
  // token 用量
  usage: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  } | null;
}

// 工具调用
interface ToolCall {
  id: string;
  tool: string;
  arguments: Record<string, unknown>;
  status: 'pending' | 'running' | 'completed' | 'failed';
  result?: string;
  error?: string;
  startTime: number;
  endTime?: number;
}
```

### useAgentStream Hook

这是组件库的核心 Hook，负责 SSE 连接管理、事件解析和状态维护。

```typescript
import { useState, useRef, useCallback, useEffect } from 'react';

function useAgentStream(url: string, options?: {
  headers?: Record<string, string>;
  body?: Record<string, unknown>;
  onError?: (error: Error) => void;
  onDone?: (state: AgentStreamState) => void;
}) {
  const [state, setState] = useState<AgentStreamState>({
    thinking: '',
    text: '',
    toolCalls: [],
    status: 'idle',
    error: null,
    usage: null,
  });

  const abortControllerRef = useRef<AbortController | null>(null);
  const textBufferRef = useRef('');
  const rafIdRef = useRef<number>(0);

  // 用 requestAnimationFrame 做流式文本渲染
  // 不是每来一个 token 就 setState，而是攒一批一起渲染
  const flushTextBuffer = useCallback(() => {
    if (textBufferRef.current.length > 0) {
      const buffered = textBufferRef.current;
      textBufferRef.current = '';
      setState(prev => ({
        ...prev,
        text: prev.text + buffered,
      }));
    }
    rafIdRef.current = 0;
  }, []);

  const appendText = useCallback((token: string) => {
    textBufferRef.current += token;
    if (rafIdRef.current === 0) {
      rafIdRef.current = requestAnimationFrame(flushTextBuffer);
    }
  }, [flushTextBuffer]);

  // 解析 SSE 事件数据
  const parseSSELine = useCallback((line: string): SSEEvent | null => {
    if (line.startsWith('event:')) {
      // event 行暂存，等 data 行一起处理
      return null;
    }
    if (line.startsWith('data:')) {
      const rawData = line.slice(5).trim();
      try {
        const parsed = JSON.parse(rawData);
        return {
          event: parsed.event || 'token',
          data: parsed,
        };
      } catch {
        return null;
      }
    }
    return null;
  }, []);

  // 处理单个 SSE 事件
  const handleEvent = useCallback((event: SSEEvent) => {
    switch (event.event) {
      case 'thinking':
        setState(prev => ({
          ...prev,
          status: 'thinking',
          thinking: prev.thinking + (event.data.content as string || ''),
        }));
        break;

      case 'token':
        setState(prev => ({ ...prev, status: 'streaming' }));
        appendText(event.data.token as string || '');
        break;

      case 'tool_call':
        setState(prev => ({
          ...prev,
          status: 'calling_tool',
          toolCalls: [
            ...prev.toolCalls,
            {
              id: event.data.id as string,
              tool: event.data.tool as string,
              arguments: (event.data.arguments as Record<string, unknown>) || {},
              status: 'pending',
              startTime: Date.now(),
            },
          ],
        }));
        break;

      case 'tool_status':
        setState(prev => ({
          ...prev,
          toolCalls: prev.toolCalls.map(tc =>
            tc.id === event.data.id
              ? { ...tc, status: event.data.status as ToolCall['status'] }
              : tc
          ),
        }));
        break;

      case 'tool_result':
        setState(prev => ({
          ...prev,
          toolCalls: prev.toolCalls.map(tc =>
            tc.id === event.data.id
              ? {
                  ...tc,
                  status: 'completed',
                  result: event.data.result as string,
                  endTime: Date.now(),
                }
              : tc
          ),
        }));
        break;

      case 'error':
        setState(prev => ({
          ...prev,
          status: 'error',
          error: event.data.message as string,
        }));
        break;

      case 'done':
        setState(prev => ({
          ...prev,
          status: 'done',
          usage: event.data.usage as AgentStreamState['usage'],
        }));
        break;
    }
  }, [appendText]);

  // 发起 SSE 请求
  const start = useCallback(async (userQuery: string) => {
    abortControllerRef.current = new AbortController();

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...options?.headers,
        },
        body: JSON.stringify({ query: userQuery, ...options?.body }),
        signal: abortControllerRef.current.signal,
      });

      const reader = response.body!.getReader();
      const decoder = new TextDecoder();
      let sseBuffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        sseBuffer += decoder.decode(value, { stream: true });
        const lines = sseBuffer.split('\n');
        // 最后一行可能不完整，保留在 buffer 里
        sseBuffer = lines.pop() || '';

        for (const line of lines) {
          const event = parseSSELine(line.trim());
          if (event) {
            handleEvent(event);
          }
        }
      }
    } catch (err) {
      if ((err as Error).name !== 'AbortError') {
        setState(prev => ({
          ...prev,
          status: 'error',
          error: (err as Error).message,
        }));
        options?.onError?.(err as Error);
      }
    }
  }, [url, options, parseSSELine, handleEvent]);

  // 组件卸载时清理
  useEffect(() => {
    return () => {
      abortControllerRef.current?.abort();
      if (rafIdRef.current) {
        cancelAnimationFrame(rafIdRef.current);
      }
    };
  }, []);

  return { state, start, abort: () => abortControllerRef.current?.abort() };
}
```

### ThinkingBox 组件

展示 Agent 的思考过程，默认折叠，点击展开。

```typescript
import React, { useState } from 'react';

interface ThinkingBoxProps {
  content: string;
  isThinking: boolean;
}

const ThinkingBox: React.FC<ThinkingBoxProps> = ({ content, isThinking }) => {
  const [expanded, setExpanded] = useState(false);

  if (!content && !isThinking) return null;

  return (
    <div className="thinking-box">
      <button
        className="thinking-toggle"
        onClick={() => setExpanded(!expanded)}
      >
        <span className={`icon ${isThinking ? 'spinning' : ''}`}>
          {isThinking ? '...' : 'done'}
        </span>
        <span className="label">
          {isThinking ? 'Agent 正在思考...' : '思考过程'}
        </span>
        <span className="arrow">{expanded ? 'v' : '>'}</span>
      </button>

      {expanded && (
        <div className="thinking-content">
          <pre>{content}</pre>
        </div>
      )}
    </div>
  );
};
```

### StreamingText 组件

流式文本渲染，带打字机效果。这里是性能优化的重点区域。

```typescript
import React, { useEffect, useRef } from 'react';

interface StreamingTextProps {
  text: string;
  isStreaming: boolean;
  showCursor?: boolean;
}

const StreamingText: React.FC<StreamingTextProps> = ({
  text,
  isStreaming,
  showCursor = true,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);

  // 自动滚动到底部
  useEffect(() => {
    if (containerRef.current && isStreaming) {
      containerRef.current.scrollTop = containerRef.current.scrollHeight;
    }
  }, [text, isStreaming]);

  return (
    <div className="streaming-text" ref={containerRef}>
      <div className="text-content">
        {text}
        {isStreaming && showCursor && (
          <span className="cursor">|</span>
        )}
      </div>
    </div>
  );
};
```

### ToolCallList 和 ToolCallCard 组件

展示工具调用的列表和单个工具的详细状态。

```typescript
import React from 'react';

interface ToolCallCardProps {
  toolCall: ToolCall;
}

const ToolCallCard: React.FC<ToolCallCardProps> = ({ toolCall }) => {
  const duration = toolCall.endTime
    ? `${((toolCall.endTime - toolCall.startTime) / 1000).toFixed(1)}s`
    : '进行中...';

  const statusConfig = {
    pending: { color: '#f0ad4e', label: '等待中' },
    running: { color: '#5bc0de', label: '执行中' },
    completed: { color: '#5cb85c', label: '已完成' },
    failed: { color: '#d9534f', label: '失败' },
  };

  const config = statusConfig[toolCall.status];

  return (
    <div className="tool-call-card" style={{ borderLeftColor: config.color }}>
      <div className="tool-header">
        <span className="tool-name">{toolCall.tool}</span>
        <span className="tool-status" style={{ color: config.color }}>
          {config.label}
        </span>
        <span className="tool-duration">{duration}</span>
      </div>

      <div className="tool-arguments">
        <pre>{JSON.stringify(toolCall.arguments, null, 2)}</pre>
      </div>

      {toolCall.result && (
        <div className="tool-result">
          <div className="result-label">结果:</div>
          <pre>{toolCall.result}</pre>
        </div>
      )}

      {toolCall.error && (
        <div className="tool-error">
          <div className="error-label">错误:</div>
          <pre>{toolCall.error}</pre>
        </div>
      )}
    </div>
  );
};

const ToolCallList: React.FC<{ toolCalls: ToolCall[] }> = ({ toolCalls }) => {
  if (toolCalls.length === 0) return null;

  return (
    <div className="tool-call-list">
      <div className="list-header">
        工具调用 ({toolCalls.length})
      </div>
      {toolCalls.map(tc => (
        <ToolCallCard key={tc.id} toolCall={tc} />
      ))}
    </div>
  );
};
```

### 根组件 AgentSSEFlow

把所有子组件组合起来。

```typescript
import React from 'react';

interface AgentSSEFlowProps {
  url: string;
  query: string;
  headers?: Record<string, string>;
  className?: string;
}

const AgentSSEFlow: React.FC<AgentSSEFlowProps> = ({
  url,
  query,
  headers,
  className,
}) => {
  const { state, start, abort } = useAgentStream(url, { headers });

  React.useEffect(() => {
    if (query) {
      start(query);
    }
  }, [query]);

  return (
    <div className={`agent-sse-flow ${className || ''}`}>
      {/* 思考过程 */}
      <ThinkingBox
        content={state.thinking}
        isThinking={state.status === 'thinking'}
      />

      {/* 工具调用 */}
      <ToolCallList toolCalls={state.toolCalls} />

      {/* 流式文本 */}
      <StreamingText
        text={state.text}
        isStreaming={state.status === 'streaming'}
      />

      {/* 错误展示 */}
      {state.status === 'error' && (
        <div className="error-banner">
          <span>出错了: {state.error}</span>
          <button onClick={() => start(query)}>重试</button>
          <button onClick={abort}>取消</button>
        </div>
      )}

      {/* 用量统计 */}
      {state.usage && (
        <div className="usage-info">
          Token 用量: {state.usage.totalTokens}
          (输入 {state.usage.promptTokens} / 输出 {state.usage.completionTokens})
        </div>
      )}
    </div>
  );
};
```

## 性能优化

### requestAnimationFrame 批量渲染

这是整个组件库最重要的性能优化。

LLM 生成 token 的速度很快，有时候一秒钟能吐几十个 token。如果每个 token 都触发一次 `setState`，React 就会频繁 re-render，界面会卡。

解决方案是用 `requestAnimationFrame` 做批量渲染：

```
┌───────────────────────────────────────────────────────────────┐
│              requestAnimationFrame 批量渲染                    │
├───────────────────────────────────────────────────────────────┤
│                                                               │
│  没有 rAF 优化：                                              │
│  token 1 -> setState -> render                               │
│  token 2 -> setState -> render                               │
│  token 3 -> setState -> render                               │
│  ...                                                          │
│  token 100 -> setState -> render                             │
│  100 次 setState，100 次 render                               │
│                                                               │
│  有 rAF 优化：                                                │
│  token 1 -> buffer                                           │
│  token 2 -> buffer                                           │
│  token 3 -> buffer                                           │
│  ...                                                          │
│  rAF 触发 -> setState(buffer) -> 1 次 render                 │
│  token 98 -> buffer                                          │
│  token 99 -> buffer                                          │
│  rAF 触发 -> setState(buffer) -> 1 次 render                 │
│  大大减少 render 次数                                         │
│                                                               │
└───────────────────────────────────────────────────────────────┘
```

核心代码在 `useAgentStream` 的 `appendText` 函数里。关键逻辑是：新 token 来了先往 buffer 里塞，如果当前帧还没有安排 rAF，就注册一个。下一帧渲染时，把 buffer 里的所有文本一次性合并到 state 里。

### 防止不必要的 re-render

给子组件加 `React.memo`，避免父组件 state 变化时所有子组件都重新渲染。

```typescript
const StreamingText = React.memo<StreamingTextProps>(({
  text,
  isStreaming,
  showCursor = true,
}) => {
  // ... 组件逻辑
});

const ToolCallCard = React.memo<ToolCallCardProps>(({ toolCall }) => {
  // ... 组件逻辑
});
```

但注意，`ToolCallCard` 用了 `React.memo` 之后有个坑：工具调用状态变化时（比如从 `running` 变成 `completed`），因为 `toolCall` 对象引用变了，`React.memo` 会正确地触发 re-render。但如果父组件每次 render 都创建新的 `toolCalls` 数组引用，`React.memo` 就白加了。所以要在父组件用 `useMemo` 稳定数组引用。

### 自动滚动的节流

流式文本渲染时，如果内容超过容器高度，需要自动滚动到底部。但不能每次文本变化都滚动，那样太频繁了。

```typescript
useEffect(() => {
  if (containerRef.current && isStreaming) {
    // 只有当用户已经在底部时才自动滚动
    // 如果用户手动往上翻了，就不强制拉回来
    const el = containerRef.current;
    const isAtBottom =
      el.scrollHeight - el.scrollTop - el.clientHeight < 50;

    if (isAtBottom) {
      el.scrollTop = el.scrollHeight;
    }
  }
}, [text, isStreaming]);
```

这里用了一个判断：只有当用户已经在底部附近（差 50px 以内）时，才自动滚动。如果用户手动往上翻了去看之前的内容，就不强制拉回来。这是个体验细节，但很重要。

## 踩坑记录

### 坑一：SSE 缓冲区拆包问题

**问题描述**：用 `fetch` + ReadableStream 读取 SSE 流时，一次 `reader.read()` 返回的 chunk 可能包含多条消息，也可能把一条消息截断成两半。

**真实场景**：生产环境偶尔出现 JSON 解析错误，`JSON.parse` 报 `Unexpected token`。本地开发从来没遇到过，因为本地网络快，一个 chunk 刚好是一条完整消息。

**解决方案**：维护一个字符串 buffer，每次把新 chunk 拼到 buffer 后面，按换行符 split，最后一行如果不像完整消息就留在 buffer 里等下一个 chunk。

```typescript
let sseBuffer = '';

while (true) {
  const { done, value } = await reader.read();
  if (done) break;

  sseBuffer += decoder.decode(value, { stream: true });
  const lines = sseBuffer.split('\n');
  // 最后一行可能不完整，保留在 buffer 里
  sseBuffer = lines.pop() || '';

  for (const line of lines) {
    const event = parseSSELine(line.trim());
    if (event) handleEvent(event);
  }
}
```

### 坑二：组件卸载后 setState

**问题描述**：用户快速发送多个请求，前面的请求还没结束就切走了（比如切换聊天窗口），之前的 fetch 还在跑，结果回来后对已经卸载的组件调用 `setState`，控制台报 `Can't perform a React state update on an unmounted component`。

**解决方案**：用 `AbortController` 在组件卸载时 abort 掉 fetch 请求。

```typescript
useEffect(() => {
  return () => {
    abortControllerRef.current?.abort();
    if (rafIdRef.current) {
      cancelAnimationFrame(rafIdRef.current);
    }
  };
}, []);
```

同时在 catch 里判断是否是 AbortError，如果是就跳过 setState。

### 坑三：thinking 内容和 token 内容交错时的状态管理

**问题描述**：Agent 先输出 thinking，然后切到 token 输出，但 thinking 和 token 的 event 可能在同一个 chunk 里到达。如果处理逻辑是先全部处理完 thinking 再处理 token，会导致 thinking 阶段的 UI 卡住。

**解决方案**：在 chunk 级别做事件循环，每条消息立即处理，不要攒着。

```typescript
// 正确：逐条处理
for (const line of lines) {
  const event = parseSSELine(line.trim());
  if (event) handleEvent(event);  // 每条立即处理
}

// 错误：攒着一起处理
// const events = lines.map(parseSSELine).filter(Boolean);
// events.forEach(handleEvent);  // 时序可能不对
```

### 坑四：流式文本的 React reconciler 问题

**问题描述**：文本特别长的时候（比如 Agent 输出了一万多个 token），每次 setState 把完整文本塞进去，React 的 reconciler 要 diff 整个 DOM，非常慢。

**解决方案**：分段渲染。把长文本按段落或按固定长度拆分成多个 DOM 节点，利用 React 的 key 来让 reconciler 只更新变化的部分。

```typescript
const StreamingText = React.memo<StreamingTextProps>(({ text, isStreaming }) => {
  // 把文本按段落拆分，每个段落是独立的 DOM 节点
  const paragraphs = useMemo(() => {
    return text.split('\n').map((p, i) => ({
      id: i,
      content: p,
    }));
  }, [text]);

  return (
    <div className="streaming-text">
      {paragraphs.map(p => (
        <p key={p.id}>{p.content}</p>
      ))}
      {isStreaming && <span className="cursor">|</span>}
    </div>
  );
});
```

### 坑五：EventSource 和 fetch SSE 的重连行为差异

**问题描述**：原生 `EventSource` 断线后会自动重连，但用 `fetch` 实现的 SSE 不会。如果后端挂了一下再恢复，`fetch` 版本就彻底断了，用户看不到任何提示。

**解决方案**：自己实现重连逻辑，捕获 fetch 错误后等待一段时间自动重试，同时给用户展示重连状态。

```typescript
const connectWithRetry = async (retryCount = 0) => {
  const maxRetries = 3;
  try {
    await start(query);
  } catch (err) {
    if (retryCount < maxRetries) {
      const delay = Math.pow(2, retryCount) * 1000;
      setState(prev => ({
        ...prev,
        status: 'error',
        error: `连接断开，${delay / 1000}秒后重连...`,
      }));
      setTimeout(() => connectWithRetry(retryCount + 1), delay);
    }
  }
};
```

## 参考资料

- [MDN: Using server-sent events](https://developer.mozilla.org/en-US/docs/Web/API/Server-sent_events/Using_server-sent_events)
- [MDN: Fetch API - Response.body](https://developer.mozilla.org/en-US/docs/Web/API/Response/body)
- [MDN: ReadableStream](https://developer.mozilla.org/en-US/docs/Web/API/ReadableStream)
- [React Docs: Optimizing Performance](https://react.dev/learn/rendering-lists#why-does-react-need-keys)
- [requestAnimationFrame - MDN](https://developer.mozilla.org/en-US/docs/Web/API/window/requestAnimationFrame)
- [AbortController - MDN](https://developer.mozilla.org/en-US/docs/Web/API/AbortController)
- [Vercel AI SDK: Streaming](https://sdk.vercel.ai/docs/foundations/streaming)
