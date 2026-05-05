---
sidebar_position: 2
title: Agent 对话 UI 设计与实现
slug: agent-chat-ui-design
---

# Agent 对话 UI 设计与实现

Agent 对话 UI 不是普通的聊天界面——消息长度不可控、流式输出需要逐字渲染、中间有工具调用状态、还要支持 Markdown 和代码高亮。再加上移动端适配，边界情况远比想象的多。

## 一、整体架构：Chat UI 不只是聊天窗口

很多前端同学（包括最初的我）会觉得 Agent 对话 UI 就是一个聊天组件。但实际做下来你会发现，它比普通的即时通讯要复杂不少。普通聊天的回复是即时的、完整的，而 Agent 的回复是流式的、可能包含工具调用中间态、还可能带思考过程。

先把整体架构画出来：

```
┌─────────────────────────────────────────────────────────────┐
│                     ChatPage (页面容器)                      │
│                                                             │
│  ┌───────────────────────────────────────────────────────┐  │
│  │                  MessageList (消息列表)                │  │
│  │                                                       │  │
│  │  ┌─────────────────────────────────────────────────┐  │  │
│  │  │  MessageBubble (用户消息)                        │  │  │
│  │  │  内容: 纯文本                                    │  │  │
│  │  └─────────────────────────────────────────────────┘  │  │
│  │                                                       │  │
│  │  ┌─────────────────────────────────────────────────┐  │  │
│  │  │  AgentMessage (Agent 消息)                       │  │  │
│  │  │  ┌───────────────────────────────────────────┐  │  │  │
│  │  │  │  ThinkingBlock (思考过程, 可折叠)          │  │  │  │
│  │  │  └───────────────────────────────────────────┘  │  │  │
│  │  │  ┌───────────────────────────────────────────┐  │  │  │
│  │  │  │  ToolCallBlock (工具调用, 可折叠)          │  │  │  │
│  │  │  └───────────────────────────────────────────┘  │  │  │
│  │  │  ┌───────────────────────────────────────────┐  │  │  │
│  │  │  │  MarkdownRenderer (正文内容)               │  │  │  │
│  │  │  │  • 普通文本                                 │  │  │  │
│  │  │  │  • 代码块 (语法高亮 + 复制按钮)             │  │  │  │
│  │  │  │  • 表格、列表、链接                          │  │  │  │
│  │  │  └───────────────────────────────────────────┘  │  │  │
│  │  │  ┌───────────────────────────────────────────┐  │  │  │
│  │  │  │  StreamingCursor (流式打字光标)            │  │  │  │
│  │  │  └───────────────────────────────────────────┘  │  │  │
│  │  └─────────────────────────────────────────────────┘  │  │
│  │                                                       │  │
│  │  ┌─────────────────────────────────────────────────┐  │  │
│  │  │  LoadingIndicator (Agent 思考中/调用工具中)      │  │  │
│  │  └─────────────────────────────────────────────────┘  │  │
│  └───────────────────────────────────────────────────────┘  │
│                                                             │
│  ┌───────────────────────────────────────────────────────┐  │
│  │                  InputArea (输入区域)                  │  │
│  │  ┌─────────────┐  ┌──────────┐  ┌──────────────┐    │  │
│  │  │  文本输入框   │  │ 发送按钮  │  │  附件/工具按钮 │    │  │
│  │  │  (auto-resize)│  │          │  │              │    │  │
│  │  └─────────────┘  └──────────┘  └──────────────┘    │  │
│  └───────────────────────────────────────────────────────┘  │
│                                                             │
│  ┌───────────────────────────────────────────────────────┐  │
│  │                StateManager (状态管理层)                │  │
│  │  • messages[] - 消息列表                               │  │
│  │  • streaming - 流式输出状态                            │  │
│  │  • conversationId - 会话 ID                           │  │
│  └───────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
```

核心要解决的问题可以归纳为三类：

1. **消息状态管理** -- 消息的增删改查、流式追加、历史加载
2. **内容渲染** -- Markdown 解析、代码高亮、流式文本闪烁控制
3. **交互体验** -- 自动滚动、输入框自适应高度、移动端适配

下面逐一展开。

## 二、数据模型设计

