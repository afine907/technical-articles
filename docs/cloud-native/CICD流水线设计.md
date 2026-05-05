---
sidebar_position: 3
title: CI/CD 流水线设计
slug: cicd-pipeline-design
---

# CI/CD 流水线设计

## 引言：一次深夜事故引发的思考

周五晚上十一点，我正在追一部日剧，手机突然震个不停。监控群里炸了——Agent 服务的线上版本出了严重 Bug，模型调用链路断裂，用户请求全部 500。我赶紧打开电脑，发现是下午某位同事直接往 main 分支推了一段没有经过测试的代码，而当时正好赶上一次手动部署。

这种"人肉 CI/CD"的痛，我相信每个前端转后端的同学都经历过。前端项目里我们有 webpack-dev-server 热更新、有 Vercel/Netlify 的自动预览，一切看起来都很优雅。但当你的服务变成了一个需要对接 LLM API、需要 GPU 资源、需要管理模型密钥的 Agent 服务时，部署复杂度直接拉了好几个量级。

这篇文章就来聊聊，一个 Agent 服务的 CI/CD 流水线应该怎么设计——从代码提交到生产部署，全流程打通。

## CI/CD 概述：到底在解决什么问题

CI（持续集成）和 CD（持续交付/部署）不是什么新概念，但在 Agent 服务场景下，它们的含义有一些微妙的变化。

**CI（Continuous Integration）的核心**：每次代码提交都自动触发构建和测试，尽早发现问题。对于 Agent 服务来说，CI 阶段除了常规的 lint 和单元测试，还需要关注 Prompt 模板的格式校验、模型 API 的 mock 测试等。

**CD（Continuous Delivery/Deployment）的核心**：把通过 CI 的代码自动推送到目标环境。Agent 服务的 CD 还需要处理模型配置切换、API Key 轮换、LLM 费用预算检查等传统 Web 服务不太会遇到的问题。

一个典型的 Agent 服务 CI/CD 流水线如下：

```
代码提交
  |
  v
+------------------+
|   CI 阶段         |
|  +-------------+ |
|  | Lint/Format | |
|  +-------------+ |
|  | Type Check  | |
|  +-------------+ |
|  | Unit Tests  | |
|  +-------------+ |
|  | Prompt Lint | |
|  +-------------+ |
+------------------+
  |
  v
+------------------+
|   Build 阶段      |
|  +-------------+ |
|  | Docker Build| |
|  +-------------+ |
|  | Image Push  | |
|  +-------------+ |
|  | SBOM/Scan   | |
|  +-------------+ |
+------------------+
  |
  v
+------------------+
|   Deploy 阶段     |
|  +-------------+ |
|  | Dev Deploy  | |
|  +-------------+ |
|  | Smoke Tests | |
|  +-------------+ |
|  | Staging     | |
|  +-------------+ |
|  | Production  | |
|  +-------------+ |
+------------------+
```

## GitHub Actions 基础：Agent 服务的首选 CI/CD 平台

在众多 CI/CD 工具中，GitHub Actions 对 Agent 项目来说是最自然的选择。原因很简单：你的代码在 GitHub 上，Agent 项目通常也依赖 GitHub 上的各种开源 LangChain/LangGraph 生态，用 GitHub Actions 能最方便地集成 Secrets、环境变量和 OIDC 认证。

### 核心概念速览

| 概念 | 说明 | Agent 服务类比 |
|------|------|---------------|
| Workflow | 一个完整的 CI/CD 流程定义 | 从代码提交到生产的全流程 |
| Job | Workflow 中的一个任务单元 | 比如"测试"或"部署"是独立 Job |
| Step | Job 中的一个具体步骤 | 比如"运行 pytest"是一个 Step |
| Runner | 执行 Job 的机器 | GitHub 提供的 Ubuntu runner 或自托管 |
| Action | 可复用的 Step 组件 | 比如 `actions/setup-python` |
| Matrix | 多环境并行构建策略 | 同时测试 Python 3.10 和 3.11 |

### 最小可用 Workflow

先看一个最基础的例子，跑通 CI：

