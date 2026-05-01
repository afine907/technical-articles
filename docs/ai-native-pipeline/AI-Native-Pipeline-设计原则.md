# AI Native Pipeline 设计原则

> 基于软件工程经典原则与 AI 最佳实践，构建可靠的 Agent 开发流水线。

## 核心设计理念

AI Native Pipeline 不是凭空创造的新概念，而是将**软件工程经典原则**应用到 Agent 开发场景。

本文档将经典原则映射到 Pipeline 的 5 个节点：

```
impact-analyzer → prd-agent → spec-agent → coding-agent → verification-agent
```

---

## 一、软件工程原则

### 1.1 DRY（Don't Repeat Yourself）

**原则**：系统中的每个知识点都应该有单一、明确的表示。

**应用到 Pipeline**：

```python
# ❌ 错误：每个 Agent 各自维护上下文
class ImpactAnalyzer:
    def analyze(self, task):
        self.context = {"files": [...]}  # 自己维护

class PRDAgent:
    def analyze(self, task):
        self.context = {"requirements": [...]}  # 自己维护

# ✅ 正确：Task Spec 作为 Single Source of Truth
class TaskSpec:
    """单一事实源"""
    def __init__(self):
        self.data = {
            "context": None,      # 来自 impact-analyzer
            "requirements": None, # 来自 prd-agent
            "spec": None,         # 来自 spec-agent
            "implementation": None # 来自 coding-agent
        }
    
    def update(self, section: str, data: dict):
        self.data[section] = data
        self.save()  # 持久化
```

**Pipeline 实现**：

```markdown
# Task Spec: 用户登录功能

## 上下文（impact-analyzer）
- Core Files: src/auth/session.py
- Risks: authenticate() 被 12 处调用

## 需求（prd-agent）
- P0: 手机号 + 验证码登录
- 验收标准: 登录成功返回 JWT

## 技术决策（spec-agent）
- API: POST /api/auth/login
- 理由: 项目已有 JWT 工具类

## 实现记录（coding-agent）
- 新增: src/auth/phone_login.py
- 测试: tests/auth/test_phone_login.py
```

---

### 1.2 SOLID 原则

**应用到 Agent 设计**：

#### Single Responsibility Principle（单一职责）

```python
# ❌ 错误：一个 Agent 做多件事
class SuperAgent:
    def analyze_code(self): pass
    def write_prd(self): pass
    def write_code(self): pass
    def run_tests(self): pass

# ✅ 正确：每个 Agent 单一职责
class ImpactAnalyzer:
    """只负责代码影响分析"""
    def analyze(self, codebase) -> ImpactMap: ...

class PRDAgent:
    """只负责需求分析"""
    def analyze(self, task) -> PRD: ...

class SpecAgent:
    """只负责技术规格"""
    def design(self, prd, context) -> Spec: ...

class CodingAgent:
    """只负责代码实现"""
    def implement(self, spec) -> Code: ...

class VerificationAgent:
    """只负责验证"""
    def verify(self, code, criteria) -> Result: ...
```

#### Open/Closed Principle（开闭原则）

```python
# ✅ 对扩展开放，对修改关闭
class Pipeline:
    def __init__(self):
        self.agents = []
    
    def add_agent(self, agent: Agent):
        """扩展：添加新 Agent"""
        self.agents.append(agent)
    
    def run(self, task: str):
        """核心流程不变"""
        for agent in self.agents:
            agent.execute(task)

# 扩展：添加新 Agent，无需修改 Pipeline
pipeline = Pipeline()
pipeline.add_agent(ImpactAnalyzer())
pipeline.add_agent(PRDAgent())
pipeline.add_agent(SpecAgent())
# 未来可以添加更多...
pipeline.add_agent(SecurityAgent())  # 新增安全检查
```

#### Dependency Inversion Principle（依赖倒置）

```python
# ✅ 高层模块不依赖低层模块，都依赖抽象
class Agent(ABC):
    @abstractmethod
    def execute(self, task: str) -> Result: ...

class ImpactAnalyzer(Agent):
    def execute(self, task: str) -> ImpactMap: ...

class PRDAgent(Agent):
    def execute(self, task: str) -> PRD: ...

# Pipeline 依赖抽象
class Pipeline:
    def __init__(self, agents: list[Agent]):
        self.agents = agents
```

---

### 1.3 KISS（Keep It Simple, Stupid）

**原则**：简单性是可靠性的前提。

**应用到 Pipeline**：

