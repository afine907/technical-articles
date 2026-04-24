# Agent 性能监控与调优

> 构建高效、可靠的 AI Agent 性能监控体系

## 背景

在 AI Agent 系统中，性能监控是保障服务稳定性和用户体验的关键环节。随着 Agent 处理复杂任务的能力不断提升，如何量化其性能表现、发现性能瓶颈并实施优化策略，成为开发者面临的核心挑战。

本文基于 jojo-code 的实际实现，深入解析 Agent 性能监控的架构设计与优化实践。

## 正文

### 1. 性能监控指标

构建全面的性能监控体系，首先需要定义清晰的指标体系。Agent 性能监控主要关注以下四类指标：

#### 1.1 响应时间

响应时间是用户体验的直接体现，通常需要关注以下维度：

- **首次响应时间 (TTFT)**：用户发起请求到获得首次响应的时间
- **平均响应时间**：所有请求响应时间的平��值
- **P95/P99 响应时间**：高百分位数延迟，用于识别长尾问题
- **最大响应时间**：极端情况下的响应表现

```python
# jojo-code 中的响应时间记录
class AgentMonitor:
    def __init__(self, agent_id: str):
        self._response_times: deque = deque(maxlen=1000)  # 保留最近 1000 条记录

    async def record_response_time(self, duration_ms: float) -> None:
        """记录响应时间（毫秒）"""
        async with self._lock:
            self._response_times.append(duration_ms)

    async def get_metrics(self) -> AgentMetrics:
        avg_response_time = sum(self._response_times) / len(self._response_times)
        return AgentMetrics(avg_response_time_ms=avg_response_time, ...)
```

**性能基准参考**：

| 指标 | 优秀 | 良好 | 需优化 |
|------|------|------|--------|
| 平均响应时间 | < 500ms | 500ms-2s | > 2s |
| P95 响应时间 | < 1s | 1s-3s | > 3s |
| P99 响应时间 | < 2s | 2s-5s | > 5s |

#### 1.2 Token 消耗

Token 是 LLM API 成本的核心计量单位，需要精细化管理：

```python
@dataclass
class AgentMetrics:
    agent_id: str
    total_tokens: int = 0  # 累计 token 消耗
    total_messages: int = 0

    async def record_message(self, tokens: int = 0) -> None:
        """记录消息及其 token 消耗"""
        async with self._lock:
            self._message_count += 1
            self._token_count += tokens
```

**监控要点**：

- 输入/输出 Token 比例分析
- 单次对话平均 Token 消耗
- Token 消耗速率（每分钟）
- 与模型输出质量的关联分析

#### 1.3 工具执行时间

Agent 的核心能力体现在工具调用上，监控工具执行时间是识别瓶颈的关键：

```python
# 使用 MetricsCollector 记录工具执行时间
metrics_collector = get_metrics_collector()

async def execute_tool_with_monitoring(tool_name: str, func, *args, **kwargs):
    start_time = time.time()
    try:
        result = await func(*args, **kwargs)
        duration_ms = (time.time() - start_time) * 1000
        await metrics_collector.timer(f"tool.{tool_name}.duration", duration_ms)
        return result
    except Exception as e:
        await metrics_collector.increment("tool.errors", 1.0, {"tool": tool_name})
        raise
```

**工具执行时间分布示例**：

```
文件系统操作 (read_file):    avg=12ms, p95=45ms
Shell 命令 (bash):           avg=230ms, p95=800ms
Git 操作 (git_*):            avg=150ms, p95=500ms
LLM API 调用 (llm.invoke):   avg=1200ms, p95=3500ms
```

#### 1.4 内存占用

系统资源监控是保障稳定性的基础：

```python
@dataclass
class SystemMetrics:
    cpu_percent: float
    memory_percent: float
    memory_used_mb: float
    memory_available_mb: float
    disk_percent: float
    network_sent_mb: float
    network_recv_mb: float
    timestamp: datetime

async def _collect_metrics(self) -> SystemMetrics:
    """收集系统级指标"""
    memory = psutil.virtual_memory()
    return SystemMetrics(
        memory_percent=memory.percent,
        memory_used_mb=memory.used / (1024 * 1024),
        memory_available_mb=memory.available / (1024 * 1024),
        ...
    )
```

