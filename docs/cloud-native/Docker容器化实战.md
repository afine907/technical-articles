---
sidebar_position: 1
title: Docker 容器化实战
slug: docker-containerization
---

# Docker 容器化实战

Agent 服务本地跑得好好的，部署到服务器就出问题——Python 依赖版本冲突（本地 3.11，服务器 3.9）、系统库缺失、环境变量没配。Docker 把应用和运行环境打包在一起，保证任何地方都以同样的方式运行。

## 容器架构全景

先搞清楚 Docker 的整体架构，再动手写 Dockerfile。

```
+------------------------------------------------------------------+
|                        开发者机器                                  |
|                                                                    |
|  +------------------+    docker build    +-------------------+     |
|  |   Dockerfile     | -----------------> |   Docker Image    |     |
|  +------------------+                    +-------------------+     |
|                                                |                   |
|                                          docker push               |
|                                                v                   |
+-------------------------------------------------------------------+
                                        |
                                        v
+-------------------------------------------------------------------+
|                       Docker Registry (Hub / 私有仓库)              |
+-------------------------------------------------------------------+
                                        |
                                        v
+-------------------------------------------------------------------+
|                        生产服务器                                   |
|                                                                    |
|  docker pull   +-------------------+    docker run                  |
|  ------------> |   Docker Image    | ------------> +-----------+   |
|                +-------------------+               | Container |   |
|                                                    +-----------+   |
|                                                      |  |  |       |
|                                                      v  v  v       |
|                                                   App  App  App    |
+-------------------------------------------------------------------+

容器 vs 虚拟机:

+-------------------------------------------+
|           传统虚拟机架构                     |
|  +------+ +------+ +------+                |
|  | App1 | | App2 | | App3 |                |
|  +------+ +------+ +------+                |
|  | Guest OS | Guest OS | Guest OS |         |
|  +----------------------------------+      |
|  |        Hypervisor               |      |
|  +----------------------------------+      |
|  |          Host OS                |      |
|  +----------------------------------+      |
|  |          Hardware               |      |
+-------------------------------------------+

+-------------------------------------------+
|           Docker 容器架构                   |
|  +------+ +------+ +------+                |
|  | App1 | | App2 | | App3 |                |
|  +------+ +------+ +------+                |
|  |  Libs |  Libs |  Libs  |                |
|  +----------------------------------+      |
|  |        Docker Engine            |      |
|  +----------------------------------+      |
|  |          Host OS                |      |
|  +----------------------------------+      |
|  |          Hardware               |      |
+-------------------------------------------+

核心区别: 容器共享宿主机内核，虚拟机需要独立的操作系统内核。
所以容器更轻量、启动更快，但隔离性不如虚拟机。
```

## Docker 基础指令速查

对于前端同学来说，不需要把 Docker 当成运维工具来学，掌握以下几个核心指令就够了。

**镜像相关：**

```bash
# 拉取镜像
docker pull python:3.11-slim

# 列出本地镜像
docker images

# 删除镜像
docker rmi <image_id>

# 构建镜像（在 Dockerfile 所在目录执行）
docker build -t my-agent:1.0 .
```

**容器相关：**

```bash
# 运行容器
docker run -d --name agent-api -p 8000:8000 my-agent:1.0

# 查看运行中的容器
docker ps

# 查看容器日志
docker logs -f agent-api

# 进入容器内部调试
docker exec -it agent-api /bin/bash

# 停止并删除容器
docker stop agent-api && docker rm agent-api
```

**实用调试技巧：**

```bash
# 查看容器的文件系统变化
docker diff agent-api

# 查看容器资源占用
docker stats agent-api

# 查看容器详细信息
docker inspect agent-api

# 导出容器为 tar 文件（用于离线传输）
docker export agent-api > agent-backup.tar
```

## Dockerfile 指令详解

Dockerfile 是 Docker 的核心，每一个指令都在构建镜像的一层。理解每条指令的含义和最佳实践，是写好 Dockerfile 的基础。

### 核心指令