```yaml
# .github/workflows/ci.yml
name: Agent Service CI

on:
  push:
    branches: [main, develop]
  pull_request:
    branches: [main]

jobs:
  lint-and-test:
    runs-on: ubuntu-latest
    steps:
      - name: Checkout code
        uses: actions/checkout@v4

      - name: Set up Python
        uses: actions/setup-python@v5
        with:
          python-version: "3.11"

      - name: Install dependencies
        run: |
          pip install poetry
          poetry install --no-interaction

      - name: Lint with Ruff
        run: poetry run ruff check .

      - name: Type check with mypy
        run: poetry run mypy src/

      - name: Run tests
        run: poetry run pytest --cov=src --cov-report=xml
```

这个 workflow 做了三件事：代码检查、类型检查、单元测试。对于前端同学来说，这就像 eslint + tsc + jest 的组合，只是工具链换成了 Python 生态的 Ruff、mypy、pytest。

## Agent 服务 CI/CD 全流程设计

接下来我们搭建一个完整的 Agent 服务 CI/CD 流水线。假设项目结构如下：

```
agent-service/
  src/
    agent/          # Agent 核心逻辑
    tools/          # 工具函数
    prompts/        # Prompt 模板
    config/         # 配置管理
  tests/
    unit/           # 单元测试
    integration/    # 集成测试
    e2e/            # 端到端测试
  deploy/
    k8s/            # K8s 部署配置
    docker/         # Docker 相关配置
  .github/
    workflows/
      ci.yml
      cd-dev.yml
      cd-prod.yml
  pyproject.toml
  Dockerfile
```

### 第一步：CI 阶段——代码质量保障

CI 阶段要覆盖 lint、类型检查、单元测试，以及 Agent 特有的 Prompt 校验。

```yaml
# .github/workflows/ci.yml
name: CI

on:
  push:
    branches: [main, develop]
  pull_request:
    branches: [main]

env:
  PYTHON_VERSION: "3.11"
  NODE_VERSION: "20"

jobs:
  lint:
    name: Lint & Format Check
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Set up Python
        uses: actions/setup-python@v5
        with:
          python-version: ${{ env.PYTHON_VERSION }}

      - name: Cache pip dependencies
        uses: actions/cache@v4
        with:
          path: ~/.cache/pip
          key: ${{ runner.os }}-pip-${{ hashFiles('**/pyproject.toml') }}
          restore-keys: |
            ${{ runner.os }}-pip-

      - name: Install dependencies
        run: |
          pip install poetry
          poetry install --no-interaction

      - name: Ruff lint
        run: poetry run ruff check . --output-format=github

      - name: Ruff format check
        run: poetry run ruff format --check .

  type-check:
    name: Type Check
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Set up Python
        uses: actions/setup-python@v5
        with:
          python-version: ${{ env.PYTHON_VERSION }}

      - name: Cache pip dependencies
        uses: actions/cache@v4
        with:
          path: ~/.cache/pip
          key: ${{ runner.os }}-pip-${{ hashFiles('**/pyproject.toml') }}

      - name: Install dependencies
        run: |
          pip install poetry
          poetry install --no-interaction

      - name: mypy type check
        run: poetry run mypy src/ --strict

  test:
    name: Unit Tests
    runs-on: ubuntu-latest
    strategy:
      matrix:
        python-version: ["3.10", "3.11", "3.12"]
    steps:
      - uses: actions/checkout@v4

      - name: Set up Python ${{ matrix.python-version }}
        uses: actions/setup-python@v5
        with:
          python-version: ${{ matrix.python-version }}

      - name: Cache pip dependencies
        uses: actions/cache@v4
        with:
          path: ~/.cache/pip
          key: ${{ runner.os }}-pip-${{ matrix.python-version }}-${{ hashFiles('**/pyproject.toml') }}

      - name: Install dependencies
        run: |
          pip install poetry
          poetry install --no-interaction

      - name: Run unit tests
        run: |
          poetry run pytest tests/unit/ \
            --cov=src \
            --cov-report=xml \
            --junitxml=reports/junit.xml

      - name: Upload coverage report
        if: matrix.python-version == '3.11'
        uses: actions/upload-artifact@v4
        with:
          name: coverage-report
          path: coverage.xml

  prompt-lint:
    name: Prompt Template Lint
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Set up Python
        uses: actions/setup-python@v5
        with:
          python-version: ${{ env.PYTHON_VERSION }}

      - name: Install dependencies
        run: |
          pip install poetry
          poetry install --no-interaction

      - name: Validate prompt templates
        run: |
          python -c "
          import yaml
          import sys
          from pathlib import Path

          errors = []
          for f in Path('src/prompts').glob('*.yaml'):
              try:
                  data = yaml.safe_load(f.read_text())
                  if 'template' not in data:
                      errors.append(f'{f}: missing template key')
                  if 'variables' not in data:
                      errors.append(f'{f}: missing variables key')
              except Exception as e:
                  errors.append(f'{f}: {e}')

          if errors:
              for e in errors:
                  print(f'ERROR: {e}')
              sys.exit(1)
          print('All prompt templates validated.')
          "
```

