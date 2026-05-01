# AI Native Pipeline 踩坑实录

> 做 Agent 开发，最怕的不是 Agent 不聪明，而是你不知道它什么时候变蠢了。

## 坑一：Agent 改了，不知道效果变好还是变坏

### 问题

最初，我改了一个 Agent 的 prompt，感觉效果更好了。但跑了几次发现：

> "等等，之前这个 case 能过的，怎么现在过不了了？"

没有对比，没有量化，全凭感觉。

### 解决：建立评估框架

我设计了一套评估流程：

```
1. 准备测试集（20-50 个典型任务）
2. 运行 Agent，记录输出
3. 对比金标准
4. 生成报告
```

核心指标：

| 指标 | 计算方式 | 目标 |
|------|----------|------|
| **准确率** | 正确输出 / 总输出 | > 80% |
| **完整率** | 覆盖要求 / 总要求 | > 90% |
| **平均耗时** | 总时间 / 任务数 | < 60s |
| **Token 消耗** | 总 Token / 任务数 | < 10K |

### 评估方法

**方法 1：金标准对比**

```python
test_cases = [
    {
        "input": "在用户模块增加手机号登录",
        "expected_output": {
            "core_files": ["src/auth/session.py"],
            "boundary": ["src/payments/"],
            "risks": ["authenticate() 被多处调用"]
        }
    },
    # ... 更多测试用例
]

def evaluate_agent(agent, test_cases):
    results = []
    for case in test_cases:
        output = agent.run(case["input"])
        score = compare_output(output, case["expected_output"])
        results.append(score)
    return sum(results) / len(results)
```

**方法 2：LLM-as-Judge**

用另一个 LLM 评估 Agent 输出：

```
你是一个评估专家。请评估以下 Agent 输出的质量。

任务：{input}
Agent 输出：{output}

请从以下维度打分（1-5分）：
1. 完整性：是否覆盖所有要求？
2. 准确性：信息是否正确？
3. 简洁性：是否冗余？
4. 可读性：是否易于理解？
```

### 对比评估流程

```
1. 保存修改前的评估结果
2. 修改 Agent
3. 运行相同的测试集
4. 对比结果

对比维度：
- 准确率是否提升？
- Token 消耗是否减少？
- 执行时间是否缩短？
```

---

## 坑二：代码分析依赖外部工具

### 问题

impact-analyzer 需要分析代码依赖关系。我一开始用的是 ctags：

```bash
ctags -R --fields=+n --languages=Python ./src/
```

结果：
- 某些机器没装 ctags
- 不同语言需要不同工具
- 调用关系分析不够智能

### 解决：无工具降级方案

我设计了两层分析：

**层 1：有工具时（精确模式）**

```bash
# 使用 ctags / tree-sitter
ctags -R --fields=+n ./src/
```

**层 2：无工具时（降级模式）**

```bash
# 使用 grep + LLM 理解
grep -rn "import\|require\|from" ./src --include="*.py"
grep -rn "关键词" ./src --include="*.py"
```

然后让 LLM 理解代码语义。

### Agent 实现

```markdown
## 工具检测

# 检测 ctags
command -v ctags && echo "ctags available" || echo "use grep"

# ctags 可用时（精确模式）
ctags -R --fields=+n --languages=Python ./src/

# ctags 不可用时（降级模式）
# 使用 Read + grep 组合
# 1. grep 快速扫描引用
# 2. Read 关键文件提取结构
# 3. 让 LLM 理解代码语义
```

---

## 坑三：Agent 之间信息传递不清晰

### 问题

coding-agent 收到 spec.md，但不知道：
- impact-analyzer 发现了哪些风险
- prd-agent 为什么这样划分优先级
- spec-agent 为什么选择这个 API 设计

**每个 Agent 都是"信息孤岛"**。

### 解决：Task Spec 作为单一事实源

```markdown
# Task Spec

## 上下文（来自 impact-analyzer）
- Core Files: src/auth/session.py
- Risks: authenticate() 被 12 处调用

## 需求（来自 prd-agent）
- 功能列表: ...
- 验收标准: ...

## 技术决策（来自 spec-agent）
- API 设计: POST /api/auth/login
- 为什么这样设计: 项目已有 JWT 工具类

## 实现记录（来自 coding-agent）
- 修改文件: ...
- 关键改动: ...
```

**每个 Agent 都往 Task Spec 里写内容**，后续 Agent 就能看到完整上下文。

---

## 坑四：验收标准需要人工预定义

### 问题

传统做法：用户写验收标准

```yaml
verifications:
  - type: test
    command: pytest tests/ -v
  - type: lint
    command: ruff check src/
```

问题：
- 用户可能不知道怎么写验收标准
- 验收标准可能不完整

### 解决：从 Spec 自动推断验收标准

verification-agent 会分析 spec.md，自动推断验证项：

```
spec 定义: POST /api/auth/login
→ 自动添加验证: curl 测试登录接口

spec 定义: 数据模型 User
→ 自动添加验证: 检查数据库 schema

spec 定义: 使用 pytest
→ 自动添加验证: pytest tests/ -v
```

这样用户不需要懂测试，Agent 自动生成验收标准。

---

## 坑五：复杂任务不知道怎么拆

### 问题

一个任务涉及 5 个 API、3 个模块，直接扔给 coding-agent 会：

- 输出太长，超出 token 限制
- 一个地方出错，整体失败
- 没法并行，效率低

### 解决：自动任务拆解

当 SPEC 复杂度高时（API > 3 或跨模块或前后端都有），自动触发 task-breakdown：

```
[Step 3.5] 任务拆解
  → 分析依赖关系
  → 生成执行计划

任务拆解:
| ID | 任务 | 依赖 | 执行 |
|----|------|------|------|
| T1 | 后端 - 登录 API | - | 并行 |
| T2 | 后端 - 验证码 API | - | 并行 |
| T3 | 前端 - 登录页 | - | 并行 |
| T4 | 前端 - 验证码页 | T3 | 串行 |
| T5 | 集成测试 | T1,T2,T3,T4 | 最后 |

执行计划:
- 阶段1（并行）: T1, T2, T3
- 阶段2（串行）: T4
- 阶段3（验收）: T5
```

---

## 坑六：没有 Planning Gate，错误累积

### 问题

早期版本没有 Planning Gate，Agent 一路跑到底。结果：

- 需求理解错了 → Spec 设计错了 → 代码写错了 → 全白干
- 错误在最后才发现，返工成本高

### 解决：关键节点人工确认

```
[Step 2/5] 分析需求...
  ✅ P0: JWT Token 生成/验证
  ✅ P1: Token 刷新
  
  [PAUSE] 确认需求? [y/n]
```

借鉴 OpenAI 的 **Harness Engineering** 实践：
- Planning Gate 在关键节点暂停
- 用户确认后才继续
- 避免错误假设累积

**两个 Planning Gate**：
- **Step 2 后**：确认需求范围
- **Step 4 后**：确认代码改动

---

## 坑七：Token 限制导致上下文丢失

### 问题

大项目的 Task Spec 越来越长，最终超出 token 限制：

```markdown
# Task Spec（已超过 50K tokens）

## 上下文（来自 impact-analyzer）
- 300+ 文件依赖关系...
- 50+ 风险点...

## 需求（来自 prd-agent）
- 完整 PRD 文档...

## 技术决策（来自 spec-agent）
- 20 个 API 设计...
- 完整数据模型...

## 实现记录（来自 coding-agent）
- 100+ 文件改动...
```

结果：
- 后面的 Agent 看不到前面的内容
- 上下文截断导致关键信息丢失
- 重复生成已有的内容

### 解决：增量上下文 + 智能压缩

**策略 1：只传必要信息**

```python
def get_relevant_context(task_spec: str, agent_role: str) -> str:
    """根据 Agent 角色提取相关上下文"""
    
    if agent_role == "coding-agent":
        # 只需要技术决策 + 实现记录
        return extract_sections(task_spec, [
            "技术决策", "Core Files", "验收标准"
        ])
    
    elif agent_role == "verification-agent":
        # 只需要验收标准 + 实现记录
        return extract_sections(task_spec, [
            "验收标准", "实现记录"
        ])
```

**策略 2：智能压缩**

```python
def compress_spec(spec: str, max_tokens: int = 8000) -> str:
    """压缩 Task Spec 到目标 token 数"""
    
    # 1. 提取关键信息
    key_info = extract_key_points(spec)
    
    # 2. 用 LLM 压缩
    compressed = llm.invoke(f"""
请将以下内容压缩到 {max_tokens} tokens 以内，保留所有关键信息：

{spec}

压缩要求：
1. 保留所有决策点
2. 保留所有风险点
3. 用简洁语言重写
4. 删除冗余描述
""")
    
    return compressed
```

