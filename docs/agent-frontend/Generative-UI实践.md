---
sidebar_position: 3
title: Generative UI 实践
slug: generative-ui-practice
---

# Generative UI 实践

> 传统的 AI 对话界面，LLM 返回什么就渲染什么——一段文字、一个 JSON、一张图表。但你有没有想过：LLM 直接返回一个 React 组件，前端直接渲染？这就是 Generative UI。

## 从一个需求说起

去年我做一个内部工具，需求是：用户输入"帮我查一下上周的销售数据"，AI 不仅返回数据，还要决定用什么图表展示——柱状图、折线图还是表格。

最初的做法是前端写死一个 `ChartRenderer`，LLM 返回 `{ type: "bar", data: [...] }`，前端 `switch` 渲染。结果呢？每新增一种可视化方式，都要改前端代码、改后端 schema、改 prompt。三个人改，三个人互相踩。

后来发现了 Vercel AI SDK 的 `tool` 模式：LLM 直接返回要调用的 tool 名和参数，服务端执行 tool，把 React 组件的渲染逻辑交给服务端组件（RSC），前端只负责流式接收和渲染。整个链路变成：用户说一句话，AI 决定画什么图，数据查出来，组件渲染好，流式返回给前端。

这就是 Generative UI。

## 什么是 Generative UI

Generative UI 的核心思想：**LLM 不只生成文本，还生成 UI**。

传统模式：

```
用户输入 -> LLM -> 文本/JSON -> 前端解析 -> 固定组件渲染
```

Generative UI 模式：

```
用户输入 -> LLM -> Tool 调用 -> 服务端执行 -> React Server Component -> 流式返回前端
```

关键区别：

- **传统模式**：前端需要预判所有可能的输出格式，写 `if/else` 或 `switch` 来渲染
- **Generative UI**：前端只提供"画布"，LLM 决定画什么，服务端组件负责渲染

打个比方：传统模式像餐厅的固定菜单，厨师做什么你吃什么。Generative UI 像自助点餐机，你说了想吃什么，厨房（服务端）现做，做完直接送到你桌上。

## 架构模式

### 模式一：Tool-based UI Generation

最常见的方式。LLM 调用一个 tool，tool 的返回结果决定渲染什么组件。

```
+----------+     +--------+     +-----------+     +--------+     +-------+
| 前端用户  | --> | API 路由 | --> |  LLM 生成  | --> | Tool 执行| --> | RSC 组件|
+----------+     +--------+     +-----------+     +--------+     +-------+
     ^                                                             |
     |              <-- SSE 流式返回 React 组件序列化数据 --         |
     +-------------------------------------------------------------+
```

流程：

1. 用户发送消息
2. API 路由将消息转发给 LLM
3. LLM 决定调用某个 tool（如 `renderChart`、`showTable`）
4. 服务端执行 tool，获取数据
5. 服务端渲染对应的 React Server Component
6. 组件序列化后通过 SSE 流式返回前端
7. 前端接收并渲染

### 模式二：Streaming Component Generation

LLM 直接生成组件的 JSX 结构（安全子集），前端解析后渲染。适合轻量场景。

```
+--------+     +--------+     +-----------+     +---------+
|  前端   | --> | API 路由 | --> |  LLM 生成  | --> | JSX 解析 |
+--------+     +--------+     |  JSX 字符串 |     | 安全渲染 |
                               +-----------+     +---------+
```

这种模式更灵活，但安全风险更高，需要严格过滤。

### 模式三：Hybrid（混合模式）

结合 tool 和流式生成。LLM 先决定用哪个组件模板，再通过 tool 获取数据填充。这是生产环境最推荐的方式。

## Vercel AI SDK 集成

Vercel AI SDK 是目前实现 Generative UI 最成熟的工具链。它提供了：

- `useChat` / `useCompletion`：前端 hook，处理流式消息
- `streamUI`：服务端函数，流式渲染 React 组件
- `tool`：定义可调用的工具，LLM 自动选择

