---
sidebar_position: 3
title: 数据库设计与 ORM
slug: database-design-orm
---

# 数据库设计与 ORM

Agent 聊天记录莫名丢失、会话状态查询慢、并发写入冲突——这些问题的根源往往是数据库设计。把对话历史塞在内存 dict 里，服务重启就清零；用 JSON 字符串拼接存消息，10 万条后加载历史要 8 秒。

Agent 系统的数据模型比传统 CRUD 复杂得多：对话状态、工具调用记录、记忆存储、向量检索，每一层都有自己的设计考量。

## Agent 数据模型设计

### 为什么 Agent 的数据模型和普通 Web 应用不同

普通 Web 应用的核心模型通常是 User → Order → Product 这种线性关系。Agent 系统则天然带有"对话流"和"状态机"的特征：

- 一个 Agent 可以同时服务多个会话（Session）
- 每个会话包含多轮消息，消息之间有顺序和依赖
- Agent 在执行过程中会产生工具调用（Tool Call），这些调用需要持久化
- Agent 的记忆（Memory）是跨会话的，需要独立的存储策略
- 状态流转需要支持回溯和审计

这意味着你的数据模型不能只考虑"存"，还要考虑"查"和"恢复"的效率。

### 核心数据模型

下面是 Agent 系统中最常见的实体关系：

```
+------------------+       +-------------------+
|     Agent        |  1:N  |      Session      |
|------------------|-------|-------------------|
| id (PK)          |       | id (PK)           |
| name             |       | agent_id (FK)     |
| system_prompt    |       | user_id (FK)      |
| model_config     |       | status            |
| created_at       |       | created_at        |
| updated_at       |       | updated_at        |
+------------------+       +--------+----------+
                                     |
                                     | 1:N
                                     v
+------------------+       +-------------------+
|   ToolCall       |  1:1  |     Message       |
|------------------|-------|-------------------|
| id (PK)          |       | id (PK)           |
| message_id (FK)  |       | session_id (FK)   |
| tool_name        |       | role              |
| arguments        |       | content           |
| result           |       | token_count       |
| latency_ms       |       | metadata (JSON)   |
| status           |       | created_at        |
+------------------+       +-------------------+

+------------------+       +-------------------+
|      User        |  1:N  |      Memory       |
|------------------|-------|-------------------|
| id (PK)          |       | id (PK)           |
| external_id      |       | user_id (FK)      |
| metadata (JSON)  |       | kind              |
| created_at       |       | content           |
+------------------+       | embedding (向量)   |
                           | created_at        |
                           +-------------------+
```

### 关系设计要点

**1. Agent 和 Session 是一对多关系**

一个 Agent 实例可以同时处理多个用户的会话。设计时要注意 Session 表必须带 `agent_id` 外键，这样你可以针对不同 Agent 分别查询和清理历史。

**2. Message 是核心表，必须轻量高效**

Message 表会被高频读写。每一轮对话（用户输入 + Agent 回复）至少产生 2 条记录。如果 Agent 使用了工具，还会产生额外的 tool_call 和 tool_result 消息。日均活跃用户 1000 的 Agent 服务，一个月轻松积累百万级消息记录。

**3. ToolCall 单独建表而非嵌套在 Message 中**

虽然很多框架（比如 LangChain）习惯把工具调用结果直接拼在消息的 `additional_kwargs` 里，但生产环境下建议单独建表。原因：工具调用有独立的生命周期（执行中、成功、失败、超时），单独建表方便查询性能指标和错误排查。

**4. Memory 和 Session 是平行概念**

Memory 是跨会话的长期记忆，不属于某一个 Session。它的存储策略通常涉及向量数据库，我们在后文单独讨论。

## SQLAlchemy 基础：2.0 风格

### 为什么选 SQLAlchemy

Python 生态中 ORM 选择不少：SQLAlchemy、Tortoise ORM、Peewee、PonyORM。对 Agent 开发来说，SQLAlchemy 是最佳选择，原因有三：

