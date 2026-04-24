# Agent 错误处理与重试机制

在 Agent 开发中，错误处理与重试机制是保障系统稳定性的核心能力。网络不稳定、LLM 服务限流、工具执行失败等问题随时可能发生，没有完善的错误处理机制，Agent 很难在生产环境中稳定运行。本文以 jojo-code 源码为例，深入讲解 Agent 错误处理的挑战、异常体系设计、重试机制实现以及最佳实践。

## 1. 错误处理的挑战

Agent 系统运行在复杂的分布式环境中，错误来源多样，主要包括以下几类：

### 1.1 网络错误

网络请求是 Agent 与外部服务交互的主要方式，网络错误常见的有：

- **连接超时**：请求超过预设时间未建立连接
- **读取超时**：建立连接后，等待响应超时
- **DNS 解析失败**：域名无法解析
- **连接被拒绝**：目标服务未运行或防火墙阻止
- **SSL 证书错误**：HTTPS 证书验证失败

```python
# 网络请求可能抛出的异常
try:
    async with session.post(url, json=payload) as response:
        pass
except TimeoutError:
    # 请求超时
    pass
except aiohttp.ClientConnectorError:
    # 连接错误
    pass
except Exception as e:
    # 其他网络错误
    pass
```

### 1.2 LLM 错误

调用 LLM API 时可能遇到多种错误：

- **API 限流**：请求频率超过限制（HTTP 429）
- **认证失败**：API Key 无效或过期（HTTP 401）
- **模型不可用**：指定的模型不存在或已下架
- **输入过长**：提示词超出模型上下文限制
- **服务不可用**：LLM 服务端内部错误（HTTP 500）

```python
# LLM 调用错误示例
class LLMError(JojoCodeError):
    """LLM 调用错误"""
    pass

# 调用 LLM 时捕获错误
try:
    response = await llm.complete(prompt)
except Exception as e:
    if "429" in str(e):
        # 限流错误，可以重试
        raise LLMError("API 限流", hint="请稍后重试") from e
    elif "401" in str(e):
        # 认证错误，不可重试
        raise LLMError("API Key 无效", hint="请检查配置") from e
    else:
        raise
```

### 1.3 工具执行错误

Agent 通过工具与文件系统、Shell 命令等交互，工具执行可能失败：

- **文件不存在**：读取或编辑不存在的文件
- **权限不足**：没有执行操作的权限
- **命令执行失败**：Shell 命令返回非零退出码
- **超时**：命令执行时间过长
- **安全拦截**：安全检查拒绝执行

```python
# 工具执行错误
class ToolError(JojoCodeError):
    """工具执行错误"""
    pass

# 工具执行失败示例
def execute_tool(tool_name: str, args: dict) -> Any:
    # 安全检查
    result = permission_manager.check(tool_name, args)
    if result.denied:
        raise ToolError(
            f"工具 {tool_name} 执行被拒绝",
            hint=result.reason
        )
    
    # 执行工具
    try:
        return tool_registry.execute(tool_name, args)
    except FileNotFoundError as e:
        raise ToolError(f"文件不存在: {args.get('path')}") from e
    except PermissionError as e:
        raise ToolError("权限不足", hint=str(e)) from e
```

### 1.4 超时问题

Agent 的超时问题分为多个层次：

- **单次请求超时**：网络请求或工具执行超时
- **工具调用超时**：单个工具执行时间超过限制
- **Agent 回合超时**：单个 LLM 响应等待超时
- **会话超时**：整个 Agent 会话时长限制

```python
# 超时配置示例
@dataclass
class TimeoutConfig:
    """超时配置"""
    
    # 网络请求超时
    request_timeout: int = 30
    
    # 工具执行超时
    tool_timeout: int = 300
    
    # 重试配置
    retry_count: int = 3
    retry_delay: float = 1.0
```

## 2. 错误分类与处理策略

根据错误的不同特征，需要采用不同的处理策略。

