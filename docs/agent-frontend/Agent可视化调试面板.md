---
sidebar_position: 4
title: Agent 可视化调试面板
slug: agent-debug-panel
---

# Agent 可视化调试面板

Agent 输出了离谱的结果，日志里有 50 多条记录、8 次工具调用、3 次重试——一行行翻 log 两小时，最后发现是一个 JSON 字段名拼错了。传统日志排查在 Agent 场景下效率极低，需要可视化调试面板把决策链路、工具调用、Token 消耗全部呈现出来。

## 为什么 Agent 调试这么难？

传统的 Web 应用调试，你打开 Chrome DevTools，看 Network、看 Console，基本就能定位问题。

Agent 系统完全不一样。难点在于：

**1. 决策链路不透明**

传统应用是 `if-else` 确定性逻辑，Agent 是 LLM 动态决策。你不知道它下一步会调哪个工具、传什么参数。每次运行可能走不同路径。

**2. 多轮交互叠加**

一个 Agent 可能要经过 thought -> action -> observation -> thought -> action -> observation 这样的多轮循环。每一轮都有输入输出，链条很长。

**3. 异步和流式处理**

Agent 的响应是流式的，工具调用是异步的。传统的 "请求-响应" 模式不适用。你需要实时追踪状态变化。

**4. 成本不透明**

一次请求可能调了5个工具，每个工具都有 token 消耗。你不追踪，根本不知道钱花在哪了。

打个比方：

- 传统应用调试 = 看一条直线，起点到终点清清楚楚
- Agent 调试 = 看一棵树，每个分支都是 LLM 的决策，你不知道走了哪条

## 调试面板整体架构

先看整体设计。调试面板本质上是一个 **事件驱动的实时监控系统**：

```
+----------------------------------------------------------+
|                  Agent Debug Panel                        |
+----------------------------------------------------------+
|  +------------------+  +------------------+  +----------+ |
|  | Decision Chain   |  | Tool Call Status |  | Token    | |
|  | Visualization    |  | Tracker          |  | Monitor  | |
|  |                  |  |                  |  |          | |
|  | thought -> act   |  | pending/running  |  | usage    | |
|  | -> obs -> thought|  | /success/fail    |  | cost     | |
|  +------------------+  +------------------+  +----------+ |
|  +------------------+  +------------------+  +----------+ |
|  | Latency          |  | Log Filter &     |  | Replay   | |
|  | Waterfall        |  | Search           |  | Controls | |
|  |                  |  |                  |  |          | |
|  | [==  ==] bar     |  | keyword filter   |  | play/pause| |
|  +------------------+  +------------------+  +----------+ |
+----------------------------------------------------------+
```

核心数据流：

```
Agent Runtime
    |
    | (Event Stream via WebSocket / SSE)
    v
+------------------+
| Event Collector  |  -- 收集所有 Agent 事件
+------------------+
    |
    v
+------------------+
| Event Processor  |  -- 解析、分类、打时间戳
+------------------+
    |
    +----> State Store (Zustand / Redux)
              |
              v
        +-----------+
        | UI Render |  -- 实时更新各面板
        +-----------+
```

关键设计决策：

1. **事件驱动，不轮询** -- 用 WebSocket 或 SSE 推送事件，不用定时拉取
2. **本地状态管理** -- 用 Zustand 存调试状态，轻量且支持订阅
3. **虚拟滚动** -- Agent 事件可能有上千条，必须虚拟化
4. **时间线模型** -- 所有事件以时间为轴组织，支持回放

## 事件模型设计

一切的基础是事件定义。Agent 运行过程中会产生这些事件：