- 生态成熟，几乎所有数据库驱动都有对应方言
- 2.0 版本引入了全新的类型安全 API，和 Python 类型注解配合良好
- 支持同步和异步两种模式，一套模型定义可以同时适用

### 模型定义：Mapped 类型注解风格

SQLAlchemy 2.0 推荐使用 `Mapped` 类型注解来定义模型，不再需要单独写 `Column()`：

```python
from datetime import datetime
from enum import Enum as PyEnum

from sqlalchemy import (
    String, Text, Integer, Float,
    ForeignKey, JSON, Enum, Index,
    func,
)
from sqlalchemy.orm import (
    DeclarativeBase, Mapped, mapped_column,
    relationship,
)

class Base(DeclarativeBase):
    """所有模型的基类"""
    pass

class MessageRole(str, PyEnum):
    SYSTEM = "system"
    USER = "user"
    ASSISTANT = "assistant"
    TOOL = "tool"

class SessionStatus(str, PyEnum):
    ACTIVE = "active"
    ENDED = "ended"
    ERROR = "error"

class Agent(Base):
    __tablename__ = "agents"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    name: Mapped[str] = mapped_column(String(100), unique=True, index=True)
    system_prompt: Mapped[str] = mapped_column(Text, default="")
    model_config: Mapped[dict] = mapped_column(JSON, default=dict)
    created_at: Mapped[datetime] = mapped_column(
        server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        server_default=func.now(), onupdate=func.now()
    )

    # 关系
    sessions: Mapped[list["Session"]] = relationship(
        back_populates="agent", cascade="all, delete-orphan"
    )

class Session(Base):
    __tablename__ = "sessions"
    __table_args__ = (
        Index("ix_sessions_agent_status", "agent_id", "status"),
    )

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    agent_id: Mapped[int] = mapped_column(ForeignKey("agents.id"))
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True)
    status: Mapped[SessionStatus] = mapped_column(
        Enum(SessionStatus), default=SessionStatus.ACTIVE
    )
    created_at: Mapped[datetime] = mapped_column(
        server_default=func.now()
    )

    agent: Mapped["Agent"] = relationship(back_populates="sessions")
    messages: Mapped[list["Message"]] = relationship(
        back_populates="session", cascade="all, delete-orphan",
        order_by="Message.created_at",
    )

class Message(Base):
    __tablename__ = "messages"
    __table_args__ = (
        Index("ix_messages_session_created", "session_id", "created_at"),
    )

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    session_id: Mapped[int] = mapped_column(ForeignKey("sessions.id"), index=True)
    role: Mapped[MessageRole] = mapped_column(Enum(MessageRole))
    content: Mapped[str] = mapped_column(Text, default="")
    token_count: Mapped[int | None] = mapped_column(Integer, nullable=True)
    metadata_: Mapped[dict | None] = mapped_column(
        "metadata", JSON, nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(
        server_default=func.now()
    )

    session: Mapped["Session"] = relationship(back_populates="messages")
    tool_call: Mapped["ToolCall | None"] = relationship(
        back_populates="message", uselist=False
    )

class ToolCall(Base):
    __tablename__ = "tool_calls"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    message_id: Mapped[int] = mapped_column(
        ForeignKey("messages.id"), unique=True
    )
    tool_name: Mapped[str] = mapped_column(String(100), index=True)
    arguments: Mapped[dict] = mapped_column(JSON, default=dict)
    result: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    latency_ms: Mapped[float | None] = mapped_column(Float, nullable=True)
    status: Mapped[str] = mapped_column(String(20), default="pending")

    message: Mapped["Message"] = relationship(back_populates="tool_call")
```

### Pydantic 和 SQLAlchemy 模型的分工

在 Agent 项目中，通常需要两套模型：SQLAlchemy 模型管数据库，Pydantic 模型管 API 传输和校验。不要混用。

```python
from pydantic import BaseModel, ConfigDict
from datetime import datetime

# Pydantic schema: 用于 API 请求/响应
class MessageCreate(BaseModel):
    role: MessageRole
    content: str

class MessageRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    role: MessageRole
    content: str
    created_at: datetime

class SessionCreate(BaseModel):
    agent_id: int

class SessionRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    agent_id: int
    status: SessionStatus
    created_at: datetime
    messages: list[MessageRead] = []
```

