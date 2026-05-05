---
sidebar_position: 1
title: Agent 崩了怎么办？错误处理与重试机制
slug: error-handling
---

# Agent 崩了怎么办？错误处理与重试机制

你的 Agent 调用 OpenAI API，突然返回 `RateLimitError`。重试？等待？降级？

没有错误处理的 Agent，就像没有刹车的车——能跑，但危险。

## 📊 Agent 错误类型统计

我分析了 jojo-code 运行 30 天的错误日志：

```
┌─────────────────────────────────────────────────────────┐
│                  Agent 错误分布（30天）                  │
├─────────────────────────────────────────────────────────┤
│                                                         │
│  LLM API 错误        ████████████████████  42%          │
│  • Rate Limit        ████████████  28%                  │
│  • Timeout           ████  10%                          │
│  • Service Unavailable ██  4%                           │
│                                                         │
│  工具执行错误         ████████████  25%                  │
│  • FileNotFoundError ██████  12%                        │
│  • PermissionError   ███  8%                            │
│  • 其他              ██  5%                             │
│                                                         │
│  状态错误             ████  18%                          │
│  • KeyError          ██  10%                            │
│  • TypeError         █  5%                              │
│  • 其他              █  3%                              │
│                                                         │
│  其他错误             ████  15%                          │
│                                                         │
└─────────────────────────────────────────────────────────┘
```

## 🔬 错误分类与影响

### 分类表

| 错误类型 | 典型错误 | 是否可恢复 | 影响 |
|---------|---------|-----------|------|
| **临时性错误** | RateLimit, Timeout | ✅ 是 | 短暂延迟 |
| **资源错误** | FileNotFoundError | ❌ 否 | 需要修正输入 |
| **权限错误** | PermissionError | ❌ 否 | 需要调整权限 |
| **状态错误** | KeyError, TypeError | ❌ 否 | 代码 Bug |
| **致命错误** | OutOfMemory | ❌ 否 | 需要重启 |

### 错误处理策略矩阵

```
┌─────────────────────────────────────────────────────────┐
│                  错误处理策略矩阵                        │
├─────────────────────────────────────────────────────────┤
│                                                         │
│              │ 可恢复 │ 不可恢复                        │
│  ────────────┼────────┼────────────────                │
│  临时性错误   │ 重试   │ 超限后降级                       │
│  资源错误    │ 降级   │ 返回错误提示                      │
│  权限错误    │ 降级   │ 返回错误提示                      │
│  状态错误    │ 修复   │ 记录日志 + 返回提示               │
│  致命错误    │ 重启   │ 记录日志 + 告警                   │
│                                                         │
└─────────────────────────────────────────────────────────┘
```

## 🛠️ 三大处理机制

### 机制一：重试（Retry）

**适用场景**：临时性错误（Rate Limit、网络抖动）

```
┌─────────────────────────────────────────────────────────┐
│                    重试策略流程                          │
├─────────────────────────────────────────────────────────┤
│                                                         │
│  请求 ──▶ 失败?                                         │
│            │                                            │
│            ├─ 否 ─▶ 返回结果                             │
│            │                                            │
│            └─ 是 ─▶ 重试次数 < 最大次数?                 │
│                        │                                │
│                        ├─ 是 ─▶ 等待（指数退避）         │
│                        │         │                      │
│                        │         └─▶ 重试请求           │
│                        │                                │
│                        └─ 否 ─▶ 抛出异常                 │
│                                                         │
└─────────────────────────────────────────────────────────┘
```

**实现代码**：

```python
from tenacity import (
    retry,
    stop_after_attempt,
    wait_exponential,
    retry_if_exception_type,
)
from openai import RateLimitError, APITimeoutError

@retry(
    stop=stop_after_attempt(3),  # 最多重试 3 次
    wait=wait_exponential(
        multiplier=1,  # 基础等待时间
        min=4,         # 最小等待 4 秒
        max=10,        # 最大等待 10 秒
    ),
    retry=retry_if_exception_type(
        (RateLimitError, APITimeoutError)
    ),
)
async def call_llm_with_retry(messages: list) -> str:
    """带重试的 LLM 调用"""
    return await llm.ainvoke(messages)

# 等待时间示例：
# 第 1 次重试：等待 4 秒
# 第 2 次重试：等待 8 秒
# 第 3 次重试：等待 10 秒（达到上限）
```

**重试效果**：

| 错误类型 | 重试成功率 | 平均等待时间 |
|---------|-----------|-------------|
| Rate Limit | 85% | 6.5s |
| Timeout | 70% | 5.2s |
| Network Error | 90% | 3.8s |

### 机制二：降级（Fallback）