这里有几个值得说明的点：

**Matrix Builds（矩阵构建）**：Agent 服务通常需要兼容多个 Python 版本，matrix 策略让你用一份配置同时跑多个版本的测试。`strategy.matrix` 会自动展开为多个并行 Job。

**Prompt Lint**：这是 Agent 服务特有的 CI 步骤。我们的 Prompt 模板用 YAML 文件管理，CI 阶段会校验每个模板是否包含必要的 `template` 和 `variables` 字段，防止格式错误的模板流入生产环境。

**缓存策略**：`actions/cache` 缓存 pip 依赖，`key` 用 `pyproject.toml` 的 hash 来判断是否需要重新安装。这在 Agent 项目中特别重要，因为 `langchain`、`langgraph` 这些依赖包非常大，每次全量安装要好几分钟。

### 第二步：Build 阶段——Docker 镜像构建与推送

通过 CI 后，进入构建阶段。Agent 服务的 Docker 镜像通常比较大（因为要包含 Python 运行时和大量依赖），所以构建策略需要一些优化。

```yaml
# .github/workflows/build.yml
name: Build & Push

on:
  workflow_run:
    workflows: ["CI"]
    types: [completed]
    branches: [main, develop]

env:
  REGISTRY: ghcr.io
  IMAGE_NAME: ${{ github.repository }}/agent-service

jobs:
  build-and-push:
    name: Build Docker Image
    runs-on: ubuntu-latest
    if: ${{ github.event.workflow_run.conclusion == 'success' }}
    permissions:
      contents: read
      packages: write
    outputs:
      image-tag: ${{ steps.meta.outputs.version }}
    steps:
      - uses: actions/checkout@v4

      - name: Set up Docker Buildx
        uses: docker/setup-buildx-action@v3

      - name: Log in to Container Registry
        uses: docker/login-action@v3
        with:
          registry: ${{ env.REGISTRY }}
          username: ${{ github.actor }}
          password: ${{ secrets.GITHUB_TOKEN }}

      - name: Extract metadata
        id: meta
        uses: docker/metadata-action@v5
        with:
          images: ${{ env.REGISTRY }}/${{ env.IMAGE_NAME }}
          tags: |
            type=sha,prefix=
            type=ref,event=branch
            type=semver,pattern={{version}}

      - name: Build and push Docker image
        uses: docker/build-push-action@v5
        with:
          context: .
          file: Dockerfile
          push: true
          tags: ${{ steps.meta.outputs.tags }}
          labels: ${{ steps.meta.outputs.labels }}
          cache-from: type=gha
          cache-to: type=gha,mode=max
          build-args: |
            PYTHON_VERSION=3.11
            BUILDKIT_INLINE_CACHE=1

  security-scan:
    name: Container Security Scan
    needs: build-and-push
    runs-on: ubuntu-latest
    steps:
      - name: Run Trivy vulnerability scanner
        uses: aquasecurity/trivy-action@master
        with:
          image-ref: ${{ env.REGISTRY }}/${{ env.IMAGE_NAME }}:${{ needs.build-and-push.outputs.image-tag }}
          format: "sarif"
          output: "trivy-results.sarif"
          severity: "CRITICAL,HIGH"

      - name: Upload Trivy scan results
        uses: github/codeql-action/upload-sarif@v3
        with:
          sarif_file: "trivy-results.sarif"
```

几个关键点：

**BuildKit 缓存**：`cache-from: type=gha` 和 `cache-to: type=gha,mode=max` 使用 GitHub Actions 的缓存后端存储 Docker 层。对于 Agent 服务这种依赖很多的镜像，缓存命中时构建时间可以从 10 分钟缩短到 2 分钟。

**安全扫描**：Agent 服务的镜像包含大量第三方依赖，用 Trivy 扫描已知漏洞是必要的。特别是 `langchain` 生态的依赖链很长，安全风险面更大。

