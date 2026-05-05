---
sidebar_position: 1
title: 多 LLM API 统一接入
slug: multi-llm-api-integration
---

# 多 LLM API 统一接入

> 项目初期用的 OpenAI，后来客户要求用 DeepSeek（成本低），再后来又要接 Claude（长文本能力强）。每次接一个新的 LLM 都要改一遍代码，改了三个月我忍不了了——必须搞一个统一的接入层，让业务代码和具体 LLM 解耦。

## 一、为什么要统一接入

```
没有统一接入层：
  业务代码 → OpenAI SDK → OpenAI API
  业务代码 → Anthropic SDK → Claude API
  业务代码 → OpenAI 兼容接口 → DeepSeek API
  业务代码 → OpenAI 兼容接口 → Qwen API

  每个 LLM 的 SDK 不同、参数不同、返回格式不同
  切换模型 = 改一堆代码

有统一接入层：
  业务代码 → LLM Gateway → OpenAI / Claude / DeepSeek / Qwen

  业务代码只依赖 Gateway，切换模型零改动
```

## 二、主流 LLM API 对比

### 2.1 一览表

| 特性 | OpenAI | Claude | DeepSeek | Qwen (通义) | 文心一言 |
|------|--------|--------|----------|------------|---------|
| **主力模型** | GPT-4o / o1 | Claude Opus 4.7 / Sonnet 4.6 | DeepSeek-V3 / R1 | Qwen-Max / Qwen-Plus | ERNIE 4.0 |
| **上下文窗口** | 128K / 1M | 200K | 64K / 128K | 128K / 1M | 128K |
| **中文能力** | ★★★★☆ | ★★★☆☆ | ★★★★★ | ★★★★★ | ★★★★☆ |
| **代码能力** | ★★★★★ | ★★★★★ | ★★★★☆ | ★★★★☆ | ★★★☆☆ |
| **价格 (输入/1M)** | $2.5-5 | $3-15 | ¥1-2 | ¥2-20 | ¥8-12 |
| **价格 (输出/1M)** | $10-15 | $15-75 | ¥2-8 | ¥6-60 | ¥24-36 |
| **Function Calling** | ✅ | ✅ | ✅ | ✅ | ✅ |
| **流式输出** | ✅ | ✅ | ✅ | ✅ | ✅ |
| **视觉理解** | ✅ | ✅ | ✅ | ✅ | ✅ |
| **国内可直连** | ❌ | ❌ | ✅ | ✅ | ✅ |

### 2.2 选型建议

```
你的场景是什么？
│
├── 追求最强能力 → Claude Opus 4.7 / GPT-4o
│
├── 追求性价比 → DeepSeek-V3（国内最便宜）
│
├── 国内合规 + 中文场景 → Qwen-Max / 文心一言
│
├── 长文本处理 → Claude（200K）/ Qwen（1M）
│
├── 代码生成 → Claude Sonnet 4.6 / GPT-4o
│
└── 全场景通用 → GPT-4o（综合能力最均衡）
```

## 三、统一接入层实现

### 3.1 基础架构

```python
from abc import ABC, abstractmethod
from dataclasses import dataclass
from typing import List, Optional, AsyncIterator
import httpx

@dataclass
class LLMMessage:
    role: str  # "system" / "user" / "assistant"
    content: str

@dataclass
class LLMResponse:
    content: str
    model: str
    usage: dict  # {"prompt_tokens": 100, "completion_tokens": 50}
    finish_reason: str

class BaseLLMProvider(ABC):
    """LLM 提供者基类"""

    @abstractmethod
    async def chat(
        self,
        messages: List[LLMMessage],
        model: str,
        temperature: float = 0.7,
        max_tokens: Optional[int] = None,
    ) -> LLMResponse:
        pass

    @abstractmethod
    async def chat_stream(
        self,
        messages: List[LLMMessage],
        model: str,
        temperature: float = 0.7,
    ) -> AsyncIterator[str]:
        pass
```

### 3.2 OpenAI 提供者

