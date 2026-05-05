---
sidebar_position: 1
title: FastAPI + LangChain 实战
slug: fastapi-langchain-practice
---

# FastAPI + LangChain 实战

Agent 需要一个后端 API 服务：接收用户输入、调用 LLM、流式返回结果。Python 生态里 Flask、Django、FastAPI 三个选择，FastAPI 的开发体验最接近前端熟悉的 Express/Koa，配合 LangChain 做 LLM 编排，是 Agent 后端的主流组合。

## 整体架构：你的 Agent API 长什么样

在写代码之前，先看看我们要搭建的系统整体长什么样：

```
+--------------------------------------------------+
|                   Client (Browser/App)            |
|               POST /api/v1/chat                   |
|               GET  /api/v1/chat/stream (SSE)      |
+--------------------------------------------------+
                         |
                         | HTTP Request
                         v
+--------------------------------------------------+
|              FastAPI Application Layer            |
+--------------------------------------------------+
|  Middleware (CORS, Rate Limit, Auth, Logging)     |
+--------------------------------------------------+
|  Router Layer (API Versioning /api/v1/)           |
+--------------------------------------------------+
|  Pydantic Request/Response Validation             |
+--------------------------------------------------+
|  Dependency Injection (LLM, DB, Cache)            |
+--------------------------------------------------+
+--------------------------------------------------+
|              LangChain Orchestration Layer        |
+--------------------------------------------------+
|  Prompt Templates -> Chain / Agent -> Tools       |
+--------------------------------------------------+
|  Streaming Handler (SSE / WebSocket)              |
+--------------------------------------------------+
+--------------------------------------------------+
|              External Services                    |
+--------------------------------------------------+
|  OpenAI API / 本地模型 / Vector DB / 检索工具    |
+--------------------------------------------------+
```

简单来说，前端请求进来，经过 FastAPI 的中间件层做校验和限流，然后路由到对应的处理函数，处理函数里面调用 LangChain 的 Chain 或 Agent 来和大模型交互，最后把结果返回给前端。如果需要流式输出，就用 SSE 把 token 一个一个推给前端。

## FastAPI 基础：你已经会一半了

如果你写过 Express 或者 Koa，FastAPI 会让你感到非常亲切。它本质上就是一个 Python 的 Web 框架，但天生支持异步，而且自带数据校验和 API 文档。

### 最小可运行示例

```python
from fastapi import FastAPI
from pydantic import BaseModel

app = FastAPI(title="Agent API", version="1.0.0")

class ChatRequest(BaseModel):
    message: str
    conversation_id: str | None = None

class ChatResponse(BaseModel):
    reply: str
    conversation_id: str

@app.post("/api/v1/chat")
async def chat(request: ChatRequest) -> ChatResponse:
    # 这里后续会接入 LangChain
    return ChatResponse(
        reply=f"收到: {request.message}",
        conversation_id=request.conversation_id or "new-session"
    )
```

几个关键点：

1. **Pydantic BaseModel**：相当于 TypeScript 的 interface，自动帮你做请求体校验。前端传错字段直接返回 422，不用你手动写 if/else。
2. **async/await**：FastAPI 原生支持异步，LLM 调用本身就是 IO 密集型，天然适合异步处理。
3. **类型注解**：Python 3.10+ 的类型系统，写起来比 TypeScript 的类型注解还简洁。

### Pydantic 模型设计

Agent API 的请求和响应往往比较复杂，好的模型设计能省很多事：

```python
from pydantic import BaseModel, Field
from enum import Enum

class ModelType(str, Enum):
    GPT4 = "gpt-4"
    GPT35_TURBO = "gpt-3.5-turbo"
    CLAUDE = "claude-3-opus"

class ChatMessage(BaseModel):
    role: str = Field(..., description="角色: user 或 assistant")
    content: str = Field(..., description="消息内容")

class AgentRequest(BaseModel):
    """Agent 聊天请求"""
    messages: list[ChatMessage] = Field(..., min_length=1)
    model: ModelType = ModelType.GPT4
    temperature: float = Field(default=0.7, ge=0.0, le=2.0)
    max_tokens: int = Field(default=2048, ge=1, le=8192)
    stream: bool = False
    tools: list[str] | None = None

class AgentResponse(BaseModel):
    """Agent 聊天响应"""
    content: str
    model: str
    usage: dict
    tool_calls: list[dict] | None = None
```

