---
slug: multi-agent-collaboration
sidebar_position: 10
title: 单 Agent 不够用？多 Agent 协作的三大模式和五个坑
---


一个 Agent 承担所有角色——分析需求、写代码、测试——结果什么都做得一般。拆成多个专责 Agent（分析师、设计师、程序员、测试员）后，代码质量提升了一个档次。

多 Agent 协作的真实难点和解决方案。

## 核心问题：为什么单 Agent 做不好？

我做过一个实验，让单 Agent 和多 Agent 完成同样的任务："实现一个用户登录功能，要求有验证码、记住我、密码加密"。

**单 Agent 的输出**：

```python
# 它把所有逻辑塞在一个文件里，没有测试
def login(username, password):
    if check_password(username, password):
        return "success"
    return "failed"
```

问题：
- 没有需求分析，漏掉了"验证码"和"记住我"
- 没有设计文档，代码结构混乱
- 没有测试，安全性没考虑

**多 Agent 的输出**：

```
Analyst Agent: 需求拆解为 5 个功能点
Designer Agent: 设计了 3 层架构 + 时序图
Coder Agent: 分 3 个文件实现，有类型注解
Tester Agent: 写了 8 个测试用例，覆盖率 92%
```

原因：**每个 Agent 都有自己的"专业领域"，专注一件事做得更好**。

## 三大协作模式

### 模式一：顺序流水线（最简单）

适用场景：流程固定，不需要回退。

```
需求 → 分析师 → 设计师 → 程序员 → 测试员 → 交付
```

实现：

```python
from typing import TypedDict, Annotated
from langgraph.graph import StateGraph, END

class DevState(TypedDict):
    requirement: str
    analysis: str
    design: str
    code: str
    test_result: str
    iteration: int

def analyst_node(state: DevState) -> dict:
    """需求分析师：拆解需求"""
    requirement = state["requirement"]
    
    prompt = f"""你是需求分析师。分析以下需求，拆解为功能点：

{requirement}

输出格式：
1. 功能点列表
2. 技术要求
3. 风险点"""
    
    analysis = llm.invoke(prompt)
    return {"analysis": analysis}

def designer_node(state: DevState) -> dict:
    """架构师：设计方案"""
    prompt = f"""根据需求分析设计技术方案：

{state['analysis']}

输出：
1. 模块划分
2. 数据结构
3. 关键代码框架"""
    
    design = llm.invoke(prompt)
    return {"design": design}

def coder_node(state: DevState) -> dict:
    """程序员：实现代码"""
    prompt = f"""根据设计实现代码：

{state['design']}

要求：
- 完整可运行
- 有类型注解
- 有异常处理"""
    
    code = llm.invoke(prompt)
    return {"code": code}

def tester_node(state: DevState) -> dict:
    """测试员：验证代码"""
    prompt = f"""测试以下代码：

{state['code']}

输出：
1. 测试用例
2. 发现的问题
3. 修复建议"""
    
    result = llm.invoke(prompt)
    
    # 如果有问题，返回"需要修复"
    if "问题" in result and "无问题" not in result:
        return {"test_result": result, "needs_fix": True}
    
    return {"test_result": result, "needs_fix": False}

# 构建流程
workflow = StateGraph(DevState)
workflow.add_node("analyst", analyst_node)
workflow.add_node("designer", designer_node)
workflow.add_node("coder", coder_node)
workflow.add_node("tester", tester_node)

workflow.set_entry_point("analyst")
workflow.add_edge("analyst", "designer")
workflow.add_edge("designer", "coder")
workflow.add_edge("coder", "tester")

# 简单的路由：有问题就修，没问题就结束
def route_after_test(state: DevState) -> str:
    if state.get("needs_fix") and state.get("iteration", 0) < 3:
        return "coder"  # 回到程序员修复
    return END

workflow.add_conditional_edges("tester", route_after_test, {"coder": "coder", END: END})
```

### 模式二：反馈循环（最实用）

适用场景：需要迭代改进，质量要求高。

```
需求 → 分析 → 设计 → 编码 → 测试
                          ↓ 失败
                      反馈 → 编码 → 测试
```

真实案例：jojo-code 的代码生成流程。

