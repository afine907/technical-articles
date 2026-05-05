---
slug: deployment
sidebar_position: 8
title: Agent 部署上线全流程：从开发到生产
---

你的 Agent 在本地跑得很好，现在要上线给用户用。但一上线就各种问题：环境变量找不到、日志看不到、资源泄漏、API 限流...

这篇文章，我系统讲解 Agent 从开发到上线的完整流程。

## 部署前的检查清单

```
□ 依赖已锁定
□ 环境变量已整理
□ 配置已外置
□ 日志已配置
□ 错误处理已完善
□ 测试已通过
□ 性能已测试
□ 安全已加固
```

## 部署架构选型

### 方案对比

| 方案 | 优点 | 缺点 | 适用场景 |
|------|------|------|---------|
| 脚本部署 | 简单直接 | 不易管理、难扩展 | 内部工具、快速验证 |
| Docker | 环境一致、易扩展 | 学习成本、资源开销 | 生产环境、团队协作 |
| Serverless | 自动扩缩、按量付费 | 冷启动、调试困难 | 流量波动大、成本敏感 |
| Kubernetes | 高可用、自动伸缩 | 复杂度高 | 大规模、企业级 |

**我的建议**：
- 内部工具 → 脚本部署
- 生产环境 → Docker
- 流量波动大 → Serverless
- 企业级 → Kubernetes

## 第一步：Docker 化

### Dockerfile

```dockerfile
# 使用 Python 3.11 slim 版本
FROM python:3.11-slim

# 设置工作目录
WORKDIR /app

# 安装系统依赖
RUN apt-get update && apt-get install -y \
    gcc \
    && rm -rf /var/lib/apt/lists/*

# 复制依赖文件
COPY requirements.txt .

# 安装 Python 依赖
RUN pip install --no-cache-dir -r requirements.txt

# 复制代码
COPY src/ ./src/
COPY config/ ./config/

# 创建非 root 用户（安全）
RUN useradd -m -u 1000 appuser && \
    chown -R appuser:appuser /app
USER appuser

# 健康检查
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
    CMD curl -f http://localhost:8000/health || exit 1

# 暴露端口
EXPOSE 8000

# 启动命令
CMD ["python", "-m", "uvicorn", "src.api:app", "--host", "0.0.0.0", "--port", "8000"]
```

### docker-compose.yml

```yaml
version: '3.8'

services:
  agent-api:
    build: .
    ports:
      - "8000:8000"
    environment:
      - OPENAI_API_KEY=${OPENAI_API_KEY}
      - LOG_LEVEL=INFO
    volumes:
      - ./config:/app/config:ro
      - ./logs:/app/logs
    restart: always
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:8000/health"]
      interval: 30s
      timeout: 10s
      retries: 3
    deploy:
      resources:
        limits:
          memory: 2G
        reservations:
          memory: 512M
  
  redis:
    image: redis:alpine
    ports:
      - "6379:6379"
    volumes:
      - redis-data:/data
    restart: always

volumes:
  redis-data:
```

## 第二步：API 服务封装

### FastAPI 应用

```python
# src/api.py
from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field
from typing import Optional
import logging
import time

from .agent import Agent
from .config import settings

# 配置日志
logging.basicConfig(
    level=getattr(logging, settings.LOG_LEVEL),
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s',
    handlers=[
        logging.FileHandler('logs/agent.log'),
        logging.StreamHandler(),
    ]
)
logger = logging.getLogger(__name__)

# 创建应用
app = FastAPI(
    title="AI Agent API",
    description="Agent API 服务",
    version="1.0.0",
)

# CORS 配置
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# 初始化 Agent
agent = Agent()

# 请求模型
class ChatRequest(BaseModel):
    message: str = Field(..., description="用户消息", min_length=1, max_length=10000)
    session_id: Optional[str] = Field(None, description="会话ID，用于多轮对话")
    stream: bool = Field(False, description="是否流式返回")

class ChatResponse(BaseModel):
    content: str
    session_id: str
    tool_calls: list = []
    metadata: dict = {}

# API 端点
@app.post("/chat", response_model=ChatResponse)
async def chat(request: ChatRequest):
    """处理聊天请求"""
    start_time = time.time()
    
    try:
        logger.info(f"收到请求: session_id={request.session_id}, message={request.message[:50]}...")
        
        # 执行 Agent
        result = await agent.run(
            message=request.message,
            session_id=request.session_id,
        )
        
        # 记录耗时
        elapsed = time.time() - start_time
        logger.info(f"请求完成: session_id={result['session_id']}, elapsed={elapsed:.2f}s")
        
        return ChatResponse(
            content=result["content"],
            session_id=result["session_id"],
            tool_calls=result.get("tool_calls", []),
            metadata={"elapsed_seconds": elapsed},
        )
    
    except Exception as e:
        logger.error(f"请求失败: {str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/chat/stream")
async def chat_stream(request: ChatRequest):
    """流式聊天"""
    
    async def generate():
        try:
            async for chunk in agent.stream(request.message, request.session_id):
                yield f"data: {chunk}\n\n"
            yield "data: [DONE]\n\n"
        except Exception as e:
            logger.error(f"流式请求失败: {str(e)}", exc_info=True)
            yield f"data: {{'error': '{str(e)}'}}\n\n"
    
    return StreamingResponse(generate(), media_type="text/event-stream")

@app.get("/health")
async def health():
    """健康检查"""
    return {
        "status": "healthy",
        "timestamp": time.time(),
    }

@app.get("/metrics")
async def metrics():
    """性能指标"""
    return {
        "requests_total": agent.request_count,
        "avg_latency_ms": agent.avg_latency * 1000,
        "active_sessions": agent.active_sessions,
    }

# 中间件：请求日志
@app.middleware("http")
async def log_requests(request: Request, call_next):
    start_time = time.time()
    
    response = await call_next(request)
    
    elapsed = time.time() - start_time
    logger.info(
        f"{request.method} {request.url.path} "
        f"status={response.status_code} "
        f"elapsed={elapsed:.3f}s"
    )
    
    return response
```