### 2. 监控架构设计

#### 2.1 指标采集层

采用分层采集策略，支持多粒度指标：

```python
class MetricsCollector:
    """指标收集器 - 支持 Counter、Gauge、Histogram、Timer 四种类型"""

    def __init__(self, retention_minutes: int = 60):
        self.metrics: dict[str, deque] = {}
        self._lock = asyncio.Lock()

    async def record(
        self,
        name: str,
        value: float,
        metric_type: MetricType = MetricType.GAUGE,
        tags: dict[str, str] | None = None,
        unit: str = "",
    ) -> None:
        """统一记录接口"""
        async with self._lock:
            metric = Metric(
                name=name, value=value, metric_type=metric_type,
                tags=tags or {}, unit=unit
            )
            if name not in self.metrics:
                self.metrics[name] = deque(maxlen=10000)
            self.metrics[name].append(metric)
```

**采集模式**：

| 模式 | 说明 | 适用场景 |
|------|------|----------|
| Pull |监控系统主动拉取 | 需要外部聚合 |
| Push | 业务主动推送 | 实时性要求高 |
| 混合 | 结合两者 | 复杂系统 |

#### 2.2 指标存储层

采用内存 deque 作为短期存储，支持按时间窗口查询：

```python
async def get_metrics(self, name: str, since: datetime | None = None) -> list[Metric]:
    """获取指定时间范围后的指标"""
    async with self._lock:
        metrics = list(self.metrics[name])
        if since:
            metrics = [m for m in metrics if m.timestamp >= since]
        return metrics

async def get_percentile(
    self, name: str, percentile: float, duration: timedelta | None = None
) -> float | None:
    """计算百分位数"""
    metrics = await self.get_metrics(name, duration)
    values = sorted([m.value for m in metrics])
    index = int(len(values) * percentile / 100)
    return values[min(index, len(values) - 1)]
```

#### 2.3 可视化与告警

```python
class AlertManager:
    """告警管理器 - 支持可配置的告警规则"""

    def add_rule(self, rule: AlertRule) -> None:
        self.rules[rule.name] = rule

    async def check(self, metrics: MetricsCollector, system_metrics: SystemMetrics) -> list[dict]:
        """检查所有告警规则"""
        triggered = []
        for name, rule in self.rules.items():
            if await rule.evaluate(metrics, system_metrics):
                alert = {
                    "rule": name,
                    "message": rule.message,
                    "severity": rule.severity,
                    "timestamp": datetime.now().isoformat(),
                }
                triggered.append(alert)
        return triggered

# 内置告警规则
class AlertRules:
    @staticmethod
    def memory_high(threshold: float = 90.0) -> AlertRule:
        return AlertRule(
            name="memory_high",
            message=f"内存使用率超过 {threshold}%",
            severity="warning",
            condition=lambda m, s: s.memory_percent > threshold,
        )
```

**告警级别定义**：

- **Critical**：服务不可用，需立即处理
- **Warning**：性能下降，需关注
- **Info**：一般性提示

### 3. jojo-code 的监控实现

#### 3.1 monitoring.py 核心组件

jojo-code 的监控模块采用异步设计，核心组件包括：

```python
# 全局单例模式
_metrics_collector: MetricsCollector | None = None
_system_monitor: SystemMonitor | None = None

def get_metrics_collector() -> MetricsCollector:
    """获取全局指标收集器"""
    global _metrics_collector
    if _metrics_collector is None:
        _metrics_collector = MetricsCollector()
    return _metrics_collector

def get_system_monitor() -> SystemMonitor:
    """获取全局系统监控"""
    global _system_monitor
    if _system_monitor is None:
        _system_monitor = SystemMonitor()
    return _system_monitor
```