```typescript
// Agent 调试事件类型
type AgentEvent =
  | AgentStartEvent
  | ThoughtEvent
  | ToolCallStartEvent
  | ToolCallEndEvent
  | AgentEndEvent
  | ErrorEvent;

interface BaseEvent {
  id: string;
  timestamp: number;
  agentId: string;
  sessionId: string;
}

// Agent 开始运行
interface AgentStartEvent extends BaseEvent {
  type: 'agent:start';
  input: string;
  model: string;
  systemPrompt: string;
}

// LLM 思考过程（包括 reasoning / chain of thought）
interface ThoughtEvent extends BaseEvent {
  type: 'thought';
  content: string;
  tokenUsage: {
    prompt: number;
    completion: number;
    total: number;
  };
  cost: number;
}

// 工具调用开始
interface ToolCallStartEvent extends BaseEvent {
  type: 'tool:call:start';
  toolName: string;
  toolArgs: Record<string, unknown>;
  callId: string;
}

// 工具调用结束
interface ToolCallEndEvent extends BaseEvent {
  type: 'tool:call:end';
  callId: string;
  toolName: string;
  status: 'success' | 'error';
  result?: unknown;
  error?: string;
  duration: number; // 毫秒
}

// Agent 运行结束
interface AgentEndEvent extends BaseEvent {
  type: 'agent:end';
  output: string;
  totalDuration: number;
  totalTokenUsage: TokenUsage;
  totalCost: number;
}
```

每个事件都有统一的 `id`、`timestamp`、`agentId`，方便后续关联和过滤。

## 决策链路可视化

这是调试面板最核心的部分。Agent 的决策链路本质上是一个步骤列表，每一步可能是 thought、tool call 或 observation。

先看数据结构：

```typescript
interface DecisionStep {
  id: string;
  type: 'thought' | 'action' | 'observation' | 'error';
  content: string;
  timestamp: number;
  duration?: number;
  toolCall?: ToolCallInfo;
  tokenUsage?: TokenUsage;
  status: 'running' | 'completed' | 'failed';
}

interface ToolCallInfo {
  name: string;
  args: Record<string, unknown>;
  result?: unknown;
  error?: string;
}
```

然后是 React 组件。核心思路：把决策链路渲染成一个步骤列表，每一步显示类型、内容和状态：

```tsx
import React, { useMemo } from 'react';
import { useDebugStore } from '../../stores/debugStore';

// 决策步骤的颜色映射
const STEP_COLORS = {
  thought: '#6366f1',    // 靛蓝色 - 思考
  action: '#f59e0b',     // 琥珀色 - 行动
  observation: '#10b981', // 绿色 - 观察
  error: '#ef4444',      // 红色 - 错误
} as const;

const STEP_LABELS = {
  thought: '思考',
  action: '行动',
  observation: '观察',
  error: '错误',
} as const;

export function DecisionChainPanel() {
  const { events, selectedSessionId } = useDebugStore();

  // 从事件流构建决策链路
  const steps = useMemo(() => {
    const sessionEvents = events.filter(
      (e) => e.sessionId === selectedSessionId
    );
    return buildDecisionSteps(sessionEvents);
  }, [events, selectedSessionId]);

  return (
    <div className="decision-chain-panel">
      <h3>决策链路</h3>
      <div className="steps-container">
        {steps.map((step, index) => (
          <DecisionStepCard
            key={step.id}
            step={step}
            index={index}
            isLast={index === steps.length - 1}
          />
        ))}
      </div>
    </div>
  );
}

// 单个步骤卡片
function DecisionStepCard({
  step,
  index,
  isLast,
}: {
  step: DecisionStep;
  index: number;
  isLast: boolean;
}) {
  const color = STEP_COLORS[step.type];
  const label = STEP_LABELS[step.type];

  return (
    <div className="step-card">
      {/* 左侧时间线 */}
      <div className="step-timeline">
        <div
          className="step-dot"
          style={{ backgroundColor: color }}
        />
        {!isLast && <div className="step-line" />}
      </div>

      {/* 右侧内容 */}
      <div className="step-content">
        <div className="step-header">
          <span className="step-index">#{index + 1}</span>
          <span className="step-label" style={{ color }}>
            {label}
          </span>
          {step.duration && (
            <span className="step-duration">
              {formatDuration(step.duration)}
            </span>
          )}
          {step.tokenUsage && (
            <span className="step-tokens">
              {step.tokenUsage.total} tokens
            </span>
          )}
        </div>

        {/* 步骤内容（可折叠） */}
        <StepContent step={step} />

        {/* 如果是工具调用，显示工具详情 */}
        {step.toolCall && (
          <ToolCallDetail toolCall={step.toolCall} />
        )}
      </div>
    </div>
  );
}
```