```python
# ❌ 错误：过度设计
class ComplexPipeline:
    def __init__(self):
        self.orchestrator = Orchestrator()
        self.message_queue = MessageQueue()
        self.state_machine = StateMachine()
        self.event_bus = EventBus()
        # ...更多组件

# ✅ 正确：5 个 Agent，顺序执行
class SimplePipeline:
    def run(self, task: str):
        # Step 1: 影响分析
        impact = ImpactAnalyzer().analyze(task)
        
        # Step 2: 需求分析
        prd = PRDAgent().analyze(task, impact)
        
        # [PAUSE] Planning Gate
        if not user_confirm(prd):
            return
        
        # Step 3: 技术设计
        spec = SpecAgent().design(prd)
        
        # Step 4: 代码实现
        code = CodingAgent().implement(spec)
        
        # [PAUSE] Planning Gate
        if not user_confirm(code):
            return
        
        # Step 5: 验证
        result = VerificationAgent().verify(code)
        
        return result
```

**为什么 5 个节点？**

因为这是人类开发的自然流程：
1. 先看影响 → 2. 再写需求 → 3. 设计方案 → 4. 写代码 → 5. 验证验收

**Less is More**：5 个节点，每个打磨到极致，比 10 个节点各做一半要好。

---

### 1.4 YAGNI（You Aren't Gonna Need It）

**原则**：不要实现你目前不需要的功能。

**应用到 Pipeline**：

```python
# ❌ 错误：过早优化
class Pipeline:
    def __init__(self):
        self.cache = DistributedCache()  # 还没需要分布式缓存
        self.queue = KafkaQueue()        # 还没需要消息队列
        self.monitor = Prometheus()      # 还没需要监控

# ✅ 正确：按需添加
class Pipeline:
    def __init__(self):
        self.state = {}  # 先用简单的 dict
    
    def enable_persistence(self):
        """需要时再添加持久化"""
        self.state = FileBasedState()
    
    def enable_caching(self):
        """需要时再添加缓存"""
        self.cache = RedisCache()
```

---

### 1.5 12-Factor App

**应用到 Agent 系统**：

| Factor | 应用 |
|--------|------|
| **Config** | 环境变量管理 API Keys、模型配置 |
| **Dependencies** | requirements.txt / package.json 显式声明依赖 |
| **Backing Services** | LLM API、向量数据库作为附加资源 |
| **Build, Release, Run** | Agent 代码构建 → 部署 → 运行分离 |
| **Processes** | Agent 无状态，状态存储在 Task Spec |
| **Port binding** | Agent 通过 stdio / HTTP 通信 |
| **Concurrency** | 多 Agent 通过消息队列并发 |
| **Disposability** | Agent 可快速启动/停止 |
| **Logs** | 结构化日志输出到 stdout |
| **Admin processes** | 管理 task 通过 CLI 执行 |

**配置管理示例**：

```python
from pydantic import BaseSettings

class AgentConfig(BaseSettings):
    # LLM 配置
    llm_api_key: str
    llm_model: str = "gpt-4"
    llm_max_tokens: int = 4096
    
    # Pipeline 配置
    pipeline_max_retries: int = 3
    pipeline_timeout: int = 300
    
    class Config:
        env_file = ".env"

config = AgentConfig()
```

---

## 二、AI/ML 最佳实践

### 2.1 Few-shot Prompting

**原则**：通过少量示例引导模型理解任务格式。

**应用到 Agent**：

```python
# ❌ 错误：只有指令
prompt = """
分析代码影响范围。
"""

# ✅ 正确：Few-shot 示例
prompt = """
分析代码影响范围。

示例 1：
输入：在用户模块增加手机号登录
输出：
{
  "core_files": ["src/auth/session.py"],
  "dependent_files": ["src/api/routes/*.py"],
  "risks": ["authenticate() 被多处调用"]
}

示例 2：
输入：给订单模块添加库存检查
输出：
{
  "core_files": ["src/orders/service.py"],
  "dependent_files": ["src/inventory/client.py"],
  "risks": ["库存不足时的回滚逻辑"]
}

现在分析：
输入：{task}
输出：
"""
```

---

### 2.2 Chain of Thought（思维链）

**原则**：让模型展示推理过程，提高复杂任务准确率。

**应用到 Agent**：

```python
# ✅ 让 Agent 展示思考过程
prompt = """
设计 API 接口。

请按以下步骤思考：

Step 1: 分析需求
- 这个接口要解决什么问题？
- 用户是谁？

Step 2: 设计 API
- Method 和 Path 是什么？
- 请求参数有哪些？
- 响应格式是什么？

Step 3: 考虑边界
- 错误情况怎么处理？
- 性能如何优化？

Step 4: 输出设计
```json
{
  "method": "POST",
  "path": "/api/auth/login",
  ...
}
```
"""
```