这种写法的好处是，FastAPI 会自动根据这些模型生成 OpenAPI 文档（访问 `/docs` 就能看到 Swagger UI），前端同学可以直接看文档来对接，不用来问你参数是什么类型。

## LangChain 基础：LLM 编排的瑞士军刀

LangChain 说白了就是一个帮你把 LLM 调用标准化的框架。它提供了 Chain、Agent、Tool 等概念，让你不用每次都手拼 prompt + 调 API + 解析响应。

### Chain：最简单的编排方式

Chain 就是把多个步骤串起来，数据从一头流到另一头：

```python
from langchain_openai import ChatOpenAI
from langchain_core.prompts import ChatPromptTemplate
from langchain_core.output_parsers import StrOutputParser

# 初始化 LLM
llm = ChatOpenAI(
    model="gpt-4",
    temperature=0.7,
    streaming=True,  # 开启流式输出
)

# 定义 Prompt 模板
prompt = ChatPromptTemplate.from_messages([
    ("system", "你是一个专业的技术顾问，擅长回答后端开发相关的问题。"),
    ("human", "{question}"),
])

# 组装 Chain
chain = prompt | llm | StrOutputParser()

# 调用
result = chain.invoke({"question": "FastAPI 和 Flask 有什么区别？"})
print(result)
```

那个 `|` 管道运算符是 LangChain v0.2+ 引入的 LCEL（LangChain Expression Language），读起来就像 Unix 管道一样，数据从左往右流。

### Agent：让 LLM 自己决定用什么工具

Chain 的步骤是固定的，但 Agent 可以根据用户的问题动态选择工具。比如用户问天气，Agent 就去调天气 API；问数据库里的数据，就去查数据库。

```python
from langchain_openai import ChatOpenAI
from langchain_core.tools import tool
from langgraph.prebuilt import create_react_agent

@tool
def search_knowledge_base(query: str) -> str:
    """搜索内部知识库，返回相关文档内容"""
    # 实际项目中这里会查向量数据库
    documents = {
        "部署流程": "1. git pull  2. docker build  3. docker push  4. kubectl apply",
        "代码规范": "使用 black 格式化，mypy 检查类型，pytest 写测试",
    }
    for key, value in documents.items():
        if key in query:
            return value
    return "未找到相关文档"

@tool
def calculate_expression(expression: str) -> str:
    """计算数学表达式，支持加减乘除和幂运算"""
    try:
        result = eval(expression)  # 生产环境请用 ast.literal_eval 或 sympy
        return str(result)
    except Exception as e:
        return f"计算错误: {e}"

# 创建 Agent
llm = ChatOpenAI(model="gpt-4", temperature=0)
tools = [search_knowledge_base, calculate_expression]
agent = create_react_agent(llm, tools)
```

## 核心集成：把 FastAPI 和 LangChain 粘在一起

这是整篇文章最关键的部分。怎么把 LangChain 的能力封装成一个生产级的 FastAPI 服务？

### 依赖注入：FastAPI 的杀手锏

FastAPI 的依赖注入系统（Dependency Injection）是你在前端框架里很少见到的。它能帮你管理 LLM 实例的生命周期、数据库连接、缓存等资源：

```python
from fastapi import FastAPI, Depends
from langchain_openai import ChatOpenAI
from langchain_core.language_models import BaseChatModel
from functools import lru_cache
from pydantic_settings import BaseSettings

class Settings(BaseSettings):
    """应用配置，从环境变量或 .env 文件读取"""
    openai_api_key: str
    openai_base_url: str = "https://api.openai.com/v1"
    default_model: str = "gpt-4"
    max_concurrent_requests: int = 10
    rate_limit_per_minute: int = 60

    class Config:
        env_file = ".env"

@lru_cache()
def get_settings() -> Settings:
    return Settings()

def get_llm(settings: Settings = Depends(get_settings)) -> BaseChatModel:
    """获取 LLM 实例（单例）"""
    return ChatOpenAI(
        api_key=settings.openai_api_key,
        base_url=settings.openai_base_url,
        model=settings.default_model,
        temperature=0.7,
        streaming=True,
    )

app = FastAPI(title="Agent API Service", version="1.0.0")

@app.get("/api/v1/health")
async def health_check(settings: Settings = Depends(get_settings)):
    return {"status": "ok", "version": settings.default_model}
```