对应的样式大致是这样的（关键部分）：

```css
.decision-chain-panel {
  border: 1px solid #e5e7eb;
  border-radius: 8px;
  padding: 16px;
}

.step-card {
  display: flex;
  gap: 12px;
  margin-bottom: 8px;
}

.step-timeline {
  display: flex;
  flex-direction: column;
  align-items: center;
  width: 20px;
}

.step-dot {
  width: 12px;
  height: 12px;
  border-radius: 50%;
  flex-shrink: 0;
}

.step-line {
  width: 2px;
  flex: 1;
  background-color: #e5e7eb;
  margin-top: 4px;
}

.step-content {
  flex: 1;
  padding-bottom: 16px;
}

.step-header {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 4px;
}
```

效果就是左侧一条时间线，每个节点颜色不同（思考是蓝色、行动是黄色、观察是绿色），右侧是具体内容。

## 工具调用状态追踪

Agent 的工具调用是调试的重灾区。你需要知道：调了什么工具、传了什么参数、花了多久、成功还是失败。

我做了一个工具调用面板，核心是状态机：

```
         +----------+
         | pending  |
         +----+-----+
              |
              v
         +----------+
         | running  |
         +----+-----+
              |
         +----+----+
         |         |
         v         v
   +---------+ +-------+
   | success | | error |
   +---------+ +-------+
```

实现代码：

```tsx
import React from 'react';

type ToolStatus = 'pending' | 'running' | 'success' | 'error';

const STATUS_CONFIG: Record<ToolStatus, {
  label: string;
  color: string;
  bgColor: string;
}> = {
  pending:  { label: '等待中', color: '#6b7280', bgColor: '#f3f4f6' },
  running:  { label: '执行中', color: '#3b82f6', bgColor: '#eff6ff' },
  success:  { label: '成功',   color: '#10b981', bgColor: '#ecfdf5' },
  error:    { label: '失败',   color: '#ef4444', bgColor: '#fef2f2' },
};

interface ToolCallItem {
  callId: string;
  toolName: string;
  status: ToolStatus;
  args: Record<string, unknown>;
  result?: unknown;
  error?: string;
  startTime: number;
  endTime?: number;
  duration?: number;
}

export function ToolCallTracker({
  toolCalls,
}: {
  toolCalls: ToolCallItem[];
}) {
  return (
    <div className="tool-call-tracker">
      <h3>工具调用链</h3>
      <div className="tool-list">
        {toolCalls.map((tc) => (
          <ToolCallRow key={tc.callId} toolCall={tc} />
        ))}
      </div>
    </div>
  );
}

function ToolCallRow({ toolCall }: { toolCall: ToolCallItem }) {
  const config = STATUS_CONFIG[toolCall.status];

  return (
    <div
      className="tool-call-row"
      style={{
        borderLeft: `4px solid ${config.color}`,
        backgroundColor: config.bgColor,
      }}
    >
      <div className="tool-call-header">
        <span className="tool-name">{toolCall.toolName}</span>
        <span
          className="tool-status"
          style={{ color: config.color }}
        >
          {config.label}
        </span>
        {toolCall.duration !== undefined && (
          <span className="tool-duration">
            {toolCall.duration}ms
          </span>
        )}
      </div>

      {/* 参数展示 */}
      <details className="tool-args">
        <summary>参数</summary>
        <pre>{JSON.stringify(toolCall.args, null, 2)}</pre>
      </details>

      {/* 结果展示（成功或失败） */}
      {toolCall.status === 'success' && toolCall.result && (
        <details className="tool-result success">
          <summary>结果</summary>
          <pre>{JSON.stringify(toolCall.result, null, 2)}</pre>
        </details>
      )}

      {toolCall.status === 'error' && toolCall.error && (
        <div className="tool-error">
          {toolCall.error}
        </div>
      )}
    </div>
  );
}
```

一个关键细节：**参数和结果默认折叠**。工具调用的参数可能很大（比如一大段 JSON），全部展开会让页面卡顿。用 `<details>` 标签做懒加载展开，简单高效。