先把消息的数据结构定义清楚，后面所有组件都围绕这个结构工作。

```typescript
// 消息角色
type MessageRole = 'user' | 'assistant' | 'system' | 'tool';

// 消息状态
type MessageStatus = 'pending' | 'streaming' | 'completed' | 'error';

// 工具调用信息
interface ToolCall {
  id: string;
  name: string;
  arguments: string;       // JSON 字符串
  result?: string;
}

// 单条消息
interface ChatMessage {
  id: string;
  role: MessageRole;
  content: string;         // 主要文本内容
  thinkingContent?: string; // Agent 的思考过程 (Claude thinking / OpenAI o1)
  toolCalls?: ToolCall[];   // 工具调用列表
  status: MessageStatus;
  timestamp: number;
  error?: string;          // 错误信息
}

// 整个对话状态
interface ChatState {
  messages: ChatMessage[];
  conversationId: string | null;
  isStreaming: boolean;
  streamingMessageId: string | null; // 当前正在流式输出的消息 ID
}
```

为什么要把 `thinkingContent` 和 `toolCalls` 单独拎出来？因为在 UI 上它们需要不同的展示形式。思考过程通常需要折叠起来（用户不一定想看），工具调用需要显示调用的工具名和参数，而主文本内容才是最终给用户的回答。

## 三、消息列表组件

消息列表看起来简单，但细节特别多。我总结下来核心要处理好三件事：虚拟滚动、自动滚动到底部、流式追加时的性能。

```typescript
import React, { useRef, useEffect, useState, useCallback } from 'react';

interface MessageListProps {
  messages: ChatMessage[];
  streamingMessageId: string | null;
}

const MessageList: React.FC&lt;MessageListProps&gt; = ({
  messages,
  streamingMessageId,
}) => {
  const listRef = useRef&lt;HTMLDivElement&gt;(null);
  const bottomRef = useRef&lt;HTMLDivElement&gt;(null);
  const [autoScroll, setAutoScroll] = useState(true);

  // 监听用户是否手动向上滚动
  const handleScroll = useCallback(() => {
    const el = listRef.current;
    if (!el) return;
    // 距离底部 100px 以内认为是"在底部"
    const isAtBottom =
      el.scrollHeight - el.scrollTop - el.clientHeight &lt; 100;
    setAutoScroll(isAtBottom);
  }, []);

  // 新消息到来或流式更新时，自动滚到底部
  useEffect(() => {
    if (autoScroll) {
      bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages, autoScroll]);

  return (
    &lt;div
      ref={listRef}
      onScroll={handleScroll}
      className="message-list"
      role="log"
      aria-live="polite"
      aria-label="对话消息列表"
    &gt;
      {messages.map((msg) =&gt; (
        &lt;MessageItem
          key={msg.id}
          message={msg}
          isStreaming={msg.id === streamingMessageId}
        /&gt;
      ))}
      &lt;div ref={bottomRef} /&gt;
    &lt;/div&gt;
  );
};
```

这里有几个关键点值得说一下：

**自动滚动的判断逻辑**。不是说"有新消息就滚动"，而是要判断用户是不是正在看历史消息。如果用户手动往上翻了，说明他不想被打断，这时候就不要强制拉到底部。判断标准一般是"距离底部 100px 以内"。

**`aria-live="polite"`**。这是无障碍访问的要求，屏幕阅读器会在消息更新时通知视障用户。做 Agent 产品的同学很容易忽略这一点。

**`bottomRef` 占位符**。用一个空 div 放在列表底部，通过 `scrollIntoView` 来实现滚动。比直接操作 `scrollTop` 更稳定，也不用手动计算滚动距离。

## 四、消息气泡与 Agent 消息组件

用户消息和 Agent 消息的展示方式差异很大，应该拆成两个组件。

