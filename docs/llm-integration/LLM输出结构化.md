---
sidebar_position: 3
title: LLM 输出结构化
slug: llm-structured-output
---

# LLM 输出结构化

> Agent 需要调用工具时，LLM 必须返回合法的 JSON——函数名、参数类型、参数值，一个字符都不能错。我最初用正则表达式从 LLM 输出中提取 JSON，结果 30% 的情况会解析失败。后来发现了 Structured Output 和 Function Calling，才真正解决了这个问题。

## 一、为什么需要结构化输出

LLM 的原生输出是自由文本，但 Agent 系统需要机器可读的结构化数据：

```
自由文本输出：
  "我觉得天气不错，温度大约 25 度，适合出门"  -- 人类能理解，机器无法解析

结构化输出：
  {
    "temperature": 25,
    "condition": "sunny",
    "recommendation": "适合出门"
  }  -- 机器直接可用
```

## 二、三种结构化输出方式

### 2.1 JSON Mode（OpenAI）

强制 LLM 输出合法 JSON，但不保证格式符合你的 Schema：

```python
from openai import OpenAI

client = OpenAI()

response = client.chat.completions.create(
    model="gpt-4o",
    messages=[{"role": "user", "content": "列出 3 种编程语言及其特点"}],
    response_format={"type": "json_object"},  # 开启 JSON Mode
)

# 保证输出是合法 JSON，但字段名不确定
import json
data = json.loads(response.choices[0].message.content)
# {"languages": [{"name": "Python", "feature": "简洁"}, ...]}
```

**优点**：输出一定是合法 JSON
**缺点**：不保证字段名和类型，需要额外校验

### 2.2 Structured Outputs（OpenAI / Claude）

严格保证输出符合你定义的 JSON Schema：

```python
from pydantic import BaseModel
from openai import OpenAI

class CalendarEvent(BaseModel):
    name: str
    date: str
    participants: list[str]

client = OpenAI()

completion = client.beta.chat.completions.parse(
    model="gpt-4o",
    messages=[
        {"role": "system", "content": "提取事件信息"},
        {"role": "user", "content": "下周三和张三、李四开会讨论产品需求"},
    ],
    response_format=CalendarEvent,
)

event = completion.choices[0].message.parsed
# CalendarEvent(name='产品需求讨论', date='下周三', participants=['张三', '李四'])
```

**Claude 的实现**：
```python
import anthropic
from pydantic import BaseModel

client = anthropic.Anthropic()

class EventInfo(BaseModel):
    name: str
    date: str
    participants: list[str]

message = client.messages.create(
    model="claude-sonnet-4-6-20250514",
    max_tokens=1024,
    messages=[{"role": "user", "content": "下周三和张三、李四开会讨论产品需求"}],
    tools=[{
        "name": "extract_event",
        "description": "提取事件信息",
        "input_schema": EventInfo.model_json_schema(),
    }],
)

# 解析工具调用结果
import json
event_data = json.loads(message.content[0].input)
```

**优点**：输出 100% 符合 Schema，类型安全
**缺点**：Schema 复杂时可能影响输出质量

### 2.3 Function Calling（通用）

让 LLM 决定调用哪个函数，并生成函数参数：

```python
tools = [
    {
        "type": "function",
        "function": {
            "name": "get_weather",
            "description": "获取指定城市的天气信息",
            "parameters": {
                "type": "object",
                "properties": {
                    "city": {
                        "type": "string",
                        "description": "城市名称，如 '北京'",
                    },
                    "unit": {
                        "type": "string",
                        "enum": ["celsius", "fahrenheit"],
                        "description": "温度单位",
                    },
                },
                "required": ["city"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "search_flights",
            "description": "搜索航班信息",
            "parameters": {
                "type": "object",
                "properties": {
                    "origin": {"type": "string", "description": "出发城市"},
                    "destination": {"type": "string", "description": "到达城市"},
                    "date": {"type": "string", "description": "出发日期，格式 YYYY-MM-DD"},
                },
                "required": ["origin", "destination", "date"],
            },
        },
    },
]

response = client.chat.completions.create(
    model="gpt-4o",
    messages=[{"role": "user", "content": "北京今天天气怎么样？"}],
    tools=tools,
    tool_choice="auto",
)

# 模型决定调用 get_weather 函数
tool_call = response.choices[0].message.tool_calls[0]
print(tool_call.function.name)  # "get_weather"
print(tool_call.function.arguments)  # '{"city": "北京", "unit": "celsius"}'
```

## 三、Schema 设计最佳实践

### 3.1 描述要精确

```python
# 不好的 Schema
{
    "type": "object",
    "properties": {
        "info": {"type": "string"},  # "info" 太模糊
        "data": {"type": "array"},   # "data" 不知道存什么
    },
}

# 好的 Schema
{
    "type": "object",
    "properties": {
        "summary": {
            "type": "string",
            "description": "用户评论的一句话总结，不超过 20 字",
        },
        "sentiment": {
            "type": "string",
            "enum": ["positive", "negative", "neutral"],
            "description": "情感倾向",
        },
        "keywords": {
            "type": "array",
            "items": {"type": "string"},
            "description": "提取 3-5 个关键词",
        },
    },
    "required": ["summary", "sentiment", "keywords"],
}
```