`ConfigDict(from_attributes=True)` 让 Pydantic 可以直接从 SQLAlchemy 实例序列化，不需要手动转换字典。

## 异步 ORM：Tortoise / SQLAlchemy Async

### 为什么 Agent 系统必须用异步

Agent 的核心循环是：接收消息 → 调用 LLM → 等待响应 → 执行工具 → 返回结果。LLM 调用本身就是 I/O 密集型（一次 API 调用几百毫秒到几十秒），如果数据库操作也是同步的，整个事件循环会被阻塞。

异步 ORM 的好处：

- LLM 等待期间可以处理其他请求
- 数据库连接池利用率更高
- 和 FastAPI / LangChain 的异步生态天然契合

### SQLAlchemy AsyncSession

SQLAlchemy 2.0 原生支持异步，核心是 `AsyncSession`：

```python
from sqlalchemy.ext.asyncio import (
    create_async_engine,
    async_sessionmaker,
    AsyncSession,
)

# 异步引擎（注意连接串用 aiopg / aiosqlite 驱动）
DATABASE_URL = "postgresql+asyncpg://user:pass@localhost/agent_db"

engine = create_async_engine(
    DATABASE_URL,
    echo=False,
    pool_size=20,         # 连接池大小
    max_overflow=10,      # 超出 pool_size 后最多再借 10 个
    pool_pre_ping=True,   # 每次取连接前先 ping，避免用断开的连接
)

AsyncSessionLocal = async_sessionmaker(
    engine,
    class_=AsyncSession,
    expire_on_commit=False,  # Agent 场景必须设 False
)

async def get_db_session() -> AsyncSession:
    """FastAPI 依赖注入用的 session 工厂"""
    async with AsyncSessionLocal() as session:
        try:
            yield session
            await session.commit()
        except Exception:
            await session.rollback()
            raise
```

`expire_on_commit=False` 是个关键参数。默认情况下 SQLAlchemy 提交后会把所有对象标记为"过期"，下次访问属性会触发延迟加载——但在异步场景下延迟加载会导致 `MissingGreenlet` 错误。Agent 场景下通常提交后还需要继续使用对象，所以必须关闭这个行为。

### Tortoise ORM 方案

如果你更喜欢 Django 风格的 ORM 体验，Tortoise ORM 也是一个不错的选择。它天然异步，API 更贴近 Django：

```python
from tortoise import models, fields

class Agent(models.Model):
    id = fields.IntField(pk=True)
    name = fields.CharField(max_length=100, unique=True)
    system_prompt = fields.TextField(default="")
    model_config = fields.JSONField(default=dict)
    created_at = fields.DatetimeField(auto_now_add=True)

    sessions: fields.ReverseRelation["Session"]

    class Meta:
        table = "agents"

class Session(models.Model):
    id = fields.IntField(pk=True)
    agent = fields.ForeignKeyField(
        "models.Agent", related_name="sessions"
    )
    user_id = fields.IntField(index=True)
    status = fields.CharField(max_length=20, default="active")
    created_at = fields.DatetimeField(auto_now_add=True)

    messages: fields.ReverseRelation["Message"]

    class Meta:
        table = "sessions"

class Message(models.Model):
    id = fields.IntField(pk=True)
    session = fields.ForeignKeyField(
        "models.Session", related_name="messages"
    )
    role = fields.CharField(max_length=20)
    content = fields.TextField(default="")
    created_at = fields.DatetimeField(auto_now_add=True)

    class Meta:
        table = "messages"
```

Tortoise ORM 和 SQLAlchemy 的取舍：如果你的项目和 LangChain/LangGraph 深度集成，选 SQLAlchemy（LangChain 原生支持）；如果追求开发效率和 Django 迁移经验，选 Tortoise。

## Session 管理

### Session 生命周期

Agent 的 Session 管理远比普通 Web 应用的 session 复杂：