```dockerfile
# FROM - 指定基础镜像，这是每条 Dockerfile 的第一条有效指令
FROM python:3.11-slim

# WORKDIR - 设置工作目录，后续指令都会在这个目录下执行
# 如果目录不存在会自动创建
WORKDIR /app

# ENV - 设置环境变量，在构建和运行时都有效
ENV PYTHONUNBUFFERED=1
ENV PYTHONDONTWRITEBYTECODE=1

# COPY - 将文件从主机复制到镜像中
# 先复制依赖文件，利用 Docker 层缓存机制
COPY requirements.txt .

# RUN - 在镜像中执行命令
# 合并多条 RUN 减少镜像层数，清理缓存减小体积
RUN pip install --no-cache-dir -r requirements.txt && \
    rm -rf /root/.cache

# 复制源代码（放在依赖安装之后，这样代码变化不会触发重新安装依赖）
COPY src/ ./src/

# EXPOSE - 声明容器运行时监听的端口（只是文档作用，不实际映射）
EXPOSE 8000

# CMD - 容器启动时执行的命令
# 使用 exec 格式（JSON 数组），避免 shell 格式的信号传递问题
CMD ["python", "-m", "uvicorn", "src.api:app", "--host", "0.0.0.0", "--port", "8000"]
```

### .dockerignore 文件

和 `.gitignore` 类似，`.dockerignore` 告诉 Docker 在构建时忽略哪些文件。这能显著减小镜像体积和加速构建。

```
# .dockerignore
__pycache__
*.pyc
*.pyo
.git
.gitignore
.env
.env.*
venv/
.venv/
node_modules/
*.md
tests/
.pytest_cache/
.mypy_cache/
.dockerignore
Dockerfile
docker-compose.yml
```

### 层缓存机制

Docker 构建镜像时，每条指令生成一层。Docker 会缓存每一层，如果某一层没有变化，就直接使用缓存，跳过重建。

```
+-----------------------------------------------------+
| 构建过程（层缓存生效）                                  |
|                                                       |
| FROM python:3.11-slim     [cache] -- 基础镜像没变      |
| WORKDIR /app              [cache] -- 已存在           |
| COPY requirements.txt .   [cache] -- 依赖文件没变      |
| RUN pip install ...       [cache] -- 依赖没变          |
| COPY src/ ./src/          [NEW]   -- 代码变了，重跑     |
| CMD [...]                 [cache]                     |
+-----------------------------------------------------+

关键原则: 把变化频率低的指令放在前面，变化频率高的放在后面。
```

## 多阶段构建

Agent 项目通常依赖很多包，有些只在编译时需要，运行时用不到。多阶段构建能把构建环境和运行环境分开，大幅减小最终镜像体积。

```
多阶段构建原理:

+---------------------------+      +---------------------------+
|      Builder 阶段          |      |      Runtime 阶段          |
|                           |      |                           |
| FROM python:3.11 AS builder|      | FROM python:3.11-slim     |
|                           |      |                           |
| 安装编译工具(gcc等)        |      | 只复制需要的文件            |
| 安装所有依赖(含编译时依赖)  | ---> |  不装编译工具              |
| 编译/构建代码              |      |  只装运行时依赖             |
|                           |      |                           |
| 镜像大小: ~800MB          |      | 镜像大小: ~200MB           |
+---------------------------+      +---------------------------+
```

### Python Agent 项目的多阶段构建

```dockerfile
# ============ Stage 1: Builder ============
FROM python:3.11-slim AS builder

WORKDIR /build

# 安装编译时需要的系统依赖
RUN apt-get update && \
    apt-get install -y --no-install-recommends gcc libffi-dev && \
    rm -rf /var/lib/apt/lists/*

COPY requirements.txt .

# 在 builder 阶段安装所有依赖
RUN pip install --no-cache-dir --prefix=/install -r requirements.txt

# ============ Stage 2: Runtime ============
FROM python:3.11-slim AS runtime

WORKDIR /app

# 从 builder 阶段复制已编译的依赖
COPY --from=builder /install /usr/local

# 复制应用代码
COPY src/ ./src/
COPY config/ ./config/

# 创建非 root 用户
RUN groupadd -r agent && useradd -r -g agent -d /app -s /sbin/nologin agent && \
    chown -R agent:agent /app
USER agent

# 健康检查
HEALTHCHECK --interval=30s --timeout=10s --start-period=15s --retries=3 \
    CMD python -c "import urllib.request; urllib.request.urlopen('http://localhost:8000/health')" || exit 1

EXPOSE 8000

CMD ["python", "-m", "uvicorn", "src.api:app", "--host", "0.0.0.0", "--port", "8000"]
```

效果对比：