### 安装

```bash
npm install ai @ai-sdk/openai @ai-sdk/react
```

### 后端：API 路由（Next.js App Router）

```typescript
// app/api/chat/route.ts
import { openai } from '@ai-sdk/openai';
import { streamText, tool } from 'ai';
import { z } from 'zod';

export async function POST(req: Request) {
  const { messages } = await req.json();

  const result = streamText({
    model: openai('gpt-4o'),
    messages,
    tools: {
      renderChart: tool({
        description: '根据数据渲染一个图表',
        parameters: z.object({
          chartType: z.enum(['bar', 'line', 'pie']),
          title: z.string(),
          data: z.array(z.object({
            label: z.string(),
            value: z.number(),
          })),
        }),
        execute: async ({ chartType, title, data }) => {
          // 返回数据，前端根据 chartType 渲染对应组件
          return { chartType, title, data };
        },
      }),
      showTable: tool({
        description: '以表格形式展示数据',
        parameters: z.object({
          columns: z.array(z.string()),
          rows: z.array(z.array(z.string())),
        }),
        execute: async ({ columns, rows }) => {
          return { columns, rows };
        },
      }),
    },
    maxSteps: 3,
  });

  return result.toDataStreamResponse();
}
```

### 前端：useChat 消费流式响应

```typescript
// app/chat/page.tsx
'use client';

import { useChat } from '@ai-sdk/react';

export default function ChatPage() {
  const { messages, input, handleInputChange, handleSubmit } = useChat({
    api: '/api/chat',
  });

  return (
    <div>
      {messages.map((message) => (
        <div key={message.id}>
          {message.role === 'user' ? (
            <p>{message.content}</p>
          ) : (
            // 渲染 LLM 的回复，包含 tool 调用结果
            <MessageContent content={message} />
          )}
        </div>
      ))}

      <form onSubmit={handleSubmit}>
        <input value={input} onChange={handleInputChange} />
        <button type="submit">发送</button>
      </form>
    </div>
  );
}
```

### 渲染 Tool 调用结果

```typescript
// components/MessageContent.tsx
'use client';

import { BarChart } from './charts/BarChart';
import { LineChart } from './charts/LineChart';
import { PieChart } from './charts/PieChart';
import { DataTable } from './charts/DataTable';
import type { Message } from 'ai';

function MessageContent({ content }: { content: Message }) {
  // 遍历消息的 parts，找到 tool-invocation 类型的部分
  return (
    <div>
      {content.parts?.map((part, i) => {
        switch (part.type) {
          case 'text':
            return <p key={i}>{part.text}</p>;

          case 'tool-invocation':
            return renderToolResult(part.toolInvocation, i);

          default:
            return null;
        }
      })}
    </div>
  );
}

function renderToolResult(
  invocation: {
    toolName: string;
    state: string;
    result?: any;
  },
  index: number
) {
  // tool 还在执行中，显示 loading
  if (invocation.state !== 'result') {
    return <div key={index}>正在生成...</div>;
  }

  const { toolName, result } = invocation;

  switch (toolName) {
    case 'renderChart':
      switch (result.chartType) {
        case 'bar':
          return <BarChart key={index} data={result.data} title={result.title} />;
        case 'line':
          return <LineChart key={index} data={result.data} title={result.title} />;
        case 'pie':
          return <PieChart key={index} data={result.data} title={result.title} />;
        default:
          return null;
      }

    case 'showTable':
      return (
        <DataTable
          key={index}
          columns={result.columns}
          rows={result.rows}
        />
      );

    default:
      return null;
  }
}
```

## useChat 与 useCompletion 的区别

这两个 hook 看起来像，但用法差异很大：

```typescript
// useChat：用于多轮对话，维护消息历史
const { messages, input, handleInputChange, handleSubmit } = useChat({
  api: '/api/chat',
  // 每次发送都会带上完整的消息历史
});

// useCompletion：用于单次补全，不维护历史
const { completion, input, handleInputChange, handleSubmit } = useCompletion({
  api: '/api/completion',
  // 只返回当前补全的结果
});
```

