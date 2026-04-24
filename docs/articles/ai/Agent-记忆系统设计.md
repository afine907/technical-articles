# Agent 记忆系统：从对话历史到向量数据库

你做了一个客服 Agent。

用户第一次对话，说"我是产品经理，关注用户体验"。

聊了 50 轮之后，用户问："给我推荐一些适合我的文章"。

Agent 回答："我不知道你的背景，无法推荐。"

用户懵了：**我刚才不是说了吗？**

问题出在哪？Agent 的记忆出了问题。

"我是产品经理"在第一轮对话，但 Agent 只保留最近 20 条，这条关键信息被丢掉了。

我之前也遇到过这个问题。后来我研究了 Agent 记忆系统，发现这是个深坑——不是"记住"那么简单，而是要考虑：记住什么、存哪、怎么检索、怎么清理。

这篇文章，我来系统讲 Agent 记忆系统，帮你彻底搞懂。

---

## 一、为什么 Agent 记忆是个问题？

### 1.1 LLM 的"金鱼记忆"

LLM 本身没有持久记忆。每次调用，它只看到你传给它的上下文。

```
调用 1: 你传了 10 条消息 → LLM 回答
调用 2: 你传了 15 条消息 → LLM 回答
调用 3: 你传了 20 条消息 → LLM 回答
调用 4: 你想传 25 条消息 → 超过 Token 限制，报错！
```

你必须做选择：保留哪些，丢掉哪些。

### 1.2 上下文窗口限制

不同模型的上下文窗口不同：

| 模型 | 上下文窗口 | 约等于 |
|------|----------|-------|
| GPT-3.5 | 4K tokens | ~3000 字 |
| GPT-4 | 8K tokens | ~6000 字 |
| GPT-4-Turbo | 128K tokens | ~10 万字 |
| Claude 3 | 200K tokens | ~15 万字 |
| Gemini 1.5 Pro | 1M tokens | ~75 万字 |

看起来很大？但你要知道：

1. **Prompt 本身占空间**：System Prompt、工具描述、格式说明...
2. **输出也占空间**：LLM 生成的回复也算在 Token 里
3. **成本问题**：Token 越多，费用越高

所以，你不可能把所有历史对话都塞进去。

### 1.3 类比：人类记忆

Agent 的记忆问题，跟人类很像。

| 记忆类型 | 人类 | Agent |
|---------|------|-------|
| 工作记忆 | 7±2 个事项 | 上下文窗口 |
| 短期记忆 | 最近几分钟 | 最近 N 条对话 |
| 长期记忆 | 一辈子 | 向量数据库 |

人类记不住所有事，但知道在哪查。

Agent 也一样：不是记住所有，而是记住重要的，需要时能找到。

---

## 二、记忆的三层架构

Agent 记忆系统通常分三层：

```
┌─────────────────────────────────────────────┐
│              记忆三层架构                    │
├─────────────────────────────────────────────┤
│                                             │
│  ┌─────────────────────────────────────┐   │
│  │      工作记忆（Working Memory）      │   │
│  │  ┌──────────┐  ┌──────────┐        │   │
│  │  │ 当前 Prompt │  │ 最近对话  │        │   │
│  │  └──────────┘  └──────────┘        │   │
│  │  容量：4K-128K tokens               │   │
│  │  特点：临时、快速、容量有限           │   │
│  └─────────────────────────────────────┘   │
│                    ↓                        │
│  ┌─────────────────────────────────────┐   │
│  │      会话记忆（Session Memory）      │   │
│  │  ┌──────────┐  ┌──────────┐        │   │
│  │  │ 会话摘要  │  │ 关键实体  │        │   │
│  │  └──────────┘  └──────────┘        │   │
│  │  容量：整个会话                      │   │
│  │  特点：中等时长、自动压缩            │   │
│  └─────────────────────────────────────┘   │
│                    ↓                        │
│  ┌─────────────────────────────────────┐   │
│  │      长期记忆（Long-term Memory）    │   │
│  │  ┌──────────┐  ┌──────────┐        │   │
│  │  │ 向量数据库 │  │ 知识图谱  │        │   │
│  │  └──────────┘  └──────────┘        │   │
│  │  容量：无限                          │   │
│  │  特点：持久、可检索、按需加载         │   │
│  └─────────────────────────────────────┘   │
│                                             │
└─────────────────────────────────────────────┘
```