**Impact Map 示例**：

```markdown
## Impact Map: 用户登录功能

### 思考过程

1. 用户登录涉及哪些文件？
   - 认证逻辑: src/auth/session.py
   - 路由定义: src/api/routes/auth.py

2. 哪些地方会受影响？
   - authenticate() 被 12 处调用
   - 中间件依赖认证结果

3. 哪些不能改？
   - 支付模块有独立认证
   - 管理员认证不能影响

### 结论

- Core Files: src/auth/session.py
- Dependent Files: src/api/routes/*.py (12 处)
- Boundary: src/payments/, src/admin/auth.py
- Risks: authenticate() 签名变更需全量修改
```

---

### 2.3 Self-Consistency

**原则**：多次采样，选择最一致的答案。

**应用到验证**：

```python
def verify_with_consistency(code: str, tests: str, n: int = 3):
    """多次验证，取一致结果"""
    
    results = []
    for _ in range(n):
        result = run_tests(code, tests)
        results.append(result)
    
    # 选择最一致的结果
    from collections import Counter
    most_common = Counter(results).most_common(1)[0]
    
    if most_common[1] >= n * 0.6:  # 60% 一致性
        return most_common[0]
    else:
        raise InconsistentResultError("验证结果不一致")
```

---

### 2.4 LLM-as-Judge

**原则**：用 LLM 评估 LLM 的输出质量。

**应用到评估**：

```python
def evaluate_agent_output(task: str, output: str) -> float:
    """LLM 评估 Agent 输出"""
    
    prompt = f"""
你是一个评估专家。请评估以下 Agent 输出。

任务：{task}

Agent 输出：
{output}

请从以下维度打分（1-5分）：
1. 完整性：是否覆盖所有要求？
2. 准确性：信息是否正确？
3. 简洁性：是否冗余？

输出格式：
{{
  "completeness": 4,
  "accuracy": 5,
  "conciseness": 3,
  "overall": 4.0,
  "feedback": "具体改进建议"
}}
"""
    
    result = llm.invoke(prompt)
    return json.loads(result)
```

---

### 2.5 Context Window Management

**原则**：有效管理上下文窗口，避免信息过载。

**应用到 Task Spec**：

```python
def compress_spec(spec: str, max_tokens: int = 8000) -> str:
    """压缩 Task Spec"""
    
    # 策略 1：按优先级提取
    sections = parse_spec(spec)
    
    priority_order = [
        "技术决策",      # coding-agent 最需要
        "验收标准",      # verification-agent 最需要
        "Risks",        # 风险提示
        "需求",         # 背景信息
        "实现记录"       # 可选
    ]
    
    compressed = ""
    current_tokens = 0
    
    for section in priority_order:
        content = sections.get(section, "")
        section_tokens = count_tokens(content)
        
        if current_tokens + section_tokens <= max_tokens:
            compressed += f"## {section}\n{content}\n\n"
            current_tokens += section_tokens
        else:
            # 截断
            remaining = max_tokens - current_tokens
            compressed += f"## {section}\n{content[:remaining*4]}...\n"
            break
    
    return compressed
```

---

## 三、Agent 特有原则

### 3.1 Single Source of Truth（单一事实源）

**原则**：所有 Agent 共享同一个 Task Spec，避免信息不一致。

```python
class TaskSpec:
    """单一事实源"""
    
    _instance = None
    
    def __new__(cls, task_id: str):
        if cls._instance is None:
            cls._instance = super().__new__(cls)
            cls._instance.task_id = task_id
            cls._instance.data = {}
        return cls._instance
    
    def update(self, agent: str, data: dict):
        """Agent 更新自己的部分"""
        self.data[agent] = data
        self._persist()
    
    def get_context_for(self, agent: str) -> dict:
        """获取 Agent 需要的上下文"""
        dependencies = {
            "spec-agent": ["impact-analyzer", "prd-agent"],
            "coding-agent": ["impact-analyzer", "prd-agent", "spec-agent"],
            "verification-agent": ["spec-agent", "coding-agent"]
        }
        
        needed = dependencies.get(agent, [])
        return {k: self.data[k] for k in needed if k in self.data}
```

---

### 3.2 Planning Gate

**原则**：关键决策点需要人工确认，避免错误累积。

```python
class PlanningGate:
    """关键节点人工确认"""
    
    GATES = {
        "after_prd": {
            "description": "确认需求范围",
            "check": lambda prd: prd.p0_features and prd.acceptance_criteria
        },
        "after_code": {
            "description": "确认代码改动",
            "check": lambda code: code.tests and code.coverage > 0.8
        }
    }
    
    def should_pause(self, stage: str, data: dict) -> bool:
        """判断是否需要暂停"""
        gate = self.GATES.get(stage)
        
        if gate and not gate["check"](data):
            print(f"[PAUSE] {gate['description']}")
            return user_confirm(data)
        
        return True
```

