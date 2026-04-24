# Agent 部署上线全流程

你的 Agent 在本地跑得好好的，现在要上线给用户用，怎么部署？

我之前踩过很多坑：本地是 macOS，服务器是 Linux，路径编码全乱；本地有环境变量，服务器忘了配置，API key 找不到；本地单进程，上线后并发就崩了。

这篇文章，我来分享 Agent 上线的完整流程。

## 部署方式对比

| 方式 | 优点 | 缺点 | 适用场景 |
|------|------|------|---------|
| 脚本部署 | 简单直接 | 不易管理 | 内部工具、快速验证 |
| Docker | 环境一致、易扩展 | 需要容器知识 | 生产环境、团队协作 |
| Serverless | 自动扩缩、按量付费 | 冷启动延迟 | 流量不稳定、成本敏感 |

推荐：先用脚本跑通，再用 Docker 上生产。

## 第一步：准备部署清单

上线前检查这些：

```bash
□ 依赖已锁定 (requirements.txt 或 pyproject.toml)
□ 环境变量已整理 (.env.example)
□ 配置已外置 (config.yaml)
□ 日志已配置 (logs/)
□ 错误处理已完善
□ 测试已通过 (pytest)
```

关键文件：

```
my-agent/
├── src/
│   └── agent/
├── tests/
├── requirements.txt    # 依赖
├── .env.example        # 环境变量模板
├── config.yaml         # 配置文件
├── Dockerfile          # Docker 配置
└── README.md
```

## 第二步：脚本部署（最简单）

适合：内部工具、快速验证。

```bash
# 1. 准备环境
python -m venv venv
source venv/bin/activate  # Linux/Mac
# venv\Scripts\activate  # Windows

# 2. 安装依赖
pip install -r requirements.txt

# 3. 配置环境变量
cp .env.example .env
# 编辑 .env 填入真实值

# 4. 启动
python -m agent.server
```

后台运行：

```bash
# 使用 nohup
nohup python -m agent.server > logs/agent.log 2>&1 &

# 或使用 systemd（推荐）
sudo nano /etc/systemd/system/agent.service
```

systemd 配置：

```ini
[Unit]
Description=AI Agent Server
After=network.target

[Service]
Type=simple
User=agent
WorkingDirectory=/opt/my-agent
Environment="PATH=/opt/my-agent/venv/bin"
ExecStart=/opt/my-agent/venv/bin/python -m agent.server
Restart=always
RestartSec=10

[Install]
WantedBy=multi-user.target
```

启动：

```bash
sudo systemctl start agent
sudo systemctl enable agent  # 开机自启
sudo systemctl status agent
```

## 第三步：Docker 部署（推荐）

适合：生产环境、需要扩展。

**Dockerfile**：

```dockerfile
FROM python:3.11-slim

WORKDIR /app

# 安装依赖
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# 复制代码
COPY src/ ./src/
COPY config.yaml .

# 创建非 root 用户
RUN useradd -m agent
USER agent

# 暴露端口
EXPOSE 8000

# 启动命令
CMD ["python", "-m", "agent.server"]
```

**构建和运行**：

```bash
# 构建
docker build -t my-agent:latest .

# 运行
docker run -d \
  --name agent \
  -p 8000:8000 \
  -e OPENAI_API_KEY=sk-xxx \
  -v $(pwd)/config.yaml:/app/config.yaml \
  -v $(pwd)/logs:/app/logs \
  my-agent:latest

# 查看日志
docker logs -f agent
```

**docker-compose.yml**（多服务）：

```yaml
version: '3.8'

services:
  agent:
    build: .
    ports:
      - "8000:8000"
    environment:
      - OPENAI_API_KEY=${OPENAI_API_KEY}
    volumes:
      - ./config.yaml:/app/config.yaml
      - ./logs:/app/logs
    restart: always
  
  redis:
    image: redis:alpine
    ports:
      - "6379:6379"
```

启动：

```bash
docker-compose up -d
```