**策略 3：分层存储**

```
Task Spec/
├── summary.md          # 摘要（< 1000 tokens）
├── context.json        # 结构化上下文
├── decisions/          # 决策记录
│   ├── api-design.md
│   └── data-model.md
└── implementations/    # 实现记录
    ├── file-changes.md
    └── test-results.md
```

每个 Agent 只读取需要的层级：

```python
def get_context_for_agent(agent: str) -> str:
    if agent == "coding-agent":
        # 读取摘要 + API 设计
        return read("summary.md") + read("decisions/api-design.md")
    
    elif agent == "verification-agent":
        # 读取摘要 + 测试结果
        return read("summary.md") + read("implementations/test-results.md")
```

---

## 坑八：并发修改冲突

### 问题

多个 Agent 并行执行，同时修改同一个文件：

```
Agent A: 修改 src/auth/login.py
Agent B: 同时修改 src/auth/login.py

结果：Agent B 覆盖了 Agent A 的修改
```

### 解决：文件锁 + 变更合并

**策略 1：文件锁机制**

```python
import fcntl
from contextlib import contextmanager

@contextmanager
def file_lock(file_path: str):
    """文件锁"""
    with open(file_path, 'w') as f:
        try:
            fcntl.flock(f, fcntl.LOCK_EX)  # 排他锁
            yield f
        finally:
            fcntl.flock(f, fcntl.LOCK_UN)  # 释放锁

# 使用
with file_lock("src/auth/login.py"):
    # 修改文件
    modify_file()
```

**策略 2：变更隔离**

```python
# 每个 Agent 在自己的分支工作
def start_agent_task(task_id: str):
    branch = f"agent-{task_id}"
    run(f"git checkout -b {branch}")
    
    # Agent 工作...
    
    # 完成后合并
    run(f"git checkout main")
    run(f"git merge {branch}")
```

**策略 3：智能合并**

```python
def merge_changes(file: str, changes: list[Change]) -> str:
    """智能合并多个变更"""
    
    # 1. 分析变更位置
    regions = [c.location for c in changes]
    
    # 2. 检测冲突
    conflicts = detect_conflicts(regions)
    
    if conflicts:
        # 3. 用 LLM 解决冲突
        return resolve_with_llm(file, conflicts)
    
    # 4. 无冲突，直接合并
    return apply_changes(file, changes)
```

### 执行计划优化

```python
def plan_parallel_execution(tasks: list[Task]) -> ExecutionPlan:
    """规划并行执行，避免文件冲突"""
    
    # 1. 分析每个任务的文件依赖
    file_deps = {t.id: get_modified_files(t) for t in tasks}
    
    # 2. 分组：无冲突的并行，有冲突的串行
    groups = []
    current_group = []
    used_files = set()
    
    for task in tasks:
        task_files = file_deps[task.id]
        
        if task_files & used_files:  # 有冲突
            groups.append(current_group)
            current_group = [task]
            used_files = task_files
        else:  # 无冲突
            current_group.append(task)
            used_files |= task_files
    
    groups.append(current_group)
    
    return ExecutionPlan(
        parallel_groups=groups,
        total_steps=sum(len(g) for g in groups)
    )
```

---

## 坑九：中间步骤失败无法恢复

### 问题

Pipeline 执行到一半失败：

```
[Step 1/5] ✅ 代码影响分析
[Step 2/5] ✅ 需求分析
[Step 3/5] ❌ 技术规格设计 - 失败

所有进度丢失，需要从头开始
```

### 解决：断点续传 + 状态持久化

**策略 1：步骤状态持久化**

```python
class PipelineState:
    """Pipeline 状态管理"""
    
    def __init__(self, task_id: str):
        self.state_file = f".pipeline/{task_id}/state.json"
        self.state = self._load()
    
    def save_step(self, step: int, result: dict):
        """保存步骤结果"""
        self.state[f"step_{step}"] = {
            "status": "completed",
            "result": result,
            "timestamp": datetime.now().isoformat()
        }
        self._save()
    
    def get_step_result(self, step: int) -> dict:
        """获取步骤结果"""
        return self.state.get(f"step_{step}", {}).get("result")
    
    def get_resume_point(self) -> int:
        """获取恢复点"""
        for i in range(1, 6):
            if self.state.get(f"step_{i}", {}).get("status") != "completed":
                return i
        return 6  # 全部完成
```

**策略 2：断点续传**

```python
def run_pipeline(task: str, resume: bool = True):
    """运行 Pipeline，支持断点续传"""
    
    state = PipelineState(task_id)
    
    start_step = 1
    if resume:
        start_step = state.get_resume_point()
        if start_step > 1:
            print(f"[Resume] 从步骤 {start_step} 继续...")
    
    for step in range(start_step, 6):
        try:
            result = run_step(step, task, state)
            state.save_step(step, result)
        except Exception as e:
            print(f"[Error] 步骤 {step} 失败: {e}")
            print(f"[Recovery] 修复后运行: /pipeline --resume {task_id}")
            raise
```

**策略 3：幂等设计**

每个步骤设计为幂等的：

```python
def step_3_spec_design(task: str, state: PipelineState):
    """技术规格设计（幂等）"""
    
    # 检查是否已完成
    existing = state.get_step_result(3)
    if existing:
        print("[Skip] 步骤 3 已完成，跳过")
        return existing
    
    # 执行步骤
    result = design_spec(task)
    
    # 保存结果
    state.save_step(3, result)
    
    return result
```

---

## 坑十：生成的代码质量参差不齐

### 问题

coding-agent 生成的代码：

- 有时候很优雅
- 有时候一团糟
- 缺乏一致性

### 解决：代码质量门禁

**策略 1：多维度检查**

```python
def quality_gate(code: str, file_path: str) -> QualityResult:
    """代码质量门禁"""
    
    checks = []
    
    # 1. Lint 检查
    lint_result = run_lint(file_path)
    checks.append(("lint", lint_result.passed, lint_result.errors))
    
    # 2. 类型检查
    type_result = run_type_check(file_path)
    checks.append(("type", type_result.passed, type_result.errors))
    
    # 3. 测试覆盖率
    coverage = run_coverage(file_path)
    checks.append(("coverage", coverage > 80, f"覆盖率 {coverage}%"))
    
    # 4. 复杂度检查
    complexity = calculate_complexity(code)
    checks.append(("complexity", complexity < 10, f"圈复杂度 {complexity}"))
    
    # 5. 安全检查
    security = run_security_scan(code)
    checks.append(("security", len(security) == 0, security))
    
    return QualityResult(
        passed=all(c[1] for c in checks),
        checks=checks
    )
```

**策略 2：自动修复循环**

```python
def code_with_auto_fix(spec: str, max_iterations: int = 3) -> str:
    """带自动修复的代码生成"""
    
    code = generate_code(spec)
    
    for i in range(max_iterations):
        result = quality_gate(code)
        
        if result.passed:
            return code
        
        # 自动修复
        fix_prompt = f"""
代码存在以下问题：
{result.get_errors()}

请修复这些问题，保持原有功能不变。

原代码：
{code}
"""
        code = llm.invoke(fix_prompt)
    
    # 超过最大迭代次数，请求人工介入
    raise QualityError(f"无法自动修复，需要人工介入: {result.get_errors()}")
```

**策略 3：代码模板约束**

```python
# 预定义代码模板
TEMPLATES = {
    "api_endpoint": '''
@app.{method}("{path}")
async def {function_name}({params}):
    """
    {docstring}
    """
    # TODO: 实现逻辑
    pass
''',
    
    "data_model": '''
class {ClassName}(BaseModel):
    """{docstring}"""
    {fields}
    
    class Config:
        from_attributes = True
'''
}

def generate_with_template(task_type: str, context: dict) -> str:
    """使用模板生成代码"""
    template = TEMPLATES.get(task_type)
    if template:
        return template.format(**context)
    return generate_code(context)
```

---

## 坑十一：测试用例不完整

### 问题

Agent 写的测试：

- 只覆盖正常路径
- 边界条件没测
- 异常处理没测

### 解决：测试用例自动补全

**策略 1：测试覆盖分析**

```python
def analyze_test_coverage(code: str, tests: str) -> CoverageReport:
    """分析测试覆盖情况"""
    
    # 1. 提取代码中的分支
    branches = extract_branches(code)
    
    # 2. 分析测试覆盖的分支
    covered = analyze_covered_branches(tests)
    
    # 3. 找出未覆盖的分支
    uncovered = branches - covered
    
    return CoverageReport(
        total_branches=len(branches),
        covered=len(covered),
        uncovered=uncovered,
        coverage_rate=len(covered) / len(branches)
    )
```