**适用场景**：主服务不可用，切换备用方案

```
┌─────────────────────────────────────────────────────────┐
│                    降级策略流程                          │
├─────────────────────────────────────────────────────────┤
│                                                         │
│  请求 ──▶ 主模型 ──▶ 成功?                               │
│              │          │                               │
│              │          ├─ 是 ─▶ 返回结果                │
│              │          │                               │
│              │          └─ 否 ─▶ 备用模型 1              │
│              │                   │                      │
│              │                   ├─ 成功 ─▶ 返回         │
│              │                   │                      │
│              │                   └─ 失败 ─▶ 备用模型 2   │
│              │                            │             │
│              │                            ├─ 成功 ─▶ 返回│
│              │                            │             │
│              │                            └─ 失败 ─▶ 报错│
│                                                         │
└─────────────────────────────────────────────────────────┘
```

**实现代码**：

```python
from dataclasses import dataclass
from typing import Optional

@dataclass
class Model:
    name: str
    invoke: callable
    cost_per_1k: float  # 输入成本
    priority: int  # 优先级（越小越优先）

class FallbackChain:
    """降级链"""
    
    def __init__(self, models: list[Model]):
        # 按优先级排序
        self.models = sorted(models, key=lambda m: m.priority)
    
    async def invoke(self, messages: list) -> tuple[str, str]:
        """执行降级链
        
        Returns:
            (结果, 使用的模型名)
        """
        errors = []
        
        for model in self.models:
            try:
                result = await model.invoke(messages)
                return result, model.name
            except Exception as e:
                errors.append(f"{model.name}: {str(e)}")
                continue
        
        raise Exception(f"所有模型都失败:\n" + "\n".join(errors))

# 配置降级链
fallback = FallbackChain([
    Model("gpt-4-turbo", gpt4.invoke, 0.01, priority=1),
    Model("gpt-3.5-turbo", gpt35.invoke, 0.0015, priority=2),
    Model("claude-3-haiku", claude.invoke, 0.00025, priority=3),
])

# 使用
result, model_used = await fallback.invoke(messages)
print(f"使用模型: {model_used}")
```

**成本优化**：智能路由

```python
def estimate_complexity(message: str) -> str:
    """评估任务复杂度"""
    
    # 复杂度关键词
    high_keywords = ["分析", "设计", "架构", "优化", "debug", "重构"]
    medium_keywords = ["实现", "编写", "创建", "修改"]
    
    for kw in high_keywords:
        if kw in message:
            return "high"
    
    for kw in medium_keywords:
        if kw in message:
            return "medium"
    
    return "low"

# 根据复杂度选择模型
def select_model(complexity: str, fallback: FallbackChain) -> Model:
    if complexity == "high":
        return fallback.models[0]  # GPT-4
    elif complexity == "medium":
        return fallback.models[1]  # GPT-3.5
    else:
        return fallback.models[2]  # Claude Haiku
```

**成本节省效果**：

| 策略 | 月度成本 | 节省 |
|------|---------|------|
| 全部用 GPT-4 | $450 | - |
| 降级链（无智能路由） | $280 | 38% |
| 降级链 + 智能路由 | $180 | 60% |

### 机制三：错误隔离（Isolation）

**适用场景**：单个工具失败不影响整体

```
┌─────────────────────────────────────────────────────────┐
│                    错误隔离示例                          │
├─────────────────────────────────────────────────────────┤
│                                                         │
│  工具调用列表：                                          │
│  ├── read_file("a.txt") ✅ 成功                         │
│  ├── read_file("b.txt") ❌ 失败（文件不存在）            │
│  └── read_file("c.txt") ✅ 成功                         │
│                                                         │
│  ❌ 无隔离：Agent 崩溃，所有结果丢失                      │
│  ✅ 有隔离：返回 [结果A, 错误信息, 结果C]                 │
│                                                         │
└─────────────────────────────────────────────────────────┘
```

**实现代码**：

```python
from typing import Union

@dataclass
class ToolResult:
    success: bool
    tool_name: str
    result: Optional[str] = None
    error: Optional[str] = None

async def execute_tools_safely(
    tool_calls: list[dict],
    tool_map: dict,
) -> list[ToolResult]:
    """安全执行工具（错误隔离）"""
    
    results = []
    
    for tc in tool_calls:
        name = tc["name"]
        args = tc["args"]
        
        try:
            # 执行工具
            if name not in tool_map:
                raise ValueError(f"未知工具: {name}")
            
            result = await tool_map[name].ainvoke(args)
            
            results.append(ToolResult(
                success=True,
                tool_name=name,
                result=result,
            ))
        
        except Exception as e:
            # 捕获异常，不影响其他工具
            results.append(ToolResult(
                success=False,
                tool_name=name,
                error=str(e),
            ))
    
    return results

# 格式化返回给 Agent
def format_results(results: list[ToolResult]) -> list[str]:
    formatted = []
    for r in results:
        if r.success:
            formatted.append(f"[{r.tool_name}] {r.result}")
        else:
            formatted.append(f"[{r.tool_name}] 错误: {r.error}")
    return formatted
```