| 阶段 | 镜像大小 | 包含内容 |
|------|---------|---------|
| 单阶段构建 | ~800MB | 所有依赖 + gcc + pip cache |
| 多阶段 Builder | ~600MB | 编译环境 |
| 多阶段 Runtime | ~200MB | 只有运行时依赖 + 代码 |

## Agent 服务容器化实战

AI Agent 服务和普通的 Web 服务有一些区别，比如依赖大模型 API、需要管理会话状态、可能需要 GPU 加速。这些特点在容器化时需要特别考虑。

### 完整的 Agent 项目结构

```
agent-service/
  src/
    api.py          # FastAPI 入口
    agent.py        # Agent 核心逻辑
    tools/          # Agent 工具集
    config.py       # 配置管理
  config/
    settings.yaml   # 运行时配置
  tests/
  requirements.txt
  Dockerfile
  docker-compose.yml
  .dockerignore
  .env.example      # 环境变量模板（不要提交 .env 到 git）
```

### 一个真实的 Agent Dockerfile

```dockerfile
# ============ Stage 1: 依赖安装 ============
FROM python:3.11-slim AS builder

WORKDIR /build

RUN apt-get update && \
    apt-get install -y --no-install-recommends gcc libffi-dev && \
    rm -rf /var/lib/apt/lists/*

# 分离基础依赖和 Agent 特有依赖，方便缓存
COPY requirements-base.txt .
COPY requirements-agent.txt .

RUN pip install --no-cache-dir --prefix=/install \
    -r requirements-base.txt \
    -r requirements-agent.txt

# ============ Stage 2: 运行时 ============
FROM python:3.11-slim

# 安装 curl 用于健康检查
RUN apt-get update && \
    apt-get install -y --no-install-recommends curl && \
    rm -rf /var/lib/apt/lists/*

# 复制已编译的依赖
COPY --from=builder /install /usr/local

WORKDIR /app

# 创建应用目录并设置权限
RUN mkdir -p /app/logs /app/data && \
    groupadd -r agent && \
    useradd -r -g agent -d /app -s /sbin/nologin agent && \
    chown -R agent:agent /app

COPY --chown=agent:agent src/ ./src/
COPY --chown=agent:agent config/ ./config/

USER agent

# 设置 Python 环境
ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PYTHONPATH=/app \
    APP_ENV=production

EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=10s --start-period=20s --retries=3 \
    CMD curl -f http://localhost:8000/health || exit 1

CMD ["python", "-m", "uvicorn", "src.api:app", "--host", "0.0.0.0", "--port", "8000", "--workers", "2"]
```

### GPU 支持（用于本地 LLM 推理）

如果你的 Agent 需要在容器内运行本地大模型（比如 Llama、Qwen），就需要 GPU 支持。

```dockerfile
# 使用 NVIDIA CUDA 基础镜像
FROM nvidia/cuda:12.2.0-runtime-ubuntu22.04 AS runtime

# 安装 Python
RUN apt-get update && \
    apt-get install -y python3.11 python3-pip && \
    rm -rf /var/lib/apt/lists/*

# 安装 PyTorch (GPU 版本)
RUN pip3 install --no-cache-dir \
    torch torchvision --index-url https://download.pytorch.org/whl/cu122

# ... 后续步骤类似
```

运行时需要指定 GPU：

```bash
# 方式一：使用 --gpus 参数
docker run --gpus all -d --name llm-agent my-llm-agent:1.0

# 方式二：使用 NVIDIA Container Toolkit
docker run --runtime=nvidia -e NVIDIA_VISIBLE_DEVICES=all -d my-llm-agent:1.0
```

## Docker Compose 编排

单个容器可以跑，但 Agent 服务通常需要多个组件协作：API 服务、缓存、数据库、消息队列等。Docker Compose 让你用一个 YAML 文件管理所有服务。

### Agent 服务的完整编排

