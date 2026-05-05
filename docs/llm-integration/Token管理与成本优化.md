---
sidebar_position: 4
title: Token 管理与成本优化
slug: token-management-cost-optimization
---

# Token 管理与成本优化

> 上个月看 LLM 的账单差点晕过去——一个月烧了 8000 块。排查发现，System Prompt 每次都重复发送（占 40% 的 Token），Agent 的上下文窗口没做压缩（历史消息越攒越多），很多简单任务用了 GPT-4o（其实 DeepSeek 就够了）。做了三个月优化，成本降到了 2000 块/月，效果还提升了。

## 一、Token 成本构成

```
LLM 调用成本 = 输入 Token × 输入单价 + 输出 Token × 输出单价

输入 Token 构成：
┌────────────────────────────────────────┐
│  System Prompt（每次重复发送）  30-50%  │
│  历史对话（越积越多）          20-40%  │
│  上下文（RAG 检索结果）        10-20%  │
│  当前用户输入                   5-10%  │
└────────────────────────────────────────┘

输出 Token 构成：
┌────────────────────────────────────────┐
│  正常回答                           70%  │
│  思考过程（CoT）                   20%  │
│  格式化输出（JSON 头尾）           10%  │
└────────────────────────────────────────┘
```

## 二、优化策略全景

### 2.1 策略一览

| 策略 | 节省比例 | 实现难度 | 适用场景 |
|------|---------|---------|---------|
| Prompt Cache | 30-50% | 低 | 所有场景 |
| 上下文压缩 | 20-40% | 中 | 长对话 |
| 语义缓存 | 10-30% | 中 | 重复问题 |
| 模型路由 | 20-60% | 中 | 多模型场景 |
| 输出长度控制 | 10-20% | 低 | 所有场景 |
| 批量 API | 50% | 低 | 离线任务 |

### 2.2 成本优化路线图

```
第 1 步：开启 Prompt Cache（立竿见影，0 成本）
    ↓
第 2 步：控制输出长度 + 关闭不必要的 CoT（简单）
    ↓
第 3 步：实现上下文压缩（中等）
    ↓
第 4 步：模型路由（中等，需要评估体系）
    ↓
第 5 步：语义缓存（中等，适合重复问题多的场景）
```

## 三、Prompt Cache

### 3.1 原理

Prompt Cache 缓存重复的前缀 Token，命中缓存后这部分不需要重新计算：

```
第一次调用：
  [System Prompt + 历史对话 + 用户输入] → 全量计算

第二次调用（System Prompt 相同）：
  [System Prompt（缓存命中）] + [新历史 + 用户输入] → 只计算新增部分

节省：System Prompt 占 1000 Token → 每次节省 1000 Token 的计算
```

### 3.2 实现

```python
# OpenAI Prompt Caching（自动生效，无需代码改动）
# 只需确保 System Prompt 在 messages 的最前面，且内容不变
response = client.chat.completions.create(
    model="gpt-4o",
    messages=[
        {"role": "system", "content": SYSTEM_PROMPT},  # 固定前缀
        {"role": "user", "content": user_input},
    ],
)

# Anthropic Prompt Caching
response = client.messages.create(
    model="claude-sonnet-4-6-20250514",
    messages=[{"role": "user", "content": user_input}],
    system=[
        {
            "type": "text",
            "text": SYSTEM_PROMPT,
            "cache_control": {"type": "ephemeral"},  # 标记可缓存
        }
    ],
)
```

**注意事项**：
- OpenAI：前缀需要 ≥1024 Token 才能缓存，缓存有效期 5-10 分钟
- Anthropic：前缀需要 ≥1024 Token，缓存有效期 5 分钟
- System Prompt 内容不变时才能命中缓存

### 3.3 缓存命中率优化

```python
# 把不变的内容放在前面，变化的内容放在后面
# 好的顺序：
messages = [
    {"role": "system", "content": "你是...（固定，1000 Token）"},
    {"role": "system", "content": "知识库内容...（相对固定，2000 Token）"},
    {"role": "user", "content": "历史对话...（变化，500 Token）"},
    {"role": "user", "content": "当前问题...（变化，50 Token）"},
]
# 缓存命中：3000 Token（前两层），未命中：550 Token
```

