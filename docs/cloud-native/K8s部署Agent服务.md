---
sidebar_position: 2
title: K8s 部署 Agent 服务
slug: k8s-agent-deployment
---

# K8s 部署 Agent 服务

上一篇我们把 Agent 服务 Docker 化了，镜像构建没问题，本地跑得也挺好。然后你 `docker run` 一把梭上去了——然后某天凌晨三点，服务挂了，你被电话叫醒，手动重启。

这就是为什么我们需要 Kubernetes。

Agent 服务和传统 Web 服务不太一样：它可能跑一个请求就是几十秒（等 LLM 返回），可能要流式输出（SSE/WebSocket），可能需要 GPU 推理，可能要保持对话状态。这些特性让 K8s 的部署策略有了针对性的考量。

这篇文章，我从 K8s 核心概念讲起，一步步搞定 Agent 服务的生产级部署。

## K8s 核心架构

先把 K8s 的整体架构搞清楚，不然后面看 YAML 会很懵。

```
┌─────────────────────────────────────────────────────────────┐
│                      K8s Cluster                            │
│                                                             │
│  ┌───────────────────────────────────────────────────────┐  │
│  │                 Master Node (Control Plane)           │  │
│  │                                                       │  │
│  │  ┌─────────────┐ ┌──────────────┐ ┌───────────────┐  │  │
│  │  │ API Server  │ │  Scheduler   │ │ Controller Mgr│  │  │
│  │  └─────────────┘ └──────────────┘ └───────────────┘  │  │
│  │  ┌─────────────┐ ┌──────────────┐                     │  │
│  │  │    etcd     │ │  Cloud Ctrl   │                    │  │
│  │  └─────────────┘ └──────────────┘                     │  │
│  └───────────────────────────────────────────────────────┘  │
│                                                             │
│  ┌──────────────────────┐  ┌──────────────────────┐        │
│  │     Worker Node 1    │  │     Worker Node 2    │        │
│  │  ┌────────────────┐  │  │  ┌────────────────┐  │        │
│  │  │   kubelet      │  │  │  │   kubelet      │  │        │
│  │  └────────────────┘  │  │  └────────────────┘  │        │
│  │  ┌────────────────┐  │  │  ┌────────────────┐  │        │
│  │  │  kube-proxy    │  │  │  │  kube-proxy    │  │        │
│  │  └────────────────┘  │  │  └────────────────┘  │        │
│  │  ┌───────┐ ┌───────┐│  │  ┌───────┐ ┌───────┐│        │
│  │  │ Pod A │ │ Pod B ││  │  │ Pod C │ │ Pod D ││        │
│  │  └───────┘ └───────┘│  │  └───────┘ └───────┘│        │
│  └──────────────────────┘  └──────────────────────┘        │
└─────────────────────────────────────────────────────────────┘
```

**Master Node** 负责全局调度和管理：
- **API Server**：所有操作的入口，`kubectl` 本质就是调 API Server
- **Scheduler**：决定 Pod 跑在哪个 Node 上
- **Controller Manager**：保证实际状态和期望状态一致（你说要 3 个副本，它就维持 3 个）
- **etcd**：存储集群所有状态数据的 KV 数据库

**Worker Node** 负责实际跑工作负载：
- **kubelet**：每个 Node 上的代理，负责管理 Pod 的生命周期
- **kube-proxy**：处理网络规则，实现 Service 的负载均衡
- **Container Runtime**：跑容器的（containerd、CRI-O 等）

## Pod 生命周期

理解 Pod 生命周期对排查 Agent 服务问题至关重要。