### 3.2 用 enum 约束取值范围

```python
# 让模型只能返回预定义的值
{
    "type": "object",
    "properties": {
        "priority": {
            "type": "string",
            "enum": ["low", "medium", "high", "urgent"],
            "description": "任务优先级",
        },
        "status": {
            "type": "string",
            "enum": ["pending", "in_progress", "completed", "blocked"],
            "description": "任务状态",
        },
    },
}
```

### 3.3 嵌套结构

```python
# 复杂的嵌套 Schema
{
    "type": "object",
    "properties": {
        "analysis": {
            "type": "object",
            "properties": {
                "main_topic": {"type": "string"},
                "sub_topics": {
                    "type": "array",
                    "items": {
                        "type": "object",
                        "properties": {
                            "name": {"type": "string"},
                            "relevance": {"type": "number", "minimum": 0, "maximum": 1},
                        },
                    },
                },
            },
        },
        "action_items": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "task": {"type": "string"},
                    "assignee": {"type": "string"},
                    "deadline": {"type": "string"},
                },
            },
        },
    },
}
```

## 四、Pydantic 模型定义（推荐）

用 Pydantic 定义 Schema，然后自动生成 JSON Schema：

```python
from pydantic import BaseModel, Field
from typing import Optional, List
from enum import Enum

class Sentiment(str, Enum):
    POSITIVE = "positive"
    NEGATIVE = "negative"
    NEUTRAL = "neutral"

class ReviewAnalysis(BaseModel):
    """评论分析结果"""
    summary: str = Field(description="一句话总结，不超过 20 字")
    sentiment: Sentiment = Field(description="情感倾向")
    confidence: float = Field(ge=0, le=1, description="置信度 0-1")
    keywords: List[str] = Field(min_length=1, max_length=5, description="关键词 1-5 个")
    issues: Optional[List[str]] = Field(default=None, description="用户提到的问题（如有）")

# 自动生成 JSON Schema
schema = ReviewAnalysis.model_json_schema()
print(schema)

# 从 LLM 输出解析
data = ReviewAnalysis.model_validate_json(llm_output)
print(data.summary)      # 类型安全
print(data.sentiment)    # 枚举值
print(data.confidence)   # 自动类型转换
```

## 五、后处理与校验

```python
from pydantic import ValidationError

def safe_parse_llm_output(text: str, schema: BaseModel) -> dict | None:
    """安全解析 LLM 输出"""
    import json, re

    # 尝试多种方式提取 JSON
    json_str = None

    # 方式 1：直接解析
    try:
        json.loads(text)
        json_str = text
    except json.JSONDecodeError:
        pass

    # 方式 2：提取 ```json 代码块
    if not json_str:
        match = re.search(r'```json\s*(.*?)\s*```', text, re.DOTALL)
        if match:
            json_str = match.group(1)

    # 方式 3：提取 { ... }
    if not json_str:
        match = re.search(r'\{.*\}', text, re.DOTALL)
        if match:
            json_str = match.group(0)

    if not json_str:
        return None

    # Pydantic 校验
    try:
        data = schema.model_validate_json(json_str)
        return data.model_dump()
    except ValidationError as e:
        print(f"Schema validation failed: {e}")
        return None
```

## 六、踩坑记录

### 坑 1：JSON Mode 输出的字段名不固定

**问题**：用 JSON Mode 时，LLM 每次返回的字段名可能不同（`name` vs `title` vs `title_name`）。

**解决**：用 Structured Outputs（`response_format` + Pydantic 模型）代替 JSON Mode，强制输出格式。

### 坑 2：复杂 Schema 导致输出质量下降

**问题**：Schema 嵌套了 5 层，LLM 经常在深层字段出错或遗漏。

**解决**：Schema 尽量扁平，嵌套不超过 3 层。复杂任务拆分成多次调用，每次一个简单 Schema。

### 坑 3：Function Calling 的 description 不够详细

**问题**：函数描述太简短，LLM 选错了函数或参数填错。

**解决**：description 要详细说明用途、适用场景、参数含义，甚至给出示例：
```python
"description": "获取天气信息。只用于查询实时天气，不用于预报。城市名使用中文，如 '北京'、'上海'。"
```

### 坑 4：Pydantic 模型的 Optional 字段

**问题**：定义了 `Optional[List[str]]`，LLM 有时返回 `null`，有时返回 `[]`，处理不一致。

**解决**：在代码中统一处理：
```python
issues = data.issues or []  # null → []
```

### 坑 5：不同模型的 Structured Output 支持差异

**问题**：OpenAI 原生支持 `response_format`，Claude 需要用 Tool Use，DeepSeek 部分支持。

**解决**：在 Gateway 层做适配，对不同模型用不同的实现方式，业务代码统一调用。

## 八、参考资料

- OpenAI Structured Outputs：https://platform.openai.com/docs/guides/structured-outputs
- OpenAI Function Calling：https://platform.openai.com/docs/guides/function-calling
- Anthropic Tool Use：https://docs.anthropic.com/en/docs/build-with-claude/tool-use
- Pydantic 文档：https://docs.pydantic.dev/