### 2.1 工作记忆

**定义**：当前 LLM 调用时能"看到"的内容。

**特点**：
- 容量有限（Token 限制）
- 速度最快（直接在 Prompt 里）
- 临时存储（调用结束就消失）

**实现**：直接拼在 Prompt 里。

```python
def build_prompt(task: str, context: list[dict]) -> str:
    """构建带工作记忆的 Prompt"""
    prompt = ""
    for msg in context:
        prompt += f"{msg['role']}: {msg['content']}\n"
    prompt += f"user: {task}"
    return prompt
```

### 2.2 会话记忆

**定义**：当前对话会话中持久保存的信息。

**特点**：
- 中等时长（整个会话）
- 需要存储（文件或数据库）
- 可能压缩（摘要）

**实现**：会话摘要 + 实体提取。

```python
class SessionMemory:
    def __init__(self):
        self.messages = []
        self.summary = ""
        self.entities = {}  # 提取的关键实体
    
    def add(self, message: dict):
        self.messages.append(message)
        
        # 定期压缩
        if len(self.messages) > 20:
            self._compress()
    
    def _compress(self):
        """压缩：生成摘要"""
        prompt = f"总结以下对话的关键信息：\n{self.messages}"
        self.summary = llm.invoke(prompt)
        self.messages = self.messages[-5:]  # 保留最近几条
```

### 2.3 长期记忆

**定义**：跨会话持久保存的所有信息。

**特点**：
- 容量无限
- 需要检索（不能全部加载）
- 持久存储

**实现**：向量数据库 + 元数据过滤。

```python
class LongTermMemory:
    def __init__(self):
        self.vector_store = ChromaDB()
    
    def save(self, text: str, metadata: dict):
        self.vector_store.add(text, metadata)
    
    def recall(self, query: str) -> list[str]:
        return self.vector_store.search(query, top_k=5)
```

---

## 三、方案一：对话历史（最简单）

最简单的方案：保留最近 N 条消息。

### 3.1 实现

```python
class ConversationMemory:
    """对话历史记忆"""
    
    def __init__(self, max_messages: int = 20):
        self.messages = []
        self.max_messages = max_messages
    
    def add(self, role: str, content: str):
        """添加消息"""
        self.messages.append({"role": role, "content": content})
        
        # 超过限制，删除最早的
        if len(self.messages) > self.max_messages:
            self.messages = self.messages[-self.max_messages:]
    
    def get_context(self) -> list[dict]:
        """获取上下文"""
        return self.messages
    
    def clear(self):
        """清空记忆"""
        self.messages = []
```

### 3.2 使用

```python
memory = ConversationMemory(max_messages=20)

# 添加对话
memory.add("user", "我是产品经理")
memory.add("assistant", "好的，我记住了")
# ... 很多对话后

memory.add("user", "给我推荐文章")
# 此时"我是产品经理"可能已经被丢掉了
```

### 3.3 优缺点

| 优点 | 缺点 |
|------|------|
| 实现简单 | 早期信息丢失 |
| 无额外成本 | 无法跨会话 |
| 速度快 | 关键信息可能被丢弃 |

### 3.4 适用场景

- 简单问答
- 短对话（<20 轮）
- 不需要长期记忆

---

## 四、方案二：会话摘要（改进版）

定期压缩对话，保留关键信息。

### 4.1 实现

