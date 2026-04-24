# 单 Agent 不够用？多 Agent 协作入门

你的任务很复杂：先分析需求，再设计方案，然后写代码，最后测试验证。一个 Agent 做不过来。

我之前做过一个项目：用户输入需求，Agent 要理解需求、设计方案、写代码、写测试、生成文档。单个 Agent 要么代码写得烂，要么测试不全。

后来我改用多 Agent 架构：一个负责设计，一个负责写代码，一个负责测试。效果立刻好很多。

这篇文章，我来分享多 Agent 协作的入门。

## 为什么需要多 Agent？

单个 Agent 的局限：

```
一个 Agent 承担所有角色：
- 分析师：理解需求
- 设计师：设计方案  
- 程序员：写代码
- 测试员：写测试
- 文档员：写文档

结果：每个角色都做得一般，代码质量不稳定
```

多 Agent 的优势：

```
每个 Agent 专注一件事：
- Analyst Agent：专注需求分析
- Designer Agent：专注方案设计
- Coder Agent：专注写代码
- Tester Agent：专注测试

结果：每个角色都做得专业，整体质量提升
```

## 最简单的多 Agent 架构

**顺序执行**：Agent A → Agent B → Agent C

```python
from langgraph.graph import StateGraph

class MultiAgentState(TypedDict):
    requirement: str
    design: str
    code: str
    test_result: str

# 定义 Agent
def analyst_agent(state: dict) -> dict:
    """分析需求"""
    requirement = state["requirement"]
    analysis = llm.invoke(f"分析需求：{requirement}")
    return {"analysis": analysis}

def designer_agent(state: dict) -> dict:
    """设计方案"""
    analysis = state["analysis"]
    design = llm.invoke(f"根据分析设计方案：{analysis}")
    return {"design": design}

def coder_agent(state: dict) -> dict:
    """写代码"""
    design = state["design"]
    code = llm.invoke(f"根据设计写代码：{design}")
    return {"code": code}

# 构建流程
workflow = StateGraph(MultiAgentState)
workflow.add_node("analyst", analyst_agent)
workflow.add_node("designer", designer_agent)
workflow.add_node("coder", coder_agent)

workflow.set_entry_point("analyst")
workflow.add_edge("analyst", "designer")
workflow.add_edge("designer", "coder")
workflow.add_edge("coder", END)

graph = workflow.compile()

# 运行
result = graph.invoke({"requirement": "写一个用户登录功能"})
```

执行流程：

```
用户需求 → Analyst Agent（分析）→ Designer Agent（设计）→ Coder Agent（编码）→ 输出
```

## Agent 之间怎么传递信息？

多 Agent 协作的核心：**共享状态**。

```python
class SharedState(TypedDict):
    # 所有 Agent 都能访问
    requirement: str      # 原始需求
    analysis: str         # 分析结果
    design: str           # 设计方案
    code: str             # 代码
    feedback: list[str]   # 反馈历史
```

每个 Agent 从状态读取需要的，写入自己的结果：

```python
def coder_agent(state: SharedState) -> dict:
    """写代码的 Agent"""
    # 读取设计
    design = state["design"]
    
    # 读取之前的反馈
    feedback = state.get("feedback", [])
    
    # 生成代码
    prompt = f"""
设计方案：
{design}

之前的反馈：
{feedback}

请根据设计和反馈编写代码。
"""
    code = llm.invoke(prompt)
    
    # 写入状态
    return {"code": code}
```

## Agent 之间怎么协作？

### 模式一：顺序传递

一个接一个，线性流程。

```
分析 → 设计 → 编码 → 测试
```

适合：流程固定的任务。

### 模式二：反馈循环

后面的 Agent 发现问题，让前面的 Agent 重新做。

```python
def tester_agent(state: SharedState) -> dict:
    """测试 Agent"""
    code = state["code"]
    
    # 运行测试
    test_result = run_tests(code)
    
    if test_result.failed:
        # 测试失败，返回反馈
        return {
            "feedback": [f"测试失败：{test_result.error}"],
            "next_agent": "coder"  # 让编码 Agent 重做
        }
    
    return {"test_result": "passed"}

# 路由
def should_retry(state: SharedState) -> str:
    if state.get("feedback"):
        return "coder"  # 返回编码
    return "end"
```

适合：需要迭代改进的任务。

### 模式三：人机协作

关键节点让人类确认。

```python
def designer_agent(state: SharedState) -> dict:
    design = generate_design(state["requirement"])
    
    # 等待人类确认
    user_approval = input(f"设计方案：\n{design}\n\n确认？(y/n): ")
    
    if user_approval.lower() != "y":
        # 用户不满意，重新设计
        return {"feedback": ["用户不满意，重新设计"]}
    
    return {"design": design}
```

适合：重要决策需要人工确认。

## 使用 AutoGen 简化开发

微软的 AutoGen 专门做多 Agent 协作：

```python
from autogen import AssistantAgent, UserProxyAgent

# 定义 Agent
analyst = AssistantAgent(
    name="Analyst",
    system_message="你是一个需求分析师，负责理解和分析用户需求。",
    llm_config={"model": "gpt-4"}
)

coder = AssistantAgent(
    name="Coder", 
    system_message="你是一个程序员，根据设计方案编写代码。",
    llm_config={"model": "gpt-4"}
)

user = UserProxyAgent(
    name="User",
    human_input_mode="NEVER",  # 不需要人工输入
)

# 创建群聊
from autogen import GroupChat, GroupChatManager

groupchat = GroupChat(
    agents=[user, analyst, coder],
    messages=[],
    max_round=10
)

manager = GroupChatManager(groupchat=groupchat)

# 启动对话
user.initiate_chat(
    manager,
    message="请帮我写一个用户登录功能"
)
```

AutoGen 会自动协调 Agent 之间的对话。

## 我踩过的坑

**坑一：Agent 角色重叠**

我让两个 Agent 都"写代码"，结果互相覆盖。

解决：明确每个 Agent 的职责边界。

**坑二：状态污染**

一个 Agent 写了太多东西到状态，另一个 Agent 看晕了。

解决：每个 Agent 只写自己的输出，不修改其他字段。

**坑三：无限循环**

Tester 发现问题返回给 Coder，Coder 改完又返回给 Tester，无限循环。

解决：加最大迭代次数：

```python
if state.get("iteration", 0) > 3:
    return "end"  # 强制结束
```

## 什么时候用多 Agent？

```
单 Agent 适合：
- 任务简单、流程固定
- 快速原型验证
- 资源有限

多 Agent 适合：
- 任务复杂、需要多种能力
- 质量要求高
- 流程可以标准化
```

建议：先用单 Agent 跑通，再考虑拆分多 Agent。

## 下一步行动

1. **分析你的任务**：有没有明显的阶段划分？（分析→设计→编码→测试）
2. **定义 Agent 角色**：每个 Agent 专注一件事
3. **设计状态结构**：Agent 之间怎么传递信息
4. **从简单的顺序流程开始**：先跑通，再加复杂度

多 Agent 不是为了炫技，是为了让每个环节都专业。

---

一个 Agent 做所有事，就像一个人又当厨师又当服务员又当收银员。多 Agent 就是分工协作，每个人专注自己的领域。