```typescript
// 用户消息 - 简单直接
const UserMessage: React.FC&lt;{ message: ChatMessage }&gt; = ({ message }) =&gt; {
  return (
    &lt;div className="message message--user"&gt;
      &lt;div className="message__avatar"&gt;我&lt;/div&gt;
      &lt;div className="message__content"&gt;
        &lt;div className="message__text"&gt;{message.content}&lt;/div&gt;
      &lt;/div&gt;
    &lt;/div&gt;
  );
};

// Agent 消息 - 复杂得多
const AgentMessage: React.FC&lt;{
  message: ChatMessage;
  isStreaming: boolean;
}&gt; = ({ message, isStreaming }) =&gt; {
  const [showThinking, setShowThinking] = useState(false);

  return (
    &lt;div className="message message--assistant"&gt;
      &lt;div className="message__avatar"&gt;AI&lt;/div&gt;
      &lt;div className="message__content"&gt;
        {/* 思考过程 - 默认折叠 */}
        {message.thinkingContent &amp;&amp; (
          &lt;ThinkingBlock
            content={message.thinkingContent}
            expanded={showThinking}
            onToggle={() =&gt; setShowThinking(!showThinking)}
          /&gt;
        )}

        {/* 工具调用 - 折叠展示 */}
        {message.toolCalls?.map((tc) =&gt; (
          &lt;ToolCallBlock key={tc.id} toolCall={tc} /&gt;
        ))}

        {/* 主要回复内容 */}
        {message.content &amp;&amp; (
          &lt;MarkdownRenderer content={message.content} /&gt;
        )}

        {/* 流式输出中的打字光标 */}
        {isStreaming &amp;&amp; &lt;StreamingCursor /&gt;}

        {/* 错误状态 */}
        {message.status === 'error' &amp;&amp; (
          &lt;div className="message__error"&gt;
            生成出错: {message.error}
            &lt;button onClick={() =&gt; retryMessage(message.id)}&gt;
              重试
            &lt;/button&gt;
          &lt;/div&gt;
        )}
      &lt;/div&gt;
    &lt;/div&gt;
  );
};
```

`ThinkingBlock` 做成可折叠的很重要。Claude 的 extended thinking 和 OpenAI 的 o1 推理过程可能非常长，一股脑全显示出来会把主要内容挤到屏幕外面去。

```typescript
const ThinkingBlock: React.FC&lt;{
  content: string;
  expanded: boolean;
  onToggle: () =&gt; void;
}&gt; = ({ content, expanded, onToggle }) =&gt; {
  return (
    &lt;div className="thinking-block"&gt;
      &lt;button
        className="thinking-block__toggle"
        onClick={onToggle}
        aria-expanded={expanded}
      &gt;
        {expanded ? '收起思考过程' : '查看思考过程'}
      &lt;/button&gt;
      {expanded &amp;&amp; (
        &lt;div className="thinking-block__content"&gt;
          &lt;MarkdownRenderer content={content} /&gt;
        &lt;/div&gt;
      )}
    &lt;/div&gt;
  );
};
```

## 五、流式文本渲染：最关键的体验细节

流式渲染是 Agent 对话 UI 和普通聊天 UI 最大的区别。用户发完消息后不是立刻看到完整回复，而是像打字一样一个字一个字蹦出来。这看起来简单，但要做好需要处理好几个问题。

### 5.1 基本的流式追加

```typescript
// 自定义 hook：管理流式消息
function useStreamingMessage() {
  const [messages, setMessages] = useState&lt;ChatMessage[]&gt;([]);
  const [streamingId, setStreamingId] = useState&lt;string | null&gt;(null);

  const startStreaming = useCallback((id: string) =&gt; {
    setStreamingId(id);
  }, []);

  const appendChunk = useCallback((id: string, chunk: string) =&gt; {
    setMessages((prev) =&gt;
      prev.map((msg) =&gt;
        msg.id === id
          ? { ...msg, content: msg.content + chunk, status: 'streaming' }
          : msg
      )
    );
  }, []);

  const finishStreaming = useCallback((id: string) =&gt; {
    setMessages((prev) =&gt;
      prev.map((msg) =&gt;
        msg.id === id
          ? { ...msg, status: 'completed' }
          : msg
      )
    );
    setStreamingId(null);
  }, []);

  return { messages, streamingId, startStreaming, appendChunk, finishStreaming };
}
```

### 5.2 流式光标组件

一个小小的闪烁光标，对用户的感知影响很大。没有它的话，用户会觉得页面卡住了，不知道 Agent 是在思考还是出了问题。

