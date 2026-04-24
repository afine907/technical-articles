# AI Agent 长期记忆管理实现

> 基于 jojo-code 的 Memory 模块实现分析，探讨 AI Agent 如何管理对话历史和上下文记忆

## 背景

- 为什么写：理解 AI Agent 如何在多轮对话中保持上下文连贯性
- 解决什么问题：对话上下文过长导致的 token 溢出和成本问题
- 目标读者：对 AI Agent 开发感兴趣的技术人员

## 正文

### 1. 记忆管理的设计思路

AI Agent 的长期记忆管理面临两大核心挑战：**上下文长度限制**和**记忆持久化**。jojo-code 采用分层管理策略：

- **内存层**：快速读写的消息列表
- **持久层**：基于文件的 JSON 存储，支持跨会话恢复
- **压缩层**：当 token 超限时自动压缩历史

核心设计原则：
- **渐进式遗忘**：不删除旧记忆，而是压缩保留摘要
- **自动管理**：减少开发者手动干预
- **兼容性**：保留旧 API 的同时支持 LangChain 消息类型

### 2. 核心数据结构

项目定义了三个层级的数据结构：

```python
@dataclass
class Message:
    role: str                    # 消息角色（user/assistant）
    content: str                 # 消息内容
    metadata: dict = field(...)  # 元数据
    timestamp: datetime = field(default_factory=datetime.now)

@dataclass
class Conversation:
    id: str                      # 对话唯一标识
    messages: list = field(...)  # 消息列表
    created_at: datetime
    updated_at: datetime
```

`ConversationMemory` 是核心类，整合消息管理与持久化：

| 属性 | 类型 | 说明 |
|------|------|------|
| `messages` | `list[BaseMessage]` | LangChain 消息列表 |
| `max_tokens` | `int` | 触发压缩的阈值（默认 100000） |
| `storage_path` | `Path` | 持久化文件路径 |
| `auto_save` | `bool` | 是否自动保存 |

### 3. 实现细节

**Token 计数与压缩**

使用 `tiktoken` 进行精确 token 计数：
```python
def token_count(self) -> int:
    total = 0
    for msg in self.messages:
        content = msg.content if isinstance(msg.content, str) else str(msg.content)
        total += len(self._encoding.encode(content))
    return total
```

压缩策略（`_compress` 方法）：
1. 保留所有 SystemMessage（系统级重要指令）
2. 保留最近 20 条普通消息
3. 生成占位摘要消息替换被丢弃的早期消息

**持久化机制**

基于 JSON 文件存储，序列化时记录消息类型：
```python
def save(self) -> None:
    data = {
        "messages": [
            {"type": msg.__class__.__name__, "content": msg.content}
            for msg in self.messages
        ]
    }
    with open(self.storage_path, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
```

**多会话管理**

`ConversationManager` 支持管理多个独立对话：
```python
def create_conversation(self, conversation_id: str) -> Conversation
def get_conversation(self, conversation_id: str) -> Conversation | None
def list_conversations(self) -> list[Conversation]
def delete_conversation(self, conversation_id: str) -> bool
```

### 4. 使用示例

```python
from pathlib import Path
from langchain_core.messages import HumanMessage, AIMessage
from jojo_code.memory.conversation import ConversationMemory

# 初始化（支持持久化）
memory = ConversationMemory(
    max_tokens=100000,
    storage_path=Path("./memory/conversation.json"),
    auto_save=True
)

# 添加消息
memory.add_message(HumanMessage(content="你好，请介绍一下你自己"))
memory.add_message(AIMessage(content="我是 AI Agent..."))

# 获取上下文
context = memory.get_context()

# 获取最近 N 条
recent = memory.get_last_n_messages(5)

# 手动保存/加载
memory.save()
memory.load()
```

## 总结

- 采用分层设计（内存→压缩→持久化）平衡性能和资源
- 基于 token 阈值触发自动压缩，避免上下文溢出
- JSON 文件存储实现跨会话记忆恢复
- LangChain 消息类型集成便于与其他组件协作

## 参考资料

- [jojo-code memory 模块源码](https://github.com/example/jojo-code)
- [LangChain Messages 文档](https://python.langchain.com/docs/concepts/messages/)
- [tiktoken 文档](https://github.com/openai/tiktoken)

---

**作者**: AI Assistant
**日期**: 2026-04-24
**标签**: AI Agent, 记忆管理, LangChain