```
创建 Session
    |
    v
[status = active] <----+
    |                   |
    | 收到用户消息        | 新一轮对话
    v                   |
 加载历史消息             |
    |                   |
    v                   |
 调用 LLM (带历史上下文)  |
    |                   |
    +-----> 收到回复 -----+
    |
    | 用户长时间无操作 / 显式关闭
    v
[status = ended]
    |
    v
 后处理（归档、统计 token 消耗等）
```

### 异步 CRUD 操作示例

```python
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

async def create_session(
    db: AsyncSession, agent_id: int, user_id: int
) -> Session:
    """创建新的对话 Session"""
    session = Session(
        agent_id=agent_id,
        user_id=user_id,
        status=SessionStatus.ACTIVE,
    )
    db.add(session)
    await db.flush()  # flush 不提交，只生成 ID
    return session

async def add_message(
    db: AsyncSession,
    session_id: int,
    role: MessageRole,
    content: str,
    token_count: int | None = None,
) -> Message:
    """向 Session 追加一条消息"""
    message = Message(
        session_id=session_id,
        role=role,
        content=content,
        token_count=token_count,
    )
    db.add(message)
    await db.flush()
    return message

async def get_conversation_history(
    db: AsyncSession,
    session_id: int,
    limit: int = 50,
) -> list[Message]:
    """
    获取对话历史，按时间倒序取最近 N 条。
    注意：LLM 调用时需要反转为正序。
    """
    stmt = (
        select(Message)
        .where(Message.session_id == session_id)
        .order_by(Message.created_at.desc())
        .limit(limit)
    )
    result = await db.execute(stmt)
    messages = list(result.scalars().all())
    messages.reverse()  # 转为正序
    return messages

async def end_session(db: AsyncSession, session_id: int) -> None:
    """结束一个 Session"""
    stmt = select(Session).where(Session.id == session_id)
    result = await db.execute(stmt)
    session = result.scalar_one()
    session.status = SessionStatus.ENDED
```

### 关于 `flush()` 和 `commit()` 的选择

很多初学者搞不清这两个的区别：

- `flush()` 把 SQL 发送给数据库但不提交事务，数据库会分配主键 ID，但其他连接看不到这些数据
- `commit()` 提交事务，所有修改对其他连接可见

在 Agent 系统中推荐的模式是：每一步操作只 `flush()`，在整个 Agent 执行循环结束后统一 `commit()`。这样做的好处是：

1. 中间出错可以整体回滚，不会留下脏数据
2. 减少数据库提交次数，性能更好
3. 主键 ID 已经生成，可以在后续步骤中使用

```python
async def agent_turn(db: AsyncSession, session_id: int, user_input: str):
    """一次完整的 Agent 轮次"""
    # 1. 保存用户消息
    user_msg = await add_message(db, session_id, MessageRole.USER, user_input)

    # 2. 加载历史
    history = await get_conversation_history(db, session_id)

    # 3. 调用 LLM（可能触发工具调用）
    response = await llm.chat(history)

    # 4. 保存助手回复
    assistant_msg = await add_message(
        db, session_id, MessageRole.ASSISTANT,
        response.content, token_count=response.usage.total_tokens,
    )

    # 5. 如果有工具调用，保存记录
    for tc in response.tool_calls:
        tool_call = ToolCall(
            message_id=assistant_msg.id,
            tool_name=tc.name,
            arguments=tc.arguments,
            result=tc.result,
            latency_ms=tc.latency_ms,
            status="completed",
        )
        db.add(tool_call)

    # 6. 统一提交
    await db.commit()
```

## 迁移策略：Alembic

### 为什么 Agent 项目特别需要迁移管理

Agent 系统的数据模型迭代很快——今天存纯文本，明天要加向量字段；这周只需要基础对话，下周要加 Agent 记忆。如果没有迁移工具，每次改模型都要手动写 SQL 或者重建表，在生产环境是灾难。

Alembic 是 SQLAlchemy 官方的迁移工具，类似于前端世界中的数据库版本控制。

### 基本配置