**策略 2：自动生成缺失测试**

```python
def generate_missing_tests(code: str, report: CoverageReport) -> str:
    """为未覆盖的分支生成测试"""
    
    prompt = f"""
以下代码有未覆盖的测试分支：

代码：
{code}

未覆盖的分支：
{report.uncovered}

请为这些分支生成测试用例。

要求：
1. 使用 pytest 格式
2. 包含边界条件测试
3. 包含异常处理测试
4. 测试函数命名清晰
"""
    
    return llm.invoke(prompt)
```

**策略 3：测试模板**

```python
TEST_TEMPLATES = {
    "normal_case": '''
def test_{function}_normal():
    """测试正常流程"""
    result = {function}({normal_input})
    assert result == {expected_output}
''',
    
    "edge_case": '''
def test_{function}_edge_case():
    """测试边界条件"""
    result = {function}({edge_input})
    assert result == {expected_output}
''',
    
    "error_case": '''
def test_{function}_error():
    """测试异常处理"""
    with pytest.raises({exception_type}):
        {function}({invalid_input})
'''
}

def generate_complete_tests(function: str, spec: dict) -> str:
    """生成完整的测试套件"""
    tests = []
    
    # 正常流程
    tests.append(TEST_TEMPLATES["normal_case"].format(
        function=function,
        normal_input=spec["normal_input"],
        expected_output=spec["expected_output"]
    ))
    
    # 边界条件
    for edge in spec.get("edge_cases", []):
        tests.append(TEST_TEMPLATES["edge_case"].format(
            function=function,
            edge_input=edge["input"],
            expected_output=edge["output"]
        ))
    
    # 异常处理
    for error in spec.get("error_cases", []):
        tests.append(TEST_TEMPLATES["error_case"].format(
            function=function,
            exception_type=error["exception"],
            invalid_input=error["input"]
        ))
    
    return "\n".join(tests)
```

---

## 坑十二：Agent 不知道何时停止

### 问题

Agent 有时候会：

- 过度优化代码
- 添加不必要的功能
- 无限循环修改

### 解决：明确完成条件

**策略 1：DoD (Definition of Done)**

```python
DEFINITION_OF_DONE = {
    "coding-agent": [
        "所有 P0 需求已实现",
        "测试覆盖率 >= 80%",
        "Lint 检查通过",
        "类型检查通过",
        "无安全漏洞",
    ],
    
    "verification-agent": [
        "所有测试通过",
        "覆盖率检查通过",
        "性能测试通过",
        "安全扫描通过",
    ]
}

def check_completion(agent: str, result: dict) -> bool:
    """检查是否完成"""
    dod = DEFINITION_OF_DONE.get(agent, [])
    
    for criteria in dod:
        if not evaluate_criteria(criteria, result):
            return False
    
    return True
```

**策略 2：最大迭代限制**

```python
def run_with_limit(agent, task: str, max_iterations: int = 5):
    """带迭代限制的执行"""
    
    for i in range(max_iterations):
        result = agent.run(task)
        
        if check_completion(agent.role, result):
            return result
        
        # 未完成，继续优化
        task = f"优化以下结果：\n{result}\n\n未满足的条件：{get_unmet_criteria()}"
    
    # 达到最大迭代
    raise MaxIterationError(f"达到最大迭代次数 {max_iterations}")
```

**策略 3：进度检测**

```python
def detect_progress(previous: str, current: str) -> float:
    """检测是否有实质性进展"""
    
    # 1. 相似度检测
    similarity = calculate_similarity(previous, current)
    
    # 2. 改动量检测
    change_ratio = calculate_change_ratio(previous, current)
    
    # 3. 质量提升检测
    quality_improvement = compare_quality(previous, current)
    
    # 进展指标
    progress = (1 - similarity) * 0.3 + change_ratio * 0.3 + quality_improvement * 0.4
    
    return progress

def run_with_progress_check(agent, task: str):
    """带进展检测的执行"""
    
    previous_result = None
    no_progress_count = 0
    
    while True:
        result = agent.run(task)
        
        if previous_result:
            progress = detect_progress(previous_result, result)
            
            if progress < 0.1:  # 进展太小
                no_progress_count += 1
                if no_progress_count >= 2:
                    print("[Warning] 无实质性进展，停止迭代")
                    return result
            else:
                no_progress_count = 0
        
        previous_result = result
```

---

## 坑十三：跨语言项目处理困难

### 问题

项目包含多种语言（Python + TypeScript + Go），Agent 只擅长一种：

```
Agent: 生成 Python 代码...
实际需要: TypeScript 代码

结果：语言不匹配，无法使用
```

### 解决：语言检测 + 上下文注入

**策略 1：项目语言检测**

```python
def detect_project_languages(project_root: str) -> list[str]:
    """检测项目使用的语言"""
    
    language_indicators = {
        "python": ["requirements.txt", "pyproject.toml", "setup.py", "*.py"],
        "typescript": ["tsconfig.json", "package.json", "*.ts"],
        "go": ["go.mod", "*.go"],
        "rust": ["Cargo.toml", "*.rs"],
        "java": ["pom.xml", "build.gradle", "*.java"],
    }
    
    detected = []
    for lang, indicators in language_indicators.items():
        for indicator in indicators:
            if glob.glob(f"{project_root}/**/{indicator}", recursive=True):
                detected.append(lang)
                break
    
    return detected
```

**策略 2：语言上下文注入**

```python
LANGUAGE_CONTEXTS = {
    "python": """
项目使用 Python，请遵循：
- 使用 type hints
- 使用 Pydantic 做数据验证
- 使用 pytest 写测试
- 使用 ruff 做 lint
- 使用 uv 管理依赖
""",
    
    "typescript": """
项目使用 TypeScript，请遵循：
- 使用 strict 模式
- 使用 Zod 做数据验证
- 使用 Vitest 写测试
- 使用 ESLint + Prettier
- 使用 pnpm 管理依赖
"""
}

def inject_language_context(prompt: str, languages: list[str]) -> str:
    """注入语言上下文"""
    
    context = "\n".join([
        LANGUAGE_CONTEXTS.get(lang, "")
        for lang in languages
    ])
    
    return f"{context}\n\n{prompt}"
```

**策略 3：文件级语言检测**

```python
def detect_file_language(file_path: str) -> str:
    """检测单个文件的语言"""
    
    ext_map = {
        ".py": "python",
        ".ts": "typescript",
        ".tsx": "typescript",
        ".go": "go",
        ".rs": "rust",
        ".java": "java",
    }
    
    ext = Path(file_path).suffix
    return ext_map.get(ext, "unknown")

def generate_code_with_lang(file_path: str, spec: str) -> str:
    """根据文件语言生成代码"""
    
    lang = detect_file_language(file_path)
    
    prompt = f"""
目标文件：{file_path}
语言：{lang}

{LANGUAGE_CONTEXTS.get(lang, '')}

需求：
{spec}

请生成符合项目规范的代码。
"""
    
    return llm.invoke(prompt)
```

---

## 坑十四：安全漏洞被忽视

### 问题

Agent 生成的代码可能包含：

- SQL 注入漏洞
- XSS 漏洞
- 硬编码密钥
- 不安全的权限检查

### 解决：安全扫描 + 自动修复

**策略 1：集成安全扫描工具**

```python
def security_scan(code: str, file_path: str) -> SecurityReport:
    """安全扫描"""
    
    issues = []
    
    # 1. Bandit (Python)
    if file_path.endswith(".py"):
        result = run_bandit(file_path)
        issues.extend(result.issues)
    
    # 2. Semgrep (多语言)
    result = run_semgrep(file_path)
    issues.extend(result.issues)
    
    # 3. 自定义规则检查
    issues.extend(check_custom_rules(code))
    
    return SecurityReport(
        safe=len(issues) == 0,
        issues=issues
    )

# 自定义安全规则
CUSTOM_RULES = [
    {
        "pattern": r"password\s*=\s*['\"]",
        "message": "禁止硬编码密码",
        "severity": "critical"
    },
    {
        "pattern": r"execute\s*\(\s*['\"]SELECT.*\+",
        "message": "可能的 SQL 注入",
        "severity": "critical"
    },
    {
        "pattern": r"innerHTML\s*=",
        "message": "可能的 XSS 漏洞",
        "severity": "high"
    }
]
```

**策略 2：安全修复 Agent**