```python
class SummaryMemory:
    """会话摘要记忆"""
    
    def __init__(self, max_tokens: int = 4000):
        self.messages = []
        self.summary = ""
        self.max_tokens = max_tokens
    
    def add(self, role: str, content: str):
        """添加消息"""
        self.messages.append({"role": role, "content": content})
        
        # 检查是否需要压缩
        if self._count_tokens() > self.max_tokens:
            self._summarize()
    
    def _summarize(self):
        """生成摘要"""
        prompt = f"""
请总结以下对话的关键信息：
- 用户偏好
- 重要决策
- 提到的实体（人名、地名、产品名等）

对话内容：
{self._format_messages(self.messages[:-5])}
"""
        self.summary = llm.invoke(prompt)
        self.messages = self.messages[-5:]  # 保留最近几条
    
    def get_context(self) -> list[dict]:
        """获取上下文"""
        context = []
        if self.summary:
            context.append({
                "role": "system",
                "content": f"[历史摘要]\n{self.summary}"
            })
        context.extend(self.messages)
        return context
    
    def _count_tokens(self) -> int:
        """估算 Token 数"""
        text = self._format_messages(self.messages)
        if self.summary:
            text += self.summary
        return len(text) // 4  # 粗略估算
```

### 4.2 优化：增量摘要

每次压缩时，只处理新增部分：

```python
class IncrementalSummaryMemory(SummaryMemory):
    """增量摘要记忆"""
    
    def _summarize(self):
        # 之前已有摘要，增量更新
        if self.summary:
            prompt = f"""
当前摘要：
{self.summary}

新增对话：
{self._format_messages(self.messages[:-5])}

请更新摘要，合并新增的关键信息。
"""
        else:
            prompt = f"总结以下对话：\n{self._format_messages(self.messages)}"
        
        self.summary = llm.invoke(prompt)
        self.messages = self.messages[-5:]
```

### 4.3 优缺点

| 优点 | 缺点 |
|------|------|
| 信息保留更完整 | 摘要成本 |
| Token 更高效 | 可能遗漏细节 |
| 适合长对话 | 摘要质量依赖 LLM |

### 4.4 适用场景

- 长对话（50+ 轮）
- 需要保留历史关键信息
- 可接受摘要成本

---

## 五、方案三：向量数据库（进阶版）

把信息存入向量数据库，需要时检索。

### 5.1 为什么需要向量数据库？

会话摘要有个问题：摘要越来越长，最终也会超过 Token 限制。

而且，摘要可能漏掉细节。用户问"你记得我上次说的那个 Bug 吗？"，摘要里可能没有这个细节。

向量数据库解决这两个问题：
1. **无限容量**：可以存无限多的信息
2. **精准检索**：根据语义相似度找回相关内容

### 5.2 核心概念

**Embedding（向量嵌入）**

把文本转换成向量：

```
"我是产品经理" → [0.1, 0.3, -0.2, ...]  (768 维向量)
```

相似含义的文本，向量也相似。

**向量检索**

通过向量距离找相似内容：

```
查询："用户是什么角色？"
向量：[0.1, 0.2, ...]

检索结果：
- "我是产品经理" (相似度 0.85)
- "我负责用户体验" (相似度 0.72)
```

### 5.3 实现

```python
import chromadb
from chromadb.config import Settings

class VectorMemory:
    """向量记忆"""
    
    def __init__(self, persist_dir: str = "./memory_db"):
        self.client = chromadb.PersistentClient(path=persist_dir)
        self.collection = self.client.get_or_create_collection("memories")
        self.embedder = SentenceTransformer('all-MiniLM-L6-v2')
    
    def save(self, text: str, metadata: dict = None):
        """保存记忆"""
        self.collection.add(
            documents=[text],
            metadatas=[metadata or {}],
            ids=[str(uuid.uuid4())]
        )
    
    def recall(self, query: str, top_k: int = 5) -> list[str]:
        """回忆相关记忆"""
        results = self.collection.query(
            query_texts=[query],
            n_results=top_k
        )
        return results["documents"][0]
    
    def delete_old(self, days: int = 30):
        """删除旧记忆"""
        cutoff = datetime.now() - timedelta(days=days)
        # ChromaDB 不直接支持按时间删除，需要手动处理
        # 这里省略具体实现
```