```bash
# 初始化（生成 alembic/ 目录和 alembic.ini）
alembic init alembic

# 修改 alembic.ini 中的连接串
# sqlalchemy.url = postgresql+asyncpg://user:pass@localhost/agent_db
```

```python
# alembic/env.py 关键修改
from sqlalchemy import pool
from sqlalchemy.ext.asyncio import async_engine_from_config
from alembic import context

# 导入你的所有模型，确保 Alembic 能检测到
from app.models import Base

target_metadata = Base.metadata

def run_migrations_offline() -> None:
    """离线模式生成 SQL 脚本"""
    url = config.get_main_option("sqlalchemy.url")
    context.configure(
        url=url,
        target_metadata=target_metadata,
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
    )
    with context.begin_transaction():
        context.run_migrations()

def do_run_migrations(connection):
    context.configure(connection=connection, target_metadata=target_metadata)
    with context.begin_transaction():
        context.run_migrations()

async def run_async_migrations() -> None:
    """异步模式执行迁移"""
    connectable = async_engine_from_config(
        config.get_section(config.config_ini_section, {}),
        prefix="sqlalchemy.",
        poolclass=pool.NullPool,
    )
    async with connectable.connect() as connection:
        await connection.run_sync(do_run_migrations)
    await connectable.dispose()

def run_migrations_online() -> None:
    import asyncio
    asyncio.run(run_async_migrations())

if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
```

### 日常使用

```bash
# 修改模型后自动生成迁移文件
alembic revision --autogenerate -m "add memory table"

# 检查生成的迁移文件（重要！autogenerate 不是万能的）
# 然后执行迁移
alembic upgrade head

# 回滚一步
alembic downgrade -1

# 回滚到指定版本
alembic downgrade abc123
```

### Agent 项目中的迁移注意事项

1. **不要在生产环境用 `--autogenerate` 直接升级**。先生成迁移文件，人工审查后再执行。
2. **大数据量表加字段时注意锁表时间**。给百万级消息表加字段，PostgreSQL 需要全表重写。可以用 `ALTER TABLE ... ADD COLUMN ... DEFAULT ...` 的方式避免锁全表。
3. **向量字段的迁移要特别小心**。pgvector 扩展的 `vector` 类型需要先安装扩展：`CREATE EXTENSION IF NOT EXISTS vector`，这个可以在迁移文件中显式执行。

## Agent 状态持久化

### 三种需要持久化的状态

```
+-----------------------------------------------------+
|                  Agent 状态全景                       |
+-----------------------------------------------------+
|                                                     |
|  1. 对话状态（Conversation State）                    |
|     - 当前会话的消息历史                               |
|     - 上下文窗口管理（token 截断策略）                   |
|                                                     |
|  2. 工具调用状态（Tool Call State）                    |
|     - 正在执行的工具调用                               |
|     - 工具调用结果缓存                                 |
|     - 重试记录                                       |
|                                                     |
|  3. 记忆状态（Memory State）                          |
|     - 短期记忆（当前会话的摘要）                         |
|     - 长期记忆（跨会话的事实和偏好）                      |
|     - 向量检索结果                                    |
|                                                     |
+-----------------------------------------------------+
```

### 对话状态的上下文窗口管理

LLM 有 token 上限（GPT-4o 约 128K，Claude 约 200K），但成本和延迟随 token 数增长。实际项目中通常会做截断：