```python
def fix_security_issues(code: str, report: SecurityReport) -> str:
    """修复安全问题"""
    
    if report.safe:
        return code
    
    prompt = f"""
以下代码存在安全问题：

代码：
{code}

安全问题：
{format_issues(report.issues)}

请修复这些安全问题，保持原有功能不变。

修复指南：
- SQL 注入：使用参数化查询
- XSS：使用安全的模板引擎
- 硬编码密钥：使用环境变量
- 权限检查：添加中间件
"""
    
    return llm.invoke(prompt)
```

**策略 3：安全最佳实践注入**

```python
SECURITY_GUIDELINES = """
安全开发规范：

1. 输入验证
   - 永远不信任用户输入
   - 使用 Pydantic / Zod 验证
   - 白名单优于黑名单

2. 认证授权
   - 使用成熟的认证库
   - 密码必须加密存储
   - Token 过期机制

3. 数据保护
   - 敏感数据加密
   - 不在日志中记录敏感信息
   - 使用 HTTPS

4. 代码安全
   - 不执行用户输入的代码
   - 不拼接 SQL 语句
   - 不直接使用用户输入作为文件路径
"""

def generate_with_security(spec: str) -> str:
    """带安全意识的代码生成"""
    
    prompt = f"""
{SECURITY_GUIDELINES}

需求：
{spec}

请生成安全的代码，遵循以上安全规范。
"""
    
    code = llm.invoke(prompt)
    
    # 扫描并修复
    report = security_scan(code)
    if not report.safe:
        code = fix_security_issues(code, report)
    
    return code
```

---

## 坑十五：性能问题被忽视

### 问题

Agent 生成的代码能跑，但性能很差：

- N+1 查询问题
- 没有索引
- 内存泄漏
- 同步阻塞

### 解决：性能检查 + 优化建议

**策略 1：性能反模式检测**

```python
PERFORMANCE_ANTI_PATTERNS = [
    {
        "pattern": r"for\s+\w+\s+in\s+.*:\s*\n\s*\w+\.\w+\(",
        "message": "可能的 N+1 查询问题",
        "suggestion": "使用批量查询或预加载"
    },
    {
        "pattern": r"sleep\s*\(",
        "message": "同步阻塞",
        "suggestion": "使用异步操作"
    },
    {
        "pattern": r"while\s+True:",
        "message": "可能的无限循环",
        "suggestion": "添加超时机制"
    }
]

def detect_performance_issues(code: str) -> list[PerformanceIssue]:
    """检测性能问题"""
    issues = []
    
    for pattern in PERFORMANCE_ANTI_PATTERNS:
        matches = re.finditer(pattern["pattern"], code)
        for match in matches:
            issues.append(PerformanceIssue(
                location=match.start(),
                message=pattern["message"],
                suggestion=pattern["suggestion"]
            ))
    
    return issues
```

**策略 2：性能优化提示**

```python
def optimize_code(code: str, issues: list[PerformanceIssue]) -> str:
    """优化代码性能"""
    
    if not issues:
        return code
    
    prompt = f"""
以下代码存在性能问题：

代码：
{code}

性能问题：
{format_issues(issues)}

请优化代码，解决这些性能问题。

优化方向：
1. 数据库查询：使用 JOIN、预加载、批量操作
2. 缓存：对频繁访问的数据使用缓存
3. 异步：将阻塞操作改为异步
4. 算法：选择更高效的数据结构和算法
"""
    
    return llm.invoke(prompt)
```

**策略 3：性能基准测试**

```python
def benchmark_code(code: str, test_data: dict) -> BenchmarkResult:
    """性能基准测试"""
    
    import time
    import memory_profiler
    
    # 执行时间
    start = time.time()
    exec(code, {"input": test_data})
    elapsed = time.time() - start
    
    # 内存使用
    mem_usage = memory_profiler.memory_usage(
        lambda: exec(code, {"input": test_data})
    )
    
    return BenchmarkResult(
        elapsed_time=elapsed,
        peak_memory=max(mem_usage),
        passed=elapsed < 1.0 and max(mem_usage) < 100
    )
```

---

## 坑十六：依赖版本冲突

### 问题

Agent 生成的代码使用了不兼容的依赖版本：

```
项目依赖: numpy==1.21.0
Agent 代码使用: numpy 2.0 新特性

结果：运行失败
```

### 解决：依赖检查 + 版本约束

**策略 1：依赖版本检测**

```python
def get_project_dependencies(project_root: str) -> dict[str, str]:
    """获取项目依赖版本"""
    
    # Python
    requirements = Path(project_root) / "requirements.txt"
    if requirements.exists():
        return parse_requirements(requirements.read_text())
    
    # TypeScript
    package_json = Path(project_root) / "package.json"
    if package_json.exists():
        return json.loads(package_json.read_text()).get("dependencies", {})
    
    return {}
```

**策略 2：版本兼容性检查**

```python
def check_version_compatibility(
    code: str, 
    dependencies: dict[str, str]
) -> list[CompatibilityIssue]:
    """检查版本兼容性"""
    
    issues = []
    
    # 检测代码使用的特性
    features = detect_features(code)
    
    # 检查每个特性的版本要求
    for feature in features:
        required_version = get_min_version(feature)
        current_version = dependencies.get(feature.package, "0.0.0")
        
        if compare_versions(current_version, required_version) < 0:
            issues.append(CompatibilityIssue(
                package=feature.package,
                required=required_version,
                current=current_version,
                feature=feature.name
            ))
    
    return issues
```

**策略 3：依赖约束注入**

```python
def generate_with_version_constraints(
    spec: str, 
    dependencies: dict[str, str]
) -> str:
    """带版本约束的代码生成"""
    
    constraint_info = "\n".join([
        f"- {pkg}: {version}"
        for pkg, version in dependencies.items()
    ])
    
    prompt = f"""
项目依赖版本：
{constraint_info}

请使用兼容的 API，不要使用更高版本的新特性。

需求：
{spec}
"""
    
    return llm.invoke(prompt)
```

---

## 坑十七：代码风格不一致

### 问题

不同 Agent 生成的代码风格不同：

```
Agent A: snake_case 变量名
Agent B: camelCase 变量名
Agent C: 单字母变量名

结果：代码难以维护
```

### 解决：代码风格规范 + 自动格式化

**策略 1：项目风格检测**

```python
def detect_code_style(project_root: str) -> CodeStyle:
    """检测项目代码风格"""
    
    # 检查配置文件
    style_config = {}
    
    # Python: pyproject.toml, .flake8, .ruff.toml
    pyproject = Path(project_root) / "pyproject.toml"
    if pyproject.exists():
        config = tomllib.loads(pyproject.read_text())
        style_config.update(config.get("tool", {}).get("ruff", {}))
    
    # TypeScript: .eslintrc, .prettierrc
    eslintrc = Path(project_root) / ".eslintrc.json"
    if eslintrc.exists():
        style_config.update(json.loads(eslintrc.read_text()))
    
    return CodeStyle(**style_config)
```

**策略 2：格式化工具集成**

```python
def format_code(code: str, file_path: str, style: CodeStyle) -> str:
    """格式化代码"""
    
    if file_path.endswith(".py"):
        # 使用 ruff 格式化
        return run_ruff_format(code, style)
    
    elif file_path.endswith((".ts", ".tsx")):
        # 使用 prettier 格式化
        return run_prettier(code, style)
    
    return code
```

**策略 3：风格指南注入**

```python
def generate_with_style(spec: str, style: CodeStyle) -> str:
    """带风格约束的代码生成"""
    
    prompt = f"""
代码风格规范：

命名规范：
- 变量：{style.variable_naming}
- 函数：{style.function_naming}
- 类：{style.class_naming}
- 常量：{style.constant_naming}

格式规范：
- 缩进：{style.indent}
- 行宽：{style.line_length}
- 引号：{style.quote_style}

注释规范：
- 文档字符串：{style.docstring_style}
- 行内注释：{style.inline_comment_style}

需求：
{spec}

请生成符合以上风格规范的代码。
"""
    
    return llm.invoke(prompt)
```

---

## 坑十八：缺少日志和监控

### 问题

Pipeline 运行时：

- 不知道哪个步骤耗时最长
- 不知道哪个 Agent 调用失败
- 无法追溯历史问题

### 解决：全链路监控

**策略 1：结构化日志**

```python
import structlog

logger = structlog.get_logger()

def log_step(step: int, agent: str, action: str, **kwargs):
    """结构化日志"""
    logger.info(
        "pipeline_step",
        step=step,
        agent=agent,
        action=action,
        **kwargs
    )

# 使用
log_step(
    step=3,
    agent="coding-agent",
    action="generate_code",
    files_modified=5,
    tokens_used=3200,
    duration_ms=4500
)
```

**策略 2：性能追踪**

