---
sidebar_position: 2
title: Prompt 工程进阶
slug: prompt-engineering-advanced
---

# Prompt 工程进阶

> 一开始我觉得 Prompt 不就是写几句话嘛，能有多难？直到我的 Agent 在生产环境连续三天返回错误格式的数据，排查了两天才发现是 System Prompt 里少了一句"请用 JSON 格式返回"。从那以后我才认真对待 Prompt 工程——它不是"写几句话"，而是一门需要系统化方法论的工程学科。

## 一、Prompt 工程的本质

Prompt 工程 = **用自然语言编程**。

```
传统编程：  代码 → 编译器 → 执行
Prompt 工程：Prompt → LLM → 输出

本质上都是：输入 → 处理器 → 输出
区别在于：LLM 是概率模型，同样的 Prompt 可能产生不同输出
所以需要：更精确的指令 + 更多的约束 + 验证机制
```

## 二、核心 Prompt 技术

### 2.1 Chain-of-Thought（思维链）

让 LLM 展示推理过程，而不是直接给答案：

```
# 不好的 Prompt
问：小明有 5 个苹果，给了小红 2 个，又买了 3 个，现在有几个？
答：6 个（可能对，但无法验证推理过程）

# 好的 Prompt（加 "Let's think step by step"）
问：小明有 5 个苹果，给了小红 2 个，又买了 3 个，现在有几个？
    请一步一步思考。
答：
  1. 小明一开始有 5 个苹果
  2. 给了小红 2 个：5 - 2 = 3 个
  3. 又买了 3 个：3 + 3 = 6 个
  所以现在有 6 个苹果。
```

```python
cot_prompt = """请一步一步思考以下问题，展示你的推理过程。

问题：{question}

推理过程："""
```

### 2.2 Few-Shot（少样本学习）

给 LLM 几个示例，让它学习输入输出的模式：

```python
few_shot_prompt = """请根据用户评论判断情感倾向（正面/负面/中性）。

示例 1：
评论：这个手机拍照效果太好了，夜景模式特别清晰！
情感：正面

示例 2：
评论：等了一个星期才收到，而且屏幕有划痕
情感：负面

示例 3：
评论：手机收到了，还没用，先给个好评
情感：中性

现在请判断：
评论：{input}
情感："""
```

**关键技巧**：
- 示例数量：3-5 个通常够用
- 示例多样性：覆盖正面、负面、边界情况
- 示例顺序：把最相似的示例放在最后（最近邻效应）

### 2.3 ReAct（推理 + 行动）

让 LLM 交替进行推理和工具调用：

```python
react_prompt = """你是一个能使用工具的助手。请用以下格式回答：

Thought: 我需要思考一下这个问题...
Action: 工具名称
Action Input: 工具参数
Observation: 工具返回结果（由系统填写）
... (可以重复 Thought/Action 循环)
Thought: 我现在知道答案了
Final Answer: 最终答案

可用工具：
- search(query): 搜索互联网
- calculate(expression): 数学计算
- lookup(term): 查找术语定义

问题：{question}
"""
```

### 2.4 Self-Consistency（自一致性）

多次采样，取多数投票的结果：

```python
async def self_consistent_answer(gateway, question, n_samples=5):
    """多次生成，取最一致的答案"""
    answers = []
    for _ in range(n_samples):
        response = await gateway.chat(
            messages=[LLMMessage(role="user", content=f"请回答：{question}")],
            temperature=0.7,  # 有一定随机性
        )
        answers.append(response.content)

    # 统计最常出现的答案
    from collections import Counter
    counter = Counter(answers)
    most_common = counter.most_common(1)[0][0]

    return most_common, answers
```

## 三、Prompt 模板系统设计

### 3.1 分层 Prompt 架构

```
┌─────────────────────────────────────────────┐
│  Layer 1: System Prompt（全局指令）          │
│  "你是一个专业的客服助手，用中文回答..."      │
│                                              │
│  Layer 2: Role Prompt（角色定义）            │
│  "你是 XX 公司的客服，专注于产品咨询..."      │
│                                              │
│  Layer 3: Task Prompt（任务指令）            │
│  "请根据用户的问题，从知识库中检索答案..."     │
│                                              │
│  Layer 4: Format Prompt（输出格式）          │
│  "请用 JSON 格式返回，包含 answer 和 source"  │
│                                              │
│  Layer 5: Context（动态上下文）              │
│  检索到的文档、用户历史、元数据等              │
└─────────────────────────────────────────────┘
```

### 3.2 模板引擎实现

```python
from string import Template
from typing import Dict, Any

class PromptTemplate:
    """可复用的 Prompt 模板"""

    def __init__(self, template: str, required_vars: list = None):
        self.template = template
        self.required_vars = required_vars or []

    def format(self, **kwargs) -> str:
        # 检查必填变量
        for var in self.required_vars:
            if var not in kwargs:
                raise ValueError(f"Missing required variable: {var}")

        # 替换变量
        result = self.template
        for key, value in kwargs.items():
            result = result.replace(f"{{{key}}}", str(value))
        return result

# 定义常用模板
RAG_TEMPLATE = PromptTemplate(
    template="""基于以下上下文回答用户的问题。

规则：
1. 只基于上下文中的信息回答，不要编造
2. 如果上下文中没有相关信息，请说"我没有找到相关信息"
3. 回答要简洁、准确、有条理

上下文：
{context}

问题：{question}

回答：""",
    required_vars=["context", "question"],
)

CODE_REVIEW_TEMPLATE = PromptTemplate(
    template="""请审查以下代码，关注：
1. 安全漏洞（SQL 注入、XSS、命令注入等）
2. 性能问题（N+1 查询、内存泄漏等）
3. 代码规范（命名、结构、注释等）

代码语言：{language}

```{language}
{code}
```

请按以下格式返回审查结果：
- 问题列表（严重程度：高/中/低）
- 改进建议
- 整体评价""",
    required_vars=["language", "code"],
)
```