```yaml
# docker-compose.yml
services:
  # ============ Agent API 服务 ============
  agent-api:
    build:
      context: .
      dockerfile: Dockerfile
      target: runtime          # 多阶段构建指定目标阶段
    container_name: agent-api
    ports:
      - "8000:8000"
    environment:
      - OPENAI_API_KEY=${OPENAI_API_KEY}
      - REDIS_URL=redis://redis:6379/0
      - DATABASE_URL=postgresql://agent:agent@postgres:5432/agent_db
      - LOG_LEVEL=INFO
      - APP_ENV=production
    volumes:
      - ./config:/app/config:ro          # 配置文件只读挂载
      - agent-logs:/app/logs              # 日志持久化
      - agent-data:/app/data              # 数据持久化
    depends_on:
      redis:
        condition: service_healthy
      postgres:
        condition: service_healthy
    restart: unless-stopped
    deploy:
      resources:
        limits:
          cpus: '2.0'
          memory: 2G
        reservations:
          cpus: '0.5'
          memory: 512M
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:8000/health"]
      interval: 30s
      timeout: 10s
      start_period: 20s
      retries: 3
    logging:
      driver: "json-file"
      options:
        max-size: "10m"
        max-file: "3"
    networks:
      - agent-net

  # ============ GPU 推理服务（可选）============
  llm-inference:
    build:
      context: ./llm-service
      dockerfile: Dockerfile
    container_name: llm-inference
    ports:
      - "8001:8001"
    volumes:
      - model-cache:/models          # 模型文件持久化
    deploy:
      resources:
        reservations:
          devices:
            - driver: nvidia
              count: all
              capabilities: [gpu]
        limits:
          memory: 8G
    networks:
      - agent-net
    profiles:
      - gpu                          # 只在 docker compose --profile gpu up 时启动

  # ============ Redis 缓存 ============
  redis:
    image: redis:7-alpine
    container_name: agent-redis
    ports:
      - "6379:6379"
    volumes:
      - redis-data:/data
    command: redis-server --appendonly yes --maxmemory 256mb --maxmemory-policy allkeys-lru
    healthcheck:
      test: ["CMD", "redis-cli", "ping"]
      interval: 10s
      timeout: 5s
      retries: 5
    restart: unless-stopped
    networks:
      - agent-net

  # ============ PostgreSQL 数据库 ============
  postgres:
    image: postgres:16-alpine
    container_name: agent-postgres
    environment:
      POSTGRES_DB: agent_db
      POSTGRES_USER: agent
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD:-agent_dev}
    ports:
      - "5432:5432"
    volumes:
      - postgres-data:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U agent -d agent_db"]
      interval: 10s
      timeout: 5s
      retries: 5
    restart: unless-stopped
    networks:
      - agent-net

# ============ 网络配置 ============
networks:
  agent-net:
    driver: bridge

# ============ 数据卷 ============
volumes:
  agent-logs:
  agent-data:
  redis-data:
  postgres-data:
  model-cache:
```

### 常用 Compose 命令

```bash
# 启动所有服务（后台运行）
docker compose up -d

# 只启动带 gpu profile 的服务
docker compose --profile gpu up -d

# 查看服务状态
docker compose ps

# 查看日志（实时跟踪）
docker compose logs -f agent-api

# 重新构建并启动（代码更新后）
docker compose up -d --build agent-api

# 停止所有服务
docker compose down

# 停止并删除数据卷（危险！数据会丢失）
docker compose down -v

# 进入某个容器
docker compose exec agent-api bash
```

## 网络管理

Docker 的网络模型是容器化服务之间通信的基础。理解不同网络模式的区别，对于排查 Agent 服务间的通信问题非常关键。

### 网络模式对比

```
bridge 模式（默认）:
+------------------+     +------------------+
|   agent-api      |     |   redis           |
| 172.18.0.2       |     | 172.18.0.3        |
+------------------+     +------------------+
         |                        |
         +----------+-------------+
                    |
            docker0 bridge
            172.18.0.1
                    |
              Host 网络

特点: 容器间通过 bridge 互通，容器可通过端口映射暴露服务。

host 模式:
+------------------------------------------+
|            Host 网络空间                   |
|                                            |
|  +-----------+    +-----------+            |
|  | agent-api |    |   redis   |            |
|  | :8000     |    | :6379     |            |
|  +-----------+    +-----------+            |
|                                            |
|  容器直接使用宿主机网络栈                    |
+------------------------------------------+

特点: 性能最好，但端口可能冲突，隔离性差。
```

### 自定义网络实现服务发现

Docker Compose 默认创建一个 bridge 网络，同一网络内的容器可以通过服务名互相访问。这对 Agent 服务非常重要，因为你的 API 服务需要连接 Redis 和 PostgreSQL。