## Token 消耗展示

Agent 的 token 消耗是成本控制的关键。你需要按步骤拆分 token 用量，看清楚钱花在哪了。

```typescript
// Token 使用统计
interface TokenBreakdown {
  stepId: string;
  stepType: string;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  estimatedCost: number; // 美元
  model: string;
}

// 汇总统计
interface TokenSummary {
  totalPromptTokens: number;
  totalCompletionTokens: number;
  totalTokens: number;
  totalCost: number;
  steps: TokenBreakdown[];
  byModel: Record<string, {
    tokens: number;
    cost: number;
    callCount: number;
  }>;
}
```

前端展示用一个简洁的仪表盘：

```tsx
export function TokenDashboard({ summary }: { summary: TokenSummary }) {
  const costFormatted = summary.totalCost.toFixed(4);

  return (
    <div className="token-dashboard">
      <h3>Token 消耗</h3>

      {/* 总览卡片 */}
      <div className="token-overview">
        <MetricCard
          label="总 Token"
          value={summary.totalTokens.toLocaleString()}
          icon="tokens"
        />
        <MetricCard
          label="Prompt"
          value={summary.totalPromptTokens.toLocaleString()}
          subtitle={`${(
            (summary.totalPromptTokens / summary.totalTokens) * 100
          ).toFixed(1)}%`}
        />
        <MetricCard
          label="Completion"
          value={summary.totalCompletionTokens.toLocaleString()}
          subtitle={`${(
            (summary.totalCompletionTokens / summary.totalTokens) * 100
          ).toFixed(1)}%`}
        />
        <MetricCard
          label="预估费用"
          value={`$${costFormatted}`}
          highlight={summary.totalCost > 0.1}
        />
      </div>

      {/* 按模型分组 */}
      <div className="token-by-model">
        <h4>按模型分布</h4>
        {Object.entries(summary.byModel).map(([model, stats]) => (
          <div key={model} className="model-stat-row">
            <span className="model-name">{model}</span>
            <span className="model-tokens">
              {stats.tokens.toLocaleString()} tokens
            </span>
            <span className="model-cost">
              ${stats.cost.toFixed(4)}
            </span>
            <span className="model-count">
              {stats.callCount} 次调用
            </span>
          </div>
        ))}
      </div>

      {/* 按步骤的 Token 消耗柱状图 */}
      <div className="token-per-step">
        <h4>每步骤消耗</h4>
        {summary.steps.map((step) => (
          <div key={step.stepId} className="step-token-bar">
            <span className="step-label">{step.stepType}</span>
            <div className="bar-container">
              <div
                className="bar-fill"
                style={{
                  width: `${(step.totalTokens / summary.totalTokens) * 100}%`,
                }}
              />
            </div>
            <span className="step-tokens">
              {step.totalTokens.toLocaleString()}
            </span>
            <span className="step-cost">
              ${step.estimatedCost.toFixed(4)}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
```

一个小技巧：当单次费用超过 $0.1 时，用红色高亮提醒。这在调试阶段很容易忽略，一不小心就烧钱了。

## 延迟分析（瀑布图）

Agent 的延迟分析和浏览器性能分析类似，用瀑布图展示每一步花了多长时间。这对定位性能瓶颈非常有用。

```
步骤                  耗时
#1 thought           [====] 800ms
#2 tool: search_db   [========] 1500ms
#3 thought           [===] 600ms
#4 tool: api_call     [============] 2200ms
#5 thought           [====] 750ms
#6 tool: format       [=] 200ms
                     0ms          2500ms
```

核心组件：