## 第三步：配置管理

### 使用 Pydantic Settings

```python
# src/config.py
from pydantic_settings import BaseSettings
from typing import Optional

class Settings(BaseSettings):
    """应用配置"""
    
    # API Keys
    OPENAI_API_KEY: str
    ANTHROPIC_API_KEY: Optional[str] = None
    
    # 模型配置
    MODEL_NAME: str = "gpt-4-turbo"
    MODEL_TEMPERATURE: float = 0.7
    MAX_TOKENS: int = 4096
    
    # Agent 配置
    MAX_ITERATIONS: int = 20
    MEMORY_MAX_TOKENS: int = 100000
    
    # 服务配置
    HOST: str = "0.0.0.0"
    PORT: int = 8000
    DEBUG: bool = False
    LOG_LEVEL: str = "INFO"
    
    # Redis
    REDIS_URL: str = "redis://localhost:6379"
    
    class Config:
        env_file = ".env"
        env_file_encoding = "utf-8"

settings = Settings()
```

### .env.example

```bash
# API Keys
OPENAI_API_KEY=sk-xxx
ANTHROPIC_API_KEY=sk-ant-xxx

# 模型配置
MODEL_NAME=gpt-4-turbo
MODEL_TEMPERATURE=0.7
MAX_TOKENS=4096

# Agent 配置
MAX_ITERATIONS=20
MEMORY_MAX_TOKENS=100000

# 服务配置
HOST=0.0.0.0
PORT=8000
DEBUG=false
LOG_LEVEL=INFO

# Redis
REDIS_URL=redis://redis:6379
```

## 第四步：日志和监控

### 结构化日志

```python
import json
import logging
from datetime import datetime

class JSONFormatter(logging.Formatter):
    """JSON 格式日志"""
    
    def format(self, record: logging.LogRecord) -> str:
        log_data = {
            "timestamp": datetime.utcnow().isoformat(),
            "level": record.levelname,
            "logger": record.name,
            "message": record.getMessage(),
            "module": record.module,
            "function": record.funcName,
            "line": record.lineno,
        }
        
        if record.exc_info:
            log_data["exception"] = self.formatException(record.exc_info)
        
        return json.dumps(log_data, ensure_ascii=False)

# 使用
handler = logging.StreamHandler()
handler.setFormatter(JSONFormatter())
logging.root.addHandler(handler)
```

### Prometheus 指标

```python
from prometheus_client import Counter, Histogram, Gauge, generate_latest
from fastapi import Response

# 定义指标
REQUEST_COUNT = Counter(
    'agent_requests_total',
    'Total requests',
    ['method', 'endpoint', 'status']
)

REQUEST_LATENCY = Histogram(
    'agent_request_latency_seconds',
    'Request latency',
    ['method', 'endpoint']
)

ACTIVE_SESSIONS = Gauge(
    'agent_active_sessions',
    'Active sessions'
)

@app.get("/metrics")
async def metrics():
    """Prometheus 指标端点"""
    return Response(
        content=generate_latest(),
        media_type="text/plain"
    )

# 在中间件中记录
@app.middleware("http")
async def prometheus_middleware(request: Request, call_next):
    method = request.method
    endpoint = request.url.path
    
    with REQUEST_LATENCY.labels(method=method, endpoint=endpoint).time():
        response = await call_next(request)
    
    REQUEST_COUNT.labels(
        method=method,
        endpoint=endpoint,
        status=response.status_code
    ).inc()
    
    return response
```

## 第五步：安全加固

### API 认证