```python
# src/config.py
import os

# 使用 Docker Compose 的服务名作为主机名
REDIS_URL = os.getenv("REDIS_URL", "redis://localhost:6379/0")
DATABASE_URL = os.getenv("DATABASE_URL", "postgresql://agent:agent@localhost:5432/agent_db")

# Agent API 地址（如果 LLM 推理服务独立部署）
LLM_API_URL = os.getenv("LLM_API_URL", "http://llm-inference:8001/v1")
```

## 数据卷管理

容器是临时的，但数据需要持久化。Docker 提供了三种数据持久化方式。

### 三种挂载方式

```bash
# 1. 命名卷（Named Volume）-- 推荐用于数据库、模型缓存
docker volume create agent-data
docker run -v agent-data:/data my-agent

# 2. 绑定挂载（Bind Mount）-- 推荐用于配置文件、开发时的代码热更新
docker run -v $(pwd)/config:/app/config:ro my-agent

# 3. tmpfs 挂载 -- 用于敏感数据，只存在于内存中
docker run --tmpfs /app/secrets my-agent
```

### 实际使用场景

```yaml
volumes:
  # 开发环境：代码热更新
  agent-api:
    volumes:
      - ./src:/app/src                  # 代码实时同步
      - /app/__pycache__                # 排除缓存目录

  # 生产环境：数据持久化
  agent-api:
    volumes:
      - ./config:/app/config:ro         # 配置只读
      - agent-logs:/app/logs            # 日志持久化
      - agent-data:/app/data            # 数据持久化

  # 数据库：必须持久化
  postgres:
    volumes:
      - postgres-data:/var/lib/postgresql/data
```

## 镜像优化

镜像体积直接影响拉取速度和部署效率。一个优化良好的镜像应该尽可能小。

### 优化策略

**1. 选择合适的基础镜像**

| 基础镜像 | 大小 | 适用场景 |
|---------|------|---------|
| python:3.11 | ~1GB | 不推荐，包含太多无用工具 |
| python:3.11-slim | ~150MB | 推荐大多数场景 |
| python:3.11-alpine | ~50MB | 追求极致体积，但可能有兼容问题 |
| distroless | ~30MB | 最小化，适合生产环境 |

**2. 合并 RUN 指令并清理缓存**

```dockerfile
# 不推荐：每条 RUN 生成一层，且缓存占用空间
RUN apt-get update
RUN apt-get install -y gcc
RUN rm -rf /var/lib/apt/lists/*

# 推荐：合并为一条，减少层数和体积
RUN apt-get update && \
    apt-get install -y --no-install-recommends gcc && \
    rm -rf /var/lib/apt/lists/*
```

**3. 使用 .dockerignore 排除无关文件**

```
# .dockerignore
.git
.github
.vscode
__pycache__
*.pyc
*.pyo
.pytest_cache
.mypy_cache
tests/
docs/
*.md
.env
.venv
node_modules
```

**4. 利用缓存机制优化构建顺序**

```dockerfile
# 先复制依赖文件，再复制代码
# 这样只有依赖变化时才重新安装
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# 代码变化频繁，放在最后
COPY src/ ./src/
```

## 安全最佳实践

容器安全不是可选项，特别是 Agent 服务通常涉及 API 密钥、用户数据等敏感信息。

### 核心安全措施

**1. 使用非 root 用户运行**

```dockerfile
# 创建专用用户
RUN groupadd -r agent && \
    useradd -r -g agent -d /app -s /sbin/nologin agent

# 设置目录权限
RUN chown -R agent:agent /app

# 切换到非 root 用户
USER agent
```

**2. 只读文件系统**

```yaml
# docker-compose.yml
services:
  agent-api:
    read_only: true                    # 只读根文件系统
    tmpfs:
      - /tmp                           # 需要写入的目录用 tmpfs
      - /app/logs
    security_opt:
      - no-new-privileges:true         # 防止权限提升
```

**3. 密钥管理**

```bash
# 不要把密钥写在 Dockerfile 或 docker-compose.yml 中
# 不推荐：
environment:
  - OPENAI_API_KEY=sk-xxx             # 明文写在文件中

# 推荐方式一：使用 .env 文件（不要提交到 git）
# .env
OPENAI_API_KEY=sk-xxx
POSTGRES_PASSWORD=secret

# 推荐方式二：使用 Docker Secrets（Swarm 模式）
docker secret create openai_key openai_key.txt

# 推荐方式三：使用云服务商的密钥管理服务
# AWS Secrets Manager / GCP Secret Manager / 阿里云 KMS
```