```python
from opentelemetry import trace
from opentelemetry.sdk.trace import TracerProvider

tracer = trace.get_tracer(__name__)

def trace_step(step_name: str):
    """性能追踪装饰器"""
    def decorator(func):
        async def wrapper(*args, **kwargs):
            with tracer.start_as_current_span(step_name) as span:
                span.set_attribute("step", step_name)
                start = time.time()
                
                try:
                    result = await func(*args, **kwargs)
                    span.set_attribute("status", "success")
                    return result
                except Exception as e:
                    span.set_attribute("status", "error")
                    span.set_attribute("error.message", str(e))
                    raise
                finally:
                    elapsed = time.time() - start
                    span.set_attribute("duration_ms", elapsed * 1000)
        
        return wrapper
    return decorator

# 使用
@trace_step("code_generation")
async def generate_code(spec: str) -> str:
    return llm.invoke(spec)
```

**策略 3：指标收集**

```python
from prometheus_client import Counter, Histogram, Gauge

# 定义指标
PIPELINE_STEPS = Counter(
    'pipeline_steps_total',
    'Total pipeline steps executed',
    ['step', 'agent', 'status']
)

PIPELINE_DURATION = Histogram(
    'pipeline_duration_seconds',
    'Pipeline step duration',
    ['step', 'agent']
)

PIPELINE_TOKENS = Counter(
    'pipeline_tokens_total',
    'Total tokens used',
    ['agent']
)

# 使用
def record_metrics(step: str, agent: str, status: str, duration: float, tokens: int):
    PIPELINE_STEPS.labels(step=step, agent=agent, status=status).inc()
    PIPELINE_DURATION.labels(step=step, agent=agent).observe(duration)
    PIPELINE_TOKENS.labels(agent=agent).inc(tokens)
```

**策略 4：可视化面板**

```python
# Grafana Dashboard 配置
DASHBOARD_CONFIG = {
    "panels": [
        {
            "title": "Pipeline 成功率",
            "type": "gauge",
            "query": "sum(rate(pipeline_steps_total{status='success'}[5m])) / sum(rate(pipeline_steps_total[5m]))"
        },
        {
            "title": "各步骤耗时",
            "type": "graph",
            "query": "histogram_quantile(0.95, rate(pipeline_duration_seconds_bucket[5m]))"
        },
        {
            "title": "Token 消耗趋势",
            "type": "graph",
            "query": "sum(rate(pipeline_tokens_total[1h])) by (agent)"
        }
    ]
}
```

---

## 坑十九：用户反馈无法持续改进

### 问题

用户给反馈后：

- 反馈只对当前任务有效
- 相似任务不会自动应用反馈
- 无法积累改进经验

### 解决：反馈闭环系统

**策略 1：反馈收集**

```python
class FeedbackCollector:
    """反馈收集器"""
    
    def __init__(self):
        self.feedbacks = []
    
    def collect(
        self, 
        task: str, 
        result: str, 
        feedback: str,
        rating: int  # 1-5
    ):
        """收集反馈"""
        self.feedbacks.append({
            "task": task,
            "result": result,
            "feedback": feedback,
            "rating": rating,
            "timestamp": datetime.now().isoformat()
        })
    
    def get_negative_feedbacks(self) -> list:
        """获取负面反馈"""
        return [f for f in self.feedbacks if f["rating"] <= 2]
    
    def get_patterns(self) -> list[dict]:
        """分析反馈模式"""
        # 按反馈类型分组
        patterns = defaultdict(list)
        for f in self.feedbacks:
            key = self._extract_key_issue(f["feedback"])
            patterns[key].append(f)
        
        return [
            {"issue": k, "count": len(v), "examples": v[:3]}
            for k, v in sorted(patterns.items(), key=lambda x: -len(x[1]))
        ]
```

**策略 2：反馈驱动改进**

```python
def improve_from_feedback(
    collector: FeedbackCollector,
    prompt_template: str
) -> str:
    """从反馈改进 Prompt"""
    
    negative = collector.get_negative_feedbacks()
    if not negative:
        return prompt_template
    
    patterns = collector.get_patterns()
    
    improvement_prompt = f"""
当前 Prompt 模板：
{prompt_template}

用户反馈模式分析：
{format_patterns(patterns)}

请根据这些反馈改进 Prompt 模板，解决常见问题。

改进方向：
1. 添加明确的约束条件
2. 提供更多示例
3. 强调易出错的地方
"""
    
    return llm.invoke(improvement_prompt)
```

**策略 3：反馈知识库**

```python
class FeedbackKnowledgeBase:
    """反馈知识库"""
    
    def __init__(self, db_path: str = "feedback_kb.json"):
        self.db_path = db_path
        self.knowledge = self._load()
    
    def learn(self, task: str, feedback: str, improvement: str):
        """学习反馈"""
        # 提取任务模式
        pattern = extract_task_pattern(task)
        
        # 存储改进方案
        if pattern not in self.knowledge:
            self.knowledge[pattern] = []
        
        self.knowledge[pattern].append({
            "feedback": feedback,
            "improvement": improvement,
            "count": 1
        })
        
        self._save()
    
    def get_improvements(self, task: str) -> list[str]:
        """获取相关改进方案"""
        pattern = extract_task_pattern(task)
        entries = self.knowledge.get(pattern, [])
        
        # 按使用次数排序
        sorted_entries = sorted(entries, key=lambda x: -x["count"])
        
        return [e["improvement"] for e in sorted_entries[:3]]
```

---

## 坑二十：多 Agent 协作效率低

### 问题

多个 Agent 协作时：

- 重复查询相同信息
- 等待其他 Agent 完成时间过长
- 通信开销大

### 解决：高效协作模式

**策略 1：共享缓存**

```python
from functools import lru_cache
import hashlib

class SharedCache:
    """Agent 共享缓存"""
    
    _instance = None
    _cache = {}
    
    def __new__(cls):
        if cls._instance is None:
            cls._instance = super().__new__(cls)
        return cls._instance
    
    def get_or_compute(self, key: str, compute_fn) -> any:
        """获取或计算"""
        cache_key = hashlib.md5(key.encode()).hexdigest()
        
        if cache_key not in self._cache:
            self._cache[cache_key] = compute_fn()
        
        return self._cache[cache_key]

# 使用
cache = SharedCache()

def analyze_code(file_path: str):
    return cache.get_or_compute(
        f"analyze:{file_path}",
        lambda: actual_analyze(file_path)
    )
```

**策略 2：并行执行**

```python
import asyncio

async def run_parallel_agents(tasks: list[AgentTask]) -> list[AgentResult]:
    """并行执行多个 Agent"""
    
    # 创建任务
    coroutines = [
        run_agent(task.agent, task.input)
        for task in tasks
    ]
    
    # 并行执行
    results = await asyncio.gather(*coroutines, return_exceptions=True)
    
    # 处理结果
    return [
        AgentResult(
            task_id=tasks[i].id,
            success=not isinstance(results[i], Exception),
            output=results[i] if not isinstance(results[i], Exception) else None,
            error=str(results[i]) if isinstance(results[i], Exception) else None
        )
        for i in range(len(results))
    ]
```

**策略 3：消息队列解耦**

```python
from queue import Queue
from threading import Thread

class AgentMessageQueue:
    """Agent 消息队列"""
    
    def __init__(self):
        self.queues = defaultdict(Queue)
        self.handlers = {}
    
    def register(self, agent: str, handler):
        """注册 Agent 处理器"""
        self.handlers[agent] = handler
        Thread(target=self._process, args=(agent,), daemon=True).start()
    
    def send(self, to: str, message: dict):
        """发送消息"""
        self.queues[to].put(message)
    
    def _process(self, agent: str):
        """处理消息"""
        handler = self.handlers[agent]
        while True:
            message = self.queues[agent].get()
            handler(message)
```

---

## 坑二十一：环境差异导致执行失败

### 问题

本地运行成功，部署后失败：

- 环境变量缺失
- 文件路径不同
- 依赖版本不一致

### 解决：环境一致性保障

**策略 1：环境变量管理**

```python
from pydantic import BaseSettings

class EnvConfig(BaseSettings):
    """环境变量配置"""
    
    # 必需变量
    DATABASE_URL: str
    API_KEY: str
    
    # 可选变量（带默认值）
    LOG_LEVEL: str = "INFO"
    MAX_RETRIES: int = 3
    
    class Config:
        env_file = ".env"
        env_file_encoding = "utf-8"

# 使用
config = EnvConfig()

def get_database_url() -> str:
    return config.DATABASE_URL
```

**策略 2：路径适配**