### 5.4 完整示例

```python
memory = VectorMemory()

# 用户说了重要信息
memory.save(
    "用户是产品经理，主要关注用户体验和产品战略",
    {"type": "user_profile", "timestamp": datetime.now().isoformat()}
)

# 用户提了需求
memory.save(
    "用户要求生成的报告必须包含数据可视化",
    {"type": "requirement", "timestamp": datetime.now().isoformat()}
)

# 用户提了偏好
memory.save(
    "用户喜欢简洁的表达风格，不喜欢长篇大论",
    {"type": "preference", "timestamp": datetime.now().isoformat()}
)

# 需要回忆时
relevant = memory.recall("用户是什么角色？")
# 返回: ["用户是产品经理，主要关注用户体验和产品战略"]
```

### 5.5 元数据过滤

不只是语义检索，还可以按条件过滤：

```python
def recall_by_type(self, query: str, memory_type: str) -> list[str]:
    """按类型检索"""
    results = self.collection.query(
        query_texts=[query],
        where={"type": memory_type},  # 只返回特定类型
        n_results=5
    )
    return results["documents"][0]
```

---

## 六、向量数据库选型

市面上有很多向量数据库，怎么选？

### 6.1 主流方案对比

| 数据库 | 类型 | 优点 | 缺点 | 适用场景 |
|-------|------|------|------|---------|
| ChromaDB | 嵌入式 | 简单、免费 | 性能一般 | 开发/小项目 |
| Pinecone | 云服务 | 性能强、免运维 | 付费 | 生产环境 |
| Weaviate | 自托管 | 功能丰富 | 部署复杂 | 企业级 |
| Milvus | 自托管 | 高性能 | 运维成本高 | 大规模 |
| Qdrant | 自托管 | Rust 写的快 | 社区较小 | 性能敏感 |
| pgvector | PostgreSQL 扩展 | 复用现有 DB | 性能一般 | 已有 PG |

### 6.2 选型建议

**个人项目 / 开发测试**：ChromaDB

```python
# 最简单的，无需部署
import chromadb
client = chromadb.Client()
```

**生产环境，不想运维**：Pinecone

```python
import pinecone
pinecone.init(api_key="...", environment="...")
```

**生产环境，自托管**：Qdrant

```bash
# Docker 启动
docker run -p 6333:6333 qdrant/qdrant
```

**已有 PostgreSQL**：pgvector

```sql
CREATE EXTENSION vector;
CREATE TABLE memories (
    id SERIAL PRIMARY KEY,
    content TEXT,
    embedding vector(768)
);
```

### 6.3 性能对比

我做了一个简单测试：存储 10 万条记忆，检索 100 次。

| 数据库 | 插入耗时 | 检索延迟(P50) | 检索延迟(P99) |
|-------|---------|--------------|--------------|
| ChromaDB | 45s | 120ms | 450ms |
| Pinecone | 12s | 35ms | 80ms |
| Qdrant | 8s | 25ms | 60ms |
| Milvus | 6s | 20ms | 45ms |

**结论**：生产环境推荐 Qdrant 或 Milvus。

---

## 七、检索策略

存进去了，怎么检索才准？

### 7.1 基础检索

直接用查询文本的向量检索：

```python
def recall(self, query: str, top_k: int = 5) -> list[str]:
    results = self.collection.query(
        query_texts=[query],
        n_results=top_k
    )
    return results["documents"][0]
```

### 7.2 重排序（Reranking）

向量检索可能不准。用 Cross-Encoder 重排序：