```
                    Pod 创建流程
                    ============

  用户提交 YAML ──→ API Server ──→ etcd 持久化
                                      │
                                      ▼
                                 Scheduler 分配 Node
                                      │
                                      ▼
                              目标 Node 的 kubelet
                                      │
                                      ▼
                              拉取镜像 + 创建容器
                                      │
                                      ▼
                        ┌─────────────────────────┐
                        │   Pod Running           │
                        │                         │
                        │   postStart hook        │
                        │   ↓                     │
                        │   readiness probe 通过?  │──→ No ──→ 不加入 Service
                        │   ↓ Yes                 │          Endpoints 不包含
                        │   加入 Service          │
                        │   Endpoints 更新        │
                        │                         │
                        │   liveness probe 通过?   │──→ No ──→ 容器重启
                        │   ↓ Yes                 │          (restartPolicy)
                        │   继续运行              │
                        │   ...                   │
                        │                         │
                        │   收到 SIGTERM           │
                        │   ↓                     │
                        │   preStop hook (如果配了) │
                        │   ↓                     │
                        │   等待 terminationGrace  │
                        │   PeriodSeconds (默认30s)│
                        │   ↓                     │
                        │   SIGKILL 强制停止        │
                        └─────────────────────────┘
```

关键点：
- **readiness probe** 决定 Pod 是否接受流量。Agent 服务如果启动时要加载模型，必须配好 readiness probe，否则流量打进来但服务还没就绪
- **liveness probe** 决定 Pod 是否需要重启。如果 Agent 卡死了（比如 LLM 调用死锁），liveness probe 会帮你重启
- **preStop hook** 给你时间做清理（比如等待当前请求处理完）

## Deployment 详解

Deployment 是你最常打交道的 K8s 资源，它管理 Pod 的副本数、滚动更新、回滚。

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: agent-service
  namespace: production
  labels:
    app: agent-service
    version: v1
spec:
  replicas: 3
  selector:
    matchLabels:
      app: agent-service
  strategy:
    type: RollingUpdate
    rollingUpdate:
      maxSurge: 1        # 滚动更新时最多多出 1 个 Pod
      maxUnavailable: 0  # 更新过程中不允许有 Pod 不可用
  template:
    metadata:
      labels:
        app: agent-service
        version: v1
    spec:
      terminationGracePeriodSeconds: 60  # Agent 服务建议给长一点
      containers:
        - name: agent
          image: your-registry.com/agent-service:v1.2.0
          ports:
            - containerPort: 8000
              name: http
          env:
            - name: MODEL_NAME
              value: "gpt-4"
            - name: API_KEY
              valueFrom:
                secretKeyRef:
                  name: agent-secrets
                  key: api-key
          resources:
            requests:
              cpu: "500m"
              memory: "1Gi"
            limits:
              cpu: "2"
              memory: "4Gi"
          readinessProbe:
            httpGet:
              path: /health
              port: 8000
            initialDelaySeconds: 10
            periodSeconds: 5
            timeoutSeconds: 3
            failureThreshold: 3
          livenessProbe:
            httpGet:
              path: /health
              port: 8000
            initialDelaySeconds: 30
            periodSeconds: 10
            timeoutSeconds: 5
            failureThreshold: 5
          lifecycle:
            preStop:
              exec:
                command: ["/bin/sh", "-c", "sleep 5"]
```

几个和 Agent 相关的要点：

**terminationGracePeriodSeconds** 设成 60 秒甚至更长。因为 Agent 请求可能跑几十秒，如果 Pod 被驱逐，你要给它时间完成当前请求。

**maxUnavailable: 0** 保证更新过程中不会丢请求。Agent 服务每个请求都很贵（LLM token 费用），丢不起。

**livenessProbe 的 initialDelaySeconds** 给大一点（30s），因为 Agent 启动可能要加载模型或连接外部服务，太小会被误判为挂了。

## Service 详解

Service 为 Pod 提供稳定的网络入口。不管 Pod 怎么漂移、重建，Service 的地址不变。

```yaml
# ClusterIP —— 集群内部访问（默认类型）
apiVersion: v1
kind: Service
metadata:
  name: agent-service
  namespace: production
spec:
  type: ClusterIP
  selector:
    app: agent-service
  ports:
    - port: 80           # Service 端口
      targetPort: 8000    # 容器端口
      protocol: TCP
      name: http