```python
from openai import AsyncOpenAI

class OpenAIProvider(BaseLLMProvider):
    def __init__(self, api_key: str, base_url: str = None):
        self.client = AsyncOpenAI(api_key=api_key, base_url=base_url)

    async def chat(self, messages, model="gpt-4o", temperature=0.7, max_tokens=None):
        response = await self.client.chat.completions.create(
            model=model,
            messages=[{"role": m.role, "content": m.content} for m in messages],
            temperature=temperature,
            max_tokens=max_tokens,
        )
        return LLMResponse(
            content=response.choices[0].message.content,
            model=response.model,
            usage={
                "prompt_tokens": response.usage.prompt_tokens,
                "completion_tokens": response.usage.completion_tokens,
            },
            finish_reason=response.choices[0].finish_reason,
        )

    async def chat_stream(self, messages, model="gpt-4o", temperature=0.7):
        stream = await self.client.chat.completions.create(
            model=model,
            messages=[{"role": m.role, "content": m.content} for m in messages],
            temperature=temperature,
            stream=True,
        )
        async for chunk in stream:
            if chunk.choices[0].delta.content:
                yield chunk.choices[0].delta.content
```

### 3.3 Claude 提供者

```python
import anthropic

class ClaudeProvider(BaseLLMProvider):
    def __init__(self, api_key: str):
        self.client = anthropic.AsyncAnthropic(api_key=api_key)

    async def chat(self, messages, model="claude-sonnet-4-6-20250514", temperature=0.7, max_tokens=None):
        # Claude 的 system 消息需要单独传
        system_msg = ""
        chat_messages = []
        for m in messages:
            if m.role == "system":
                system_msg = m.content
            else:
                chat_messages.append({"role": m.role, "content": m.content})

        response = await self.client.messages.create(
            model=model,
            max_tokens=max_tokens or 4096,
            system=system_msg,
            messages=chat_messages,
            temperature=temperature,
        )
        return LLMResponse(
            content=response.content[0].text,
            model=response.model,
            usage={
                "prompt_tokens": response.usage.input_tokens,
                "completion_tokens": response.usage.output_tokens,
            },
            finish_reason=response.stop_reason,
        )

    async def chat_stream(self, messages, model="claude-sonnet-4-6-20250514", temperature=0.7):
        system_msg = ""
        chat_messages = []
        for m in messages:
            if m.role == "system":
                system_msg = m.content
            else:
                chat_messages.append({"role": m.role, "content": m.content})

        async with self.client.messages.stream(
            model=model, max_tokens=4096, system=system_msg,
            messages=chat_messages, temperature=temperature,
        ) as stream:
            async for text in stream.text_stream:
                yield text
```

### 3.4 统一 Gateway

```python
class LLMGateway:
    """统一 LLM 网关"""

    def __init__(self):
        self.providers = {}
        self.default_provider = None

    def register(self, name: str, provider: BaseLLMProvider, default: bool = False):
        self.providers[name] = provider
        if default:
            self.default_provider = name

    def get_provider(self, name: str = None) -> BaseLLMProvider:
        name = name or self.default_provider
        if name not in self.providers:
            raise ValueError(f"Provider {name} not registered")
        return self.providers[name]

    async def chat(self, messages, model=None, provider=None, **kwargs):
        p = self.get_provider(provider)
        return await p.chat(messages, model=model, **kwargs)

    async def chat_stream(self, messages, model=None, provider=None, **kwargs):
        p = self.get_provider(provider)
        async for chunk in p.chat_stream(messages, model=model, **kwargs):
            yield chunk

# 使用
gateway = LLMGateway()
gateway.register("openai", OpenAIProvider(api_key="sk-xxx"), default=True)
gateway.register("claude", ClaudeProvider(api_key="sk-ant-xxx"))
gateway.register("deepseek", OpenAIProvider(
    api_key="sk-xxx",
    base_url="https://api.deepseek.com/v1",
))

# 一行切换模型
response = await gateway.chat(
    messages=[LLMMessage(role="user", content="你好")],
    provider="deepseek",
    model="deepseek-chat",
)
```

## 四、OpenAI 兼容接口

DeepSeek、Qwen、Moonshot 等国产模型都提供 OpenAI 兼容接口，这意味着用 OpenAI SDK 就能直接调用：