```typescript
const StreamingCursor: React.FC = () =&gt; {
  return (
    &lt;span className="streaming-cursor" aria-hidden="true"&gt;
      |
    &lt;/span&gt;
  );
};
```

对应的 CSS 动画：

```css
.streaming-cursor {
  display: inline-block;
  animation: blink 0.8s step-end infinite;
  color: #1a73e8;
  font-weight: bold;
  margin-left: 2px;
}

@keyframes blink {
  0%, 100% { opacity: 1; }
  50% { opacity: 0; }
}
```

### 5.3 SSE 连接与流式解析

实际的流式数据通常通过 SSE (Server-Sent Events) 传输。前端需要解析 SSE 数据流并逐块追加到消息中。

```typescript
async function* streamChatResponse(
  conversationId: string,
  userMessage: string
): AsyncGenerator&lt;{ type: string; content: string; toolCall?: ToolCall }&gt; {
  const response = await fetch('/api/chat/stream', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ conversationId, message: userMessage }),
  });

  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop()!; // 保留不完整的行

    for (const line of lines) {
      if (line.startsWith('data: ')) {
        const data = JSON.parse(line.slice(6));
        yield data;
      }
    }
  }
}
```

## 六、Markdown 渲染与代码高亮

Agent 的回复通常包含 Markdown 格式的内容，尤其是代码块。这里推荐用 `react-markdown` 配合 `react-syntax-highlighter`。

### 6.1 Markdown 渲染器组件

```typescript
import ReactMarkdown from 'react-markdown';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { oneDark } from 'react-syntax-highlighter/dist/esm/styles/prism';
import remarkGfm from 'remark-gfm';

interface MarkdownRendererProps {
  content: string;
}

const MarkdownRenderer: React.FC&lt;MarkdownRendererProps&gt; = ({ content }) =&gt; {
  return (
    &lt;div className="markdown-body"&gt;
      &lt;ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          code({ node, inline, className, children, ...props }) {
            const match = /language-(\w+)/.exec(className || '');
            const language = match ? match[1] : '';

            if (!inline &amp;&amp; language) {
              return (
                &lt;CodeBlock
                  language={language}
                  value={String(children).replace(/\n$/, '')}
                /&gt;
              );
            }

            return (
              &lt;code className={className} {...props}&gt;
                {children}
              &lt;/code&gt;
            );
          },
          // 表格也要加样式
          table({ children }) {
            return (
              &lt;div className="table-wrapper"&gt;
                &lt;table&gt;{children}&lt;/table&gt;
              &lt;/div&gt;
            );
          },
        }}
      &gt;
        {content}
      &lt;/ReactMarkdown&gt;
    &lt;/div&gt;
  );
};
```

### 6.2 带复制功能的代码块

```typescript
const CodeBlock: React.FC&lt;{
  language: string;
  value: string;
}&gt; = ({ language, value }) =&gt; {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () =&gt; {
    await navigator.clipboard.writeText(value);
    setCopied(true);
    setTimeout(() =&gt; setCopied(false), 2000);
  };

  return (
    &lt;div className="code-block"&gt;
      &lt;div className="code-block__header"&gt;
        &lt;span className="code-block__language"&gt;{language}&lt;/span&gt;
        &lt;button
          className="code-block__copy"
          onClick={handleCopy}
          aria-label={copied ? '已复制' : '复制代码'}
        &gt;
          {copied ? '已复制' : '复制'}
        &lt;/button&gt;
      &lt;/div&gt;
      &lt;SyntaxHighlighter
        style={oneDark}
        language={language}
        PreTag="div"
        customStyle={{
          margin: 0,
          borderTopLeftRadius: 0,
          borderTopRightRadius: 0,
        }}
      &gt;
        {value}
      &lt;/SyntaxHighlighter&gt;
    &lt;/div&gt;
  );
};
```

### 6.3 流式渲染中的 Markdown 解析陷阱

这里有一个很容易踩的坑：**流式输出过程中，Markdown 语法是不完整的**。

比如 Agent 正在输出一个代码块：