这样做的好处是：

1. **LLM 实例全局复用**：通过 `lru_cache` 和依赖注入，不用每次请求都创建新的 LLM 客户端。
2. **配置集中管理**：所有配置从环境变量读取，不同环境（开发、测试、生产）只需要改 `.env`。
3. **方便测试**：写测试的时候可以轻松替换 mock 的 LLM 实例。

### 完整的聊天 API

把上面的组件组装起来，一个完整的聊天接口长这样：

```python
from fastapi import FastAPI, Depends, HTTPException
from fastapi.responses import StreamingResponse
from langchain_core.prompts import ChatPromptTemplate
from langchain_core.output_parsers import StrOutputParser
from pydantic import BaseModel, Field

app = FastAPI(title="Agent API Service", version="1.0.0")

# ---- 请求/响应模型 ----

class ChatMessage(BaseModel):
    role: str = Field(..., pattern="^(user|assistant|system)$")
    content: str = Field(..., min_length=1, max_length=32000)

class ChatRequest(BaseModel):
    messages: list[ChatMessage] = Field(..., min_length=1)
    stream: bool = False

class ChatResponse(BaseModel):
    content: str
    model: str

# ---- 路由 ----

@app.post("/api/v1/chat", response_model=ChatResponse)
async def chat(
    request: ChatRequest,
    llm: BaseChatModel = Depends(get_llm),
):
    """非流式聊天接口"""
    prompt = ChatPromptTemplate.from_messages(
        [(m.role, m.content) for m in request.messages]
    )
    chain = prompt | llm | StrOutputParser()

    try:
        result = await chain.ainvoke({})
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"LLM 调用失败: {e}")

    return ChatResponse(content=result, model=llm.model_name)
```

## 流式 API：Agent 的灵魂

对于 Agent 服务来说，流式输出是必须的。用户问一个问题，Agent 可能要思考好几秒，如果一次性返回结果，用户体验极差。流式输出让用户能看到 Agent "正在打字"的效果。

### 基础流式输出

```python
@app.post("/api/v1/chat/stream")
async def chat_stream(
    request: ChatRequest,
    llm: BaseChatModel = Depends(get_llm),
):
    """流式聊天接口 - SSE 方式"""
    prompt = ChatPromptTemplate.from_messages(
        [(m.role, m.content) for m in request.messages]
    )
    chain = prompt | llm | StrOutputParser()

    async def event_generator():
        try:
            async for chunk in chain.astream({}):
                # SSE 格式: data: ...\n\n
                yield f"data: {chunk}\n\n"
            yield "data: [DONE]\n\n"
        except Exception as e:
            yield f"data: [ERROR] {str(e)}\n\n"

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",  # Nginx 专用，禁用缓冲
        },
    )
```

SSE（Server-Sent Events）的格式很简单，每条消息以 `data: ` 开头，以 `\n\n` 结尾。前端用 `EventSource` 或者 `fetch` + `ReadableStream` 就能接收。

### 前端对接示例

给你一个前端的接收代码，方便理解整个链路：

```javascript
// 前端接收 SSE 流
async function streamChat(message) {
  const response = await fetch('/api/v1/chat/stream', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      messages: [{ role: 'user', content: message }],
      stream: true,
    }),
  });

  const reader = response.body.getReader();
  const decoder = new TextDecoder();

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    const text = decoder.decode(value);
    const lines = text.split('\n').filter(line => line.startsWith('data: '));

    for (const line of lines) {
      const data = line.slice(6); // 去掉 "data: " 前缀
      if (data === '[DONE]') return;
      if (data.startsWith('[ERROR]')) {
        console.error('Stream error:', data);
        return;
      }
      // 实时渲染到页面
      appendToChatBubble(data);
    }
  }
}
```

### Agent 流式输出：处理工具调用

Agent 的流式输出比普通 Chain 复杂，因为 Agent 可能会调用工具，工具调用过程中也需要给前端反馈：

