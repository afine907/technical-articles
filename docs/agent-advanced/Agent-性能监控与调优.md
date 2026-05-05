---
slug: performance-monitoring
sidebar_position: 1
title: 如何知道你的 Agent 跑得好不好？
---

# 如何知道你的 Agent 跑得好不好？

用户投诉"Agent 太慢了"，你打开日志，全是"请求完成"，看不出问题在哪。LLM 调用时间都在 500ms 以内，但整体响应要好几秒——瓶颈可能在工具调用、上下文构建、或者任何一个你没监控到的环节。

怎么系统地监控 Agent 性能，快速定位瓶颈？

## 核心指标

监控 Agent，主要看三个指标：

**1. 响应时间**

用户发起请求到收到回复的时间。

目标：平均 < 2秒，P95 < 5秒。

**2. Token 消耗**

每次请求消耗多少 Token。直接关系到成本。

目标：单次对话 < 5000 Token。

**3. 工具执行时间**

每个工具调用花了多长时间。

目标：单个工具 < 1秒。

## 快速实现监控

最简单的方式：记录每个步骤的时间戳。

```python
import time

class AgentMonitor:
    def __init__(self):
        self.start_time = None
        self.timings = {}
    
    def start(self):
        self.start_time = time.time()
    
    def record(self, name: str):
        self.timings[name] = time.time() - self.start_time
    
    def summary(self):
        return {
            "total": sum(self.timings.values()),
            "breakdown": self.timings,
        }

# 使用
monitor = AgentMonitor()
monitor.start()

# LLM 调用
response = llm.invoke(messages)
monitor.record("llm")

# 工具执行
result = tool.execute()
monitor.record("tool")

print(monitor.summary())
# 输出: {"total": 2.3, "breakdown": {"llm": 0.5, "tool": 1.8}}
```

这样你就能看到：是 LLM 慢，还是工具慢。

## 性能瓶颈定位

我总结了常见的三类瓶颈：

### 瓶颈一：LLM 调用慢

症状：LLM 调用时间 > 1秒。

原因：
- 模型太大（GPT-4 比 GPT-3.5 慢）
- 输出太长（生成越多越慢）
- 上下文太长（输入越多越慢）

解决：
- 简单任务用小模型
- 控制输出长度
- 定期压缩上下文

### 瓶颈二：工具执行慢

症状：工具执行时间 > 1秒。

原因：
- 文件 I/O 慢（读大文件）
- 网络请求慢（API 调用）
- 计算密集型任务

解决：
- 文件操作加缓存
- 网络请求加超时
- 异步执行长任务

### 瓶颈三：上下文膨胀

症状：Token 数持续增长，响应越来越慢。

原因：
- 消息历史不断累积
- 工具结果没有清理

解决：
- 设置消息上限
- 工具结果用完就清空

## 监控面板（简化版）

```python
from dataclasses import dataclass
from collections import deque

@dataclass
class Metrics:
    avg_response_time: float
    p95_response_time: float
    total_tokens: int
    tool_timings: dict

class AgentDashboard:
    def __init__(self, window=100):
        self.response_times = deque(maxlen=window)
        self.token_counts = deque(maxlen=window)
        self.tool_timings = {}
    
    def record(self, response_time: float, tokens: int, tools: dict):
        self.response_times.append(response_time)
        self.token_counts.append(tokens)
        for tool, time in tools.items():
            if tool not in self.tool_timings:
                self.tool_timings[tool] = deque(maxlen=window)
            self.tool_timings[tool].append(time)
    
    def get_metrics(self) -> Metrics:
        times = list(self.response_times)
        times.sort()
        
        return Metrics(
            avg_response_time=sum(times) / len(times),
            p95_response_time=times[int(len(times) * 0.95)],
            total_tokens=sum(self.token_counts),
            tool_timings={k: sum(v)/len(v) for k, v in self.tool_timings.items()},
        )
```

使用：

```python
dashboard = AgentDashboard()

# 每次请求后记录
dashboard.record(
    response_time=1.5,
    tokens=500,
    tools={"read_file": 0.1, "llm": 1.2}
)

# 查看指标
metrics = dashboard.get_metrics()
print(f"平均响应时间: {metrics.avg_response_time}s")
print(f"P95: {metrics.p95_response_time}s")
print(f"工具耗时: {metrics.tool_timings}")
```

## 我踩过的坑

**坑一：只看平均值**

平均响应时间 500ms，看起来没问题。但 P95 是 5秒，说明有 5% 的用户等了很久。

解决：同时看 P95/P99。

**坑二：监控数据太多**

把每次请求的详细信息都记下来，日志文件几天就爆了。

解决：只记录聚合指标，详细日志用采样。

**坑三：监控影响性能**

每次都打印日志，反而拖慢了 Agent。

解决：异步记录，不要阻塞主流程。

## 下一步行动

1. **加上时间记录**：至少记录总响应时间和 LLM 调用时间
2. **建立基准**：跑 100 次测试，记录平均和 P95
3. **设置告警**：响应时间 > 5秒时发通知

---

监控不是目的，定位问题才是。先有数据，再谈优化。