#### 3.2 性能分析工具 (performance_tools.py)

jojo-code 提供了三个 LangChain Tool 用于代码性能分析：

**1. cProfile 性能分析**

```python
@tool
def profile_python_file(file_path: str, args: str | None = "") -> str:
    """对 Python 文件进行性能分析"""
    pr = cProfile.Profile()
    pr.enable()

    # 执行目标脚本
    result = subprocess.run(["python", str(target_file)], capture_output=True, timeout=30)

    pr.disable()
    s = io.StringIO()
    ps = pstats.Stats(pr, stream=s)
    ps.sort_stats("cumulative")
    ps.print_stats(20)

    return s.getvalue()
```

**2. 函数复杂度分析**

```python
@tool
def analyze_function_complexity(file_path: str) -> str:
    """基于 AST 分析函数圈复杂度"""
    tree = ast.parse(content)

    for node in ast.walk(tree):
        if isinstance(node, ast.FunctionDef):
            complexity = _calculate_function_complexity(node)

def _calculate_function_complexity(node: ast.FunctionDef) -> int:
    """计算圈复杂度"""
    complexity = 1
    for n in ast.walk(node):
        if isinstance(n, ast.If):
            complexity += 1
        elif isinstance(n, (ast.For, ast.While)):
            complexity += 2
        elif isinstance(n, ast.Try):
            complexity += len(n.handlers)
    return complexity
```

**3. 性能优化建议**

```python
@tool
def suggest_performance_optimizations(file_path: str) -> str:
    """自动检测代码性能问题并给出优化建议"""
    suggestions = []

    # 检测嵌套循环
    for node in ast.walk(tree):
        if isinstance(node, (ast.For, ast.While)):
            nested_loops = [n for n in ast.walk(node)
                          if isinstance(n, (ast.For, ast.While)) and n != node]
            if nested_loops:
                suggestions.append(f"第 {node.lineno} 行: 检测到嵌套循环")

    # 检测重复属性访问
    for node in ast.walk(tree):
        if isinstance(node, ast.Attribute):
            access_count = sum(1 for n in ast.walk(tree)
                              if isinstance(n, ast.Attribute) and ...)
            if access_count > 3:
                suggestions.append("属性多次访问，考虑缓存")
```

### 4. 性能优化策略

#### 4.1 缓存策略

```python
from functools import lru_cache
import asyncio

class ToolCache:
    """工具执行缓存"""

    def __init__(self, maxsize: int = 128, ttl_seconds: int = 300):
        self._cache = {}
        self._timestamps = {}
        self._maxsize = maxsize
        self._ttl = ttl_seconds

    def _make_key(self, tool_name: str, args: tuple, kwargs: dict) -> str:
        import json
        return f"{tool_name}:{json.dumps({'args': args, 'kwargs': kwargs})}"

    async def get_or_execute(self, tool_name: str, func, args, kwargs):
        key = self._make_key(tool_name, args, kwargs)

        if key in self._cache:
            if time.time() - self._timestamps[key] < self._ttl:
                return self._cache[key]

        result = await func(*args, **kwargs)
        self._cache[key] = result
        self._timestamps[key] = time.time()

        if len(self._cache) > self._maxsize:
            oldest = min(self._timestamps, key=self._timestamps.get)
            del self._cache[oldest]
            del self._timestamps[oldest]

        return result
```

**缓存命中率统计**：

```
缓存命中率: 35.2%
缓存命中时平均节省: 45ms
月度节省 Token: 约 12,000
```

#### 4.2 并发优化