```python
from pathlib import Path

class PathManager:
    """路径管理器"""
    
    def __init__(self, base_dir: str = None):
        self.base_dir = Path(base_dir or os.getcwd())
    
    def resolve(self, path: str) -> Path:
        """解析路径（支持相对和绝对）"""
        p = Path(path)
        if p.is_absolute():
            return p
        return self.base_dir / p
    
    def ensure_dir(self, path: str):
        """确保目录存在"""
        p = self.resolve(path)
        p.mkdir(parents=True, exist_ok=True)
        return p
```

**策略 3：依赖锁定**

```bash
# Python: requirements.lock
pip freeze > requirements.lock

# TypeScript: package-lock.json
npm shrinkwrap

# 使用锁定文件安装
pip install -r requirements.lock
npm ci
```

**策略 4：容器化**

```dockerfile
FROM python:3.11-slim

WORKDIR /app

# 复制依赖文件
COPY requirements.lock .
RUN pip install -r requirements.lock

# 复制代码
COPY . .

# 运行
CMD ["python", "main.py"]
```

---

## 坑二十二：错误处理不够优雅

### 问题

错误处理方式：

- 直接崩溃
- 错误信息不清晰
- 没有重试机制

### 解决：优雅的错误处理

**策略 1：错误分类**

```python
class PipelineError(Exception):
    """Pipeline 基础错误"""
    pass

class AgentError(PipelineError):
    """Agent 执行错误"""
    def __init__(self, agent: str, message: str, recoverable: bool = False):
        self.agent = agent
        self.recoverable = recoverable
        super().__init__(f"[{agent}] {message}")

class LLMError(AgentError):
    """LLM 调用错误"""
    pass

class ToolError(AgentError):
    """工具执行错误"""
    pass

class ValidationError(AgentError):
    """验证失败错误"""
    pass
```

**策略 2：重试机制**

```python
from tenacity import (
    retry, 
    stop_after_attempt, 
    wait_exponential,
    retry_if_exception_type
)

@retry(
    stop=stop_after_attempt(3),
    wait=wait_exponential(multiplier=1, min=2, max=10),
    retry=retry_if_exception_type(LLMError),
    before_sleep=lambda retry_state: logger.warning(
        f"重试 {retry_state.attempt_number}/3..."
    )
)
def call_llm(prompt: str) -> str:
    """带重试的 LLM 调用"""
    try:
        return llm.invoke(prompt)
    except RateLimitError:
        raise LLMError("coding-agent", "Rate limit exceeded", recoverable=True)
    except TimeoutError:
        raise LLMError("coding-agent", "Request timeout", recoverable=True)
```

**策略 3：降级策略**

```python
def execute_with_fallback(
    primary_fn,
    fallback_fn,
    error_types: list[type] = None
):
    """带降级的执行"""
    error_types = error_types or [Exception]
    
    try:
        return primary_fn()
    except tuple(error_types) as e:
        logger.warning(f"主策略失败: {e}，启用降级策略")
        return fallback_fn()

# 使用
result = execute_with_fallback(
    primary_fn=lambda: analyze_with_llm(code),
    fallback_fn=lambda: analyze_with_regex(code),
    error_types=[LLMError, TimeoutError]
)
```

**策略 4：错误恢复**

```python
class ErrorRecovery:
    """错误恢复"""
    
    RECOVERY_STRATEGIES = {
        "file_not_found": lambda path: create_default_file(path),
        "permission_denied": lambda path: request_permission(path),
        "validation_failed": lambda errors: auto_fix_errors(errors),
    }
    
    def recover(self, error: Exception, context: dict) -> any:
        """尝试恢复"""
        error_type = self._classify_error(error)
        
        strategy = self.RECOVERY_STRATEGIES.get(error_type)
        if strategy:
            logger.info(f"尝试恢复: {error_type}")
            return strategy(context)
        
        raise error
```

---

## 坑二十三：文档和代码不同步

### 问题

Agent 修改代码后：

- 忘记更新文档
- API 文档过时
- README 不准确

### 解决：自动文档同步

**策略 1：文档生成**

```python
def generate_api_docs(code: str) -> str:
    """从代码生成 API 文档"""
    
    prompt = f"""
请为以下代码生成 API 文档：

{code}

文档格式：
## API 名称

### 请求
- Method: POST
- Path: /api/xxx
- Headers: ...

### 参数
| 参数名 | 类型 | 必需 | 说明 |
|--------|------|------|------|

### 响应
| 字段名 | 类型 | 说明 |
|--------|------|------|

### 示例
```json
{{"request": "example"}}
```
"""
    
    return llm.invoke(prompt)
```

**策略 2：文档检查**

```python
def check_doc_sync(code: str, doc: str) -> DocSyncReport:
    """检查文档和代码是否同步"""
    
    # 提取代码中的 API 定义
    code_apis = extract_api_definitions(code)
    
    # 提取文档中的 API 定义
    doc_apis = extract_api_from_doc(doc)
    
    # 对比
    missing_in_doc = code_apis - doc_apis
    missing_in_code = doc_apis - code_apis
    
    return DocSyncReport(
        synced=len(missing_in_doc) == 0 and len(missing_in_code) == 0,
        missing_in_doc=missing_in_doc,
        missing_in_code=missing_in_code
    )
```

**策略 3：自动更新**

```python
def update_readme(readme_path: str, changes: list[Change]):
    """自动更新 README"""
    
    readme = Path(readme_path).read_text()
    
    prompt = f"""
当前 README：
{readme}

本次代码改动：
{format_changes(changes)}

请更新 README，保持格式一致。

更新要点：
1. 更新功能列表
2. 更新使用示例
3. 更新依赖说明
"""
    
    updated = llm.invoke(prompt)
    Path(readme_path).write_text(updated)
```

---

## 坑二十四：用户意图理解偏差

### 问题

用户说"优化性能"，Agent 可能：

- 优化了错误的地方
- 过度优化
- 理解成其他意思

### 解决：意图澄清机制

**策略 1：意图确认**

```python
def clarify_intent(user_input: str) -> ClarifiedIntent:
    """澄清用户意图"""
    
    prompt = f"""
用户输入：{user_input}

请分析用户意图，并生成澄清问题。

输出格式：
{{
  "primary_intent": "主要意图",
  "ambiguities": ["歧义点1", "歧义点2"],
  "clarification_questions": [
    "问题1？",
    "问题2？"
  ]
}}
"""
    
    result = llm.invoke(prompt)
    intent = json.loads(result)
    
    if intent["ambiguities"]:
        # 有歧义，需要澄清
        answers = ask_user(intent["clarification_questions"])
        intent["answers"] = answers
    
    return ClarifiedIntent(**intent)
```

**策略 2：示例引导**

```python
INTENT_EXAMPLES = {
    "优化性能": {
        "clarifications": [
            "是指响应时间还是内存使用？",
            "是针对哪个 API 或功能？"
        ],
        "examples": [
            "优化登录接口的响应时间",
            "减少批量导入的内存占用"
        ]
    },
    
    "添加功能": {
        "clarifications": [
            "这是全新功能还是改进现有功能？",
            "优先级如何？"
        ],
        "examples": [
            "添加手机号登录功能（P0）",
            "改进搜索功能，支持模糊匹配（P1）"
        ]
    }
}

def get_intent_examples(user_input: str) -> dict:
    """获取意图示例"""
    for keyword, info in INTENT_EXAMPLES.items():
        if keyword in user_input:
            return info
    return {}
```

**策略 3：反馈验证**

```python
def validate_understanding(intent: ClarifiedIntent) -> bool:
    """验证理解是否正确"""
    
    summary = f"""
我理解您的需求是：
{intent.primary_intent}

具体来说：
{format_answers(intent.answers)}

是否正确？
"""
    
    return ask_confirmation(summary)
```

---

## 坑二十五：测试数据污染生产环境

### 问题

Agent 在开发时：

- 使用真实用户数据测试
- 测试数据泄露到生产
- 敏感信息暴露

### 解决：测试数据隔离

**策略 1：数据脱敏**

```python
from faker import Faker

fake = Faker('zh_CN')

def anonymize_user_data(user: dict) -> dict:
    """用户数据脱敏"""
    return {
        "id": user["id"],  # 保留 ID
        "name": fake.name(),
        "phone": fake.phone_number(),
        "email": fake.email(),
        "address": fake.address(),
    }

def anonymize_dataset(data: list[dict]) -> list[dict]:
    """批量脱敏"""
    return [anonymize_user_data(item) for item in data]
```

**策略 2：测试数据生成器**