```python
class CodeGenState(TypedDict):
    requirement: str
    code: str
    test_result: TestResult
    feedback: list[str]
    iteration: int

@dataclass
class TestResult:
    passed: bool
    failures: list[str]
    coverage: float

def tester_with_feedback(state: CodeGenState) -> dict:
    """测试并生成具体反馈"""
    code = state["code"]
    
    # 1. 运行代码
    exec_result = execute_code_safely(code)
    
    # 2. 运行测试
    test_result = run_tests(code)
    
    # 3. 如果失败，生成具体反馈
    if not test_result.passed:
        feedback = analyze_failures(
            code=code,
            failures=test_result.failures
        )
        return {
            "test_result": test_result,
            "feedback": feedback,
        }
    
    return {"test_result": test_result}

def analyze_failures(code: str, failures: list[str]) -> list[str]:
    """分析失败原因，给出具体修改建议"""
    prompt = f"""代码：
{code}

测试失败：
{failures}

请给出具体的修改建议：
1. 哪一行有问题
2. 应该怎么改
3. 为什么"""
    
    return llm.invoke(prompt)
```

**关键改进**：反馈不是笼统的"有问题"，而是"第 15 行应该改成..."。

### 模式三：层级协作（最复杂）

适用场景：大项目，需要"经理"协调。

```
项目经理 Agent
    ├── 分析师 Agent
    ├── 开发组
    │   ├── 前端 Agent
    │   └── 后端 Agent
    └── 测试 Agent
```

实现：

```python
class ProjectState(TypedDict):
    requirement: str
    tasks: list[Task]  # 拆分的任务
    results: dict[str, str]  # 各 Agent 的结果
    status: str

def manager_agent(state: ProjectState) -> dict:
    """项目经理：拆分任务、分配、验收"""
    
    # 1. 拆分任务
    if not state.get("tasks"):
        tasks = decompose_requirement(state["requirement"])
        return {"tasks": tasks}
    
    # 2. 验收结果
    all_done = all(
        task.id in state["results"]
        for task in state["tasks"]
    )
    
    if all_done:
        # 合并结果
        final = merge_results(state["results"])
        return {"status": "completed", "final_result": final}
    
    return {"status": "in_progress"}

def decompose_requirement(requirement: str) -> list[Task]:
    """拆分需求为独立任务"""
    prompt = f"""将以下需求拆分为独立任务：

{requirement}

每个任务应该：
- 有明确的输入输出
- 可以独立完成
- 任务之间依赖关系清晰"""
    
    tasks = llm.invoke(prompt)
    return parse_tasks(tasks)
```

**实际效果**：用户输入"做一个用户系统"，经理拆分为：
- 任务 1：数据库设计（后端 Agent）
- 任务 2：API 开发（后端 Agent）
- 任务 3：前端页面（前端 Agent）
- 任务 4：测试用例（测试 Agent）

## 我踩过的五个坑

### 坑一：状态污染

**问题**：Agent A 写了很多中间变量到状态，Agent B 看晕了。

```python
# 错误示范
def analyst_agent(state):
    return {
        "analysis": "...",
        "temp_1": "...",  # 临时变量
        "temp_2": "...",  # 也存进去了
        "debug_info": "...",  # 调试信息
    }
```

**解决**：每个 Agent 只返回自己的核心输出。

```python
def analyst_agent(state):
    analysis = do_analysis(state["requirement"])
    # 临时变量留在函数内部，不污染状态
    return {"analysis": analysis}  # 只有核心输出
```

### 坑二：无限循环

**问题**：测试失败返回给程序员，程序员改完又失败，无限循环。

```python
# 错误：没有退出条件
def route_after_test(state):
    if state["test_result"].passed:
        return END
    return "coder"  # 可能无限循环
```

**解决**：加迭代上限。

```python
MAX_ITERATIONS = 3

def route_after_test(state):
    if state["test_result"].passed:
        return END
    if state.get("iteration", 0) >= MAX_ITERATIONS:
        return END  # 强制结束
    return "coder"
```

### 坑三：角色重叠

**问题**：两个 Agent 职责模糊，互相覆盖。

```
Coder Agent: 我来写登录逻辑
Designer Agent: 我也写了一份登录逻辑
结果：两份代码冲突
```

**解决**：明确边界。