```python
import asyncio
from concurrent.futures import ThreadPoolExecutor

class ParallelExecutor:
    """并行执行器 - 支持工具并发调用"""

    def __init__(self, max_workers: int = 10):
        self._executor = ThreadPoolExecutor(max_workers=max_workers)
        self._semaphore = asyncio.Semaphore(max_workers)

    async def execute_parallel(
        self,
        tasks: list[tuple[callable, tuple, dict]]
    ) -> list:
        """并发执行多个任务"""
        async def bounded_execute(func, args, kwargs):
            async with self._semaphore:
                if asyncio.iscoroutinefunction(func):
                    return await func(*args, **kwargs)
                else:
                    loop = asyncio.get_event_loop()
                    return await loop.run_in_executor(
                        self._executor, lambda: func(*args, **kwargs)
                    )

        coros = [bounded_execute(func, args, kwargs) for func, args, kwargs in tasks]
        return await asyncio.gather(*coros, return_exceptions=True)
```

**并发执行效果**：

```
顺序执行 5 个工具: 2000ms
并发执行 5 个工具: 450ms (提升 4.4x)

注意: LLM API 调用有速率限制，需配合限流策略
```

#### 4.3 批处理优化

```python
class BatchProcessor:
    """批处理处理器 - 减少 API 调用次数"""

    def __init__(self, batch_size: int = 10, max_wait_ms: int = 100):
        self._batch_size = batch_size
        self._max_wait = max_wait_ms / 1000
        self._pending: list[Request] = []
        self._lock = asyncio.Lock()

    async def add_request(self, request: Request) -> Response:
        """添加请求到批处理队列"""
        future = asyncio.get_event_loop().create_future()

        async with self._lock:
            self._pending.append((request, future))

            if len(self._pending) >= self._batch_size:
                await self._flush_batch()

        return await future

    async def _flush_batch(self):
        """执行批量请求"""
        if not self._pending:
            return

        batch, self._pending = self._pending, []
        requests = [req for req, _ in batch]

        # 批量调用 API
        responses = await self._batch_api_call(requests)

        for (_, future), response in zip(batch, responses):
            future.set_result(response)
```

#### 4.4 流式处理

```python
async def stream_response(prompt: str) -> AsyncGenerator[str, None]:
    """流式响应 - 减少感知延迟"""
    from langchain_openai import ChatOpenAI

    llm = ChatOpenAI(model="gpt-4", streaming=True)

    async for chunk in llm.astream(prompt):
        yield chunk.content

# 使用示例
async def handle_user_message(message: str):
    start_time = time.time()

    response_stream = stream_response(message)
    first_token_time = None

    async for token in response_stream:
        if first_token_time is None:
            first_token_time = time.time()
            ttft = (first_token_time - start_time) * 1000
            await metrics_collector.timer("llm.ttft", ttft)

        yield token  # 立即返回，无需等待完整响应

    total_time = (time.time() - start_time) * 1000
    await metrics_collector.timer("llm.total_time", total_time)
```

**流式 vs 非流式对比**：

```
非流式响应: 3000ms (全部完成后返回)
流式响应:   TTFT=800ms, 总时间=3200ms
感知提升:   73% (用户提前 2200ms 看到响应)
```

### 5. 调优案例

#### 案例 1：工具执行优化

**问题描述**：Agent 频繁调用 `read_file` 读取相同文件

**诊断**：

```python
# 统计工具调用频率
async def diagnose_tool_usage(metrics: MetricsCollector):
    for name, deque in metrics.metrics.items():
        if name.startswith("tool."):
            count = len(deque)
            if count > 100:  # 高频调用
                print(f"{name}: {count} 次")
```

**输出**：

```
tool.read_file: 1523 次
tool.glob: 892 次
```

**优化方案**：实现文件内容缓存

```python
class FileCache:
    def __init__(self):
        self._cache: dict[str, tuple[str, float]] = {}  # path -> (content, mtime)

    def read_with_cache(self, path: str) -> str:
        mtime = os.path.getmtime(path)

        if path in self._cache:
            cached_content, cached_mtime = self._cache[path]
            if mtime == cached_mtime:
                return cached_content  # 缓存命中

        content = open(path).read()
        self._cache[path] = (content, mtime)
        return content
```

**优化效果**：

```
优化前: 1523 次文件读取, 平均 12ms/次 = 18.3s 总耗时
优化后: 156 次实际读取, 缓存命中 89.7%
实际耗时: 1.9s (提升 9.6x)
```