### 2.1 可重试错误

以下错误适合重试：

- **网络超时**：网络暂时不稳定，重试可能成功
- **API 限流**：等待一段时间后重试，限流通常会解除
- **服务暂时不可用**：服务端暂时过载，重试可能恢复
- **连接断开**：网络波动导致，重试通常能恢复

```
┌─────────────────────────────────────────────────────────┐
│                    错误处理流程                          │
├─────────────────────────────────────────────────────────┤
│                                                         │
│   ┌──────────┐     是否可重试?    ┌──────────┐          │
│   │ 发生错误  │ ────────────────→  │   是     │          │
│   └──────────┘                   └────┬─────┘          │
│                                         │               │
│                              ┌───────────┴───────────┐  │
│                              ▼                       ▼  │
│                     ┌─────────────┐        ┌──────────┐│
│                     │ 重试次数    │        │  不可重试 ││
│                     │ < 最大值?   │        │  返回错误 ││
│                     └──────┬──────┘        └──────────┘│
│                            │                              │
│                    ┌───────┴───────┐                     │
│                    ▼               ▼                     │
│           ┌────────────┐  ┌─────────────┐              │
│           │  等待后重试 │  │  超过最大值  │              │
│           │ (指数退避)  │  │  返回错误    │              │
│           └────────────┘  └─────────────┘              │
└─────────────────────────────────────────────────────────┘
```

### 2.2 不可重试错误

以下错误不应重试，重试只会浪费资源：

- **认证失败**：API Key 无效，重试多少次都不会成功
- **权限不足**：没有权限，重试也不会获得权限
- **文件不存在**：文件不存在，重试也不会变存在
- **参数错误**：输入参数本身有问题
- **业务逻辑错误**：业务规则导致的失败

```python
# 判断错误是否可重试
def is_retryable(error: Exception) -> bool:
    """判断错误是否可重试"""
    
    # 不可重试的错误类型
    non_retryable = (
        AuthenticationError,
        PermissionError,
        FileNotFoundError,
        ValidationError,
    )
    
    if isinstance(error, non_retryable):
        return False
    
    # 特定错误码不可重试
    if isinstance(error, LLMError):
        if "401" in error.message or "403" in error.message:
            return False
    
    return True
```

### 2.3 优雅降级

当错���无��避免时，需要实现优雅降级，保证系统可用性：

- **功能降级**：关闭非核心功能，保留核心能力
- **数据降级**：使用缓存数据代替实时数据
- **服务降级**：切换到备用服务
- **返回默认值**：返回安全的默认值

```python
# 优雅降级示例
async def get_weather(location: str) -> dict:
    """获取天气信息
    
    降级策略：
    1. 优先请求实时 API
    2. 如果失败，使用缓存数据
    3. 如果没有缓存，返回默认值
    """
    
    try:
        # 尝试获取实时数据
        return await weather_api.get(location)
    except NetworkError:
        pass
    
    try:
        # 降级：尝试缓存数据
        cached = await cache.get(f"weather:{location}")
        if cached:
            return {"data": cached, "stale": True}
    except Exception:
        pass
    
    # 最终降级：返回默认值
    return {"data": {"temp": 0, "condition": "unknown"}, "fallback": True}
```

## 3. jojo-code 的异常体系

jojo-code 定义了一套统一的异常层次结构，便于错误分类和处理。

### 3.1 自定义异常基类

```python
# jojo-code/src/jojo_code/core/exceptions.py

class JojoCodeError(Exception):
    """基础异常类
    
    所有 jojo-code 异常的基类，提供统一的错误消息和提示格式。
    
    Attributes:
        message: 错误消息
        hint: 解决方案提示（可选）
    """
    
    def __init__(self, message: str, hint: str | None = None):
        self.message = message
        self.hint = hint
        super().__init__(self._format_message())
    
    def _format_message(self) -> str:
        """格式化错误消息"""
        if self.hint:
            return f"{self.message}\n提示: {self.hint}"
        return self.message
```