**选择建议**：

- 需要多轮对话、需要展示 tool 调用历史 -> 用 `useChat`
- 单次生成、代码补全、文本补全 -> 用 `useCompletion`
- Generative UI 场景 -> 几乎一定是 `useChat`，因为需要 tool invocation 的结构化数据

## React Server Components 与流式 UI

这是 Generative UI 最强大的部分：服务端组件（RSC）可以直接在服务端渲染，然后流式返回给前端。

### 传统 SSR vs 流式 SSR

```
传统 SSR：
  服务端渲染完整 HTML -> 发送给前端 -> 前端展示
  用户等待时间 = 服务端处理时间（可能 5-10 秒）

流式 SSR：
  服务端开始渲染 -> 先发送 header 部分 -> 边渲染边发送 -> 前端逐步展示
  用户等待时间 = 第一个字节的时间（通常 0.3-0.5 秒）
```

### 用 streamUI 实现流式组件渲染

```typescript
// app/api/chat/route.ts
import { streamUI } from 'ai';
import { openai } from '@ai-sdk/openai';
import { z } from 'zod';

export async function POST(req: Request) {
  const { messages } = await req.json();

  const result = await streamUI({
    model: openai('gpt-4o'),
    messages,
    text: ({ content, done }) => {
      // 流式文本渲染
      if (done) {
        return <MarkdownRenderer>{content}</MarkdownRenderer>;
      }
      return <TypewriterText text={content} />;
    },
    tools: {
      renderChart: {
        description: '渲染图表',
        parameters: z.object({
          chartType: z.enum(['bar', 'line', 'pie']),
          title: z.string(),
          data: z.array(z.object({
            label: z.string(),
            value: z.number(),
          })),
        }),
        generate: async function* ({ chartType, title, data }) {
          // 生成器函数，可以多次 yield 实现渐进式渲染
          yield <ChartLoading />;

          // 模拟数据处理
          const processedData = data.map(d => ({
            ...d,
            value: d.value * 1.1, // 举例：加个系数
          }));

          // 最终返回完整组件
          switch (chartType) {
            case 'bar':
              return <BarChart data={processedData} title={title} />;
            case 'line':
              return <LineChart data={processedData} title={title} />;
            case 'pie':
              return <PieChart data={processedData} title={title} />;
          }
        },
      },
    },
  });

  return result.toDataStreamResponse();
}
```

`generate` 函数用 `async generator` 的好处是可以 yield 多次，先显示 loading 状态，再显示最终结果。用户体验从"等半天突然出现"变成"逐步看到内容"。

## 实战：一个完整的 Dashboard 场景

用户说"展示上周各部门的销售额，用柱状图"，系统自动选择渲染柱状图组件。

### 定义 Tool

```typescript
// lib/tools.ts
import { tool } from 'ai';
import { z } from 'zod';

// 模拟数据库查询
async function querySalesData(department: string, week: string) {
  // 实际项目中这里查数据库
  return [
    { day: '周一', amount: 12000 },
    { day: '周二', amount: 15000 },
    { day: '周三', amount: 18000 },
    { day: '周四', amount: 13000 },
    { day: '周五', amount: 20000 },
  ];
}

export const salesChartTool = tool({
  description: '查询销售数据并渲染柱状图',
  parameters: z.object({
    department: z.string().describe('部门名称'),
    week: z.string().describe('周次，如 2024-W01'),
  }),
  execute: async ({ department, week }) => {
    const data = await querySalesData(department, week);
    return {
      chartType: 'bar' as const,
      title: `${department} - ${week} 每日销售额`,
      data: data.map(d => ({ label: d.day, value: d.amount })),
    };
  },
});
```

### 前端渲染组件