**4. 镜像扫描**

```bash
# 使用 Trivy 扫描镜像漏洞
docker run --rm -v /var/run/docker.sock:/var/run/docker.sock \
  aquasec/trivy image my-agent:1.0

# 集成到 CI/CD
# GitHub Actions 示例
# - name: Scan image
#   uses: aquasecurity/trivy-action@master
#   with:
#     image-ref: 'my-agent:1.0'
#     severity: 'CRITICAL,HIGH'
```

## 常见坑与解决方案

### 坑 1：镜像层缓存失效

**现象：** 每次构建都很慢，明明只改了一行代码。

**原因：** Dockerfile 中 COPY 指令的顺序不对，导致依赖安装层的缓存失效。

```dockerfile
# 错误：代码变化导致整个构建重跑
COPY . .
RUN pip install -r requirements.txt

# 正确：先复制依赖文件，再复制代码
COPY requirements.txt .
RUN pip install -r requirements.txt
COPY . .
```

### 坑 2：容器内中文乱码

**现象：** 容器内打印中文日志是乱码。

**解决方案：**

```dockerfile
# 设置 locale
ENV LANG=C.UTF-8
ENV LC_ALL=C.UTF-8
```

### 坑 3：容器时区不对

**现象：** 日志时间是 UTC，不是北京时间。

```dockerfile
# 方案一：安装时区数据
RUN apt-get update && apt-get install -y tzdata && \
    ln -sf /usr/share/zoneinfo/Asia/Shanghai /etc/localtime && \
    rm -rf /var/lib/apt/lists/*

ENV TZ=Asia/Shanghai

# 方案二：直接挂载（需要宿主机有对应文件）
# docker run -v /etc/localtime:/etc/localtime:ro my-agent
```

### 坑 4：GPU 容器无法访问显卡

**现象：** 容器内 torch.cuda.is_available() 返回 False。

**排查步骤：**

```bash
# 1. 确认宿主机 NVIDIA 驱动正常
nvidia-smi

# 2. 确认安装了 NVIDIA Container Toolkit
docker run --rm --gpus all nvidia/cuda:12.2.0-base-ubuntu22.04 nvidia-smi

# 3. 确认 docker-compose.yml 中的 GPU 配置正确
deploy:
  resources:
    reservations:
      devices:
        - driver: nvidia
          count: all
          capabilities: [gpu]
```

### 坑 5：多阶段构建中 COPY --from 路径错误

**现象：** 构建报错 `COPY failed: stat /var/lib/docker/overlay2/.../install: file does not exist`。

**原因：** builder 阶段的 `pip install --prefix=/install` 路径和 runtime 阶段的 `COPY --from=builder /install` 路径不一致。

```dockerfile
# 确保两个阶段的路径一致
# Builder 阶段
RUN pip install --no-cache-dir --prefix=/install -r requirements.txt

# Runtime 阶段
COPY --from=builder /install /usr/local
```

## 总结

对于从前端转 AI Agent 开发的同学来说，Docker 不是一个"学了就行"的工具，而是一种思维方式。它让你从"我的环境能跑"转变为"任何环境都能跑"。

回顾本文的核心要点：

1. Dockerfile 的层缓存机制决定了构建效率，把变化频率低的操作放前面
2. 多阶段构建是减小镜像体积的关键手段，Agent 项目至少能减小 60%
3. Docker Compose 让多服务编排变得简单，善用 depends_on 和 healthcheck
4. 安全实践不可忽视，非 root 用户 + 只读文件系统 + 密钥管理是底线
5. 镜像优化要持续做，每次构建都检查体积，设置大小告警

容器化只是第一步，接下来可以了解 [K8s 部署 Agent 服务](/afine907-wiki/cloud-native/k8s-agent-deployment) 来实现更高级的编排能力。

## 参考资料

- Docker 官方文档: https://docs.docker.com/
- Dockerfile 最佳实践: https://docs.docker.com/develop/develop-images/dockerfile_best-practices/
- Docker Compose 文档: https://docs.docker.com/compose/
- NVIDIA Container Toolkit: https://docs.nvidia.com/datacenter/cloud-native/container-toolkit/
- Trivy 镜像扫描: https://trivy.dev/