```python
class TestDataGenerator:
    """测试数据生成器"""
    
    def __init__(self, seed: int = 42):
        fake.seed_instance(seed)
    
    def generate_user(self, **overrides) -> dict:
        """生成用户数据"""
        data = {
            "id": fake.uuid4(),
            "name": fake.name(),
            "phone": fake.phone_number(),
            "email": fake.email(),
            "created_at": fake.date_time_this_year(),
        }
        data.update(overrides)
        return data
    
    def generate_users(self, count: int = 10) -> list[dict]:
        """批量生成用户"""
        return [self.generate_user() for _ in range(count)]
    
    def generate_order(self, user_id: str = None) -> dict:
        """生成订单数据"""
        return {
            "id": fake.uuid4(),
            "user_id": user_id or fake.uuid4(),
            "amount": fake.pydecimal(left_digits=4, right_digits=2, positive=True),
            "status": fake.random_element(["pending", "paid", "shipped", "completed"]),
            "created_at": fake.date_time_this_year(),
        }
```

**策略 3：环境隔离**

```python
# 环境配置
ENVIRONMENTS = {
    "development": {
        "database": "mongodb://localhost:27017/dev",
        "redis": "redis://localhost:6379/0",
        "s3_bucket": "dev-bucket",
    },
    "testing": {
        "database": "mongodb://localhost:27017/test",
        "redis": "redis://localhost:6379/1",
        "s3_bucket": "test-bucket",
    },
    "production": {
        "database": "mongodb://prod-mongo:27017/prod",
        "redis": "redis://prod-redis:6379/0",
        "s3_bucket": "prod-bucket",
    }
}

def get_config() -> dict:
    """获取当前环境配置"""
    env = os.getenv("ENVIRONMENT", "development")
    return ENVIRONMENTS[env]
```

---

## 坑二十六：API 破坏性变更

### 问题

Agent 修改代码时：

- 修改了 API 接口签名
- 删除了已有字段
- 改变了响应格式

导致客户端崩溃。

### 解决：API 兼容性保障

**策略 1：API 版本管理**

```python
# 版本化路由
from fastapi import APIRouter

router_v1 = APIRouter(prefix="/api/v1")
router_v2 = APIRouter(prefix="/api/v2")

@router_v1.post("/users")
def create_user_v1(user: UserV1):
    """V1 API：只支持基本字段"""
    return create_user_basic(user)

@router_v2.post("/users")
def create_user_v2(user: UserV2):
    """V2 API：支持更多字段"""
    return create_user_advanced(user)
```

**策略 2：兼容性检查**

```python
def check_api_compatibility(
    old_spec: dict, 
    new_spec: dict
) -> CompatibilityReport:
    """检查 API 兼容性"""
    
    issues = []
    
    # 检查删除的字段
    old_fields = set(old_spec.get("fields", {}).keys())
    new_fields = set(new_spec.get("fields", {}).keys())
    removed_fields = old_fields - new_fields
    
    if removed_fields:
        issues.append(f"删除字段: {removed_fields}")
    
    # 检查类型变更
    for field in old_fields & new_fields:
        old_type = old_spec["fields"][field]["type"]
        new_type = new_spec["fields"][field]["type"]
        
        if old_type != new_type:
            issues.append(f"字段 {field} 类型变更: {old_type} -> {new_type}")
    
    # 检查必需字段
    old_required = set(old_spec.get("required", []))
    new_required = set(new_spec.get("required", []))
    added_required = new_required - old_required
    
    if added_required:
        issues.append(f"新增必需字段: {added_required}")
    
    return CompatibilityReport(
        compatible=len(issues) == 0,
        issues=issues
    )
```

**策略 3：废弃声明**

```python
from warnings import warn

def deprecated_field(field_name: str, replacement: str = None):
    """废弃字段装饰器"""
    def decorator(func):
        def wrapper(*args, **kwargs):
            msg = f"字段 '{field_name}' 已废弃"
            if replacement:
                msg += f"，请使用 '{replacement}'"
            warn(msg, DeprecationWarning)
            return func(*args, **kwargs)
        return wrapper
    return decorator

# 使用
@deprecated_field("old_field", "new_field")
def get_user_old():
    return {"old_field": "value"}
```

---

## 坑二十七：多租户数据混乱

### 问题

SaaS 应用中：

- Agent 忘记添加租户过滤
- 数据查询跨租户
- 权限检查遗漏

### 解决：租户隔离机制

**策略 1：租户上下文**

```python
from contextvars import ContextVar

# 租户上下文
current_tenant: ContextVar[str] = ContextVar('current_tenant')

def set_tenant(tenant_id: str):
    """设置当前租户"""
    current_tenant.set(tenant_id)

def get_tenant() -> str:
    """获取当前租户"""
    return current_tenant.get()
```

**策略 2：自动租户过滤**

```python
from sqlalchemy import event
from sqlalchemy.orm import Session

@event.listens_for(Session, 'before_execute')
def add_tenant_filter(conn, clauseelement, multiparams, params):
    """自动添加租户过滤"""
    tenant_id = get_tenant()
    
    if hasattr(clauseelement, 'where'):
        # 添加租户条件
        clauseelement = clauseelement.where(
            clauseelement.table.c.tenant_id == tenant_id
        )
    
    return clauseelement, multiparams, params
```

**策略 3：租户隔离检查**

```python
def check_tenant_isolation(query: str) -> bool:
    """检查查询是否有租户隔离"""
    
    # 分析查询
    if "tenant_id" not in query.lower():
        return False
    
    # 检查 WHERE 子句
    if "where" in query.lower():
        if "tenant_id" not in query.lower().split("where")[1]:
            return False
    
    return True

def validate_query(query: str):
    """验证查询"""
    if not check_tenant_isolation(query):
        raise TenantIsolationError("查询缺少租户隔离条件")
```

---

## 坑二十八：配置管理混乱

### 问题

Agent 生成的代码：

- 硬编码配置
- 配置散落在各处
- 敏感配置暴露

### 解决：统一配置管理

**策略 1：配置中心**

```python
from pydantic import BaseSettings

class AppConfig(BaseSettings):
    """应用配置"""
    
    # 数据库
    database_url: str
    database_pool_size: int = 10
    
    # Redis
    redis_url: str
    
    # LLM
    llm_api_key: str
    llm_model: str = "gpt-4"
    llm_max_tokens: int = 4096
    
    # Pipeline
    pipeline_max_retries: int = 3
    pipeline_timeout: int = 300
    
    class Config:
        env_file = ".env"
        env_file_encoding = "utf-8"

# 全局配置
config = AppConfig()
```

**策略 2：敏感配置加密**

```python
from cryptography.fernet import Fernet

class SecureConfig:
    """加密配置管理"""
    
    def __init__(self, key: bytes = None):
        self.key = key or Fernet.generate_key()
        self.cipher = Fernet(self.key)
    
    def encrypt(self, value: str) -> str:
        """加密"""
        return self.cipher.encrypt(value.encode()).decode()
    
    def decrypt(self, encrypted: str) -> str:
        """解密"""
        return self.cipher.decrypt(encrypted.encode()).decode()
    
    def store_secure(self, key: str, value: str):
        """存储加密配置"""
        encrypted = self.encrypt(value)
        # 存储到安全位置
        os.environ[f"ENCRYPTED_{key}"] = encrypted
    
    def get_secure(self, key: str) -> str:
        """获取加密配置"""
        encrypted = os.getenv(f"ENCRYPTED_{key}")
        if encrypted:
            return self.decrypt(encrypted)
        return None
```

**策略 3：配置验证**

```python
def validate_config(config: AppConfig) -> list[str]:
    """验证配置"""
    
    errors = []
    
    # 检查必需配置
    if not config.database_url:
        errors.append("database_url 是必需的")
    
    if not config.llm_api_key:
        errors.append("llm_api_key 是必需的")
    
    # 检查格式
    if not config.database_url.startswith(("mongodb://", "postgresql://")):
        errors.append("database_url 格式不正确")
    
    # 检查范围
    if config.database_pool_size < 1 or config.database_pool_size > 100:
        errors.append("database_pool_size 必须在 1-100 之间")
    
    return errors
```

---

## 坑二十九：回滚困难

### 问题

Agent 部署后发现问题：

- 无法快速回滚
- 数据库变更难撤销
- 配置变更无记录

### 解决：快速回滚机制

**策略 1：变更记录**

```python
class ChangeRecord:
    """变更记录"""
    
    def __init__(self, change_id: str):
        self.change_id = change_id
        self.changes = []
        self.rollback_scripts = []
    
    def record(self, change_type: str, before: any, after: any, rollback: str):
        """记录变更"""
        self.changes.append({
            "type": change_type,
            "before": before,
            "after": after,
            "timestamp": datetime.now().isoformat()
        })
        self.rollback_scripts.append(rollback)
    
    def save(self):
        """保存变更记录"""
        path = f".changes/{self.change_id}.json"
        Path(path).write_text(json.dumps({
            "change_id": self.change_id,
            "changes": self.changes,
            "rollback_scripts": self.rollback_scripts
        }, indent=2))
    
    def rollback(self):
        """执行回滚"""
        for script in reversed(self.rollback_scripts):
            exec(script)
```