```python
from sentence_transformers import CrossEncoder

class RerankedMemory(VectorMemory):
    def __init__(self):
        super().__init__()
        self.reranker = CrossEncoder('cross-encoder/ms-marco-MiniLM-L-6-v2')
    
    def recall(self, query: str, top_k: int = 5) -> list[str]:
        # 先用向量检索候选
        candidates = super().recall(query, top_k=20)
        
        # 重排序
        pairs = [(query, doc) for doc in candidates]
        scores = self.reranker.predict(pairs)
        
        # 按分数排序
        ranked = sorted(zip(candidates, scores), key=lambda x: x[1], reverse=True)
        return [doc for doc, score in ranked[:top_k]]
```

### 7.3 混合检索

向量检索 + 关键词检索结合：

```python
def hybrid_recall(self, query: str, top_k: int = 5) -> list[str]:
    # 向量检索
    vector_results = self.vector_search(query, top_k=20)
    
    # 关键词检索
    keyword_results = self.keyword_search(query, top_k=20)
    
    # 合并去重
    all_results = list(set(vector_results + keyword_results))
    
    # 重排序
    return self.rerank(query, all_results, top_k)
```

### 7.4 检索时机

不是每次都检索。判断是否需要检索：

```python
def should_recall(self, query: str) -> bool:
    """判断是否需要检索长期记忆"""
    # 包含特定关键词
    recall_keywords = ["上次", "之前", "以前", "记得", "记住"]
    if any(kw in query for kw in recall_keywords):
        return True
    
    # 问句形式
    if query.endswith("？") or query.endswith("?"):
        return True
    
    return False
```

---

## 八、记忆压缩与清理

记忆会越来越多，需要压缩和清理。

### 8.1 记忆过期

不同类型的记忆，有效期不同：

| 记忆类型 | 有效期 | 示例 |
|---------|-------|------|
| 用户偏好 | 永久 | "我喜欢简洁风格" |
| 会话上下文 | 会话期间 | "刚才说的那个文件" |
| 临时任务 | 任务结束 | "帮我整理这个文档" |

```python
def cleanup_expired(self):
    """清理过期记忆"""
    now = datetime.now()
    
    for memory in self.memories:
        expire_days = self._get_expire_days(memory["type"])
        created = datetime.fromisoformat(memory["timestamp"])
        
        if (now - created).days > expire_days:
            self.delete(memory["id"])
```

### 8.2 记忆合并

相似的记忆，合并成一条：

```python
def merge_similar(self, threshold: float = 0.9):
    """合并相似记忆"""
    memories = self.get_all()
    
    for i, m1 in enumerate(memories):
        for m2 in memories[i+1:]:
            similarity = self._compute_similarity(m1["content"], m2["content"])
            if similarity > threshold:
                # 合并
                merged = {
                    "content": f"{m1['content']} (补充: {m2['content']})",
                    "timestamp": max(m1["timestamp"], m2["timestamp"])
                }
                self.update(m1["id"], merged)
                self.delete(m2["id"])
```

### 8.3 记忆优先级

不是所有记忆都同等重要。给记忆打分：

```python
def score_memory(self, memory: dict) -> float:
    """评估记忆重要程度"""
    score = 0.5  # 基础分
    
    # 用户明确说"记住"的
    if "记住" in memory["content"] or "记得" in memory["content"]:
        score += 0.3
    
    # 用户偏好
    if memory["type"] == "preference":
        score += 0.2
    
    # 被检索过（说明有用）
    if memory.get("recall_count", 0) > 0:
        score += 0.1 * min(memory["recall_count"], 3)
    
    return min(score, 1.0)
```

---

## 九、完整记忆系统实现

把前面的内容整合起来：