**镜像标签策略**：`docker/metadata-action` 自动生成多种标签——git commit SHA（用于精确回滚）、分支名（用于环境跟踪）、语义化版本（用于正式发布）。

### 第三步：Deploy 阶段——从 Staging 到 Production

部署阶段采用分环境推进策略，先部署到 dev，再推进到 staging，最后到 prod。

```yaml
# .github/workflows/deploy.yml
name: Deploy Agent Service

on:
  workflow_run:
    workflows: ["Build & Push"]
    types: [completed]
    branches: [main]

env:
  REGISTRY: ghcr.io
  IMAGE_NAME: ${{ github.repository }}/agent-service

jobs:
  deploy-dev:
    name: Deploy to Dev
    runs-on: ubuntu-latest
    if: ${{ github.event.workflow_run.conclusion == 'success' }}
    environment:
      name: dev
      url: https://dev-agent.example.com
    steps:
      - uses: actions/checkout@v4

      - name: Configure kubectl
        uses: azure/k8s-set-context@v3
        with:
          kubeconfig: ${{ secrets.KUBE_CONFIG_DEV }}

      - name: Update image tag in deployment
        run: |
          IMAGE_TAG=$(echo ${{ github.sha }} | cut -c1-7)
          kubectl set image deployment/agent-service \
            agent-service=${{ env.REGISTRY }}/${{ env.IMAGE_NAME }}:${IMAGE_TAG} \
            -n agent-dev

      - name: Wait for rollout
        run: |
          kubectl rollout status deployment/agent-service \
            -n agent-dev --timeout=300s

      - name: Run smoke tests
        run: |
          # 等待服务就绪
          for i in $(seq 1 30); do
            STATUS=$(curl -s -o /dev/null -w "%{http_code}" \
              https://dev-agent.example.com/health)
            if [ "$STATUS" = "200" ]; then
              echo "Service is healthy"
              exit 0
            fi
            echo "Waiting for service... attempt $i"
            sleep 10
          done
          echo "Service failed to become healthy"
          exit 1

  deploy-staging:
    name: Deploy to Staging
    needs: deploy-dev
    runs-on: ubuntu-latest
    environment:
      name: staging
      url: https://staging-agent.example.com
    steps:
      - uses: actions/checkout@v4

      - name: Configure kubectl
        uses: azure/k8s-set-context@v3
        with:
          kubeconfig: ${{ secrets.KUBE_CONFIG_STAGING }}

      - name: Update image tag
        run: |
          IMAGE_TAG=$(echo ${{ github.sha }} | cut -c1-7)
          kubectl set image deployment/agent-service \
            agent-service=${{ env.REGISTRY }}/${{ env.IMAGE_NAME }}:${IMAGE_TAG} \
            -n agent-staging

      - name: Wait for rollout
        run: |
          kubectl rollout status deployment/agent-service \
            -n agent-staging --timeout=300s

      - name: Run integration tests against staging
        run: |
          pip install poetry
          poetry install --no-interaction
          poetry run pytest tests/integration/ \
            --base-url=https://staging-agent.example.com \
            -v

  deploy-prod:
    name: Deploy to Production
    needs: deploy-staging
    runs-on: ubuntu-latest
    environment:
      name: production
      url: https://agent.example.com
    steps:
      - uses: actions/checkout@v4

      - name: Configure kubectl
        uses: azure/k8s-set-context@v3
        with:
          kubeconfig: ${{ secrets.KUBE_CONFIG_PROD }}

      - name: Deploy with rolling update
        run: |
          IMAGE_TAG=$(echo ${{ github.sha }} | cut -c1-7)
          kubectl set image deployment/agent-service \
            agent-service=${{ env.REGISTRY }}/${{ env.IMAGE_NAME }}:${IMAGE_TAG} \
            -n agent-prod

      - name: Wait for rollout
        run: |
          kubectl rollout status deployment/agent-service \
            -n agent-prod --timeout=600s

      - name: Verify production health
        run: |
          for i in $(seq 1 60); do
            RESPONSE=$(curl -s https://agent.example.com/health)
            STATUS=$(echo $RESPONSE | jq -r '.status')
            if [ "$STATUS" = "healthy" ]; then
              echo "Production service is healthy"
              exit 0
            fi
            echo "Waiting for production... attempt $i"
            sleep 10
          done
          echo "Production health check failed"
          exit 1
```