---

### 3.3 Graceful Degradation（优雅降级）

**原则**：当外部依赖不可用时，有降级方案。

```python
def analyze_dependencies(project_root: str) -> dict:
    """代码依赖分析，带降级方案"""
    
    # 层 1：精确模式（需要工具）
    if command_exists("ctags"):
        return analyze_with_ctags(project_root)
    
    if command_exists("tree-sitter"):
        return analyze_with_tree_sitter(project_root)
    
    # 层 2：降级模式（无工具）
    print("[Warning] 未安装 ctags/tree-sitter，使用降级方案")
    
    # 用 grep 扫描 import
    imports = run(f"grep -rn 'import|from' {project_root}")
    
    # 用 LLM 理解
    return llm.invoke(f"""
分析以下代码依赖关系：
{imports}

输出格式：
{{
  "dependencies": ["module1 -> module2", ...],
  "core_files": ["file1.py", ...]
}}
""")
```

---

### 3.4 Idempotency（幂等性）

**原则**：同一操作执行多次，结果相同。

```python
class ImpactAnalyzer:
    """影响分析（幂等设计）"""
    
    def analyze(self, task: str) -> ImpactMap:
        # 检查缓存
        cache_key = self._hash(task)
        if cache_key in self.cache:
            return self.cache[cache_key]
        
        # 执行分析
        result = self._do_analyze(task)
        
        # 缓存结果
        self.cache[cache_key] = result
        return result
```

---

### 3.5 Cost Control（成本控制）

**原则**：Token 消耗可控，有预算上限。

```python
class CostBudget:
    """成本预算管理"""
    
    COSTS = {
        "gpt-4": {"input": 0.03, "output": 0.06},
        "gpt-3.5-turbo": {"input": 0.0015, "output": 0.002},
    }
    
    def __init__(self, daily_budget: float = 10.0):
        self.daily_budget = daily_budget
        self.spent = 0.0
    
    def can_proceed(self, model: str, estimated_tokens: int) -> bool:
        cost = self._estimate(model, estimated_tokens)
        return (self.spent + cost) <= self.daily_budget
    
    def record(self, model: str, tokens: int):
        self.spent += self._estimate(model, tokens)
        
        # 预警
        if self.spent > self.daily_budget * 0.8:
            warn(f"成本已使用 {self.spent/self.daily_budget*100:.0f}%")
```

---

## 四、五节点设计映射

将以上原则映射到 5 个节点：

| 节点 | 职责 | 应用的原则 |
|------|------|-----------|
| **impact-analyzer** | 代码影响分析 | DRY（共享上下文）、Graceful Degradation |
| **prd-agent** | 需求分析 | Few-shot Prompting、Chain of Thought |
| **spec-agent** | 技术设计 | SOLID（单一职责）、Planning Gate |
| **coding-agent** | 代码实现 | SOLID、YAGNI、Context Window Management |
| **verification-agent** | 自动验证 | Self-Consistency、LLM-as-Judge |

---

## 五、Check List

### Agent 设计 Check List

```markdown
- [ ] 单一职责：每个 Agent 只做一件事
- [ ] 幂等性：同一输入，同一输出
- [ ] 降级方案：外部依赖不可用时有备选
- [ ] Few-shot：Prompt 包含 2-3 个示例
- [ ] Chain of Thought：复杂任务展示推理过程
- [ ] 成本控制：有 Token 预算上限
```

### Pipeline 设计 Check List

```markdown
- [ ] Single Source of Truth：Task Spec 作为单一事实源
- [ ] Planning Gate：关键节点可暂停
- [ ] 断点续传：失败后可恢复
- [ ] 并发安全：多 Agent 并行无冲突
- [ ] 配置分离：敏感信息用环境变量
```

---

## 参考资料

- [The Twelve-Factor App](https://12factor.net/)
- [SOLID Principles](https://en.wikipedia.org/wiki/SOLID)
- [Chain-of-Thought Prompting](https://arxiv.org/abs/2201.11903)
- [Self-Consistency](https://arxiv.org/abs/2203.11171)
- [Few-Shot Learning](https://arxiv.org/abs/1904.05046)
- OpenAI: [Best Practices for Prompt Engineering](https://help.openai.com/en/articles/6654000-best-practices-for-prompt-engineering-with-openai-api)

---

**下一篇**: [AI Native Pipeline 实战案例](#/articles/ai/AI-Native-Pipeline-实战案例)