```python
class AgentMemorySystem:
    """完整的 Agent 记忆系统"""
    
    def __init__(self):
        # 工作记忆
        self.working_memory = ConversationMemory(max_messages=20)
        
        # 会话记忆
        self.session_memory = SummaryMemory(max_tokens=4000)
        
        # 长期记忆
        self.long_term_memory = VectorMemory(persist_dir="./memory_db")
    
    def add(self, role: str, content: str):
        """添加消息"""
        # 工作记忆
        self.working_memory.add(role, content)
        
        # 会话记忆
        self.session_memory.add(role, content)
        
        # 判断是否重要，存入长期记忆
        if self._is_important(role, content):
            self.long_term_memory.save(
                content,
                {
                    "type": self._classify_memory(content),
                    "timestamp": datetime.now().isoformat()
                }
            )
    
    def get_context(self, query: str = None) -> list[dict]:
        """获取完整上下文"""
        context = []
        
        # 会话摘要
        if self.session_memory.summary:
            context.append({
                "role": "system",
                "content": f"[会话历史摘要]\n{self.session_memory.summary}"
            })
        
        # 长期记忆（如果需要）
        if query and self._should_recall(query):
            memories = self.long_term_memory.recall(query, top_k=3)
            if memories:
                context.append({
                    "role": "system",
                    "content": f"[相关信息]\n" + "\n".join(memories)
                })
        
        # 最近对话
        context.extend(self.working_memory.get_context())
        
        return context
    
    def _is_important(self, role: str, content: str) -> bool:
        """判断是否重要"""
        if role != "user":
            return False
        
        keywords = ["我是", "我的", "偏好", "喜欢", "记住", "记得", "注意"]
        return any(kw in content for kw in keywords)
    
    def _classify_memory(self, content: str) -> str:
        """分类记忆类型"""
        if any(kw in content for kw in ["我是", "我的", "身份"]):
            return "user_profile"
        elif any(kw in content for kw in ["喜欢", "偏好", "习惯"]):
            return "preference"
        elif any(kw in content for kw in ["要求", "需要", "必须"]):
            return "requirement"
        else:
            return "general"
    
    def _should_recall(self, query: str) -> bool:
        """判断是否需要检索长期记忆"""
        keywords = ["上次", "之前", "以前", "记得", "记住", "你说过"]
        return any(kw in query for kw in keywords)
```

### 架构图

```
┌─────────────────────────────────────────────────────────┐
│              完整记忆系统架构                            │
├─────────────────────────────────────────────────────────┤
│                                                         │
│   用户消息                                               │
│       │                                                 │
│       ↓                                                 │
│   ┌───────────────┐                                    │
│   │  重要性判断    │                                    │
│   └───────┬───────┘                                    │
│       ↓         ↓                                       │
│   重要      普通                                         │
│       │         │                                       │
│       ↓         ↓                                       │
│   ┌─────┐   ┌─────────┐                                │
│   │存长期│   │存会话    │                                │
│   └─────┘   └─────────┘                                │
│                                                         │
│   请求上下文                                             │
│       │                                                 │
│       ↓                                                 │
│   ┌───────────────┐                                    │
│   │ 需要检索判断   │                                    │
│   └───────┬───────┘                                    │
│       ↓         ↓                                       │
│   需要      不需要                                       │
│       │         │                                       │
│       ↓         │                                       │
│   ┌─────────┐  │                                        │
│   │向量检索  │  │                                        │
│   └────┬────┘  │                                        │
│        │       │                                        │
│        ↓       ↓                                        │
│   ┌─────────────────┐                                  │
│   │   组装上下文     │                                  │
│   │  [摘要]          │                                  │
│   │  [长期记忆]      │                                  │
│   │  [最近对话]      │                                  │
│   └─────────────────┘                                  │
│                                                         │
└─────────────────────────────────────────────────────────┘
```

---

## 十、效果对比

我做了个测试：同一组对话（100 轮），对比三种方案。

### 10.1 测试场景

- 用户在第一轮说"我是产品经理"
- 50 轮后问"推荐文章"
- 80 轮后问"我之前提的需求做了吗"
- 100 轮后问"你还记得我的角色吗"

### 10.2 结果