```tsx
export function LatencyWaterfall({
  steps,
}: {
  steps: LatencyStep[];
}) {
  // 计算总时间和各步骤占比
  const totalDuration = steps.reduce(
    (sum, s) => sum + s.duration,
    0
  );

  // 找出最慢的步骤
  const slowestStep = steps.reduce(
    (max, s) => (s.duration > max.duration ? s : max),
    steps[0]
  );

  return (
    <div className="latency-waterfall">
      <h3>延迟分析</h3>
      <div className="waterfall-summary">
        <span>总耗时: {formatDuration(totalDuration)}</span>
        <span className="slowest">
          最慢: {slowestStep.label} ({formatDuration(slowestStep.duration)})
        </span>
      </div>

      <div className="waterfall-chart">
        {steps.map((step) => {
          const widthPercent = (step.duration / totalDuration) * 100;
          const isSlowest = step.id === slowestStep.id;

          return (
            <div key={step.id} className="waterfall-row">
              <div className="waterfall-label">
                <span className="step-name">{step.label}</span>
                <span className="step-type">({step.type})</span>
              </div>
              <div className="waterfall-bar-container">
                <div
                  className="waterfall-bar"
                  style={{
                    width: `${widthPercent}%`,
                    backgroundColor: isSlowest
                      ? '#ef4444'
                      : getBarColor(step.type),
                    marginLeft: `${(step.startTime / totalDuration) * 100}%`,
                  }}
                />
              </div>
              <div className="waterfall-duration">
                {formatDuration(step.duration)}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function getBarColor(type: string): string {
  switch (type) {
    case 'thought':    return '#6366f1';
    case 'tool_call':  return '#f59e0b';
    case 'observation': return '#10b981';
    default:           return '#6b7280';
  }
}
```

关键点：

- 最慢的步骤用红色标记，一眼就能看到瓶颈
- 每个 bar 的水平偏移表示它在时间轴上的位置（因为工具调用是异步的，可能有重叠）
- `totalDuration` 是 wall clock time，不是各步骤之和（因为有并行）

## 实时日志过滤

Agent 事件量很大，你需要强大的过滤能力才能快速定位问题。

```tsx
import React, { useState, useMemo } from 'react';
import { useDebugStore } from '../../stores/debugStore';

interface LogFilter {
  keyword: string;
  eventTypes: string[];
  agentId: string | null;
  timeRange: [number, number] | null;
  level: 'all' | 'info' | 'warn' | 'error';
}

export function LogFilterPanel() {
  const { events } = useDebugStore();
  const [filter, setFilter] = useState<LogFilter>({
    keyword: '',
    eventTypes: [],
    agentId: null,
    timeRange: null,
    level: 'all',
  });

  // 过滤后的事件
  const filteredEvents = useMemo(() => {
    return events.filter((event) => {
      // 关键词过滤
      if (filter.keyword) {
        const keyword = filter.keyword.toLowerCase();
        const content = JSON.stringify(event).toLowerCase();
        if (!content.includes(keyword)) return false;
      }

      // 事件类型过滤
      if (
        filter.eventTypes.length > 0 &&
        !filter.eventTypes.includes(event.type)
      ) {
        return false;
      }

      // Agent ID 过滤
      if (filter.agentId && event.agentId !== filter.agentId) {
        return false;
      }

      // 时间范围过滤
      if (filter.timeRange) {
        const [start, end] = filter.timeRange;
        if (event.timestamp < start || event.timestamp > end) {
          return false;
        }
      }

      return true;
    });
  }, [events, filter]);

  return (
    <div className="log-filter-panel">
      {/* 过滤器 UI */}
      <div className="filter-bar">
        <input
          type="text"
          placeholder="搜索关键词..."
          value={filter.keyword}
          onChange={(e) =>
            setFilter((f) => ({ ...f, keyword: e.target.value }))
          }
        />
        <EventTypeFilter
          selected={filter.eventTypes}
          onChange={(types) =>
            setFilter((f) => ({ ...f, eventTypes: types }))
          }
        />
        <select
          value={filter.level}
          onChange={(e) =>
            setFilter((f) => ({
              ...f,
              level: e.target.value as LogFilter['level'],
            }))
          }
        >
          <option value="all">全部</option>
          <option value="info">Info</option>
          <option value="warn">Warn</option>
          <option value="error">Error</option>
        </select>
      </div>

      {/* 日志列表 */}
      <div className="log-list">
        {filteredEvents.map((event) => (
          <LogEntry key={event.id} event={event} />
        ))}
      </div>

      <div className="filter-status">
        显示 {filteredEvents.length} / {events.length} 条事件
      </div>
    </div>
  );
}
```