```
这是代码示例：

```python
def hello():
    print("hel
```

此时 Markdown 解析器看到的是一个未闭合的代码块标记，它会把后面的所有内容都当成代码来渲染，直到代码块标记闭合。这会导致两个问题：

1. **渲染闪烁** -- 每次 content 更新，整个 Markdown 都要重新解析，代码块反复出现和消失
2. **布局跳动** -- 文本从正常段落突然变成代码块样式，再变回来

解决方案有几种：

**方案 A：节流渲染**。不要每次 chunk 到来都重新渲染 Markdown，设置一个 100-200ms 的节流间隔。

```typescript
function useThrottledMarkdown(content: string, delay = 150): string {
  const [displayed, setDisplayed] = useState(content);
  const timerRef = useRef&lt;NodeJS.Timeout | null&gt;(null);

  useEffect(() =&gt; {
    if (timerRef.current) return;
    timerRef.current = setTimeout(() =&gt; {
      setDisplayed(content);
      timerRef.current = null;
    }, delay);
  }, [content, delay]);

  useEffect(() =&gt; {
    return () =&gt; {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  return displayed;
}
```

**方案 B：流式状态下用简单文本渲染，完成后才用 Markdown 渲染**。这个方案更稳定，用户体验的损失也很小 -- 毕竟流式输出过程中用户通常来不及细看格式。

```typescript
const AgentMessage: React.FC&lt;{ message: ChatMessage; isStreaming: boolean }&gt; =
  ({ message, isStreaming }) =&gt; {
    return (
      &lt;div&gt;
        {isStreaming ? (
          &lt;div className="plain-text"&gt;{message.content}&lt;/div&gt;
        ) : (
          &lt;MarkdownRenderer content={message.content} /&gt;
        )}
      &lt;/div&gt;
    );
  };
```

我个人推荐方案 B，简单可靠，实际使用中用户感知不到区别。

## 七、输入区域设计

输入区域看起来最简单，但移动端适配会让你头疼。

### 7.1 自适应高度的文本框

```typescript
const AutoResizeTextarea: React.FC&lt;{
  value: string;
  onChange: (value: string) =&gt; void;
  onSend: () =&gt; void;
  disabled?: boolean;
}&gt; = ({ value, onChange, onSend, disabled }) =&gt; {
  const textareaRef = useRef&lt;HTMLTextAreaElement&gt;(null);

  // 自动调整高度
  useEffect(() =&gt; {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    // 限制最大 5 行，超过就出滚动条
    el.style.height = Math.min(el.scrollHeight, 120) + 'px';
  }, [value]);

  const handleKeyDown = (e: React.KeyboardEvent) =&gt; {
    // Enter 发送，Shift+Enter 换行
    if (e.key === 'Enter' &amp;&amp; !e.shiftKey) {
      e.preventDefault();
      if (!disabled &amp;&amp; value.trim()) {
        onSend();
      }
    }
  };

  return (
    &lt;div className="input-area"&gt;
      &lt;textarea
        ref={textareaRef}
        value={value}
        onChange={(e) =&gt; onChange(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder="输入消息... (Enter 发送, Shift+Enter 换行)"
        disabled={disabled}
        rows={1}
        aria-label="消息输入框"
      /&gt;
      &lt;button
        className="input-area__send"
        onClick={onSend}
        disabled={disabled || !value.trim()}
        aria-label="发送消息"
      &gt;
        发送
      &lt;/button&gt;
    &lt;/div&gt;
  );
};
```

### 7.2 移动端适配要点

移动端的坑特别多，我列几个关键的：

**1. 软键盘弹起时的布局问题**

iOS 和 Android 处理软键盘的方式不同。iOS 会把视口缩小（`visualViewport` 变小），Android 有时会把整个页面往上顶。

```css
/* 关键：用 visualViewport 而不是 window.innerHeight */
.input-area {
  position: fixed;
  bottom: 0;
  left: 0;
  right: 0;
  /* 不要用 bottom: 0 直接定位，
     用 JS 根据 visualViewport 高度计算 */
}
```

```typescript
// 移动端键盘适配
useEffect(() =&gt; {
  if (!('visualViewport' in window)) return;

  const handleResize = () =&gt; {
    const vp = window.visualViewport!;
    const inputArea = inputRef.current;
    if (inputArea) {
      inputArea.style.bottom = `${vp.height - vp.offsetTop}px`;
    }
  };

  window.visualViewport.addEventListener('resize', handleResize);
  return () =&gt;
    window.visualViewport.removeEventListener('resize', handleResize);
}, []);
```

**2. 触摸滚动和输入框聚焦**

在 iOS 上，如果消息列表和输入框在一个 flex 布局中，用户点击输入框时页面可能会抖动。解决方法是给消息列表设置 `overflow-y: auto`，让它独立滚动。

**3. 输入框防抖动**

输入时不要触发消息列表的重新计算。把输入区域和消息列表的滚动完全隔离。

## 八、Thinking / Loading 状态

Agent 处理用户请求时可能有多种中间状态，需要给用户明确的反馈。

```typescript
const LoadingIndicator: React.FC&lt;{
  stage: 'thinking' | 'calling_tool' | 'generating';
  toolName?: string;
}&gt; = ({ stage, toolName }) =&gt; {
  const getMessage = () =&gt; {
    switch (stage) {
      case 'thinking':
        return '正在思考...';
      case 'calling_tool':
        return `正在调用 ${toolName || '工具'}...`;
      case 'generating':
        return '正在生成回复...';
    }
  };

  return (
    &lt;div className="loading-indicator" role="status"&gt;
      &lt;div className="loading-indicator__dots"&gt;
        &lt;span /&gt;&lt;span /&gt;&lt;span /&gt;
      &lt;/div&gt;
      &lt;span className="loading-indicator__text"&gt;{getMessage()}&lt;/span&gt;
    &lt;/div&gt;
  );
};
```

CSS 动画：

```css
.loading-indicator__dots span {
  display: inline-block;
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: #999;
  margin: 0 3px;
  animation: dot-bounce 1.4s infinite ease-in-out both;
}

.loading-indicator__dots span:nth-child(1) { animation-delay: -0.32s; }
.loading-indicator__dots span:nth-child(2) { animation-delay: -0.16s; }

@keyframes dot-bounce {
  0%, 80%, 100% { transform: scale(0.6); opacity: 0.4; }
  40% { transform: scale(1); opacity: 1; }
}
```

## 九、性能优化

对话界面做着做着你会发现越来越卡，尤其是对话历史很长的时候。几个关键优化点：

**1. 虚拟列表**

当消息超过 100 条时，应该用虚拟列表（如 `react-window`）只渲染可视区域内的消息。

```typescript
import { VariableSizeList } from 'react-window';

// 用 VariableSizeList 替代普通的 map 渲染
// 每条消息高度不固定，需要估算
const estimateMessageSize = (message: ChatMessage) =&gt; {
  const baseHeight = 60; // 头像 + 间距
  const textHeight = Math.ceil(message.content.length / 40) * 20;
  return baseHeight + Math.min(textHeight, 400); // 限制最大高度
};
```

**2. Markdown 组件的 memo 化**

```typescript
const MarkdownRenderer = React.memo(
  ({ content }: { content: string }) =&gt; {
    return (
      &lt;div className="markdown-body"&gt;
        &lt;ReactMarkdown remarkPlugins={[remarkGfm]}&gt;
          {content}
        &lt;/ReactMarkdown&gt;
      &lt;/div&gt;
    );
  },
  (prev, next) =&gt; prev.content === next.content
);
```

流式更新时，已完成的消息不会重新渲染，只有当前正在流式输出的那条消息会更新。

**3. 代码高亮的按需加载**

`react-syntax-highlighter` 自带的语言包非常大。如果只用到几种语言，一定要用 `react-syntax-highlighter/dist/esm/languages/prism/xxx` 按需引入。

## 十、常见坑与解决方案

### 坑 1：流式输出时消息列表疯狂跳动

**现象**：每次收到新 chunk，消息高度增加，列表自动滚动，但滚动不够及时，导致用户看到内容在"跳"。

**原因**：`scrollIntoView` 在高频率更新时会产生动画冲突。

**解决**：用 `requestAnimationFrame` 合并滚动操作，或者直接用 `scrollTop = scrollHeight` 代替 smooth scroll。

```typescript
useEffect(() =&gt; {
  if (!autoScroll) return;
  const el = listRef.current;
  if (!el) return;
  // 用同步滚动代替 smooth scroll，避免跳动
  el.scrollTop = el.scrollHeight;
}, [content]);
```

### 坑 2：长代码块导致首次渲染卡顿

**现象**：Agent 回复了一段 500 行的代码，渲染时页面卡了 2 秒。

**原因**：`react-syntax-highlighter` 对大段代码的语法分析很耗时。

**解决**：对超过一定行数的代码块做懒渲染，先只渲染前 50 行，点击"展开"后再渲染全部。

```typescript
const CodeBlock: React.FC&lt;{ language: string; value: string }&gt; = ({
  language,
  value,
}) =&gt; {
  const lines = value.split('\n');
  const shouldCollapse = lines.length &gt; 50;
  const [expanded, setExpanded] = useState(!shouldCollapse);

  const displayValue = expanded ? value : lines.slice(0, 50).join('\n');

  return (
    &lt;div className="code-block"&gt;
      {/* ... header ... */}
      &lt;SyntaxHighlighter language={language} style={oneDark}&gt;
        {displayValue}
      &lt;/SyntaxHighlighter&gt;
      {shouldCollapse &amp;&amp; !expanded &amp;&amp; (
        &lt;button onClick={() =&gt; setExpanded(true)}&gt;
          展开全部 ({lines.length} 行)
        &lt;/button&gt;
      )}
    &lt;/div&gt;
  );
};
```

### 坑 3：移动端软键盘收起后页面留白

**现象**：在手机上点击输入框弹出键盘，发送消息后键盘收起，页面底部出现一大块空白。

**原因**：iOS Safari 在键盘收起时不会自动恢复视口高度。

**解决**：监听 `visualViewport` 的 resize 事件，主动调整布局。

```typescript
useEffect(() =&gt; {
  const handleResize = () =&gt; {
    // 键盘收起时，强制滚动到顶部修复 iOS 布局问题
    if (document.activeElement?.tagName !== 'TEXTAREA') {
      window.scrollTo(0, 0);
    }
  };
  window.visualViewport?.addEventListener('resize', handleResize);
  return () =&gt;
    window.visualViewport?.removeEventListener('resize', handleResize);
}, []);
```

### 坑 4：用户快速连续发送消息导致状态混乱

**现象**：用户在 Agent 还没回复时又发了一条新消息，两条消息的流式输出交叉了。

**解决**：在流式输出期间禁用输入框，或者用队列机制保证消息顺序处理。

```typescript
const handleSend = async () =&gt; {
  if (isStreaming) return; // 流式输出中不允许发送
  // ... 发送逻辑
};
```

### 坑 5：Markdown 中的 HTML 标签被转义

**现象**：Agent 回复中包含 HTML 标签（如 `&lt;div&gt;`），被 `react-markdown` 当成纯文本显示了。

**解决**：配置 `rehype-raw` 插件，或者在 Prompt 中要求 Agent 用 HTML 实体编码。

```typescript
// 方案：安装 rehype-raw 插件
import rehypeRaw from 'rehype-raw';

&lt;ReactMarkdown rehypePlugins={[rehypeRaw]}&gt;
  {content}
&lt;/ReactMarkdown&gt;
```

## 参考资源

- [React Markdown 官方文档](https://github.com/remarkjs/react-markdown) -- Markdown 渲染的核心库
- [react-syntax-highlighter](https://github.com/react-syntax-highlighter/react-syntax-highlighter) -- 语法高亮，支持 Prism 和 Highlight.js 两套引擎
- [react-window](https://github.com/bvaughn/react-window) -- 虚拟列表，性能优化必备
- [MDN: Server-Sent Events](https://developer.mozilla.org/zh-CN/docs/Web/API/Server-sent_events) -- SSE 协议详解
- [visualViewport API](https://developer.mozilla.org/zh-CN/docs/Web/API/Visual_Viewport_API) -- 移动端键盘适配的关键 API
- [Vercel AI Chatbot](https://github.com/vercel/ai-chatbot) -- 开源的 AI 聊天界面参考实现，非常值得学习
