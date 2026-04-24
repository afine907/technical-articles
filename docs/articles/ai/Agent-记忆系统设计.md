# Agent 记忆演进：从对话历史到向量数据库

你的 Agent 记住了最近 20 条对话，但忘了 100 条之前的关键信息。

我之前做过一个客服 Agent，用户问"上次说的那个方案"，Agent 完全不记得了。因为"上次"是 200 条对话之前的事，早被压缩掉了。

后来我给 Agent 加了向量数据库，让它能"回忆"很久以前的信息。这篇文章，我来分享 Agent 记忆的演进路径。

## 记忆的三层架构

Agent 的记忆就像人类的记忆，分三层：

```
短期记忆（工作记忆）
├── 最近的对话历史
├── 容量有限（上下文窗口）
└── 临时存储，对话结束就忘

中期记忆（会话记忆）
├── 当前会话的关键信息
├── 存在文件或数据库
└── 可跨多轮对话保持

长期记忆（知识库）
├── 所有历史信息
├── 存在向量数据库
└── 可随时检索回忆
```

## 第一层：对话历史（默认方案）

最简单的记忆：保留最近的 N 条消息。

```python
class ConversationMemory:
    def __init__(self, max_messages=20):
        self.messages = []
        self.max_messages = max_messages
    
    def add(self, message):
        self.messages.append(message)
        if len(self.messages) > self.max_messages:
            self.messages = self.messages[-self.max_messages:]
    
    def get_context(self):
        return self.messages
```

**问题**：早期的重要信息会丢失。

比如用户在第一条消息说"我是产品经理"，聊了 50 轮后，这个信息被丢掉了，Agent 开始用技术术语，用户听不懂。

## 第二层：会话摘要（改进方案）

定期把对话压缩成摘要，保留关键信息。

```python
class SummaryMemory:
    def __init__(self, max_tokens=4000):
        self.messages = []
        self.summary = ""
        self.max_tokens = max_tokens
    
    def add(self, message):
        self.messages.append(message)
        
        if self._count_tokens() > self.max_tokens:
            self._summarize()
    
    def _summarize(self):
        # 调用 LLM 生成摘要
        prompt = f"总结以下对话的关键信息：\n{self.messages}"
        self.summary = llm.invoke(prompt)
        
        # 只保留最近几条
        self.messages = self.messages[-5:]
    
    def get_context(self):
        if self.summary:
            return [{"role": "system", "content": f"历史摘要：{self.summary}"}] + self.messages
        return self.messages
```

**优点**：信息保留更完整。
**缺点**：摘要有成本，且可能遗漏细节。

## 第三层：向量数据库（进阶方案）

把每条重要信息存入向量数据库，需要时检索。

```python
from chromadb import Client
from chromadb.config import Settings

class VectorMemory:
    def __init__(self):
        self.client = Client(Settings(
            chroma_db_impl="duckdb+parquet",
            persist_directory="./memory_db"
        ))
        self.collection = self.client.create_collection("memories")
    
    def save(self, text: str, metadata: dict = None):
        """保存记忆"""
        self.collection.add(
            documents=[text],
            metadatas=[metadata or {}],
            ids=[str(uuid.uuid4())]
        )
    
    def recall(self, query: str, n_results: int = 5) -> list[str]:
        """回忆相关记忆"""
        results = self.collection.query(
            query_texts=[query],
            n_results=n_results
        )
        return results["documents"][0]
```

使用方式：

```python
memory = VectorMemory()

# 用户说了重要信息
user_info = "用户是产品经理，主要关注用户体验"
memory.save(user_info, {"type": "user_profile"})

# 之后需要回忆
relevant = memory.recall("用户是什么角色")
# 返回: ["用户是产品经理，主要关注用户体验"]
```

## 完整的记忆系统

把三层结合起来：

```python
class AgentMemory:
    def __init__(self):
        # 短期：最近对话
        self.short_term = ConversationMemory(max_messages=20)
        
        # 长期：向量数据库
        self.long_term = VectorMemory()
    
    def add_message(self, message: dict):
        """添加消息"""
        # 存入短期记忆
        self.short_term.add(message)
        
        # 重要信息存入长期记忆
        if self._is_important(message):
            self.long_term.save(
                message["content"],
                {"role": message["role"], "timestamp": datetime.now().isoformat()}
            )
    
    def get_context(self, query: str = None) -> list[dict]:
        """获取上下文"""
        context = self.short_term.get_context()
        
        # 如果有查询，从长期记忆检索相关信息
        if query:
            relevant = self.long_term.recall(query, n_results=3)
            if relevant:
                context.insert(0, {
                    "role": "system",
                    "content": f"相关信息：\n" + "\n".join(relevant)
                })
        
        return context
    
    def _is_important(self, message: dict) -> bool:
        """判断是否是重要信息"""
        keywords = ["我是", "我的", "偏好", "要求", "注意", "记住"]
        return any(kw in message.get("content", "") for kw in keywords)
```

## 实际效果对比

场景：用户在第一轮说"我是产品经理"，聊了 50 轮后问"给我推荐一些适合我的文章"。

**方案一：对话历史**
```
Agent: 我不知道你的背景，无法推荐。
（因为"我是产品经理"被丢掉了）
```

**方案二：会话摘要**
```
Agent: 根据之前的对话，你是产品经理，我推荐...
（摘要可能漏掉这个细节）
```

**方案三：向量数据库**
```
Agent: 你是产品经理，我推荐产品思维相关的文章...
（准确回忆起用户身份）
```

## 我踩过的坑

**坑一：所有东西都存向量数据库**

一开始我把每条消息都存进去，结果检索出来一堆无关信息。

解决：只存"重要信息"。用关键词或 LLM 判断重要性。

**坑二：向量维度不匹配**

换了个 Embedding 模型，结果之前的向量检索不到。

解决：统一使用一个 Embedding 模型，或者重建索引。

**坑三：忘了清理旧记忆**

向量数据库越来越大，检索变慢。

解决：定期清理过期记忆：

```python
def cleanup_old_memories(days: int = 30):
    """清理 30 天前的记忆"""
    cutoff = datetime.now() - timedelta(days=days)
    # 删除旧数据...
```

## 下一步行动

1. **评估你的场景**：需要长期记忆吗？多长的对话？
2. **从会话摘要开始**：先试简单的方案，够用就别加复杂度
3. **重要信息单独存**：用户偏好、关键决策，存入长期记忆

记忆系统的核心是：**短期记忆够用就不加复杂度，长期记忆按需引入**。

---

Agent 的记忆和人类一样：不是记住所有，而是记住重要的，需要时能找到。