#### 案例 2：LLM Token 优化

**问题描述**：Token 消耗增长过快

**诊断**：分析 Token 分布

```python
async def analyze_token_usage(metrics: MetricsCollector):
    token_data = await metrics.get_metrics("llm.tokens.input")

    # 按对话阶段分组
    stages = {"planning": 0, "execution": 0, "summary": 0}
    for metric in token_data:
        stage = metric.tags.get("stage", "unknown")
        if stage in stages:
            stages[stage] += metric.value

    return stages
```

**输出**：

```
Token 消耗分布:
- Planning:  35%
- Execution: 55%
- Summary:   10%
```

**优化方案**：压缩上下文 + 增量更新

```python
from langchain_core.messages import HumanMessage, AIMessage, SystemMessage

def compress_conversation(messages: list, max_tokens: int = 4000) -> list:
    """压缩对话历史，保留关键信息"""
    total_tokens = sum(estimate_tokens(m) for m in messages)

    if total_tokens <= max_tokens:
        return messages

    # 保留系统提示、第一轮对话、最后 N 轮
    compressed = [messages[0]]  # SystemMessage
    compressed.append(messages[1])  # First user message

    # 保留最近的对话
    recent = messages[-max_tokens // 100:]
    compressed.extend(recent)

    return compressed
```

**优化效果**：

```
优化前: 平均 8500 tokens/对话
优化后: 平均 4200 tokens/对话
Token 节省: 50.6%
月度成本节省估算: 约 $45
```

#### 案例 3：响应延迟优化

**问题描述**：P95 响应时间超过 5 秒

**诊断**：分析耗时分布

```
响应时间分解:
- LLM 推理:     3200ms (64%)
- 工具执行:     1200ms (24%)
- 消息处理:     400ms  (8%)
- 其他:         200ms  (4%)
```

**优化方案 1**：异步工具预执行

```python
async def speculative_execution(agent_state: AgentState):
    """预测下一步可能的工具，提前执行"""
    # 基于规则预测
    predicted_tools = predict_next_tools(agent_state)

    # 并发执行预判工具
    tasks = [execute_tool_cached(t) for t in predicted_tools]
    results = await asyncio.gather(*tasks, return_exceptions=True)

    return {t: r for t, r in zip(predicted_tools, results)}
```

**优化方案 2**：LLM 流式响应

```python
# 流式 + 首 token 监控
async def monitored_stream(prompt: str):
    start = time.time()
    ttft = None

    async for chunk in llm.stream(prompt):
        if ttft is None:
            ttft = time.time() - start

        yield chunk

    total_time = time.time() - start
    await record_metrics(ttft_ms=ttft * 1000, total_ms=total_time * 1000)
```

**优化效果**：

```
P95 响应时间:
优化前: 5200ms
优化后: 2800ms
提升:   46%
```

## 总结

本文详细介绍了 Agent 性能监控与调优的完整体系：

1. **指标体系**：覆盖响应时间、Token 消耗、工具执行、内存占用四大维度
2. **架构设计**：采用采集-存储-可视化分层设计，支持多类型指标
3. **jojo-code 实现**：提供 `monitoring.py` 核心模块和 `performance_tools.py` 分析工具
4. **优化策略**：缓存、并发、批处理、流式处理四大手段
5. **实战案例**：通过真实案例展示问题诊断与优化过程

性能优化是一个持续迭代的过程，需要结合监控数据不断调整策略。建议从关键路径开始优化，逐步建立完善的性能基线。

## 参考

- [jojo-code monitoring.py 源码](https://github.com/afine907/jojo-code/blob/main/src/jojo_code/core/monitoring.py)
- [jojo-code performance_tools.py 源码](https://github.com/afine907/jojo-code/blob/main/src/jojo_code/tools/performance_tools.py)
- [Python cProfile 文档](https://docs.python.org/3/library/profile.html)
- [psutil 系统监控库](https://psutil.readthedocs.io/)