```python
from langgraph.prebuilt import create_react_agent
import json

@app.post("/api/v1/agent/stream")
async def agent_stream(
    request: ChatRequest,
    llm: BaseChatModel = Depends(get_llm),
):
    """Agent 流式接口 - 带工具调用"""
    agent = create_react_agent(llm, tools)

    async def event_generator():
        try:
            async for event in agent.astream(
                {"messages": [(m.role, m.content) for m in request.messages]}
            ):
                # 处理不同类型的消息事件
                if "messages" in event:
                    last_msg = event["messages"][-1]

                    # 工具调用开始
                    if hasattr(last_msg, "tool_calls") and last_msg.tool_calls:
                        for tc in last_msg.tool_calls:
                            yield _sse_event("tool_call", {
                                "tool": tc["name"],
                                "args": tc["args"],
                            })

                    # 工具返回结果
                    if last_msg.type == "tool":
                        yield _sse_event("tool_result", {
                            "tool": last_msg.name,
                            "content": last_msg.content[:200],  # 截断避免过长
                        })

                    # AI 最终回复（流式）
                    if (
                        last_msg.type == "ai"
                        and hasattr(last_msg, "content")
                        and last_msg.content
                    ):
                        yield _sse_event("token", last_msg.content)

            yield _sse_event("done", "")

        except Exception as e:
            yield _sse_event("error", str(e))

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )

def _sse_event(event_type: str, data: str | dict) -> str:
    """构建 SSE 事件格式"""
    payload = json.dumps({"type": event_type, "data": data}, ensure_ascii=False)
    return f"data: {payload}\n\n"
```

这样前端收到的每条消息都有 `type` 字段，可以根据类型做不同的 UI 展示：工具调用显示 loading，token 逐字输出，错误显示红色提示。

## 中间件设计：给 API 穿上铠甲

一个生产级的 API 服务，光有接口是不够的，还需要一系列中间件来保证安全性、可观测性和稳定性。

### CORS 中间件

前端开发绕不开 CORS。FastAPI 配置 CORS 简单得离谱：

```python
from fastapi.middleware.cors import CORSMiddleware

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:3000",   # 本地开发
        "https://your-domain.com", # 生产环境
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
```

注意：生产环境不要用 `allow_origins=["*"]`，必须明确指定允许的域名。

### 自定义限流中间件

LLM API 调用是按 token 计费的，不限流分分钟破产。我们用内存计数器实现一个简单的限流：

```python
import time
from collections import defaultdict
from fastapi import Request, HTTPException
from starlette.middleware.base import BaseHTTPMiddleware

class RateLimitMiddleware(BaseHTTPMiddleware):
    """基于滑动窗口的限流中间件"""

    def __init__(self, app, max_requests: int = 60, window_seconds: int = 60):
        super().__init__(app)
        self.max_requests = max_requests
        self.window_seconds = window_seconds
        self.requests: dict[str, list[float]] = defaultdict(list)

    def _get_client_id(self, request: Request) -> str:
        # 优先用 API Key，其次用 IP
        api_key = request.headers.get("X-API-Key")
        if api_key:
            return f"key:{api_key}"
        return f"ip:{request.client.host}"

    async def dispatch(self, request: Request, call_next):
        # 健康检查不限流
        if request.url.path == "/api/v1/health":
            return await call_next(request)

        client_id = self._get_client_id(request)
        now = time.time()

        # 清理过期记录
        self.requests[client_id] = [
            t for t in self.requests[client_id]
            if now - t < self.window_seconds
        ]

        if len(self.requests[client_id]) >= self.max_requests:
            raise HTTPException(
                status_code=429,
                detail="请求过于频繁，请稍后再试",
            )

        self.requests[client_id].append(now)
        return await call_next(request)

# 注册中间件
app.add_middleware(
    RateLimitMiddleware,
    max_requests=60,
    window_seconds=60,
)
```

### 请求日志中间件

```python
import time
import logging

logger = logging.getLogger("agent-api")

class LoggingMiddleware(BaseHTTPMiddleware):
    """记录每个请求的耗时和状态"""

    async def dispatch(self, request: Request, call_next):
        start_time = time.time()
        response = await call_next(request)
        duration = time.time() - start_time

        logger.info(
            f"{request.method} {request.url.path} "
            f"status={response.status_code} "
            f"duration={duration:.3f}s "
            f"client={request.client.host}"
        )
        return response

app.add_middleware(LoggingMiddleware)
```

## 错误处理：优雅地面对崩溃