过滤面板的几个实用功能：

1. **关键词搜索** -- 搜 JSON 全文，比如搜工具名、搜错误信息
2. **事件类型过滤** -- 只看 tool call，或只看 error
3. **Agent ID 过滤** -- 多 Agent 场景下，只看某个 Agent 的事件
4. **时间范围过滤** -- 只看某个时间段的事件

## 回放功能

调试 Agent 最痛苦的是：bug 不是每次都复现。你需要能 "回放" 一次完整的 Agent 运行过程。

回放的核心思路：把一次 Agent 运行的所有事件存成一个快照，然后像播放视频一样回放。

```typescript
interface ReplaySession {
  id: string;
  name: string;
  events: AgentEvent[];
  createdAt: number;
  totalDuration: number;
}

// 回放状态
interface ReplayState {
  currentSession: ReplaySession | null;
  currentIndex: number;
  isPlaying: boolean;
  playbackSpeed: number; // 1x, 2x, 0.5x
}

export function useReplay() {
  const [state, setState] = useState<ReplayState>({
    currentSession: null,
    currentIndex: 0,
    isPlaying: false,
    playbackSpeed: 1,
  });

  const timerRef = useRef<NodeJS.Timeout | null>(null);

  // 开始回放
  const play = useCallback(() => {
    setState((s) => ({ ...s, isPlaying: true }));
  }, []);

  // 暂停
  const pause = useCallback(() => {
    setState((s) => ({ ...s, isPlaying: false }));
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  // 跳到下一步
  const stepForward = useCallback(() => {
    setState((s) => {
      if (!s.currentSession) return s;
      const nextIndex = Math.min(
        s.currentIndex + 1,
        s.currentSession.events.length - 1
      );
      return { ...s, currentIndex: nextIndex };
    });
  }, []);

  // 跳到上一步
  const stepBackward = useCallback(() => {
    setState((s) => ({
      ...s,
      currentIndex: Math.max(s.currentIndex - 1, 0),
    }));
  }, []);

  // 自动播放逻辑
  useEffect(() => {
    if (!state.isPlaying || !state.currentSession) return;

    const events = state.currentSession.events;
    const currentEvent = events[state.currentIndex];
    const nextEvent = events[state.currentIndex + 1];

    if (!nextEvent) {
      setState((s) => ({ ...s, isPlaying: false }));
      return;
    }

    // 计算两步之间的时间差，除以播放速度
    const delay =
      (nextEvent.timestamp - currentEvent.timestamp) /
      state.playbackSpeed;

    timerRef.current = setTimeout(() => {
      setState((s) => ({
        ...s,
        currentIndex: s.currentIndex + 1,
      }));
    }, Math.min(delay, 2000)); // 最大间隔2秒，避免等太久

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [state.isPlaying, state.currentIndex, state.playbackSpeed]);

  return {
    ...state,
    play,
    pause,
    stepForward,
    stepBackward,
    setSpeed: (speed: number) =>
      setState((s) => ({ ...s, playbackSpeed: speed })),
    loadSession: (session: ReplaySession) =>
      setState({
        currentSession: session,
        currentIndex: 0,
        isPlaying: false,
        playbackSpeed: 1,
      }),
    currentEvent: state.currentSession
      ? state.currentSession.events[state.currentIndex]
      : null,
    progress: state.currentSession
      ? (state.currentIndex / (state.currentSession.events.length - 1)) * 100
      : 0,
  };
}
```

回放 UI 和视频播放器很像：播放/暂停、前进/后退、速度调节（0.5x, 1x, 2x）、进度条。

一个关键细节：**事件之间的时间间隔要真实还原**。LLM 思考可能要2秒，工具调用可能要500毫秒。回放时按真实时间间隔播放，这样你能感知到 Agent 实际的响应节奏。

## 状态管理：Zustand Store

整个调试面板的状态用 Zustand 管理，简单直接：