注意 `environment` 配置——GitHub Actions 的 Environment 功能可以配合审批流程使用。production 环境可以配置需要特定人员 approval 才能部署，这在 Agent 服务中非常重要，因为一次错误的部署可能带来大量的 LLM API 费用损失。

## 环境管理：三套环境各司其职

Agent 服务的环境管理比普通 Web 服务复杂一些，因为每个环境对接的 LLM 配置可能完全不同。

```
+------------------+     +------------------+     +------------------+
|     Dev 环境      | --> |   Staging 环境    | --> |   Production     |
+------------------+     +------------------+     +------------------+
| Mock LLM API     |     | 小模型 (Haiku)    |     | 正式模型 (GPT-4)  |
| SQLite           |     | 测试数据库        |     | 生产数据库        |
| 无 GPU           |     | 无 GPU           |     | GPU 节点          |
| 自动部署          |     | 自动部署          |     | 人工审批后部署     |
+------------------+     +------------------+     +------------------+
```

**Dev 环境**：使用 Mock 的 LLM API，不需要真实调用模型。开发人员在这里快速迭代 Agent 逻辑，成本接近零。

**Staging 环境**：使用较小的模型（比如 GPT-4o-mini 或 Claude Haiku）做集成测试。Staging 的数据库应该用生产数据的脱敏快照，确保测试的真实性。

**Production 环境**：使用正式的模型和完整的基础设施。部署需要人工审批，支持一键回滚。

K8s 中通过 Namespace 隔离不同环境：

```yaml
# deploy/k8s/namespace.yml
apiVersion: v1
kind: Namespace
metadata:
  name: agent-dev
  labels:
    env: dev
---
apiVersion: v1
kind: Namespace
metadata:
  name: agent-staging
  labels:
    env: staging
---
apiVersion: v1
kind: Namespace
metadata:
  name: agent-prod
  labels:
    env: production
```

## Secrets 管理：Agent 服务的生命线

Agent 服务涉及大量的密钥：LLM API Key、数据库密码、向量数据库 Token、S3 Access Key 等。密钥管理一旦出问题，轻则服务不可用，重则产生巨额 API 费用。

### GitHub Secrets 基础

GitHub Actions 的 Secrets 是最基本的密钥管理方案：

```yaml
# 在 workflow 中使用 Secrets
- name: Configure LLM API Key
  run: |
    echo "OPENAI_API_KEY=${{ secrets.OPENAI_API_KEY }}" >> .env
    echo "ANTHROPIC_API_KEY=${{ secrets.ANTHROPIC_API_KEY }}" >> .env
```

但直接在 workflow 里用 Secrets 有个问题——Secrets 不会暴露到日志里，但如果有人在代码里 `print(os.environ)` 然后提交 PR，Secrets 可能被意外泄露。所以需要额外的安全措施。

### SOPS 加密配置文件