LLM API 调用经常会出错：网络超时、API Key 失效、Token 超限、模型过载......你需要一套系统的错误处理策略。

### 全局异常处理

```python
from fastapi import Request
from fastapi.responses import JSONResponse

class LLMServiceError(Exception):
    """LLM 服务相关错误"""
    def __init__(self, message: str, status_code: int = 502):
        self.message = message
        self.status_code = status_code

@app.exception_handler(LLMServiceError)
async def llm_error_handler(request: Request, exc: LLMServiceError):
    return JSONResponse(
        status_code=exc.status_code,
        content={
            "error": "LLM service error",
            "detail": exc.message,
        },
    )

@app.exception_handler(Exception)
async def global_error_handler(request: Request, exc: Exception):
    logger.exception(f"Unhandled error: {exc}")
    return JSONResponse(
        status_code=500,
        content={
            "error": "Internal server error",
            "detail": "服务内部错误，请稍后重试",
        },
    )
```

### 带重试的 LLM 调用

```python
import asyncio
from tenacity import retry, stop_after_attempt, wait_exponential

@retry(
    stop=stop_after_attempt(3),
    wait=wait_exponential(multiplier=1, min=1, max=10),
    retry=retry_if_exception_type((TimeoutError, ConnectionError)),
)
async def call_llm_with_retry(chain, inputs: dict) -> str:
    """带自动重试的 LLM 调用"""
    try:
        result = await chain.ainvoke(inputs)
        return result
    except Exception as e:
        if "rate_limit" in str(e).lower():
            # 限流错误，等待后重试
            raise
        raise LLMServiceError(f"LLM 调用失败: {e}")
```

## 后台任务：异步处理耗时操作

有些操作不适合阻塞请求，比如记录日志、发送通知、更新缓存等，可以用 FastAPI 的 BackgroundTasks：

```python
from fastapi import BackgroundTasks

async def save_conversation_log(
    user_id: str,
    messages: list,
    response: str,
):
    """保存对话记录到数据库"""
    # 实际项目中这里会写数据库
    logger.info(f"Saving conversation for user {user_id}")
    await asyncio.sleep(0.1)  # 模拟数据库写入

@app.post("/api/v1/chat")
async def chat(
    request: ChatRequest,
    background_tasks: BackgroundTasks,
    llm: BaseChatModel = Depends(get_llm),
):
    # ... 正常处理聊天逻辑 ...

    # 把日志记录放到后台
    background_tasks.add_task(
        save_conversation_log,
        user_id="current-user",
        messages=[m.model_dump() for m in request.messages],
        response=result,
    )

    return ChatResponse(content=result, model=llm.model_name)
```

## API 版本管理

LLM 领域变化太快了，API 版本管理几乎是必须的。FastAPI 里可以用 Router 来组织：

```python
from fastapi import APIRouter

# v1 版本
router_v1 = APIRouter(prefix="/api/v1")

@router_v1.post("/chat")
async def chat_v1(request: ChatRequest, ...):
    """v1 版本：基础聊天"""
    ...

# v2 版本 - 支持多模态
router_v2 = APIRouter(prefix="/api/v2")

class MultimodalRequest(BaseModel):
    messages: list[ChatMessage]
    images: list[str] | None = None  # base64 图片

@router_v2.post("/chat")
async def chat_v2(request: MultimodalRequest, ...):
    """v2 版本：支持图片输入"""
    ...

# 注册路由
app.include_router(router_v1)
app.include_router(router_v2)
```

## 对比 Flask 和 Django：为什么选 FastAPI

这三个框架我都用过，简单说说各自的优缺点：

| 维度 | FastAPI | Flask | Django |
|------|---------|-------|--------|
| 异步支持 | 原生 async/await | 需要 Flask-SSE 等扩展 | Django 4.1+ 开始支持 |
| 数据校验 | 内置 Pydantic | 需要手动写或用 marshmallow | DRF 的 Serializer |
| API 文档 | 自动生成 Swagger/ReDoc | 需要 flask-restx 等 | 需要 drf-spectacular |
| 学习曲线 | 低（前端友好） | 低 | 中（全栈框架较重） |
| 生态成熟度 | 中等（快速成长中） | 高 | 高（最成熟） |
| LLM 集成 | LangChain 原生支持 | 需要额外适配 | 同 Flask |
| 适合场景 | AI API 服务 | 小型项目 | 复杂 Web 应用 |