这个基类的设计特点：

- **统一的错误消息格式**：所有异常都遵循相同的格式
- **可选的提示信息**：提供解决方案提示
- **消息格式化**：自动在错误消息后添加提示

### 3.2 特定异常类型

```python
class ConfigError(JojoCodeError):
    """配置错误
    
    当配置缺失、无效或无法加载时抛出。
    """
    pass


class LLMError(JojoCodeError):
    """LLM 调用错误
    
    当 LLM API 调用失败时抛出。
    """
    pass


class ToolError(JojoCodeError):
    """工具执行错误
    
    当工具执行失败时抛出。
    """
    pass


class SecurityError(JojoCodeError):
    """安全错误
    
    当安全检查失败时抛出。
    """
    pass


class ValidationError(JojoCodeError):
    """验证错误
    
    当输入验证失败时抛出。
    """
    pass
```

这些特定异常类型使得错误处理更加精确：

```python
# 使用特定异常进行精确处理
try:
    result = await agent.execute(input)
except LLMError as e:
    # LLM 调用错误特殊处理
    if "rate limit" in e.message.lower():
        await handle_rate_limit(e)
    else:
        logger.error(f"LLM 调用失败: {e.message}")
except ToolError as e:
    # 工具执行错误特殊处理
    logger.error(f"工具执行失败: {e.message}")
    if e.hint:
        logger.info(f"提示: {e.hint}")
except JojoCodeError as e:
    # 其他 jojo-code 错误
    logger.error(f"错误: {e.message}")
```

### 3.3 错误传播机制

jojo-code 通过权限管理器实现错误传播和处理：

```python
# jojo-code/src/jojo_code/security/manager.py

class PermissionManager:
    """权限管理器
    
    协调所有权限守卫进���权���检查。
    支持权限模式和风险评估。
    """
    
    def check(self, tool_name: str, args: dict[str, Any]) -> PermissionResult:
        """检查工具调用权限
        
        根据权限模式和风险评估决定是否允许执行。
        
        Args:
            tool_name: 工具名称
            args: 工具参数
        
        Returns:
            权限检查结果
        """
        # 1. YOLO 模式直接放行
        if self._mode == PermissionMode.YOLO:
            return PermissionResult(PermissionLevel.ALLOW, tool_name, args)
        
        # 2. 检查调用次数限制
        if self._call_count >= self.config.max_tool_calls:
            return PermissionResult(
                PermissionLevel.DENY,
                tool_name,
                args,
                reason=f"已达到最大调用次数 {self.config.max_tool_calls}",
            )
        
        # 3. 运行守卫检查
        for guard in self.guards:
            result = guard.check(tool_name, args)
            
            # 记录审计日志
            if self.config.audit_log:
                self._log_call(tool_name, args, result)
            
            # 如果被拒绝，立即返回
            if result.denied:
                return result
        
        self._call_count += 1
        return final_result
```

### 3.4 风险评估与错误预防

```python
# jojo-code/src/jojo_code/security/risk.py

def assess_risk(tool_name: str, args: dict[str, Any]) -> str:
    """评估操作风险等级
    
    根据工具名称和参数评估操作的风险等级。
    
    Args:
        tool_name: 工具名称
        args: 工具参数
    
    Returns:
        风险等级: "low" | "medium" | "high" | "critical"
    """
    
    # 低风险工具：只读操作
    if tool_name in (
        "read_file",
        "list_directory",
        "grep_search",
        "glob_search",
    ):
        return "low"
    
    # Shell 命令工具 - 高风险
    if tool_name == "run_command":
        command = args.get("command", "")
        
        # 检查危险命令模式
        for level in ["critical", "high", "medium"]:
            patterns = _get_compiled_patterns(level)
            for pattern in patterns:
                if pattern.search(command):
                    return level
        
        return "low"
    
    # 默认中等风险
    return "medium"
```