## 四、上下文压缩

### 4.1 对话历史压缩

长对话的历史消息会持续增长，需要定期压缩：

```python
class ConversationCompressor:
    def __init__(self, max_tokens=4000, llm=None):
        self.max_tokens = max_tokens
        self.llm = llm

    async def compress(self, messages: list) -> list:
        """压缩对话历史"""
        total_tokens = self._count_tokens(messages)

        if total_tokens <= self.max_tokens:
            return messages

        # 保留 System Prompt + 最近 N 轮 + 压缩中间部分
        system_msgs = [m for m in messages if m.role == "system"]
        other_msgs = [m for m in messages if m.role != "system"]

        # 保留最近 4 轮对话
        recent = other_msgs[-8:]  # 4 轮 = 8 条消息
        old = other_msgs[:-8]

        if old:
            # 用 LLM 压缩旧对话
            summary = await self._summarize(old)
            compressed = [
                LLMMessage(role="system", content=f"之前的对话摘要：{summary}"),
            ]
        else:
            compressed = []

        return system_msgs + compressed + recent

    async def _summarize(self, messages):
        response = await self.llm.chat(
            messages=[
                LLMMessage(role="system", content="请用 3-5 句话总结以下对话的要点："),
                LLMMessage(role="user", content=str([m.content for m in messages])),
            ],
            model="gpt-4o-mini",  # 用便宜模型做摘要
        )
        return response.content
```

### 4.2 RAG 上下文压缩

```python
class ContextCompressor:
    """压缩 RAG 检索结果"""

    def __init__(self, llm, max_context_tokens=2000):
        self.llm = llm
        self.max_context_tokens = max_context_tokens

    async def compress(self, query: str, documents: list) -> str:
        """提取文档中与问题相关的部分"""
        compressed_parts = []
        total_tokens = 0

        for doc in documents:
            # 对每个文档提取相关句子
            relevant = await self._extract_relevant(query, doc.page_content)
            doc_tokens = len(relevant) // 2  # 粗略估计

            if total_tokens + doc_tokens > self.max_context_tokens:
                break

            compressed_parts.append(relevant)
            total_tokens += doc_tokens

        return "\n\n".join(compressed_parts)

    async def _extract_relevant(self, query, text):
        response = await self.llm.chat(
            messages=[LLMMessage(role="user", content=f"""
请从以下文本中提取与问题相关的部分，去掉无关内容：

问题：{query}
文本：{text}

只返回相关部分：""")],
            model="gpt-4o-mini",
        )
        return response.content
```

## 五、语义缓存

对相似问题缓存答案，避免重复调用 LLM：

```python
import hashlib
from sentence_transformers import SentenceTransformer
import numpy as np

class SemanticCache:
    def __init__(self, similarity_threshold=0.92):
        self.encoder = SentenceTransformer("BAAI/bge-small-zh-v1.5")
        self.cache = {}  # {embedding: (question, answer, timestamp)}
        self.threshold = similarity_threshold

    def get(self, question: str):
        """查找语义相似的缓存"""
        query_emb = self.encoder.encode(question)

        best_score = 0
        best_answer = None

        for cached_emb, (cached_q, cached_a, ts) in self.cache.items():
            score = np.dot(query_emb, cached_emb) / (
                np.linalg.norm(query_emb) * np.linalg.norm(cached_emb)
            )
            if score > best_score:
                best_score = score
                best_answer = cached_a

        if best_score >= self.threshold:
            return best_answer  # 缓存命中
        return None  # 未命中

    def set(self, question: str, answer: str):
        """存入缓存"""
        emb = tuple(self.encoder.encode(question))
        import time
        self.cache[emb] = (question, answer, time.time())

# 使用
cache = SemanticCache()

async def cached_llm_call(gateway, question):
    # 1. 查缓存
    cached = cache.get(question)
    if cached:
        return cached  # 直接返回，不调 LLM

    # 2. 调 LLM
    response = await gateway.chat(
        messages=[LLMMessage(role="user", content=question)]
    )

    # 3. 存缓存
    cache.set(question, response.content)
    return response.content
```

**适用场景**：FAQ、知识库问答、重复性查询
**不适用**：实时数据、个性化回答、上下文依赖的对话