```typescript
// components/charts/BarChart.tsx
'use client';

import {
  BarChart as RechartsBar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from 'recharts';

interface BarChartProps {
  data: Array<{ label: string; value: number }>;
  title: string;
}

export function BarChart({ data, title }: BarChartProps) {
  return (
    <div className="chart-container">
      <h3>{title}</h3>
      <ResponsiveContainer width="100%" height={300}>
        <RechartsBar data={data}>
          <CartesianGrid strokeDasharray="3 3" />
          <XAxis dataKey="label" />
          <YAxis />
          <Tooltip />
        </RechartsBar>
      </ResponsiveContainer>
    </div>
  );
}
```

整个链路：

```
用户: "展示上周销售部的销售数据，用柱状图"
  |
  v
LLM 分析意图 -> 选择 renderChart tool
  |
  v
Tool execute: 查询数据 -> 返回 { chartType: 'bar', data: [...] }
  |
  v
前端: toolInvocation.state === 'result' -> 渲染 <BarChart />
  |
  v
用户看到柱状图，不是一堆 JSON
```

## 安全考量

这是最容易被忽略，也最容易出问题的部分。

### 1. XSS 防护

当 LLM 输出被渲染为 UI 组件时，恶意内容注入的风险比纯文本高得多。

```typescript
// 危险：直接渲染 LLM 输出的 HTML
function DangerousRenderer({ content }: { content: string }) {
  // 绝对不要这样做！
  return <div dangerouslySetInnerHTML={{ __html: content }} />;
}

// 安全：使用白名单过滤
import DOMPurify from 'dompurify';

function SafeRenderer({ content }: { content: string }) {
  const clean = DOMPurify.sanitize(content, {
    ALLOWED_TAGS: ['p', 'strong', 'em', 'code', 'pre'],
    ALLOWED_ATTR: [],
  });
  return <div dangerouslySetInnerHTML={{ __html: clean }} />;
}
```

### 2. Tool 参数校验

LLM 返回的 tool 参数必须经过严格校验，不能直接信任。

```typescript
// 使用 Zod 做运行时校验
import { z } from 'zod';

const safeParams = z.object({
  chartType: z.enum(['bar', 'line', 'pie']), // 只允许这三个值
  title: z.string().max(100),                 // 限制长度
  data: z.array(z.object({
    label: z.string().max(50),
    value: z.number().min(0).max(1_000_000),  // 限制范围
  })).max(100),                                // 最多 100 条数据
});

// 在 tool 的 execute 中校验
execute: async (params) => {
  const validated = safeParams.parse(params); // 不合法会抛异常
  // validated 是类型安全的
  return validated;
}
```

### 3. 组件渲染沙箱

不要让 LLM 的输出直接控制组件的 props 而不做任何限制。

```typescript
// 危险：LLM 输出直接作为组件名
const componentMap = {
  BarChart,
  LineChart,
  DataTable,
};

// 安全：只允许白名单中的组件
const ALLOWED_COMPONENTS = new Set(['BarChart', 'LineChart', 'DataTable']);

function renderComponent(name: string, props: any) {
  if (!ALLOWED_COMPONENTS.has(name)) {
    return <FallbackComponent />;
  }
  const Component = componentMap[name];
  return <Component {...props} />;
}
```

### 4. 速率限制与成本控制

Generative UI 每次 tool 调用都可能触发服务端渲染和数据查询，成本比纯文本高很多。

```typescript
// API 路由中加入速率限制
import { Ratelimit } from '@upstash/ratelimit';
import { Redis } from '@upstash/redis';

const ratelimit = new Ratelimit({
  redis: Redis.fromEnv(),
  limiter: Ratelimit.slidingWindow(10, '1 m'), // 每分钟 10 次
});

export async function POST(req: Request) {
  const ip = req.headers.get('x-forwarded-for') ?? 'anonymous';
  const { success } = await ratelimit.limit(ip);

  if (!success) {
    return new Response('请求过于频繁，请稍后再试', { status: 429 });
  }

  // ... 正常处理
}
```