通过风险评估，系统可以在执行前预防性地拒绝高风险操作：

```python
# 风险评估示例
risk = assess_risk("run_command", {"command": "rm -rf /"})
print(risk)  # "critical"

risk = assess_risk("read_file", {"path": "/tmp/test.txt"})
print(risk)  # "low"
```

## 4. 重试机制设计

有效的重试机制需要考虑多个因素：重试时机、退避策略、次数限制等。

### 4.1 指数退避算法

指数退避是一种常用的重试策略，每次重试等待时间按指数增长：

```python
import asyncio
import random

async def exponential_backoff(
    func: callable,
    max_retries: int = 3,
    base_delay: float = 1.0,
    max_delay: float = 60.0,
    jitter: bool = True,
) -> Any:
    """指数退避重试
    
    Args:
        func: 要执行的 async 函数
        max_retries: 最大重试次数
        base_delay: 基础延迟（秒）
        max_delay: 最大延迟（秒）
        jitter: 是否添加随机抖动
    
    Returns:
        func 的返回值
    
    Raises:
        最后一次尝试的错误
    """
    last_error = None
    
    for attempt in range(max_retries):
        try:
            return await func()
        except Exception as e:
            last_error = e
            
            # 判断是否可重试
            if not is_retryable(e):
                raise
            
            # 已经是最后一次尝试
            if attempt >= max_retries - 1:
                break
            
            # 计算延迟：base_delay * 2^attempt
            delay = min(base_delay * (2 ** attempt), max_delay)
            
            # 添加抖动，避免惊群效应
            if jitter:
                delay = delay * (0.5 + random.random())
            
            print(f"重试 {attempt + 1}/{max_retries}, 等待 {delay:.2f}秒...")
            await asyncio.sleep(delay)
    
    raise last_error
```

```
┌─────────────────────────────────────────────────────────┐
│               指数退避时间增长示意                         │
├─────────────────────────────────────────────────────────┤
│                                                         │
│  重试次数    基础延迟      添加抖动后                     │
│  ────────  ──────────   ─────────────────               │
│     1        1s        0.5s ~ 1.0s                     │
│     2        2s        1.0s ~ 2.0s                       │
│     3        4s        2.0s ~ 4.0s                       │
│     4        8s        4.0s ~ 8.0s                      │
│     5       16s        8.0s ~ 16.0s                     │
│                                                         │
│  实际延迟曲线：                                         │
│                                                         │
│   秒                                                      │
│    │                                                      │
│ 16 │                         ╱                           │
│    │                        ╱                            │
│  8 │                      ╱                              │
│    │                    ╱                                │
│  4 │                  ╱                                 │
│    │                ╱                                   │
│  2 │              ╱                                      │
│    │            ╱                                        │
│  1 │───────────                                         │
│    └────────────┬────┬────┬────┬────→ 尝试次数         │
│                 1    2    3    4                        │
└─────────────────────────────────────────────────────────┘
```

### 4.2 最大重试次数限制

无限制的重试会导致资源耗尽，必须设置最大重试次数：

```python
from dataclasses import dataclass
from typing import Any
from enum import Enum

class RetryStrategy(Enum):
    """重试策略"""
    FIXED = "fixed"           # 固定间隔
    LINEAR =linear"          # 线性增长
    EXPONENTIAL = "exponential"  # 指数增长
    FIBONACCI = "fibonacci"   # 斐波那契增长

@dataclass
class RetryConfig:
    """重试配置"""
    
    # 最大重试次数
    max_retries: int = 3
    
    # 基础延迟（秒）
    base_delay: float = 1.0
    
    # 最大延迟（秒）
    max_delay: float = 60.0
    
    # 重试策略
    strategy: RetryStrategy = RetryStrategy.EXPONENTIAL
    
    # 是否添加抖动
    jitter: bool = True
    
    # 可重试的错误类型
    retryable_errors: tuple = (TimeoutError, ConnectionError)
```