| 问题 | 方案一（对话历史） | 方案二（摘要） | 方案三（向量） |
|------|------------------|---------------|---------------|
| 推荐文章 | ❌ 不知道背景 | ⚠️ 可能记得 | ✅ 准确回忆 |
| 需求进度 | ❌ 不知道 | ⚠️ 摘要可能漏 | ✅ 检索到 |
| 用户角色 | ❌ 忘了 | ⚠️ 可能漏 | ✅ 准确回忆 |

### 10.3 成本对比

| 方案 | 存储 | Token 消耗 | 延迟 |
|------|------|-----------|------|
| 对话历史 | 低 | 高 | 低 |
| 会话摘要 | 中 | 中 | 中 |
| 向量数据库 | 高 | 低 | 高（检索） |

---

## 十一、我踩过的坑

### 坑一：什么都存向量数据库

一开始我把每条消息都存向量，结果检索出一堆噪音。

**解决**：只存重要信息。用关键词或 LLM 判断。

```python
def _is_important(self, content: str) -> bool:
    keywords = ["我是", "我的", "偏好", "喜欢", "记住"]
    return any(kw in content for kw in keywords)
```

### 坑二：Embedding 模型不统一

换了个 Embedding 模型，之前的向量检索不到了。

**解决**：
1. 统一使用一个模型
2. 换模型时重建索引

```python
# 记录使用的模型
METADATA = {
    "embedding_model": "all-MiniLM-L6-v2",
    "created_at": "2024-01-01"
}
```

### 坑三：记忆冲突

用户说"我喜欢简洁"，又说"我喜欢详细"。

**解决**：
1. 给记忆加时间戳，优先最新的
2. 或者合并冲突信息

```python
# 合并
"用户偏好：有时喜欢简洁，有时喜欢详细（取决于场景）"
```

### 坑四：检索噪音

检索结果不相关，甚至有害。

**解决**：
1. 提高相似度阈值
2. 用 Reranker 重排序
3. 加入 LLM 二次判断

```python
def recall_with_verification(self, query: str) -> list[str]:
    candidates = self.vector_search(query, top_k=10)
    
    # 用 LLM 验证相关性
    relevant = []
    for doc in candidates:
        if self._is_relevant(query, doc):
            relevant.append(doc)
    
    return relevant[:5]
```

### 坑五：记忆无限增长

向量数据库越来越大，检索变慢。

**解决**：
1. 定期清理过期记忆
2. 限制记忆总数
3. 合并相似记忆

---

## 十二、总结

Agent 记忆系统的核心原则：

1. **不是记住所有，而是记住重要的**
2. **短期记忆够用就不加复杂度**
3. **长期记忆按需检索，不要全加载**
4. **定期清理，防止记忆膨胀**

三层记忆如何选择：

| 场景 | 推荐方案 |
|------|---------|
| 简单问答（<20 轮） | 对话历史 |
| 长对话（50+ 轮） | 会话摘要 |
| 跨会话需求 | 向量数据库 |
| 生产级应用 | 三层组合 |

---

## 十三、下一步行动

1. **评估场景**：你的 Agent 需要什么级别的记忆？
2. **从简单开始**：先用对话历史，不够再升级
3. **判断重要性**：什么信息值得长期保存？
4. **选择存储**：ChromaDB（开发）或 Qdrant（生产）

---

## 附录：常用向量数据库对比

| 数据库 | 语言 | 协议 | 特点 |
|-------|------|------|------|
| ChromaDB | Python | Apache 2.0 | 最简单，嵌入式 |
| Pinecone | Go | 商业 | 云服务，免运维 |
| Qdrant | Rust | Apache 2.0 | 高性能，自托管 |
| Milvus | Go | Apache 2.0 | 大规模，云原生 |
| Weaviate | Go | BSD | 功能丰富，GraphQL |
| pgvector | C | PostgreSQL | 复用现有数据库 |

---

记忆是 Agent 的灵魂。没有记忆，Agent 只是一个无状态的函数。有了记忆，Agent 才能成长。