```

三种 Service 类型对比：

| 类型 | 访问范围 | 典型用途 |
|------|---------|---------|
| **ClusterIP** | 集群内部 | Agent 服务之间的内部通信 |
| **NodePort** | 通过 Node IP + 端口访问 | 测试环境快速暴露 |
| **LoadBalancer** | 云厂商 LB | 直接对外暴露（生产推荐用 Ingress） |

对于 Agent 服务，大多数场景用 ClusterIP + Ingress 就够了。Agent 服务通常不直接暴露给外部用户，而是通过 API Gateway 或 BFF 层调用。

### Headless Service（有状态 Agent）

如果你的 Agent 需要保持对话状态（比如每个用户 session 绑定到特定 Pod），可以考虑 Headless Service：

```yaml
apiVersion: v1
kind: Service
metadata:
  name: agent-stateful
  namespace: production
spec:
  clusterIP: None  # Headless!
  selector:
    app: agent-stateful
  ports:
    - port: 8000
      targetPort: 8000
```

配合 StatefulSet 使用，每个 Pod 有固定的网络标识（`agent-stateful-0.agent-stateful`）。

## Ingress 详解

Ingress 管理外部 HTTP/HTTPS 流量如何路由到集群内部的 Service。

```yaml
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: agent-ingress
  namespace: production
  annotations:
    nginx.ingress.kubernetes.io/proxy-read-timeout: "120"
    nginx.ingress.kubernetes.io/proxy-send-timeout: "120"
    nginx.ingress.kubernetes.io/proxy-body-size: "50m"
    nginx.ingress.kubernetes.io/proxy-buffering: "off"
spec:
  ingressClassName: nginx
  tls:
    - hosts:
        - agent.yourdomain.com
      secretName: agent-tls-secret
  rules:
    - host: agent.yourdomain.com
      http:
        paths:
          - path: /api/chat
            pathType: Prefix
            backend:
              service:
                name: agent-service
                port:
                  number: 80
          - path: /api/stream
            pathType: Prefix
            backend:
              service:
                name: agent-service
                port:
                  number: 80
```

几个 Agent 服务特有的注意事项：

**proxy-read-timeout** 和 **proxy-send-timeout** 要设大。Agent 一个请求可能跑 60 秒以上，默认的 60 秒超时会断连。

**proxy-buffering: off** 对流式输出（SSE）很关键。如果开了 buffering，Nginx 会攒够一块再发，SSE 就不实时了。

**proxy-body-size** 调大，Agent 的请求体可能包含长对话历史。

## ConfigMap 和 Secret

把配置和敏感信息从镜像中剥离出来。

### ConfigMap

```yaml
apiVersion: v1
kind: ConfigMap
metadata:
  name: agent-config
  namespace: production
data:
  MODEL_NAME: "gpt-4"
  MODEL_TEMPERATURE: "0.7"
  MAX_TOKENS: "4096"
  SYSTEM_PROMPT: |
    你是一个专业的 AI 助手。
    请用中文回答用户问题。
  config.yaml: |
    server:
      host: "0.0.0.0"
      port: 8000
    llm:
      provider: "openai"
      model: "gpt-4"
      temperature: 0.7
    agent:
      max_iterations: 10
      timeout_seconds: 120
```

在 Deployment 中使用：

```yaml
containers:
  - name: agent
    # 方式1: 环境变量
    envFrom:
      - configMapRef:
          name: agent-config
    # 方式2: 挂载为文件
    volumeMounts:
      - name: config-volume
        mountPath: /app/config
        readOnly: true
volumes:
  - name: config-volume
    configMap:
      name: agent-config
```

### Secret

```yaml
apiVersion: v1
kind: Secret
metadata:
  name: agent-secrets
  namespace: production
type: Opaque
data:
  # echo -n "sk-xxx" | base64
  api-key: c2steHh4eHh4eHg=
  db-password: cGFzc3dvcmQxMjM=
```

使用方式和 ConfigMap 一样，可以用环境变量注入或者挂载成文件：

```yaml
containers:
  - name: agent
    env:
      - name: OPENAI_API_KEY
        valueFrom:
          secretKeyRef:
            name: agent-secrets
            key: api-key
    volumeMounts:
      - name: secret-volume
        mountPath: /app/secrets
        readOnly: true
volumes:
  - name: secret-volume
    secret:
      secretName: agent-secrets