```python
import tiktoken

def truncate_history(
    messages: list[dict],
    max_tokens: int = 8000,
    keep_system: bool = True,
    keep_recent: int = 10,
) -> list[dict]:
    """
    截断对话历史，保留 system prompt + 最近 N 条 + 尽可能多的早期消息。

    策略：
    1. system prompt 始终保留
    2. 最近 keep_recent 条消息始终保留
    3. 剩余 token 预算分配给早期消息（从新到旧）
    """
    encoding = tiktoken.encoding_for_model("gpt-4o")
    result = []
    used_tokens = 0

    # 1. 保留 system prompt
    if keep_system and messages and messages[0]["role"] == "system":
        system_tokens = len(encoding.encode(messages[0]["content"]))
        used_tokens += system_tokens
        result.append(messages[0])

    # 2. 最近的消息（从旧到新）
    recent = messages[-keep_recent:] if keep_system else messages[-keep_recent:]
    recent_tokens = sum(
        len(encoding.encode(m["content"])) for m in recent
    )

    # 3. 从剩余早期消息中，尽可能多地加入（从新到旧）
    early = messages[
        (1 if keep_system else 0):-keep_recent
    ] if len(messages) > keep_recent else []

    remaining_budget = max_tokens - used_tokens - recent_tokens
    for msg in reversed(early):
        msg_tokens = len(encoding.encode(msg["content"]))
        if remaining_budget - msg_tokens >= 0:
            remaining_budget -= msg_tokens
        else:
            break

    # 4. 组装最终结果
    # ...（省略具体拼接逻辑，核心思路是按顺序拼装）
    return result
```

### 记忆的持久化策略

Agent 的记忆分两层：

**短期记忆**：当前会话的对话摘要。通常在会话结束时用 LLM 生成摘要，存入数据库的 `metadata` 字段。

**长期记忆**：跨会话的事实和用户偏好。需要向量存储来支持语义检索。

```python
from sqlalchemy import Column, String, Text, Integer
from pgvector.sqlalchemy import Vector

class Memory(Base):
    __tablename__ = "memories"

    id = Column(Integer, primary_key=True, autoincrement=True)
    user_id = Column(Integer, ForeignKey("users.id"), index=True)
    kind = Column(String(20), index=True)  # "fact" / "preference" / "summary"
    content = Column(Text, nullable=False)
    embedding = Column(Vector(1536), nullable=True)  # OpenAI ada-002 维度
    created_at = Column(DateTime, server_default=func.now())

    __table_args__ = (
        Index("ix_memories_user_kind", "user_id", "kind"),
    )
```

查询时用余弦相似度检索最相关的记忆：

```python
from sqlalchemy import text

async def search_memories(
    db: AsyncSession,
    user_id: int,
    query_embedding: list[float],
    top_k: int = 5,
) -> list[Memory]:
    """向量检索最相关的记忆"""
    stmt = text("""
        SELECT id, content, kind,
               1 - (embedding <=> :embedding) AS similarity
        FROM memories
        WHERE user_id = :user_id
          AND embedding IS NOT NULL
        ORDER BY embedding <=> :embedding
        LIMIT :top_k
    """)
    result = await db.execute(stmt, {
        "user_id": user_id,
        "embedding": query_embedding,
        "top_k": top_k,
    })
    return result.fetchall()
```

`<=>` 是 pgvector 的余弦距离操作符，值越小越相似，所以用 `1 - distance` 得到相似度。

## 连接池管理

Agent 系统对连接池的要求和普通 Web 应用不同：LLM 调用期间会话被长时间占用，如果连接池太小，新请求会排队等连接。

### 关键参数

```python
engine = create_async_engine(
    DATABASE_URL,
    pool_size=20,          # 常驻连接数
    max_overflow=10,       # 高峰期允许额外借用
    pool_timeout=30,       # 等待连接的超时时间（秒）
    pool_recycle=1800,     # 连接存活时间（秒），超过后回收
    pool_pre_ping=True,    # 使用前检测连接是否有效
)
```

`pool_pre_ping` 非常重要。PostgreSQL 默认空闲连接超过一定时间会断开（通常是 10 分钟），如果不用 pre-ping，你可能会拿到一个已经断开的连接然后报错。开启后每次从池中取连接时会先发一个 `SELECT 1` 测试，确保连接有效。代价是多一次网络往返，但比起连接断开导致的异常，这点开销完全可以接受。

### 连接数估算

一个经验公式：

```
连接池大小 = CPU 核数 * 2 + 磁盘数
```

对于异步场景，这个公式不太适用。异步场景下大部分时间连接都在等 LLM 响应，所以可以适当放大。一般经验值：

- 小规模（日活 100 以下）：`pool_size=5, max_overflow=5`
- 中规模（日活 1000 左右）：`pool_size=20, max_overflow=10`
- 大规模（日活 10000+）：考虑读写分离 + 连接池中间件（如 PgBouncer）