### 4.3 熔断器模式

熔断器可以防止连续失败导致的级联故障：

```python
import time
from enum import Enum
from dataclasses import dataclass, field

class CircuitState(Enum):
    """熔断器状态"""
    CLOSED = "closed"     # 正常 - 允许请求
    OPEN = "open"         # 打开 - 拒绝请求，快速失败
    HALF_OPEN = "half_open"  # 半开 - 测试是否恢复

@dataclass
class CircuitBreaker:
    """熔断器
    
    防止连续失败导致的级联故障。
    在打开状态下快速失败，在半开状态下测试恢复。
    """
    
    # 失败阈值 - 连续失败次数达到此值时打开
    failure_threshold: int = 5
    
    # 恢复超时 - 经过此时间后尝试半开
    recovery_timeout: int = 60
    
    # 成功率阈值 - 半开状态下成功率需达到此比例
    success_threshold: float = 0.5
    
    # 状态
    state: CircuitState = CircuitState.CLOSED
    
    # 连续失败计数
    _failure_count: int = 0
    
    # 连续成功计数
    _success_count: int = 0
    
    # 上次打开时间
    _last_open_time: float = field(default_factory=time.time)
    
    def call(self, func: callable, *args, **kwargs) -> Any:
        """执行函数，带熔断保护"""
        
        # 检查状态
        if self.state == CircuitState.OPEN:
            # 检查是否应该进入半开状态
            if time.time() - self._last_open_time >= self.recovery_timeout:
                self.state = CircuitState.HALF_OPEN
                self._success_count = 0
            else:
                raise CircuitBreakerOpenError("熔断器打开，拒绝请求")
        
        try:
            result = func(*args, **kwargs)
            self._on_success()
            return result
        except Exception as e:
            self._on_failure()
            raise
    
    def _on_success(self) -> None:
        """成功后处理"""
        if self.state == CircuitState.HALF_OPEN:
            self._success_count += 1
            if self._success_count >= 2:  # 连续成功
                self.state = CircuitState.CLOSED
                self._failure_count = 0
        else:
            self._failure_count = 0
    
    def _on_failure(self) -> None:
        """失败后处理"""
        self._failure_count += 1
        
        if self.state == CircuitState.HALF_OPEN:
            # 半开状态下失败，重新打开
            self.state = CircuitState.OPEN
            self._last_open_time = time.time()
        elif self._failure_count >= self.failure_threshold:
            # 达到阈值，打开熔断器
            self.state = CircuitState.OPEN
            self._last_open_time = time.time()


class CircuitBreakerOpenError(Exception):
    """熔断器打开错误"""
    pass
```

```
┌─────────────────────────────────────────────────────────┐
│                    熔断器状态机                            │
├─────────────────────────────────────────────────────────┤
│                                                         │
│    ┌──────────┐    失败次数≥5     ┌──────────┐          │
│    │ CLOSED   │ ────────────────→ │   OPEN   │          │
│    │ (正常)   │                   │ (打开)   │          │
│    └────┬─────┘                   └────┬─────┘          │
│         │成功                         │                 │
│         │                     ┌────────┴────────┐     │
│         │                     │ recovery_timeout │     │
│         │                     │     (60秒)       │     │
│         │                     ▼                  │     │
│         │              ┌──────────────┐           │     │
│         │              │  HALF_OPEN   │           │     │
│         │              │   (半开)     │←─────────┘     │
│         │              └───────┬──────┘                 │
│         │              成功×2 → │                          │
│         └──────────────────────┘                           │
│                    (失败)                                  │
└─────────────────────────────────────────────────────────┘
```

### 4.4 Webhook 重试实现

jojo-code 的 Webhook 模块实现了完整的重试机制：