```python
from fastapi import Security, HTTPAuthorizationCredentials, HTTPBearer
from fastapi import HTTPException

security = HTTPBearer()

async def verify_api_key(
    credentials: HTTPAuthorizationCredentials = Security(security)
) -> str:
    """验证 API Key"""
    api_key = credentials.credentials
    
    if api_key not in settings.VALID_API_KEYS:
        raise HTTPException(status_code=401, detail="Invalid API Key")
    
    return api_key

@app.post("/chat")
async def chat(
    request: ChatRequest,
    api_key: str = Depends(verify_api_key)
):
    # 验证通过，处理请求
    ...
```

### 限流

```python
from slowapi import Limiter, _rate_limit_exceeded_handler
from slowapi.util import get_remote_address
from slowapi.errors import RateLimitExceeded

limiter = Limiter(key_func=get_remote_address)
app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)

@app.post("/chat")
@limiter.limit("10/minute")
async def chat(request: Request, chat_request: ChatRequest):
    ...
```

### 输入验证

```python
from pydantic import validator, Field
import re

class ChatRequest(BaseModel):
    message: str = Field(..., min_length=1, max_length=10000)
    
    @validator('message')
    def validate_message(cls, v):
        # 检查危险字符
        dangerous_patterns = [
            r'<script.*?>',
            r'javascript:',
            r'onerror=',
        ]
        
        for pattern in dangerous_patterns:
            if re.search(pattern, v, re.IGNORECASE):
                raise ValueError('消息包含不允许的内容')
        
        return v
```

## 第六步：错误处理

### 全局异常处理

```python
from fastapi import Request
from fastapi.responses import JSONResponse
import traceback

class AgentError(Exception):
    """Agent 错误基类"""
    pass

class TokenLimitError(AgentError):
    """Token 限制错误"""
    pass

class ToolExecutionError(AgentError):
    """工具执行错误"""
    pass

@app.exception_handler(AgentError)
async def agent_error_handler(request: Request, exc: AgentError):
    """Agent 错误处理"""
    logger.error(f"Agent 错误: {str(exc)}", exc_info=True)
    
    return JSONResponse(
        status_code=500,
        content={
            "error": type(exc).__name__,
            "message": str(exc),
        }
    )

@app.exception_handler(Exception)
async def general_error_handler(request: Request, exc: Exception):
    """通用错误处理"""
    logger.error(f"未处理异常: {str(exc)}", exc_info=True)
    
    # 生产环境不返回详细错误
    if settings.DEBUG:
        detail = traceback.format_exc()
    else:
        detail = "Internal server error"
    
    return JSONResponse(
        status_code=500,
        content={"error": "InternalServerError", "detail": detail}
    )
```

## 第七步：部署脚本

### 部署脚本

```bash
#!/bin/bash
# deploy.sh

set -e

echo "开始部署..."

# 1. 拉取最新代码
git pull origin main

# 2. 构建镜像
docker-compose build

# 3. 停止旧服务
docker-compose down

# 4. 启动新服务
docker-compose up -d

# 5. 等待健康检查
echo "等待服务启动..."
sleep 10

# 6. 健康检查
curl -f http://localhost:8000/health || {
    echo "健康检查失败"
    docker-compose logs
    exit 1
}

echo "部署成功!"
```

### 回滚脚本

```bash
#!/bin/bash
# rollback.sh

echo "开始回滚..."

# 回滚到上一个版本
docker-compose down
docker tag my-agent:latest my-agent:backup
docker tag my-agent:previous my-agent:latest
docker-compose up -d

echo "回滚完成"
```

## 我踩过的真实坑

### 坑一：环境变量遗漏

**现象**：本地正常，线上报错"OPENAI_API_KEY not found"。

**解决**：用 `.env.example` 列出所有环境变量，部署前检查。

### 坑二：日志找不到

**现象**：`print()` 输出在 Docker 里看不到。

**解决**：用 `logging` 模块，并配置 `flush=True`。

```python
import logging
logger = logging.getLogger(__name__)

# 而不是
print("some message")
```

### 坑三：资源泄漏

**现象**：运行几天后内存爆了。

**解决**：加监控和自动重启。

```yaml
deploy:
  resources:
    limits:
      memory: 2G
  restart_policy:
    condition: on-failure
    max_retries: 3
```

### 坑四：API 限流

**现象**：OpenAI API 返回 429 错误。

**解决**：加限流和重试。

```python
from tenacity import retry, stop_after_attempt, wait_exponential

@retry(
    stop=stop_after_attempt(3),
    wait=wait_exponential(multiplier=1, min=4, max=10),
)
async def call_llm(messages):
    return await llm.ainvoke(messages)
```

## 下一步行动

1. **准备 Dockerfile**：确保环境和本地一致
2. **配置管理**：用 Pydantic Settings 管理环境变量
3. **加日志和监控**：能看到运行状态
4. **安全加固**：API Key 认证 + 限流 + 输入验证
5. **写部署脚本**：自动化部署流程


部署的核心是：**环境一致、配置外置、日志可查、错误可恢复、安全可控**。