```python
# DeepSeek — 只需要改 base_url
deepseek = AsyncOpenAI(
    api_key="sk-xxx",
    base_url="https://api.deepseek.com/v1",
)

# Qwen (通义千问)
qwen = AsyncOpenAI(
    api_key="sk-xxx",
    base_url="https://dashscope.aliyuncs.com/compatible-mode/v1",
)

# Moonshot (月之暗面)
moonshot = AsyncOpenAI(
    api_key="sk-xxx",
    base_url="https://api.moonshot.cn/v1",
)

# SiliconFlow (硅基流动)
siliconflow = AsyncOpenAI(
    api_key="sk-xxx",
    base_url="https://api.siliconflow.cn/v1",
)

# 调用方式完全一样
for client in [deepseek, qwen, moonshot]:
    response = await client.chat.completions.create(
        model="their-model-name",
        messages=[{"role": "user", "content": "你好"}],
    )
```

## 五、Token 计费对比

以 100 万 Token（输入 50 万 + 输出 50 万）为例：

| 模型 | 输入成本 | 输出成本 | 总成本 | 备注 |
|------|---------|---------|--------|------|
| GPT-4o | $1.25 | $5.00 | $6.25 | 综合能力强 |
| Claude Sonnet 4.6 | $1.50 | $7.50 | $9.00 | 长文本强 |
| DeepSeek-V3 | ¥0.50 | ¥2.00 | ¥2.50 | 国内最便宜 |
| Qwen-Max | ¥2.00 | ¥6.00 | ¥8.00 | 中文最优 |
| 文心一言 4.0 | ¥4.00 | ¥12.00 | ¥16.00 | 百度生态 |

**成本优化策略**：
- 日常用便宜模型（DeepSeek/Qwen），关键场景用强模型（GPT-4o/Claude）
- 用模型路由策略，根据任务类型自动选择最优模型

## 六、踩坑记录

### 坑 1：不同模型的 System Message 处理不同

**问题**：OpenAI 的 system 消息直接放在 messages 数组里，Claude 的 system 消息需要单独传 `system` 参数。

**解决**：在 Gateway 层统一处理，对 Claude 提供者做特殊转换：
```python
# 统一格式
messages = [
    LLMMessage(role="system", content="你是一个助手"),
    LLMMessage(role="user", content="你好"),
]

# Claude 提供者内部自动拆分 system 和 chat messages
```

### 坑 2：国产模型的 Function Calling 格式差异

**问题**：DeepSeek 的 Function Calling 参数格式和 OpenAI 略有不同（`tools` vs `functions`）。

**解决**：在 Gateway 层做格式适配，或者用各模型的最新 SDK（大部分已兼容 OpenAI 格式）。

### 坑 3：API Key 安全

**问题**：API Key 硬编码在代码里，提交到 Git 后泄露。

**解决**：用环境变量 + `.env` 文件，不要提交 `.env`：
```python
import os
from dotenv import load_dotenv

load_dotenv()
api_key = os.getenv("OPENAI_API_KEY")
```

### 坑 4：并发限制

**问题**：DeepSeek 免费版限制 10 QPS，并发高了直接 429。

**解决**：实现请求队列 + 重试机制：
```python
import asyncio
from tenacity import retry, stop_after_attempt, wait_exponential

@retry(stop=stop_after_attempt(3), wait=wait_exponential(min=1, max=10))
async def safe_call(provider, messages, **kwargs):
    try:
        return await provider.chat(messages, **kwargs)
    except RateLimitError:
        await asyncio.sleep(2)
        raise
```

### 坑 5：流式输出的编码问题

**问题**：国产模型的流式输出返回的中文可能是 UTF-8 编码，在某些环境下会乱码。

**解决**：确保 HTTP 客户端使用 UTF-8 编码，或者在解析 chunk 时显式 decode：
```python
content = chunk.choices[0].delta.content
if isinstance(content, bytes):
    content = content.decode("utf-8")
```

## 八、参考资料

- OpenAI API 文档：https://platform.openai.com/docs
- Anthropic API 文档：https://docs.anthropic.com/
- DeepSeek API 文档：https://platform.deepseek.com/api-docs
- Qwen API 文档：https://help.aliyun.com/zh/model-studio/
- LangChain LLM 集成：https://python.langchain.com/docs/integrations/llms/