```

生产环境建议用 External Secrets Operator 或 Sealed Secrets，不要把 Secret 直接提交到 Git 仓库。

## HPA 自动扩缩

Agent 服务的负载特点是：请求量可能波动很大，而且单个请求消耗的资源也高（LLM 调用 + 工具执行）。HPA 能帮你自动扩缩容。

```yaml
apiVersion: autoscaling/v2
kind: HorizontalPodAutoscaler
metadata:
  name: agent-hpa
  namespace: production
spec:
  scaleTargetRef:
    apiVersion: apps/v1
    kind: Deployment
    name: agent-service
  minReplicas: 2
  maxReplicas: 10
  metrics:
    # 基于 CPU 使用率
    - type: Resource
      resource:
        name: cpu
        target:
          type: Utilization
          averageUtilization: 70
    # 基于内存使用率
    - type: Resource
      resource:
        name: memory
        target:
          type: Utilization
          averageUtilization: 80
  behavior:
    scaleUp:
      stabilizationWindowSeconds: 30
      policies:
        - type: Pods
          value: 2
          periodSeconds: 60
    scaleDown:
      stabilizationWindowSeconds: 300   # 缩容冷却 5 分钟，防止抖动
      policies:
        - type: Percent
          value: 25
          periodSeconds: 60
```

### 自定义指标扩缩

对于 Agent 服务，CPU 和内存往往不是最准确的扩缩指标。更实际的做法是基于 **并发请求数** 或 **请求队列长度** 来扩缩。

这需要安装 Prometheus Adapter 把 Prometheus 指标暴露给 HPA：

```yaml
# 伪代码 —— 基于自定义指标 "http_requests_per_second"
metrics:
  - type: Pods
    pods:
      metric:
        name: http_requests_per_second
      target:
        type: AverageValue
        averageValue: "50"  # 每个 Pod 平均 50 QPS 时触发扩缩
```

### 扩缩策略选择

| 指标 | 适用场景 | Agent 服务建议 |
|------|---------|---------------|
| CPU | 计算密集型 | 一般不准，LLM 调用主要等 I/O |
| 内存 | 有状态服务 | 可以参考，但波动大 |
| 并发请求数 | 请求处理型 | 最推荐，最直观 |
| 请求队列长度 | 异步任务型 | 适合队列式 Agent |

## Resource Requests 和 Limits

资源限制直接影响 Pod 的 QoS 等级和调度策略。

```yaml
containers:
  - name: agent
    resources:
      requests:
        cpu: "500m"     # 0.5 核，调度时保证能分到这么多
        memory: "1Gi"   # 启动时保证有 1Gi 内存
      limits:
        cpu: "2"        # 最多用 2 核
        memory: "4Gi"   # 超过会被 OOM Kill
```

**QoS 等级**（由 requests 和 limits 决定）：

| QoS 等级 | 条件 | 被驱逐优先级 |
|----------|------|-------------|
| **Guaranteed** | requests == limits | 最后被驱逐 |
| **Burstable** | requests &lt; limits | 中间 |
| **BestEffort** | 没设 requests/limits | 最先被驱逐 |

Agent 服务建议至少设成 **Burstable**，最好是 **Guaranteed**。特别是有 GPU 推理的场景，requests 和 limits 一定要设对，否则一个 Pod 吃光 GPU 显存，其他 Pod 直接 OOM。

**Agent 服务的资源估算经验**：
- 普通 LLM 调用代理服务：CPU 500m-1，Memory 512Mi-2Gi
- 带本地模型推理（小模型）：CPU 1-2，Memory 4Gi-8Gi
- GPU 推理（大模型）：GPU 1-4，Memory 8Gi-32Gi

## Agent 服务的特殊考量

Agent 服务和传统 CRUD 服务差异很大，部署时需要特别关注以下几点。

### 长时间运行请求

Agent 的一次对话可能持续 30 秒到几分钟（LLM 推理 + 工具调用 + 多轮交互）。

```
传统 Web 请求 vs Agent 请求
=============================

传统 Web:
  请求 ──→ [50ms] ──→ 响应
  --------|--------|