**给前端转后端同学的建议**：如果你的目标是快速搭建 Agent API 服务，FastAPI 是最佳选择。它的开发体验最接近 Node.js 生态，类型系统和自动生成文档的特性会让你感觉像回到了写 TypeScript 的日子。

如果你需要做一个完整的 Web 应用（比如带用户系统、后台管理界面），Django 可能更合适，但那就不是 Agent API 服务的范畴了。

## 踩坑记录：这些错误我都犯过

### 坑一：忘记开启流式输出

```python
# 错误：虽然路由支持 SSE，但 LLM 没开 streaming
llm = ChatOpenAI(model="gpt-4")  # 缺少 streaming=True
```

如果 `ChatOpenAI` 没有设置 `streaming=True`，即使你的路由返回 `StreamingResponse`，也拿不到流式数据。前端会一直等到全部生成完毕才收到一条完整的消息。

### 坑二：异步混用导致阻塞

```python
# 错误：在异步路由里用了同步的 LLM 调用
@app.post("/api/v1/chat")
async def chat(request: ChatRequest):
    result = chain.invoke({})  # 这是同步调用！会阻塞事件循环
    return result
```

在 `async` 路由里用 `chain.invoke()`（同步方法）会阻塞整个事件循环，所有并发请求都会卡住。必须用 `chain.ainvoke()`（异步方法）。

### 坑三：Pydantic 模型和 LangChain 模型混用

LangChain v0.2 之后有自己的消息模型（`HumanMessage`、`AIMessage`），而 Pydantic 有你自己的 `ChatMessage`。很多人搞混了这两套，导致序列化错误。

```python
# 正确做法：在路由入口处做转换
from langchain_core.messages import HumanMessage, AIMessage

def to_langchain_messages(messages: list[ChatMessage]):
    mapping = {"human": HumanMessage, "assistant": AIMessage, "system": SystemMessage}
    return [mapping[m.role](content=m.content) for m in messages]
```

### 坑四：Nginx 反代吃掉 SSE 流

在生产环境部署时，Nginx 默认会缓冲响应体，导致 SSE 流式数据无法实时推送到前端。解决方案有两个：

```nginx
# Nginx 配置
proxy_buffering off;
proxy_cache off;
proxy_set_header Connection '';
proxy_http_version 1.1;
chunked_transfer_encoding off;
```

或者在 FastAPI 响应头里加上 `X-Accel-Buffering: no`（我们在前面的代码里已经加了）。

### 坑五：并发请求把 API Key 额度刷爆

LLM API 的限流通常是每分钟多少次请求，或者每天多少 token。如果不限制并发，一个用户连续发 100 条消息，你的 API Key 额度可能一次就被刷完了。一定要在中间件层做好限流。

## 总结

作为前端转后端的同学，FastAPI + LangChain 是目前搭建 Agent API 服务最舒服的技术栈组合。FastAPI 的开发体验让你不用从零学后端，LangChain 帮你封装了 LLM 调用的复杂性。

核心要记住的几点：

1. Pydantic 模型是你的第一道防线，所有请求响应都要定义清晰的模型
2. 异步是必须的，`ainvoke` 不是 `invoke`
3. 流式输出用 SSE，别忘了处理 Nginx 缓冲问题
4. 限流、认证、错误处理一个都不能少
5. 善用依赖注入管理 LLM 实例和配置

技术栈选对了，剩下的就是不断实践和踩坑。祝你在 AI Agent 的路上越走越远。

## 参考资料

- [FastAPI 官方文档](https://fastapi.tiangolo.com/) -- 最权威的 FastAPI 学习资料，强烈建议从头到尾读一遍
- [LangChain 官方文档](https://python.langchain.com/docs/) -- LangChain 的 API 参考和教程
- [LangGraph 文档](https://langchain-ai.github.io/langgraph/) -- Agent 编排的核心框架
- [Pydantic V2 文档](https://docs.pydantic.dev/) -- 数据校验的底层引擎
- [SSE 规范](https://html.spec.whatwg.org/multipage/server-sent-events.html) -- Server-Sent Events 的 W3C 标准
- [FastAPI Middleware 文档](https://fastapi.tiangolo.com/advanced/middleware/) -- 中间件开发指南