**策略 2：蓝绿部署**

```python
class BlueGreenDeployment:
    """蓝绿部署"""
    
    def __init__(self):
        self.current = "blue"  # 当前生产环境
        self.staging = "green"  # 预发布环境
    
    def deploy(self, version: str):
        """部署到预发布环境"""
        deploy_to(self.staging, version)
        
        # 验证
        if validate_deployment(self.staging):
            # 切换流量
            switch_traffic(self.staging)
            self.current, self.staging = self.staging, self.current
        else:
            # 部署失败，保持当前环境
            raise DeploymentError("验证失败")
    
    def rollback(self):
        """快速回滚"""
        switch_traffic(self.current)
```

**策略 3：数据库迁移回滚**

```python
# migrations/001_add_user_table.sql
-- UP
CREATE TABLE users (
    id UUID PRIMARY KEY,
    name VARCHAR(255),
    created_at TIMESTAMP DEFAULT NOW()
);

-- DOWN
DROP TABLE users;

# Python 迁移管理
class MigrationManager:
    def migrate(self, direction: str = "up"):
        """执行迁移"""
        migrations = sorted(Path("migrations").glob("*.sql"))
        
        if direction == "up":
            for m in migrations:
                self._execute_up(m)
        else:
            for m in reversed(migrations):
                self._execute_down(m)
    
    def _execute_up(self, migration: Path):
        content = migration.read_text()
        up_sql = content.split("-- DOWN")[0].split("-- UP")[1]
        db.execute(up_sql)
    
    def _execute_down(self, migration: Path):
        content = migration.read_text()
        if "-- DOWN" in content:
            down_sql = content.split("-- DOWN")[1]
            db.execute(down_sql)
```

---

## 坑三十：成本控制缺失

### 问题

Pipeline 运行成本：

- LLM 调用费用失控
- Token 消耗无上限
- 没有成本预警

### 解决：成本控制机制

**策略 1：Token 计数**

```python
import tiktoken

class TokenCounter:
    """Token 计数器"""
    
    def __init__(self, model: str = "gpt-4"):
        self.encoder = tiktoken.encoding_for_model(model)
        self.counts = defaultdict(int)
    
    def count(self, text: str) -> int:
        """计算 Token 数"""
        return len(self.encoder.encode(text))
    
    def track(self, agent: str, text: str):
        """追踪 Token 使用"""
        count = self.count(text)
        self.counts[agent] += count
        return count
    
    def report(self) -> dict:
        """生成报告"""
        return dict(self.counts)

# 使用
counter = TokenCounter()

def call_llm(prompt: str, agent: str = "default"):
    tokens = counter.track(agent, prompt)
    
    if tokens > MAX_TOKENS_PER_REQUEST:
        raise TokenLimitError(f"请求超过 Token 限制: {tokens}")
    
    return llm.invoke(prompt)
```

**策略 2：成本预算**

```python
class CostBudget:
    """成本预算管理"""
    
    # Token 成本（美元/1K tokens）
    COSTS = {
        "gpt-4": {"input": 0.03, "output": 0.06},
        "gpt-3.5-turbo": {"input": 0.0015, "output": 0.002},
        "claude-3-opus": {"input": 0.015, "output": 0.075},
    }
    
    def __init__(self, daily_budget: float = 10.0):
        self.daily_budget = daily_budget
        self.daily_spent = 0.0
    
    def estimate_cost(self, model: str, input_tokens: int, output_tokens: int) -> float:
        """估算成本"""
        costs = self.COSTS.get(model, {"input": 0.01, "output": 0.01})
        
        input_cost = (input_tokens / 1000) * costs["input"]
        output_cost = (output_tokens / 1000) * costs["output"]
        
        return input_cost + output_cost
    
    def can_proceed(self, estimated_cost: float) -> bool:
        """检查是否超预算"""
        return (self.daily_spent + estimated_cost) <= self.daily_budget
    
    def record(self, cost: float):
        """记录成本"""
        self.daily_spent += cost
        
        # 预警
        if self.daily_spent > self.daily_budget * 0.8:
            warn(f"成本已使用 {self.daily_spent/self.daily_budget*100:.1f}%")
```

**策略 3：成本优化策略**

```python
def optimize_for_cost(prompt: str, model: str = "gpt-4") -> str:
    """成本优化"""
    
    budget = CostBudget()
    tokens = TokenCounter()
    
    # 估算成本
    input_tokens = tokens.count(prompt)
    estimated_output = input_tokens * 0.5  # 假设输出是输入的一半
    estimated_cost = budget.estimate_cost(model, input_tokens, estimated_output)
    
    # 成本过高，使用更便宜的模型
    if not budget.can_proceed(estimated_cost):
        cheaper_model = "gpt-3.5-turbo"
        logger.info(f"成本过高，切换到 {cheaper_model}")
        return llm.invoke(prompt, model=cheaper_model)
    
    return llm.invoke(prompt, model=model)
```

---

## 总结

做 Agent 开发，核心不是让 Agent 更聪明，而是：

### 核心原则

1. **可评估** - 改了 Agent，能知道效果变好还是变坏
2. **可追溯** - 每个 Agent 的决策都有记录
3. **可干预** - 关键节点能暂停，人工确认
4. **可恢复** - 失败后能断点续传
5. **可控** - 知道何时停止，避免无限循环

### 质量保障

6. **一致** - 输出质量稳定，符合标准
7. **安全** - 生成的代码无安全漏洞
8. **高效** - 生成的代码性能可接受
9. **兼容** - 依赖版本兼容，代码风格统一
10. **可测试** - 测试数据隔离，覆盖完整

### 运维能力

11. **可观测** - 全链路监控，问题可追溯
12. **可持续** - 从反馈中学习，持续改进
13. **可协作** - 多 Agent 高效协作
14. **可移植** - 环境差异不影响运行
15. **可容错** - 错误处理优雅，有恢复机制
16. **可回滚** - 变更有记录，回滚有方案

### 产品能力

17. **可维护** - 文档和代码保持同步
18. **可理解** - 用户意图理解准确
19. **可扩展** - API 版本管理，兼容演进
20. **可隔离** - 多租户数据安全隔离
21. **可配置** - 配置统一管理，敏感信息加密
22. **可预算** - 成本可控，资源有上限

**Less is More**：五个节点，每个打磨到极致，比十个节点各做一半要好。

---

## 附录：快速参考卡片

### Agent 开发 Check List

```markdown
## 启动前
- [ ] 环境变量配置完整
- [ ] 依赖版本锁定
- [ ] 测试数据准备

## 执行中
- [ ] Token 消耗监控
- [ ] 成本预算检查
- [ ] 中间结果保存

## 完成后
- [ ] 质量门禁通过
- [ ] 安全扫描通过
- [ ] 测试覆盖达标

## 部署时
- [ ] 变更记录完整
- [ ] 回滚脚本就绪
- [ ] 监控告警配置
```

### 常用命令速查

```bash
# Token 统计
python -c "import tiktoken; print(len(tiktoken.encoding_for_model('gpt-4').encode('your text')))"

# 成本估算
python -c "
costs = {'input': 0.03, 'output': 0.06}
tokens = 10000
print(f'估算成本: \${tokens/1000 * costs[\"input\"]:.2f}')
"

# 安全扫描
bandit -r src/
semgrep --config=auto src/

# 代码格式化
ruff format .
prettier --write "**/*.{js,ts,json}"
```

### 监控指标

| 指标 | 告警阈值 | 说明 |
|------|---------|------|
| 成功率 | < 80% | Agent 执行失败率过高 |
| 平均耗时 | > 60s | 执行时间过长 |
| Token 消耗 | > 10K/任务 | Token 使用过多 |
| 错误率 | > 10% | 错误频率过高 |
| 成本 | > 预算 80% | 接近预算上限 |

---

**项目地址**: https://github.com/afine907/ai-native-pipeline

**上一篇**: [AI Native Pipeline 设计实践](#/articles/ai/AI-Native-Pipeline-设计实践)

**下一篇**: [Agent 效果评估实战](#/articles/ai/Agent-效果评估实战)

---

**上一篇**: [AI Native Pipeline 设计实践](#/articles/ai/AI-Native-Pipeline-设计实践)

**下一篇**: [Agent 效果评估实战](#/articles/ai/Agent-效果评估实战)