## 六、模型路由

根据任务复杂度自动选择最优模型：

```python
class ModelRouter:
    """模型路由器"""

    def __init__(self, gateway):
        self.gateway = gateway
        self.routes = {
            "simple": {"provider": "deepseek", "model": "deepseek-chat"},      # 简单任务
            "medium": {"provider": "openai", "model": "gpt-4o-mini"},          # 中等任务
            "complex": {"provider": "openai", "model": "gpt-4o"},              # 复杂任务
            "code": {"provider": "claude", "model": "claude-sonnet-4-6-20250514"},  # 代码任务
        }

    def classify_task(self, question: str) -> str:
        """简单任务分类"""
        simple_keywords = ["你好", "谢谢", "是什么", "几岁", "几点"]
        code_keywords = ["代码", "函数", "bug", "报错", "debug", "编程"]

        if any(kw in question for kw in code_keywords):
            return "code"
        if any(kw in question for kw in simple_keywords):
            return "simple"
        if len(question) < 20:
            return "simple"
        return "complex"

    async def chat(self, question: str, **kwargs):
        task_type = self.classify_task(question)
        route = self.routes[task_type]

        return await self.gateway.chat(
            messages=[LLMMessage(role="user", content=question)],
            provider=route["provider"],
            model=route["model"],
            **kwargs,
        )
```

## 七、批量 API

对于离线任务（如批量文档处理），使用 Batch API 可以节省 50% 成本：

```python
# OpenAI Batch API
import json

# 准备批量请求
requests = []
for i, doc in enumerate(documents):
    requests.append({
        "custom_id": f"doc-{i}",
        "method": "POST",
        "url": "/v1/chat/completions",
        "body": {
            "model": "gpt-4o-mini",
            "messages": [{"role": "user", "content": f"总结：{doc}"}],
        },
    })

# 写入 JSONL 文件
with open("batch_requests.jsonl", "w") as f:
    for req in requests:
        f.write(json.dumps(req) + "\n")

# 上传并创建 Batch
batch_file = client.files.create(file=open("batch_requests.jsonl", "rb"), purpose="batch")
batch = client.batches.create(input_file_id=batch_file.id, endpoint="/v1/chat/completions", completion_window="24h")

# 24 小时内完成，成本减半
```

## 八、踩坑记录

### 坑 1：Cache 命中率低

**问题**：以为开了 Cache 就能省钱，结果命中率只有 5%。

**排查**：发现 System Prompt 每次都加了时间戳（"当前时间：2025-05-05 10:30:00"），导致前缀不一致。

**解决**：把时间戳从 System Prompt 移到 User Prompt，System Prompt 保持不变。

### 坑 2：上下文压缩丢信息

**问题**：压缩旧对话时，LLM 摘要遗漏了关键决策点，Agent 后续回答出错。

**解决**：压缩时保留结构化信息（用户意图、关键参数、决策结果），不只做"一句话摘要"。

### 坑 3：语义缓存的相似度阈值难调

**问题**：阈值 0.9 太松（不相关的问题命中了缓存），0.95 太严（相关问题没命中）。

**解决**：根据场景调整。FAQ 场景用 0.92，技术问答用 0.95。最好用 A/B 测试找最优阈值。

### 坑 4：模型路由的分类不准

**问题**：简单的路由规则（关键词匹配）经常分错，简单任务用了贵模型。

**解决**：用一个轻量级分类模型（如 BERT）做路由，或者用 LLM 自己判断（先用 mini 模型分类）。

### 坑 5：Batch API 的延迟

**问题**：Batch API 声称 24 小时内完成，但实际有时要 48 小时。

**解决**：Batch API 只适合非实时场景。实时任务还是用普通 API。

## 十、参考资料

- OpenAI Prompt Caching：https://platform.openai.com/docs/guides/prompt-caching
- Anthropic Prompt Caching：https://docs.anthropic.com/en/docs/build-with-claude/prompt-caching
- OpenAI Batch API：https://platform.openai.com/docs/guides/batch-requests
- LangChain LLM 缓存：https://python.langchain.com/docs/how_to/llm_caching/
- Token 计费说明：https://openai.com/pricing