Agent:
  请求 ──→ [LLM 调用 5s] ──→ [工具执行 10s] ──→ [LLM 调用 5s] ──→ [工具执行 8s] ──→ [LLM 调用 5s] ──→ 响应
  |-----------------------------------------------------------------------------------------|
                                    30+ 秒
```

应对策略：
- Nginx Ingress 的 `proxy-read-timeout` 设到 120 秒以上
- Pod 的 `terminationGracePeriodSeconds` 设到 60 秒以上
- 应用层做好超时控制和优雅关闭（收到 SIGTERM 后不再接受新请求，等待当前请求完成）

### 流式输出（SSE）

Agent 服务常用 SSE（Server-Sent Events）做流式输出，这对 K8s 网络层有要求：

```yaml
# Nginx Ingress 关键配置
annotations:
  nginx.ingress.kubernetes.io/proxy-buffering: "off"
  nginx.ingress.kubernetes.io/proxy-request-buffering: "off"
  nginx.ingress.kubernetes.io/connection-proxy-header: "keep-alive"
  nginx.ingress.kubernetes.io/upstream-hash-by: "$remote_addr"
```

最后一条 `upstream-hash-by: $remote_addr` 很重要——它保证同一个用户的多次请求（比如重试）尽量落到同一个 Pod，减少上下文切换。

### GPU 调度

如果 Agent 需要本地 GPU 推理：

```yaml
containers:
  - name: agent
    resources:
      limits:
        nvidia.com/gpu: "1"  # 请求 1 块 GPU
      requests:
        cpu: "2"
        memory: "8Gi"
tolerations:
  - key: "nvidia.com/gpu"
    operator: "Exists"
    effect: "NoSchedule"
nodeSelector:
  accelerator: "nvidia-tesla-a100"
```

注意：K8s 原生不支持 GPU 资源的分片。一个 Pod 要 1 块 GPU，它就独占一块。你不能把一块 GPU 分给多个 Pod（除非用 MIG 或 time-slicing 方案）。

### PersistentVolume：Agent 状态持久化

有些 Agent 需要持久化对话历史、向量数据库索引、或模型缓存：

```yaml
apiVersion: v1
kind: PersistentVolumeClaim
metadata:
  name: agent-state-pvc
  namespace: production
spec:
  accessModes:
    - ReadWriteOnce
  storageClassName: fast-ssd
  resources:
    requests:
      storage: 50Gi

# 在 Deployment 中挂载
containers:
  - name: agent
    volumeMounts:
      - name: agent-state
        mountPath: /app/state
volumes:
  - name: agent-state
    persistentVolumeClaim:
      claimName: agent-state-pvc
```

生产环境建议：
- 使用云厂商的 SSD 存储类（`fast-ssd`），Agent 的状态读写通常需要低延迟
- 如果是向量数据库，考虑用 StatefulSet + Headless Service，而不是 Deployment
- 考虑用外部存储（Redis、PostgreSQL）替代 PV，K8s 上的 PV 迁移不太方便

## 在 K8s 中监控 Agent 服务

Agent 服务的监控需要覆盖几个层面：

```
监控体系
========

┌──────────────────────────────────────────────┐
│              应用层监控                        │
│  - LLM 调用延迟 / Token 用量 / 错误率        │
│  - 工具调用成功率 / 耗时                       │
│  - Agent 完成任务的平均轮次                    │
│  - 并发会话数                                 │
├──────────────────────────────────────────────┤
│              基础设施层监控                    │
│  - Pod CPU / Memory / 网络                    │
│  - 容器 OOM / 重启次数                        │
│  - Node 资源使用率                             │
├──────────────────────────────────────────────┤
│              网络层监控                        │
│  - Ingress 请求量 / 延迟 / 错误率             │
│  - Service 的 Endpoints 数量                   │
│  - DNS 解析延迟                               │
└──────────────────────────────────────────────┘
```

推荐的监控方案组合：
- **Prometheus + Grafana**：采集和展示指标
- **Loki**：日志聚合（配合 Grafana 查看）
- **OpenTelemetry**：分布式追踪（追踪一次 Agent 调用链路）

关键告警规则示例：

```yaml
# Pod 重启次数过多（可能是 liveness probe 失败）
- alert: AgentPodCrashLooping
  expr: increase(kube_pod_container_status_restarts_total{container="agent"}[1h]) > 3
  for: 5m
  labels:
    severity: warning