## 常见坑与注意事项

### 坑 1：忘记 `expire_on_commit=False`

如前所述，SQLAlchemy 默认在 commit 后让所有 ORM 对象过期。在同步代码中这不是问题，因为下次访问属性时会自动 lazy load。但在 async 代码中，lazy load 需要 greenlet 支持，如果当前上下文没有 greenlet 运行时，会直接报错：

```
sqlalchemy.exc.MissingGreenlet: greenlet_spawn has not been called
```

**解法**：在创建 `async_sessionmaker` 时设置 `expire_on_commit=False`。

### 坑 2：N+1 查询问题

Agent 的对话历史加载是最容易出现 N+1 的地方。如果 Session 和 Message 是延迟加载关系，遍历 `session.messages` 时每条消息都会触发一次查询。

```python
# 错误写法：会触发 N+1
stmt = select(Session).where(Session.id == session_id)
result = await db.execute(stmt)
session = result.scalar_one()
for msg in session.messages:  # 这里每条消息都查一次数据库！
    pass

# 正确写法：用 selectinload 一次性加载
from sqlalchemy.orm import selectinload

stmt = (
    select(Session)
    .where(Session.id == session_id)
    .options(selectinload(Session.messages))
)
result = await db.execute(stmt)
session = result.scalar_one()
for msg in session.messages:  # 不会再触发额外查询
    pass
```

### 坑 3：并发写入导致数据覆盖

当多个请求同时修改同一个 Session 的消息列表时，可能出现最后写入者覆盖的问题。特别是当两个 LLM 调用同时返回结果时。

**解法**：给 Session 加乐观锁：

```python
class Session(Base):
    __tablename__ = "sessions"
    # ...
    version: Mapped[int] = mapped_column(Integer, default=1)
```

写入时检查版本号：

```python
async def safe_add_message(
    db: AsyncSession,
    session_id: int,
    role: MessageRole,
    content: str,
) -> Message:
    stmt = select(Session).where(
        Session.id == session_id,
        Session.version == Session.version,  # 悲观检查
    )
    result = await db.execute(stmt)
    session = result.scalar_one_or_none()
    if session is None:
        raise ValueError("Session was modified concurrently, retry")

    message = Message(
        session_id=session_id, role=role, content=content,
    )
    db.add(message)
    session.version += 1
    await db.flush()
    return message
```

### 坑 4：JSON 字段的查询效率

Agent 模型大量使用 JSON 字段存储配置和元数据。但 JSON 字段的查询性能远不如结构化字段。如果你需要频繁按 JSON 内的某个 key 查询（比如按 `model_config["model_name"]` 过滤），应该把这个字段提升为独立列：

```python
# 不好：查询时需要用 JSON 操作符
model_config = mapped_column(JSON)

# 好：把常用查询字段独立出来
model_name = mapped_column(String(50), index=True)  # 从 config 中提取
model_config = mapped_column(JSON)  # 完整配置仍然保留
```

### 坑 5：迁移文件冲突

多人协作时，Alembic 的迁移文件容易产生冲突（大家都基于同一个版本生成了新版本）。解决方案是约定迁移分支策略：

1. 每个开发者基于 `alembic head` 创建迁移
2. 合并前先执行 `alembic merge` 合并多个头
3. 在 CI 中加入检查：`alembic heads` 的数量应该只有一个

## 参考资料

- [SQLAlchemy 2.0 官方文档](https://docs.sqlalchemy.org/en/20/)
- [Alembic 迁移教程](https://alembic.sqlalchemy.org/en/latest/tutorial.html)
- [pgvector: 向量相似度搜索](https://github.com/pgvector/pgvector)
- [Tortoise ORM 文档](https://tortoise-orm.readthedocs.io/)
- [FastAPI + SQLAlchemy 异步模式](https://fastapi.tiangolo.com/how-to/async-sql-encode-2.0/)
- [LangChain: 对话消息管理](https://python.langchain.com/docs/modules/memory/)