### 3.3 动态 Prompt 构建

```python
class DynamicPromptBuilder:
    """根据上下文动态构建 Prompt"""

    def __init__(self):
        self.layers = []

    def add_system(self, instruction: str):
        self.layers.append(("system", instruction))
        return self

    def add_examples(self, examples: list):
        example_text = "\n\n".join([
            f"示例 {i+1}：\n输入：{ex['input']}\n输出：{ex['output']}"
            for i, ex in enumerate(examples)
        ])
        self.layers.append(("examples", example_text))
        return self

    def add_context(self, context: str):
        self.layers.append(("context", context))
        return self

    def add_output_format(self, format_desc: str):
        self.layers.append(("format", format_desc))
        return self

    def build(self) -> list:
        messages = []
        system_parts = []
        for layer_type, content in self.layers:
            if layer_type == "system":
                system_parts.append(content)
            elif layer_type == "format":
                system_parts.append(f"输出格式要求：\n{content}")

        if system_parts:
            messages.append(LLMMessage(role="system", content="\n\n".join(system_parts)))

        for layer_type, content in self.layers:
            if layer_type in ("examples", "context"):
                messages.append(LLMMessage(role="user", content=content))

        return messages

# 使用
builder = DynamicPromptBuilder()
messages = (builder
    .add_system("你是一个专业的技术文档翻译助手")
    .add_system("翻译时保留技术术语的英文原文")
    .add_examples([
        {"input": "Use a hash map for O(1) lookup", "output": "使用哈希映射（hash map）实现 O(1) 的查找"},
        {"input": "The algorithm has O(n log n) time complexity", "output": "该算法的时间复杂度为 O(n log n)"},
    ])
    .add_output_format("直接返回翻译结果，不需要解释")
    .build())
```

## 四、常见 Prompt 反模式

| 反模式 | 问题 | 改进 |
|--------|------|------|
| 指令太模糊 | "帮我写个程序" | "用 Python 写一个读取 CSV 文件并按列分组统计的脚本" |
| 没有输出格式 | LLM 自由发挥 | "请用 JSON 格式返回，包含以下字段..." |
| 一次性塞太多任务 | "翻译 + 改写 + 总结" | 分步执行，每步一个明确任务 |
| 没有边界约束 | LLM 可能编造 | "只基于以下上下文回答，不要编造" |
| 忽略负面指令 | "不要提到价格" → LLM 偏要提 | 改用正面指令："请只描述产品功能" |
| 示例不够多样 | 3 个示例都是正面 | 覆盖正面、负面、边界情况 |

## 五、踩坑记录

### 坑 1：Prompt 太长导致输出质量下降

**问题**：System Prompt 写了 2000 字，LLM 经常忽略后面的指令。

**解决**：System Prompt 控制在 500 字以内，关键指令放在前面（LLM 有"Lost in the Middle"问题）。长内容放到 Context 层。

### 坑 2：不同模型对同一 Prompt 响应差异大

**问题**：GPT-4o 能正确理解的 Prompt，换成 DeepSeek 后效果差很多。

**解决**：Prompt 需要针对目标模型调优。写一个 Prompt 后，至少在 2-3 个目标模型上测试。国产模型通常需要更明确、更详细的指令。

### 坑 3：Few-Shot 示例影响了模型判断

**问题**：给了 5 个正面情感的示例，模型把所有评论都判为正面。

**解决**：示例必须覆盖所有类别，且比例均衡。3 正面 + 2 负面 + 1 中性，比 5 个正面好多了。

### 坑 4：Chain-of-Thought 增加了成本

**问题**：让 LLM 展示推理过程，输出 Token 翻倍，成本也翻倍。

**解决**：只在需要推理的复杂问题上用 CoT，简单分类任务不需要。或者只在调试阶段用 CoT，生产环境关闭。

### 坑 5：JSON 输出格式不稳定

**问题**：要求 LLM 返回 JSON，但它有时会多输出一些解释文字。

**解决**：
1. 在 Prompt 中明确要求"只返回 JSON，不要其他文字"
2. 用 `response_format={"type": "json_object"}`（OpenAI 支持）
3. 后处理：提取 JSON 部分，忽略其他文字

```python
import json
import re

def extract_json(text):
    """从 LLM 输出中提取 JSON"""
    # 尝试直接解析
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        pass

    # 尝试提取 ```json ... ``` 块
    match = re.search(r'```json\s*(.*?)\s*```', text, re.DOTALL)
    if match:
        try:
            return json.loads(match.group(1))
        except json.JSONDecodeError:
            pass

    # 尝试提取 { ... } 或 [ ... ]
    match = re.search(r'(\{.*\}|\[.*\])', text, re.DOTALL)
    if match:
        try:
            return json.loads(match.group(1))
        except json.JSONDecodeError:
            pass

    raise ValueError("No valid JSON found in output")
```

## 七、参考资料

- OpenAI Prompt Engineering Guide：https://platform.openai.com/docs/guides/prompt-engineering
- Anthropic Prompt Engineering：https://docs.anthropic.com/en/docs/build-with-claude/prompt-engineering
- LangChain Prompt 模板：https://python.langchain.com/docs/concepts/prompt_templates/
- "Chain-of-Thought Prompting Elicits Reasoning in Large Language Models" (2022)
- "ReAct: Synergizing Reasoning and Acting in Language Models" (2022)