```python
# jojo-code/src/jojo_code/core/webhook.py

@dataclass
class WebhookConfig:
    """Webhook 配置"""
    
    url: str
    secret: str | None = None
    timeout: int = 30
    
    # 重试配置
    retry_count: int = 3
    retry_delay: float = 1.0
    
    enabled: bool = True

async def _deliver(
    self, name: str, config: WebhookConfig, event: WebhookEvent
) -> dict[str, Any]:
    """投递事件到 Webhook"""
    payload = self._build_payload(event)
    
    # 添加签名
    if config.secret:
        payload["signature"] = self._sign(payload, config.secret)
    
    # 发送请求，带重试
    last_error = None
    for attempt in range(config.retry_count):
        try:
            async with aiohttp.ClientSession() as session:
                async with session.post(
                    config.url,
                    json=payload,
                    timeout=aiohttp.ClientTimeout(total=config.timeout),
                ) as response:
                    if response.status < 400:
                        return {
                            "webhook": name,
                            "success": True,
                            "status": response.status,
                            "attempt": attempt + 1,
                        }
                    else:
                        last_error = f"HTTP {response.status}"
        except TimeoutError:
            last_error = "Timeout"
        except Exception as e:
            last_error = str(e)
        
        # 等待后重试（指数退避）
        if attempt < config.retry_count - 1:
            await asyncio.sleep(config.retry_delay * (attempt + 1))
    
    # 所有重试都失败
    return {
        "webhook": name,
        "success": False,
        "error": last_error,
        "attempt": config.retry_count,
    }
```

## 5. 代码示例和最佳实践

### 5.1 完整的 Agent 重试装饰器

```python
import asyncio
import functools
import logging
from typing import TypeVar, Callable, Any

T = TypeVar('T')

logger = logging.getLogger(__name__)

def with_retry(
    max_retries: int = 3,
    base_delay: float = 1.0,
    max_delay: float = 30.0,
    exponential: bool = True,
    jitter: bool = True,
    retryable_exceptions: tuple = (TimeoutError, ConnectionError),
):
    """重试装饰器
    
    Args:
        max_retries: 最大重���次���
        base_delay: 基础延迟（秒）
        max_delay: 最大延迟（秒）
        exponential: 是否使用指数退避
        jitter: 是否添加随机抖动
        retryable_exceptions: 可重试的异常类型
    """
    def decorator(func: Callable[..., T]) -> Callable[..., T]:
        @functools.wraps(func)
        async def wrapper(*args, **kwargs) -> T:
            last_error = None
            
            for attempt in range(max_retries):
                try:
                    return await func(*args, **kwargs)
                except retryable_exceptions as e:
                    last_error = e
                    
                    # 已经是最后一次尝试
                    if attempt >= max_retries - 1:
                        break
                    
                    # 计算延迟
                    if exponential:
                        delay = min(base_delay * (2 ** attempt), max_delay)
                    else:
                        delay = base_delay
                    
                    # 添加抖动
                    if jitter:
                        import random
                        delay = delay * (0.5 + random.random() * 0.5)
                    
                    logger.warning(
                        f"{func.__name__} 失败 ({attempt + 1}/{max_retries}): {e}, "
                        f"{delay:.2f}秒后重试"
                    )
                    await asyncio.sleep(delay)
            
            logger.error(f"{func.__name__} 所有重试失败")
            raise last_error
        
        return wrapper
    return decorator


# 使用示例
class Agent:
    @with_retry(max_retries=3, base_delay=1.0)
    async def call_llm(self, prompt: str) -> str:
        """调用 LLM，带重试"""
        return await self.llm.complete(prompt)
    
    @with_retry(max_retries=5, base_delay=0.5, exponential=False)
    async def fetch_data(self, url: str) -> dict:
        """获取数据，带重试"""
        return await self.http.get(url)
```

### 5.2 错误处理上下文管理器

