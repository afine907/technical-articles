# Agent 崩了怎么办？错误处理与重试

你有没有遇到过这种情况：

Agent 跑着跑着突然报错"API rate limit exceeded"，然后整个对话就崩了。用户辛辛苦苦聊了50轮，全没了。

我之前做过一个 Agent，没有错误处理，一崩溃就整个挂掉。后来加了错误处理和重试机制，稳定性提升了一个数量级。

这篇文章，我来分享怎么让 Agent 更健壮。

## Agent 常见的三类错误

### 1. LLM API 错误

最常见：Rate Limit、超时、服务不可用。

```python
openai.error.RateLimitError: Rate limit exceeded
openai.error.APIConnectionError: Connection timeout
openai.error.ServiceUnavailableError: Service unavailable
```

### 2. 工具执行错误

工具调用失败，比如文件不存在、权限不足。

```python
FileNotFoundError: [Errno 2] No such file or directory
PermissionError: [Errno 13] Permission denied
```

### 3. 状态错误

状态数据损坏或格式不对。

```python
KeyError: 'messages'
TypeError: 'NoneType' object is not subscriptable
```

## 错误处理策略

### 策略一：重试（Retry）

对于临时性错误（Rate Limit、网络问题），重试通常能解决。

```python
import time
from functools import wraps

def retry(max_attempts=3, delay=1):
    def decorator(func):
        @wraps(func)
        def wrapper(*args, **kwargs):
            for attempt in range(max_attempts):
                try:
                    return func(*args, **kwargs)
                except Exception as e:
                    if attempt == max_attempts - 1:
                        raise
                    time.sleep(delay * (2 ** attempt))  # 指数退避
            return None
        return wrapper
    return decorator

@retry(max_attempts=3, delay=1)
def call_llm(messages):
    return llm.invoke(messages)
```

关键点：**指数退避**。第一次等1秒，第二次等2秒，第三次等4秒。避免频繁重试把 API 打爆。

### 策略二：降级（Fallback）

如果主模型不可用，切换到备用模型。

```python
def call_llm_with_fallback(messages):
    models = ["gpt-4", "gpt-3.5-turbo", "claude-3"]
    
    for model in models:
        try:
            return llm.invoke(messages, model=model)
        except Exception as e:
            print(f"{model} 失败: {e}")
            continue
    
    raise Exception("所有模型都不可用")
```

### 策略三：工具错误隔离

工具执行失败，不应该让整个 Agent 崩掉。

```python
def execute_tool_safely(tool_name: str, args: dict) -> str:
    try:
        result = tools[tool_name](**args)
        return str(result)
    except FileNotFoundError:
        return "错误：文件不存在"
    except PermissionError:
        return "错误：没有权限"
    except Exception as e:
        return f"工具执行失败：{str(e)}"
```

这样，工具失败会返回错误信息，Agent 可以根据错误调整策略，而不是直接崩溃。

## 完整示例

```python
import time
from typing import Any

class RobustAgent:
    def __init__(self, max_retries=3):
        self.max_retries = max_retries
    
    def call_llm(self, messages: list) -> Any:
        """带重试的 LLM 调用"""
        for attempt in range(self.max_retries):
            try:
                return self.llm.invoke(messages)
            except Exception as e:
                if attempt == self.max_retries - 1:
                    raise
                wait = 2 ** attempt
                print(f"LLM 调用失败，{wait}秒后重试...")
                time.sleep(wait)
    
    def execute_tool(self, name: str, args: dict) -> str:
        """带错误处理的工具执行"""
        try:
            return self.tools[name](**args)
        except FileNotFoundError:
            return "文件不存在，请检查路径"
        except Exception as e:
            return f"执行失败：{str(e)}"
    
    def run(self, message: str) -> str:
        """带保护的运行"""
        try:
            state = self.create_state(message)
            result = self.graph.invoke(state)
            return result
        except Exception as e:
            return f"Agent 运行出错：{str(e)}。请稍后重试。"
```

## 我踩过的坑

**坑一：重试太频繁**

Rate Limit 错误后，我立刻重试，结果把 API 配额用完了。

解决：用指数退避，等的时间越来越长。

**坑二：没有区分错误类型**

有些错误（比如用户输入无效）不应该重试，但我对所有错误都重试了，浪费时间。

解决：区分可恢复错误和不可恢复错误。

```python
if isinstance(e, RateLimitError):
    retry()  # 可恢复
elif isinstance(e, InvalidRequestError):
    raise   # 不可恢复，直接报错
```

**坑三：错误信息暴露敏感信息**

工具报错时，直接把堆栈信息返回给用户，里面可能有路径、密钥等敏感信息。

解决：返回友好的错误信息，详细日志只记录到服务器。

```python
except Exception as e:
    log_error(e)  # 记录详细日志
    return "操作失败，请稍后重试"  # 用户友好的信息
```

## 下一步行动

1. **检查你的 Agent**：看看有哪些地方可能出错
2. **加上重试**：至少对 LLM 调用加重试
3. **工具错误隔离**：工具失败不应该导致 Agent 崩溃

---

记住一点：Agent 是生产系统，必须能处理错误。用户不会因为 Agent 崩了而怪 LLM，只会怪你的产品。