## 📊 完整错误处理架构

```
┌─────────────────────────────────────────────────────────┐
│                Agent 错误处理架构                        │
├─────────────────────────────────────────────────────────┤
│                                                         │
│  用户请求                                               │
│     │                                                   │
│     ▼                                                   │
│  ┌─────────────────────────────────────────────────┐   │
│  │              错误分类器                          │   │
│  │  • 识别错误类型                                  │   │
│  │  • 判断是否可恢复                                │   │
│  └────────────────────┬────────────────────────────┘   │
│                       │                                 │
│         ┌─────────────┼─────────────┐                  │
│         │             │             │                  │
│         ▼             ▼             ▼                  │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐            │
│  │  重试器   │  │  降级器  │  │  隔离器   │            │
│  │          │  │          │  │          │            │
│  │ RateLimit│  │ 模型切换 │  │ 工具隔离 │            │
│  │ Timeout  │  │ 功能降级 │  │ 错误收集 │            │
│  └────┬─────┘  └────┬─────┘  └────┬─────┘            │
│       │             │             │                    │
│       └─────────────┼─────────────┘                    │
│                     │                                   │
│                     ▼                                   │
│              ┌───────────┐                              │
│              │  结果聚合  │                              │
│              └─────┬─────┘                              │
│                    │                                    │
│                    ▼                                    │
│              ┌───────────┐                              │
│              │  日志记录  │                              │
│              └───────────┘                              │
│                                                         │
└─────────────────────────────────────────────────────────┘
```

## ⚠️ 我踩过的真实坑

### 坑一：重试太频繁

**问题**：Rate Limit 后立刻重试，把 API 配额用完了。

```python
# ❌ 错误：无等待重试
while retries < 3:
    try:
        return llm.invoke(messages)
    except RateLimitError:
        retries += 1
        # 没有等待！立刻重试
```

**解决**：指数退避

```python
# ✅ 正确：指数退避
import time

def exponential_backoff(attempt: int, base: float = 1.0):
    """指数退避算法"""
    wait_time = min(base * (2 ** attempt), 60)  # 最多等 60 秒
    time.sleep(wait_time)

# 等待时间：1s → 2s → 4s → 8s → ...
```

### 坑二：降级没回切

**问题**：主模型恢复后，请求还走备用模型。

**解决**：定期探测 + 自动回切

```python
class AutoFallback(FallbackChain):
    """自动回切的降级链"""
    
    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self.healthy_model = self.models[0]  # 当前健康的模型
        self.last_check = 0
    
    async def check_health(self):
        """健康检查"""
        # 每 5 分钟检查一次主模型
        if time.time() - self.last_check < 300:
            return
        
        self.last_check = time.time()
        
        try:
            # 发送简单请求测试
            await self.models[0].invoke([{"role": "user", "content": "ping"}])
            self.healthy_model = self.models[0]  # 主模型恢复
        except:
            pass  # 主模型还是不可用
```

### 坑三：错误信息暴露敏感信息

**问题**：工具报错时，返回了文件路径、密钥等敏感信息。

```python
# ❌ 错误：暴露路径
except FileNotFoundError as e:
    return f"错误: 文件 {path} 不存在"  # 暴露了完整路径
```

**解决**：脱敏处理

```python
# ✅ 正确：脱敏
except FileNotFoundError:
    return "错误: 文件不存在或无权访问"
```

## 📋 错误处理检查清单

```
□ LLM 调用
  ├── □ 加重试（指数退避）
  ├── □ 加降级（备用模型）
  └── □ 加超时（避免无限等待）

□ 工具执行
  ├── □ 每个工具 try-catch
  ├── □ 收集所有错误（不中断）
  └── □ 返回友好的错误提示

□ 状态管理
  ├── □ 验证必需字段
  ├── □ 类型检查
  └── □ 默认值处理

□ 日志记录
  ├── □ 记录错误详情（服务器端）
  ├── □ 返回友好提示（用户端）
  └── □ 不暴露敏感信息
```


**核心认知**：错误不是"会不会发生"，而是"何时发生"。提前设计好重试、降级、隔离机制，Agent 才能稳定运行。