```typescript
import { create } from 'zustand';

interface DebugStore {
  // 事件数据
  events: AgentEvent[];
  addEvent: (event: AgentEvent) => void;
  clearEvents: () => void;

  // 当前选中的 session
  selectedSessionId: string | null;
  selectSession: (sessionId: string) => void;

  // UI 状态
  activePanel: 'chain' | 'tools' | 'tokens' | 'latency' | 'logs';
  setActivePanel: (panel: DebugStore['activePanel']) => void;

  // WebSocket 连接状态
  wsStatus: 'connecting' | 'connected' | 'disconnected';
  setWsStatus: (status: DebugStore['wsStatus']) => void;
}

export const useDebugStore = create<DebugStore>((set) => ({
  events: [],
  addEvent: (event) =>
    set((state) => ({
      events: [...state.events, event],
    })),
  clearEvents: () => set({ events: [] }),

  selectedSessionId: null,
  selectSession: (sessionId) => set({ selectedSessionId: sessionId }),

  activePanel: 'chain',
  setActivePanel: (panel) => set({ activePanel: panel }),

  wsStatus: 'disconnected',
  setWsStatus: (status) => set({ wsStatus: status }),
}));
```

事件通过 WebSocket 实时推送到 store：

```typescript
// 调试面板的 WebSocket 连接
function useDebugWebSocket(url: string) {
  const { addEvent, setWsStatus } = useDebugStore();

  useEffect(() => {
    setWsStatus('connecting');
    const ws = new WebSocket(url);

    ws.onopen = () => {
      setWsStatus('connected');
    };

    ws.onmessage = (message) => {
      const event: AgentEvent = JSON.parse(message.data);
      addEvent(event);
    };

    ws.onclose = () => {
      setWsStatus('disconnected');
    };

    return () => ws.close();
  }, [url]);
}
```

## 踩过的坑

**坑一：事件量过大导致页面卡顿**

Agent 运行5分钟，可能产生上千个事件。全部渲染到 DOM，页面直接卡死。

解决：

1. 虚拟列表（react-window 或 react-virtuoso）只渲染可视区域
2. 日志默认只显示最近100条，需要时加载更多
3. 考虑对事件做采样，tool call 的 args/result 在调试面板里只存摘要，完整数据存后端

**坑二：WebSocket 断线后事件丢失**

网络抖动导致 WebSocket 断连，重连后中间的事件就丢了。

解决：实现事件续传。重连时带上最后收到的事件 ID，服务端从该 ID 之后重新推送。

```typescript
ws.onopen = () => {
  const lastEventId = useDebugStore.getState().events.at(-1)?.id;
  ws.send(JSON.stringify({
    type: 'reconnect',
    lastEventId,
  }));
};
```

**坑三：Token 金额计算不准确**

不同模型的 token 单价不同，而且 prompt caching、batch API 等都会影响实际价格。

解决：不要自己算价格，直接用 LLM 提供商返回的 `usage` 字段。如果没有返回价格，就按该模型的官方单价表计算，但要标注 "预估"。

**坑四：回放时时间戳跳跃**

如果 Agent 运行过程中有长时间的停顿（比如网络超时），回放时用户会等很久。

解决：设置最大等待时间（比如2秒）。超过2秒的间隔，在 UI 上用省略号或 "等待中..." 提示，然后直接跳到下一个事件。

**坑五：多 Agent 场景下的事件排序**

多个 Agent 并行运行时，事件是交错的。按时间排序后，同一个 Agent 的事件可能被其他 Agent 的事件打断，阅读体验很差。

解决：提供 "按 Agent 分组" 和 "按时间混合" 两种视图模式。默认按 Agent 分组，每个 Agent 一条独立的时间线。

## 参考资料

- [LangSmith 官方文档](https://docs.smith.langchain.com/) -- LangChain 的官方调试平台，可以参考它的交互设计
- [Langfuse](https://langfuse.com/) -- 开源的 LLM 可观测性平台，调试面板的设计思路可以借鉴
- [react-virtuoso](https://virtuoso.dev/) -- 虚拟列表库，处理大量事件的渲染性能
- [Zustand](https://zustand-demo.pmnd.rs/) -- 轻量状态管理，适合调试面板的实时状态
- [OpenTelemetry](https://opentelemetry.io/) -- 可观测性标准，事件模型设计可以参考其 Span/Trace 概念