```python
CODER_PROMPT = """你是程序员，只负责：
- 根据设计实现代码
- 不修改设计
- 有问题反馈给设计师"""

DESIGNER_PROMPT = """你是设计师，只负责：
- 设计架构和数据结构
- 不写实现代码
- 设计完成后交给程序员"""
```

### 坑四：上下文丢失

**问题**：Agent A 做了决策，Agent B 不知道。

```
Analyst: 用户要求用 PostgreSQL
Coder: [用 MySQL 实现]  # 不知道分析师的决策
```

**解决**：关键决策写入状态。

```python
def analyst_agent(state):
    analysis = analyze(state["requirement"])
    
    # 关键决策单独存储
    decisions = {
        "database": "PostgreSQL",
        "framework": "FastAPI",
        "test_framework": "pytest",
    }
    
    return {
        "analysis": analysis,
        "decisions": decisions,  # 后续 Agent 都能看到
    }

def coder_agent(state):
    # 读取决策
    db = state["decisions"]["database"]  # PostgreSQL
    # 按决策实现...
```

### 坑五：工具冲突

**问题**：多个 Agent 同时写同一个文件。

```
Coder A: 写入 main.py
Coder B: 也写入 main.py
结果：后者覆盖前者
```

**解决**：加锁或分工。

```python
# 方案一：文件锁
import fcntl

def safe_write(path: str, content: str):
    with open(path, 'w') as f:
        fcntl.flock(f, fcntl.LOCK_EX)  # 加锁
        f.write(content)
        fcntl.flock(f, fcntl.LOCK_UN)  # 解锁

# 方案二：明确分工
CODER_A_FILES = ["user.py", "auth.py"]
CODER_B_FILES = ["product.py", "order.py"]
```

## 真实案例：jojo-code 的多 Agent 架构

jojo-code 实际用了一个简化版：

```python
class JojoCodeState(TypedDict):
    messages: Annotated[list, merge_lists]
    tool_calls: list
    tool_results: list
    is_complete: bool
    iteration: int

# 实际只有两个"角色"
# 1. thinking_node: 决策（相当于分析师+设计师）
# 2. execute_node: 执行（相当于程序员）

def thinking_node(state):
    """思考节点：决策下一步做什么"""
    # 读取历史
    messages = state["messages"]
    
    # 决策
    response = llm_with_tools.invoke(messages)
    
    # 如果有工具调用，交给执行节点
    if response.tool_calls:
        return {
            "tool_calls": response.tool_calls,
            "is_complete": False,
        }
    
    # 否则完成任务
    return {"is_complete": True}

def execute_node(state):
    """执行节点：运行工具"""
    results = []
    for tc in state["tool_calls"]:
        result = execute_tool(tc["name"], tc["args"])
        results.append(result)
    
    return {"tool_results": results, "tool_calls": []}
```

为什么简化？因为 jojo-code 是 CLI 工具，不需要太复杂的分工。**够用就好，不要过度设计**。

## 什么时候该用多 Agent？

| 场景 | 单 Agent | 多 Agent |
|------|---------|---------|
| 任务简单（问答、查询） | ✅ | ❌ 杀鸡用牛刀 |
| 质量要求高（生产代码） | ❌ | ✅ 每个环节专人把关 |
| 流程固定（生成报告） | ✅ | ⚠️ 可选 |
| 需要迭代（代码审查） | ❌ | ✅ 反馈循环改进 |
| 团队协作（大项目） | ❌ | ✅ 经理协调分工 |

**我的建议**：先单 Agent 跑通，质量不够再拆多 Agent。

## 下一步行动

1. **评估你的任务**：有明显的阶段划分吗？（分析→设计→编码→测试）
2. **从顺序模式开始**：先跑通最简单的流水线
3. **逐步加反馈**：质量不够再加反馈循环
4. **避免过度设计**：够用就好，不要一上来就搞层级架构

多 Agent 不是为了炫技，是为了让每个环节都专业。但专业是有代价的——更多的 Agent、更多的状态管理、更多的调试。

---

一个 Agent 做所有事，就像一个人又当厨师又当服务员又当收银员，效率和 quality 都有限。多 Agent 就是分工协作，每个人专注自己的领域。但分工的前提是：任务复杂到值得分工。