对于更复杂的配置管理，推荐使用 [Mozilla SOPS](https://github.com/getsops/sops) 加密配置文件：

```yaml
# deploy/config/staging.enc.yml
# 这个文件用 SOPS 加密，只有 CI 环境能解密
LLM_PROVIDER: openai
LLM_MODEL: gpt-4o
LLM_API_KEY: ENC[AES256_GCM,data:xxx...]
DATABASE_URL: ENC[AES256_GCM,data:yyy...]
VECTOR_DB_URL: ENC[AES256_GCM,data:zzz...]
COST_BUDGET_DAILY: "500"
```

CI 中的解密步骤：

```yaml
- name: Decrypt secrets with SOPS
  run: |
    # SOPS 使用 GitHub Actions 的 OIDC 或 KMS 密钥解密
    sops --decrypt deploy/config/staging.enc.yml > deploy/config/staging.yml

- name: Apply Kubernetes secrets
  run: |
    kubectl create secret generic agent-secrets \
      --from-file=deploy/config/staging.yml \
      -n agent-staging \
      --dry-run=client -o yaml | kubectl apply -f -
```

### Agent 特有：模型 API Key 轮换

Agent 服务的 API Key 轮换是一个独特的需求。LLM API 通常有调用频率限制和费用预算，需要定期轮换 Key 来分散压力。

```yaml
# .github/workflows/rotate-keys.yml
name: Rotate LLM API Keys

on:
  schedule:
    # 每周一凌晨 3 点轮换
    - cron: "0 3 * * 1"

jobs:
  rotate-keys:
    runs-on: ubuntu-latest
    environment: production
    steps:
      - uses: actions/checkout@v4

      - name: Generate new API keys
        id: keys
        run: |
          # 这里接入你的密钥管理系统
          # 比如 Vault、AWS Secrets Manager 等
          echo "new_key=$(python scripts/generate_key.py)" >> $GITHUB_OUTPUT

      - name: Update secrets in Vault
        run: |
          vault kv put secret/agent/llm \
            openai_key="${{ steps.keys.outputs.new_key }}" \
            rotation_date="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
        env:
          VAULT_TOKEN: ${{ secrets.VAULT_TOKEN }}

      - name: Trigger rolling restart
        run: |
          kubectl rollout restart deployment/agent-service \
            -n agent-prod
```

## LLM 成本监控集成到 CI

Agent 服务与传统 Web 服务最大的区别之一是运行时成本不固定——每次 LLM 调用都会产生费用。把成本监控集成到 CI 流程中，可以在部署前就发现潜在的费用风险。

```yaml
# 在 CI 中加入成本预算检查
  cost-check:
    name: LLM Cost Budget Check
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Analyze LLM call patterns
        run: |
          python scripts/analyze_cost.py \
            --threshold-daily 500 \
            --threshold-monthly 10000 \
            --fail-on-exceed

      - name: Check prompt token usage
        run: |
          # 扫描所有 Prompt 模板的预估 token 用量
          python scripts/token_budget.py \
            --max-tokens-per-request 4000 \
            --warn-at 3000

      - name: Upload cost report
        if: always()
        uses: actions/upload-artifact@v4
        with:
          name: cost-analysis-report
          path: reports/cost-analysis.json
```

`analyze_cost.py` 这个脚本会读取最近 N 天的 LLM 调用日志，计算平均每次调用的费用，然后和预算阈值比较。如果发现某个 PR 引入的 Agent 逻辑会导致调用次数激增（比如 Prompt 里多了一个循环调用工具的步骤），CI 就会报警。

## 部署策略：Rolling、Canary、Blue-Green

Agent 服务的部署策略选择直接影响可用性和成本风险。

### Rolling Update（滚动更新）

最常用的策略，K8s 默认行为。逐步替换旧版本的 Pod：

```yaml
# deploy/k8s/deployment.yml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: agent-service
spec:
  replicas: 4
  strategy:
    type: RollingUpdate
    rollingUpdate:
      maxSurge: 1        # 最多多出 1 个 Pod
      maxUnavailable: 0  # 不允许有不可用的 Pod
  template:
    spec:
      containers:
        - name: agent-service
          image: ghcr.io/org/agent-service:latest
          resources:
            requests:
              cpu: "500m"
              memory: "512Mi"
            limits:
              cpu: "2000m"
              memory: "2Gi"
          readinessProbe:
            httpGet:
              path: /health
              port: 8000
            initialDelaySeconds: 10
            periodSeconds: 5
          livenessProbe:
            httpGet:
              path: /health
              port: 8000
            initialDelaySeconds: 30
            periodSeconds: 10
```

`maxSurge: 1` 和 `maxUnavailable: 0` 的组合确保在更新过程中始终有足够多的健康 Pod 在服务请求。对 Agent 服务来说这很重要——一次 LLM 对话可能持续 30 秒甚至更久，如果 Pod 被过早终止，正在进行的对话会中断。

### Canary Release（金丝雀发布）

先把一小部分流量导到新版本，观察一段时间没有问题再全量发布。对 Agent 服务来说，Canary 可以帮助你在真实流量下验证新 Prompt 的效果：

```yaml
# canary deployment
apiVersion: apps/v1
kind: Deployment
metadata:
  name: agent-service-canary
spec:
  replicas: 1  # 只部署 1 个副本作为金丝雀
  selector:
    matchLabels:
      app: agent-service
      version: canary
  template:
    metadata:
      labels:
        app: agent-service
        version: canary
    spec:
      containers:
        - name: agent-service
          image: ghcr.io/org/agent-service:canary
---
# Istio VirtualService 配置（如果使用 Istio）
apiVersion: networking.istio.io/v1beta1
kind: VirtualService
metadata:
  name: agent-service
spec:
  hosts:
    - agent-service
  http:
    - route:
        - destination:
            host: agent-service
            subset: stable
          weight: 90
        - destination:
            host: agent-service
            subset: canary
          weight: 10
```

### Blue-Green Deployment（蓝绿部署）

维护两套完整环境，切换流量瞬间完成。适合 Agent 服务这种对回滚速度要求高的场景——如果新版本的 Prompt 效果不好，秒级切回旧版本：

```yaml
# Blue-Green 通过 Service selector 切换
apiVersion: v1
kind: Service
metadata:
  name: agent-service
spec:
  selector:
    app: agent-service
    version: blue  # 改成 green 即可切换
  ports:
    - port: 80
      targetPort: 8000
```

## 回滚策略：Agent 服务的安全网

Agent 服务的回滚不仅仅是代码回滚——Prompt 模型配置、工具调用链路都需要一起回滚。

```yaml
# .github/workflows/rollback.yml
name: Rollback Agent Service

on:
  workflow_dispatch:
    inputs:
      environment:
        description: "Target environment"
        required: true
        type: choice
        options: [staging, production]
      revision:
        description: "Image tag or commit SHA to rollback to"
        required: true
      reason:
        description: "Reason for rollback"
        required: true

jobs:
  rollback:
    runs-on: ubuntu-latest
    environment: ${{ github.event.inputs.environment }}
    steps:
      - uses: actions/checkout@v4

      - name: Configure kubectl
        uses: azure/k8s-set-context@v3
        with:
          kubeconfig: ${{ secrets.KUBE_CONFIG_${{ github.event.inputs.environment == 'production' && 'PROD' || 'STAGING' }} }}

      - name: Record current revision
        run: |
          CURRENT=$(kubectl get deployment agent-service \
            -n agent-${{ github.event.inputs.environment }} \
            -o jsonpath='{.spec.template.spec.containers[0].image}')
          echo "Rolling back from: $CURRENT"
          echo "Rolling back to: ${{ github.event.inputs.revision }}"

      - name: Execute rollback
        run: |
          IMAGE_TAG=${{ github.event.inputs.revision }}
          kubectl set image deployment/agent-service \
            agent-service=${{ env.REGISTRY }}/${{ env.IMAGE_NAME }}:${IMAGE_TAG} \
            -n agent-${{ github.event.inputs.environment }}

      - name: Verify rollback
        run: |
          kubectl rollout status deployment/agent-service \
            -n agent-${{ github.event.inputs.environment }} \
            --timeout=300s

      - name: Notify rollback
        run: |
          curl -X POST "${{ secrets.SLACK_WEBHOOK }}" \
            -H "Content-Type: application/json" \
            -d '{
              "text": "Agent service rolled back to '"$IMAGE_TAG"' in '"${{ github.event.inputs.environment }}"'",
              "reason": "${{ github.event.inputs.reason }}",
              "operator": "${{ github.actor }}"
            }'
```

注意这个 rollback workflow 使用了 `workflow_dispatch`，支持手动触发并填写回滚版本和原因。在生产事故中，每一秒都很宝贵——直接在 GitHub Actions 页面点一下就能回滚，比 SSH 到服务器手动操作快得多。

## 常见坑点与解决方案

### 坑点一：Docker 镜像太大导致构建超时

Agent 服务的镜像动辄 2-3GB，包含完整的 Python 运行时和所有 ML 依赖。GitHub Actions 的默认超时是 6 小时，但构建时间过长会严重影响迭代效率。

**解决方案**：使用多阶段构建和依赖分层缓存。

```dockerfile
# Dockerfile - 多阶段构建
FROM python:3.11-slim AS builder

WORKDIR /app
COPY pyproject.toml poetry.lock ./
RUN pip install poetry && \
    poetry config virtualenvs.create false && \
    poetry install --no-dev --no-interaction

FROM python:3.11-slim AS runtime

WORKDIR /app
# 只复制安装好的依赖，不复制源码（构建缓存）
COPY --from=builder /usr/local/lib/python3.11/site-packages /usr/local/lib/python3.11/site-packages
COPY --from=builder /usr/local/bin /usr/local/bin

# 再复制源码（源码变化不会影响依赖层的缓存）
COPY src/ ./src/

EXPOSE 8000
CMD ["uvicorn", "src.main:app", "--host", "0.0.0.0", "--port", "8000"]
```

### 坑点二：Mock LLM API 测试不够真实

在 CI 中用 Mock 的 LLM 响应做测试，通过了但上生产就出问题。因为 Mock 不会暴露 Prompt 格式错误、Token 超限、响应解析失败等真实问题。

**解决方案**：CI 中用真实的 LLM API 跑一组"冒烟测试"，但限制调用次数和模型等级。

```yaml
- name: LLM smoke test (real API, cheap model)
  env:
    OPENAI_API_KEY: ${{ secrets.OPENAI_API_KEY_TEST }}
  run: |
    python -m pytest tests/e2e/test_llm_smoke.py \
      --model=gpt-4o-mini \
      --max-calls=5 \
      -v
```

用 GPT-4o-mini 或 Claude Haiku 这种便宜模型跑少量真实调用，成本可以控制在几分钱以内，但能发现很多 Mock 测试覆盖不到的问题。

### 坑点三：Secrets 在 Matrix Build 中泄露

Matrix 构建会并行跑多个 Job，如果某个 Job 的日志输出了环境变量，可能在其他 Job 的日志页面看到敏感信息（虽然 GitHub 会做掩码，但不总是 100% 可靠）。

**解决方案**：限制 Secrets 的 Scope，只给必要的 Job 授权。

```yaml
jobs:
  test:
    # 测试 Job 不需要 Secrets
    runs-on: ubuntu-latest
    steps:
      - run: echo "No secrets needed here"

  deploy:
    # 部署 Job 才需要 Secrets
    runs-on: ubuntu-latest
    environment: production  # 限制 Secret 的环境范围
    steps:
      - run: echo "Using ${{ secrets.PROD_SECRET }}"
```

### 坑点四：Prompt 变更缺乏版本管理

Prompt 模板的变更和代码变更一样重要，但很多团队把 Prompt 直接写在代码里，没有独立的版本追踪。一旦新 Prompt 导致 Agent 行为异常，很难快速定位是哪个 Prompt 变更引起的。

**解决方案**：Prompt 模板独立管理，CI 中记录 Prompt 版本 hash。

```yaml
- name: Record prompt versions
  run: |
    echo "## Prompt Versions" >> $GITHUB_STEP_SUMMARY
    for f in src/prompts/*.yaml; do
      HASH=$(sha256sum "$f" | cut -c1-8)
      echo "- $f: \`$HASH\`" >> $GITHUB_STEP_SUMMARY
    done
```

### 坑点五：依赖安装失败率高

Agent 项目的依赖（特别是 `langchain` 生态）更新非常频繁，有时 Poetry lock 文件和 PyPI 上的实际版本不一致，导致 CI 中 `poetry install` 失败。

**解决方案**：在 CI 中使用 `--locked` 参数确保严格的依赖解析，并设置 pip 镜像源。

```yaml
- name: Install dependencies (locked)
  run: |
    pip install poetry
    poetry config virtualenvs.create false
    poetry install --no-interaction --locked
  env:
    PIP_INDEX_URL: https://mirrors.aliyun.com/pypi/simple/
    PIP_TRUSTED_HOST: mirrors.aliyun.com
```

## 总结

Agent 服务的 CI/CD 和传统 Web 服务的 CI/CD 最大的不同在于三个方面：

1. **Prompt 即代码**：Prompt 模板的变更需要和代码变更同等严格的测试和发布流程
2. **成本意识**：LLM API 调用是按量付费的，CI/CD 流程中需要嵌入成本监控和预算检查
3. **密钥敏感度**：大量 API Key 需要安全管理和定期轮换，不能像传统服务那样一个环境变量搞定

把这三件事做好，你的 Agent 服务 CI/CD 就不会成为生产事故的源头，而是成为你迭代速度的加速器。

## 参考资料

- [GitHub Actions 官方文档](https://docs.github.com/en/actions)
- [Kubernetes Deployment 文档](https://kubernetes.io/docs/concepts/workloads/controllers/deployment/)
- [Mozilla SOPS 项目](https://github.com/getsops/sops)
- [Trivy 容器安全扫描](https://github.com/aquasecurity/trivy)
- [Docker BuildKit 缓存最佳实践](https://docs.docker.com/build/cache/)
- [LangChain 生态依赖管理注意事项](https://python.langchain.com/docs/get_started/installation)