## 第四步：API 服务封装

Agent 通常是后台服务，需要暴露 API。

**FastAPI 示例**：

```python
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
from agent.graph import build_agent_graph
from agent.state import create_initial_state

app = FastAPI(title="AI Agent API")
graph = build_agent_graph()

class ChatRequest(BaseModel):
    message: str
    session_id: str = None

class ChatResponse(BaseModel):
    content: str
    tool_calls: list = []

@app.post("/chat", response_model=ChatResponse)
async def chat(request: ChatRequest):
    """处理聊天请求"""
    try:
        state = create_initial_state(request.message)
        result = graph.invoke(state)
        
        last_msg = result["messages"][-1]
        return ChatResponse(
            content=last_msg.get("content", ""),
            tool_calls=result.get("tool_calls", []),
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/health")
async def health():
    """健康检查"""
    return {"status": "ok"}
```

启动：

```bash
uvicorn api:app --host 0.0.0.0 --port 8000
```

## 第五步：监控和日志

**日志配置**：

```python
import logging

logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s',
    handlers=[
        logging.FileHandler('logs/agent.log'),
        logging.StreamHandler(),
    ]
)

logger = logging.getLogger(__name__)
```

**关键指标监控**：

```python
from prometheus_client import Counter, Histogram

REQUEST_COUNT = Counter('agent_requests_total', 'Total requests')
REQUEST_LATENCY = Histogram('agent_request_latency_seconds', 'Request latency')
ERROR_COUNT = Counter('agent_errors_total', 'Total errors')

@app.middleware("http")
async def monitor_request(request, call_next):
    REQUEST_COUNT.inc()
    with REQUEST_LATENCY.time():
        try:
            return await call_next(request)
        except Exception:
            ERROR_COUNT.inc()
            raise
```

## 第六步：安全加固

```python
# 1. 限流
from slowapi import Limiter
limiter = Limiter(key_func=get_remote_address)

@app.post("/chat")
@limiter.limit("10/minute")
async def chat(request: ChatRequest):
    ...

# 2. API Key 认证
from fastapi import Header, HTTPException

async def verify_api_key(x_api_key: str = Header(...)):
    if x_api_key != settings.API_KEY:
        raise HTTPException(status_code=403, detail="Invalid API Key")

@app.post("/chat", dependencies=[Depends(verify_api_key)])
async def chat(request: ChatRequest):
    ...

# 3. 输入过滤
def sanitize_input(text: str) -> str:
    """过滤危险输入"""
    dangerous = [";", "|", "&", "`", "$"]
    for char in dangerous:
        if char in text:
            raise ValueError(f"输入包含危险字符: {char}")
    return text
```

## 我踩过的坑

**坑一：环境变量遗漏**

本地设置了 `OPENAI_API_KEY`，服务器忘了设置，Agent 启动报错。

解决：用 `.env.example` 列出所有需要的环境变量，部署时逐个检查。

**坑二：日志找不到**

print 输出在 Docker 里看不到。

解决：用 logging 模块，输出到文件并挂载卷。

**坑三：资源泄漏**

Agent 运行几天后内存爆了，排查发现是消息列表没清理。

解决：加定期清理，或设置 `ulimit` 限制：

```bash
ulimit -v 4194304  # 限制内存 4GB
```

## 部署检查清单

```bash
□ 环境变量已配置（.env）
□ 依赖已锁定（requirements.txt）
□ 配置已外置（config.yaml）
□ 日志正常输出（logs/）
□ 健康检查通过（/health）
□ 监控指标正常（/metrics）
□ API 认证已开启
□ 限流已配置
□ 自动重启已配置（systemd/docker restart: always）
```

## 下一步行动

1. **本地跑通 API**：用 FastAPI 封装 Agent
2. **写 Dockerfile**：确保环境和本地一致
3. **加监控和日志**：能看到运行状态

部署的核心是：**环境一致、配置外置、日志可查、错误可恢复**。

---

本地跑通只是第一步，上线才是真正的考验。