## 常见坑与解决方案

### 坑一：流式渲染闪烁

问题：组件流式返回时，每收到一个 chunk 就重新渲染，导致画面闪烁。

```typescript
// 问题代码：每次 messages 更新都重新渲染整个列表
{messages.map((msg) => (
  <Message key={msg.id} content={msg} />
))}

// 解决：用 useMemo 缓存已完成的消息，只对正在流式输出的消息做增量更新
const renderedMessages = useMemo(() => {
  return messages.map((msg) => {
    if (msg.id === streamingMessageId) {
      return { ...msg, isStreaming: true };
    }
    return { ...msg, isStreaming: false };
  });
}, [messages, streamingMessageId]);
```

### 坑二：Tool 调用结果丢失

问题：LLM 调用了 tool，但前端没收到 tool invocation 的结果。

原因：API 路由没返回完整的 data stream，或者 `maxSteps` 设置太小导致多步 tool 调用被截断。

```typescript
// 解决：确保 maxSteps 足够大
const result = streamText({
  model: openai('gpt-4o'),
  messages,
  tools: { /* ... */ },
  maxSteps: 5, // 允许最多 5 步 tool 调用
});

// 前端确保 tool 处于 'result' 状态才渲染
if (part.type === 'tool-invocation' && part.toolInvocation.state === 'result') {
  // 渲染结果
}
```

### 坑三：服务端组件在客户端报错

问题：RSC 组件用了浏览器 API（如 `window`、`document`），在服务端渲染时报错。

```typescript
// 问题代码
export function ChartComponent({ data }) {
  // window 在服务端不存在
  const width = window.innerWidth;
  return <div style={{ width }}>{/* ... */}</div>;
}

// 解决：标记为客户端组件
'use client';
import { useState, useEffect } from 'react';

export function ChartComponent({ data }) {
  const [width, setWidth] = useState(800);

  useEffect(() => {
    setWidth(window.innerWidth);
  }, []);

  return <div style={{ width }}>{/* ... */}</div>;
}
```

### 坑四：流式数据解析错误

问题：SSE 流中断或格式错误，前端解析 JSON 失败。

```typescript
// 解决：加错误边界和重试机制
'use client';

import { ErrorBoundary } from 'react-error-boundary';

function ChatWithErrorBoundary() {
  return (
    <ErrorBoundary
      fallbackRender={({ error }) => (
        <div>
          <p>渲染出错: {error.message}</p>
          <button onClick={() => window.location.reload()}>
            刷新重试
          </button>
        </div>
      )}
    >
      <ChatContent />
    </ErrorBoundary>
  );
}
```

### 坑五：中文内容截断

问题：流式输出中文时，多字节字符被截断，导致乱码或渲染错误。

```typescript
// 服务端：确保 SSE 数据完整
// Vercel AI SDK 内部已处理，但如果手动实现 SSE，注意：

// 错误：按字节切分
const chunk = buffer.slice(0, 100); // 可能切断 UTF-8 字符

// 正确：按字符切分，或使用 TextDecoder
const decoder = new TextDecoder('utf-8');
const text = decoder.decode(buffer);
```

## 参考资料

- [Vercel AI SDK 官方文档](https://sdk.vercel.ai/docs) - streamUI、useChat、tool 的完整 API
- [Generative UI - Vercel AI Playground](https://sdk.vercel.ai/docs/guides/generative-ui) - 官方 Generative UI 指南
- [React Server Components 官方文档](https://react.dev/reference/rsc/server-components) - RSC 的设计原理
- [Streaming React Server Components](https://nextjs.org/docs/app/building-your-application/rendering/streaming-and-suspense) - Next.js 流式渲染实践
- [Zod 官方文档](https://zod.dev/) - 运行时参数校验
- [DOMPurify](https://github.com/cure53/DOMPurify) - HTML 消毒库