```python
from contextlib import contextmanager
from typing import Generator, Any

class ErrorContext:
    """错误处理上下文"""
    
    def __init__(self, operation: str):
        self.operation = operation
        self.error: Exception | None = None
        self.attempts: int = 0
    
    def __enter__(self) -> "ErrorContext":
        self.attempts += 1
        return self
    
    def __exit__(self, exc_type, exc_val, exc_tb) -> bool:
        if exc_val is not None:
            self.error = exc_val
            return False  # 不吞下异常
        return True

@contextmanager
def error_handling(operation: str) -> Generator[ErrorContext, None, None]:
    """错误处理上下文管理器
    
    Usage:
        with error_handling("调用 LLM") as ctx:
            result = await llm.call(prompt)
            if ctx.attempts > 1:
                logger.info(f"重试 {ctx.attempts} 次后成功")
    """
    ctx = ErrorContext(operation)
    try:
        yield ctx
    except Exception as e:
        ctx.error = e
        raise
```

### 5.3 带超时的工具执行

```python
import asyncio
from typing import Any
from concurrent.futures import TimeoutError as FutureTimeoutError

async def run_with_timeout(
    coro: Any,
    timeout: float,
    default: Any = None,
) -> Any:
    """带超时执行协程
    
    Args:
        coro: 协程
        timeout: 超时时间（秒）
        超时后返回值
    
    Returns:
        协程结果或默认值
    """
    try:
        return await asyncio.wait_for(coro, timeout=timeout)
    except asyncio.TimeoutError:
        return default

# 使用示例
async def execute_agent_task(task: str) -> str:
    """执行 Agent 任务，带超时保护"""
    
    # LLM 调用超时 30 秒
    response = await run_with_timeout(
        llm.complete(task),
        timeout=30.0,
        default="[LLM 调用超时]"
    )
    
    # 工具执行超时 60 秒
    tool_result = await run_with_timeout(
        execute_tools(response),
        timeout=60.0,
        default={"error": "工具执行超时"}
    )
    
    return response
```

### 5.4 最佳实践总结

```
┌─────────────────────────────────────────────────────────┐
│                Agent 错误处理最佳实践                        │
├─────────────────────────────────────────────────────────┤
│                                                         │
│  1. 分层错误处理                                        │
│     ├─ 顶层：全局异常捕获、记录日志                         │
│     ├─ 中层：业务逻辑错误处理                             │
│     └─ 底层：具体操作错误处理                            │
│                                                         │
│  2. 明确的错误分类                                      │
│     ├─ 可重试：网络超时、限流、服务不可用                  │
│     └─ 不可重试：认证、权限、参数错误                     │
│                                                         │
│  3. 合理的重试策略                                      │
│     ├─ 指数退避：避免连续冲击                            │
│     ├─ 添加抖动：避免惊群效应                           │
│     └─ 设置上限：防止无限重试                            │
│                                                         │
│  4. 优雅降级                                           │
│     ├─ 功能降级：关闭非核心功能                           │
│     ├─ 数据降级：使用缓存数据                          │
│     └─ 返回默认值：保证系统可用                        │
│                                                         │
│  5. 监控和告警                                          │
│     ├─ 记录错误率、错误类型                            │
│     ├─ 熔断器状态监控                                  │
│     └─ 异常告警及时响应                                │
│                                                         │
│  6. 测试覆盖                                            │
│     ├─ 单元测试：异常类、错误处理逻辑                   │
│     ├─ 集成测试：重试机制、熔断器                        │
│     └─ 混沌测试：网络中断、服务超时                      │
└─────────────────────────────────────────────────────────┘
```

## 结语

错误处理与重试机制是 Agent 系统稳定性的基石。通过 jojo-code 的源码分析，我们可以看到一个完善的错误处理体系包括：清晰的异常层次结构、智能的错误分类、指数退避的重试策略、保护性的熔断器设计，以及多层次的优雅降级能力。在实际开发中，需要根据具体场景选择合适的策略组合，并配合完善的监控告警系统，才能构建真正可靠的 Agent 应用。