# Agent 响应延迟过高
- alert: AgentHighLatency
  expr: histogram_quantile(0.99, rate(http_request_duration_seconds_bucket{path="/api/chat"}[5m])) > 30
  for: 10m
  labels:
    severity: critical

# HPA 达到最大副本数
- alert: AgentHPAMaxedOut
  expr: kube_horizontalpodautoscaler_status_current_replicas >= kube_horizontalpodautoscaler_spec_max_replicas
  for: 15m
  labels:
    severity: warning
```

## 常见踩坑

### 1. 流式输出被 Ingress 截断

**现象**：SSE 连接几秒就断了，返回不完整。

**原因**：Nginx Ingress 默认开启 buffering，会等数据攒够了再发。另外默认超时 60 秒。

**解决**：加上 `proxy-buffering: "off"` 和 `proxy-read-timeout: "120"` 注解。

### 2. Pod 启动时 OOM Kill

**现象**：Pod 刚启动就 CrashLoopBackOff，events 显示 OOMKilled。

**原因**：Agent 启动时加载模型或预热缓存，内存使用瞬间飙高。limits 设太低。

**解决**：
- 增大 `limits.memory`
- 用 `initialDelaySeconds` 配合 readiness probe，确保启动完成后再接受流量
- 如果模型可以延迟加载，考虑 lazy loading

### 3. 滚动更新时请求失败

**现象**：更新部署期间，部分请求返回 502/504。

**原因**：旧 Pod 被终止时，连接还没断开，但 Pod 已经从 Endpoints 中移除了。

**解决**：
- 配置 `preStop` hook：`sleep 5`，让 kube-proxy 有时间更新路由规则
- 设置 `maxUnavailable: 0`
- `terminationGracePeriodSeconds` 设得足够大

### 4. HPA 基于 CPU 扩缩不生效

**现象**：HPA 不触发扩缩，CPU 使用率很高但副本数不变。

**原因**：Pod 没有设置 `resources.requests`，HPA 无法计算 CPU 使用百分比。

**解决**：确保所有容器都设置了 `resources.requests.cpu`。

### 5. GPU Pod 调度失败

**现象**：Pod 一直 Pending，events 显示 `insufficient nvidia.com/gpu`。

**原因**：GPU 资源不够，或者节点标签/toleration 不匹配。

**解决**：用 `kubectl describe pod` 和 `kubectl describe node` 确认 GPU 可用量和节点标签。

## 总结

K8s 部署 Agent 服务和部署传统 Web 服务的核心区别在于：

1. **时间维度**：Agent 请求更长，超时、优雅关闭都要调大
2. **流量维度**：流式输出对 Ingress 配置有特殊要求
3. **资源维度**：GPU 调度、模型加载对资源管理有更高要求
4. **状态维度**：对话状态的持久化和迁移需要额外考虑

核心思路是：把 Agent 当成一个"又慢又重又贵"的微服务来部署，所有配置都往"宽裕"的方向调。

## 参考资料

- [Kubernetes Documentation - Deployments](https://kubernetes.io/docs/concepts/workloads/controllers/deployment/)
- [Kubernetes Documentation - Horizontal Pod Autoscaler](https://kubernetes.io/docs/tasks/run-application/horizontal-pod-autoscale/)
- [Kubernetes Documentation - Ingress](https://kubernetes.io/docs/concepts/services-networking/ingress/)
- [Nginx Ingress Controller - Configuration](https://kubernetes.github.io/ingress-nginx/nginx-configuration/)
- [NVIDIA GPU Operator](https://docs.nvidia.com/datacenter/cloud-native/gpu-operator/latest/overview.html)
- [Prometheus Adapter for Kubernetes Metrics](https://github.com/kubernetes-sigs/prometheus-adapter)
