# Agent 状态管理设计

在大语言模型（LLM）Agent 系统中，状态管理是核心基础设施之一。它决定了 Agent 如何维护对话上下文、如何协调多轮对话中的思考与执行、以及如何在不同阶段之间进行状态转移。本文深入探讨 Agent 状态管理的必要性、基本设计模式，并结合 jojo-code 的具体实现进行分析。

## 1. 状态管理的必要性

### 1.1 多轮对话的上下文维护

LLM Agent 的核心竞争力在于能够进行多轮对话。与单轮问答不同，多轮对话需要 Agent 记住之前的对话历史、用户偏好以及任务进展。状态管理正是解决这一问题的关键。

考虑一个典型场景：用户让 Agent 帮助编写一个 Web 应用。Agent 可能需要：

1. 首先询问用户需求细节
2. 根据回答调整方案
3. 创建项目结构
4. 编写代码文件
5. 运行测试验证

如果缺乏状态管理，Agent 每次交互都会重新从零开始，无法记住"用户想要 Web 应用"这一关键上下文。通过状态管理，Agent 可以在 `messages` 字段中累积对话历史，在 `iteration` 字段中跟踪任务阶段。

### 1.2 工具调用的状态追踪

现代 Agent 的一个重要能力是调用外部工具完成复杂任务。然而，工具调用涉及多个状态：

- **待执行的工具调用**：`tool_calls` 字段存储需要执行的工具及其参数
- **工具执行结果**：`tool_results` 字段存储每个工具的返回结果
- **执行状态**：`is_complete` 字段判断任务是否完成

这些状态需要在不同节点之间传递。以 jojo-code 为例，其执行流程是：

```
用户消息 -> thinking_node (决策) -> execute_node (执行工具) -> thinking_node (评估结果) -> ... -> 完成
```

每个阶段的状态都需要正确传递和更新，这就是状态管理要解决的问题。

### 1.3 上下文边界与资源控制

LLM 有上下文长度限制，状态管理还需要解决上下文边界问题：

- **消息历史截断**：当对话历史过长时，需要智能裁剪
- **迭代次数控制**：防止无限循环，需要 `iteration` 字段追踪循环次数
- **资源清理**：工具执行结果在用完后需要清理，避免上下文膨胀

jojo-code 中设置了最大迭代次数 `MAX_ITERATIONS = 50`，并在 `should_continue` 函数中检查是否达到上限。

## 2. 状态设计模式

### 2.1 状态机模式

状态机是最基础的状态管理模型。Agent 被建模为一个有限状态机，每个状态代表 Agent 的一个执行阶段：

```
┌─────────────┐
│   IDLE      │  初始状态
└──────┬──────┘
       │ 用户输入
       ▼
┌─────────────┐
│  THINKING   │  思考/决策
└──────┬──────┘
       │
       ▼
┌─────────────┐
│ EXECUTING    │  执行工具
└──────┬──────┘
       │
       ▼
   ┌───────┐
   │COMPLETE │  或返回 THINKING
   └───────┘
```

状态机模式优点：
- 状态转换清晰，易于理解和调试
- 实现简单，适合确定性流程

缺点：
- 难以处理复杂分支和条件逻辑
- 不适合需要灵活判断的 Agent

### 2.2 状态图模式

状态图是状态机的扩展，允许更灵活的状态转移。在 LangGraph 等框架中，状态图成为主流设计：

```
LangGraph 状态图结构：

     ┌──────────────┐
     │   START     │
     └──────┬──────┘
            │
            ▼
     ┌──���───────────┐
     │  thinking   │◄────┐
     └──────┬──────┘     │
            │            │
       ┌────┴────┐       │
       ▼         ▼       │
  ┌────────┐ ┌──────┐   │
  │continue│ │ end  │   │
  └──┬─────┘ └──┬───┘   │
     │          │       │
     ▼          ▼       │
  ┌────────┐ ┌─────┐    │
  │execute │ │ END │    │
  └───┬────┘ └─────┘    │
      │                 │
      └─────────────────┘
```

状态图的核心概念：

- **节点（Node）**：状态图中的一个执行单元，如 thinking_node、execute_node
- **边（Edge）**：节点之间的转移关系
- **条件边（Conditional Edge）**：根据状态动态决定下一个节点

### 2.3 状态转移机制

状态转移是状态管理的核心。有两种主要机制：

**1. 函数式更新**

每个节点是一个函数，接收当前状态，返回状态更新：

```python
def thinking_node(state: AgentState) -> dict[str, Any]:
    """思考节点：更新状态"""
    return {
        "messages": new_messages,
        "tool_calls": tool_calls,
        "is_complete": is_complete,
        "iteration": state["iteration"] + 1,
    }
```

这种模式的优点是纯粹、易于组合。

**2. 归约器模式（Reducer）**

使用归约器合并状态更新。LangGraph 支持这种模式：

```python
from typing import Annotated

def merge_lists(left: list[Any] | None, right: list[Any] | None) -> list[Any]:
    """合并列表（Annotated reducer）"""
    if left is None:
        left = []
    if right is None:
        right = []
    return left + right

class AgentState(TypedDict):
    messages: Annotated[list[dict[str, Any]], merge_lists]
    tool_calls: list[dict[str, Any]]
```

归约器的特点是：
- 支持增量更新
- 可以处理并发更新
- 天然支持时间旅行调试

## 3. jojo-code 的 AgentState 实现

### 3.1 TypedDict 定义

jojo-code 使用 Python 的 `TypedDict` 定义 AgentState：

```python
from typing import Annotated, Any
from typing_extensions import TypedDict

class AgentState(TypedDict):
    """Agent 状态

    Attributes:
        messages: 对话历史
        tool_calls: 待执行的工具调用
        tool_results: 工具执行结果
        is_complete: 任务是否完成
        iteration: 当前循环次数
    """

    messages: Annotated[list[dict[str, Any]], merge_lists]
    tool_calls: list[dict[str, Any]]
    tool_results: list[str]
    is_complete: bool
    iteration: int
    # 模式控制：build / plan
    mode: str
```

关键设计点：

- **`messages` 使用 Annotated + reducer**：`Annotated[list[dict[str, Any]], merge_lists` 使得每次状态更新都追加而非替换消息历史
- **状态字段精简**：每个字段都有明确用途，避免不必要的数据膨胀

### 3.2 状态字段设计分析

| 字段 | 类型 | 用途 |
|------|------|------|
| `messages` | `Annotated[list, merge_lists]` | 对话历史累积 |
| `tool_calls` | `list[dict]` | 待执行工具 |
| `tool_results` | `list[str]` | 工具执行结果 |
| `is_complete` | `bool` | 任务完成标志 |
| `iteration` | `int` | 循环次数追踪 |
| `mode` | `str` | 模式控制 |

### 3.3 初始状态创建

```python
from jojo_code.agent.modes import PlanMode

def create_initial_state(user_message: str, mode: str = PlanMode.BUILD.value) -> AgentState:
    """创建初始状态

    Args:
        user_message: 用户输入消息

    Returns:
        初始化的 Agent 状态
    """
    return AgentState(
        messages=[{"role": "user", "content": user_message}],
        tool_calls=[],
        tool_results=[],
        is_complete=False,
        iteration=0,
        mode=mode,
    )
```

初始状态设置了合理的默认值：
- `iteration=0`：从零开始计数
- `is_complete=False`：任务默认未完成
- `tool_calls=[]` 和 `tool_results=[]`：空列表，避免空值检查

### 3.4 模式控制：BUILD vs PLAN

jojo-code 引入了独特的模式控制机制：

```python
class PlanMode(StrEnum):
    BUILD = "build"   # 可以执行写操作
    PLAN = "plan"     # 只读、分析计划
```

这种设计的应用场景：
- **PLAN 模式**：用户只想要看计划，不希望实际执行
- **BUILD 模式**：实际执行操作

在 `thinking_node` 中：

```python
if mode == PlanMode.PLAN.value:
    # Plan 模式：不绑定工具，LLM 只给出计划文本
    llm_with_tools = llm
else:
    llm_with_tools = llm.bind_tools(tools) if tools else llm
```

## 4. LangGraph 的状态管理机制

### 4.1 LangGraph 核心概念

LangGraph 是 LangChain 团队开发的状态图框架，专为 Agent 设计。其核心概念：

- **StateGraph**：状态图容器
- **Node**：节点函数，接收状态返回更新
- **Edge**：边，定义节点转移
- **Conditional Edge**：条件边，基于状态动态选择目标

### 4.2 状态图构建

jojo-code 的状态图定义：

```python
from langgraph.graph import END, StateGraph
from langgraph.graph.state import CompiledStateGraph

def build_agent_graph() -> CompiledStateGraph[AgentState, None, AgentState, AgentState]:
    """构建 Agent 状态图

    图结构:
        START -> thinking -> [continue -> execute -> thinking] or [end -> END]
    """
    # 创建状态图
    workflow = StateGraph(AgentState)

    # 添加节点
    workflow.add_node("thinking", thinking_node)
    workflow.add_node("execute", execute_node)

    # 设置入口点
    workflow.set_entry_point("thinking")

    # 添加条件边
    workflow.add_conditional_edges(
        "thinking",
        should_continue,
        {
            "continue": "execute",
            "end": END,
        },
    )

    # 执行后返回思考
    workflow.add_edge("execute", "thinking")

    return workflow.compile()
```

### 4.3 路由函数

状态图使用路由函数（Router）决定状态转移：

```python
from typing import Literal

def should_continue(state: AgentState) -> Literal["continue", "end"]:
    """路由函数：决定是否继续循环"""
    # 有工具调用则继续
    if state["tool_calls"]:
        return "continue"

    # 任务完成
    if state["is_complete"]:
        return "end"

    # 达到最大迭代次数
    if state["iteration"] >= MAX_ITERATIONS:
        return "end"

    return "end"
```

路由逻辑：
1. 有待执行工具 → 继续（execute）
2. 任务完成 → 结束
3. 达到迭代上限 → 结束
4. 其他情况 → 结束

### 4.4 节点实现

**Thinking Node**：

```python
def thinking_node(state: AgentState) -> dict[str, Any]:
    """思考节点：调用 LLM 决定下一步行动"""
    llm = get_llm()
    registry = get_tool_registry()

    # 转换消息格式
    messages: list[BaseMessage] = []
    for msg in state["messages"]:
        if isinstance(msg, dict):
            role = msg.get("role", "user")
            content = msg.get("content", "")
            if role == "user":
                messages.append(HumanMessage(content=content))
            elif role == "assistant":
                messages.append(AIMessage(content=content))
            # ...

    # 添加工具结果到消息
    tool_calls = state.get("tool_calls", [])
    for i, result in enumerate(state["tool_results"]):
        tool_call_id = tool_calls[i].get("id", f"call_{i}") if i < len(tool_calls) else f"call_{i}"
        messages.append(ToolMessage(content=result, tool_call_id=tool_call_id))

    # 调用 LLM
    response = llm_with_tools.invoke(messages)

    # 处理工具调用
    tool_calls: list[dict[str, Any]] = []
    if hasattr(response, "tool_calls") and response.tool_calls:
        for tc in response.tool_calls:
            tool_calls.append({
                "name": tc["name"],
                "args": tc["args"],
                "id": tc.get("id", "call_" + str(len(tool_calls))),
            })

    # 判断是否完成
    is_complete = len(tool_calls) == 0

    return {
        "messages": new_messages,
        "tool_calls": tool_calls,
        "tool_results": [],  # 清空上一次的结果
        "is_complete": is_complete,
        "iteration": state["iteration"] + 1,
    }
```

**Execute Node**：

```python
def execute_node(state: AgentState) -> dict[str, Any]:
    """执行节点：运行工具调用"""
    registry = get_tool_registry()
    results: list[str] = []

    for tool_call in state["tool_calls"]:
        try:
            result = registry.execute(tool_call["name"], tool_call["args"])
            results.append(result)
        except Exception as e:
            results.append(f"Error executing {tool_call.get('name', 'unknown')}: {e}")

    return {
        "tool_results": results,
        "tool_calls": [],  # 清空工具调用
    }
```

### 4.5 LangGraph 的状态归约

LangGraph 自动处理状态归约。当节点返回部分状态时，LangGraph 会：

1. **读取当前状态**：获取完整的状态对象
2. **应用更新**：���节点返回的字典与当前状态合并
3. **使用 Annotated 归约器**：如果字段使用 Annotated 定义了 reducer，则使用 reducer 合并

例如，`messages` 字段使用 `merge_lists` reducer，所以每次更新都会追加新消息而非替换整个列表。

## 5. 代码示例和最佳实践

### 5.1 基础状态管理

以下是使用 jojo-code 的基本示例：

```python
from jojo_code.agent.state import create_initial_state, AgentState
from jojo_code.agent.graph import get_agent_graph

# 创建初始状态
initial_state = create_initial_state(
    user_message="帮我创建一个Python Web应用",
    mode="build"
)

# 获取图实例
graph = get_agent_graph()

# 执行图
result = graph.invoke(initial_state)

# 查看最终状态
print(f"迭代次数: {result['iteration']}")
print(f"是否完成: {result['is_complete']}")
print(f"消息数: {len(result['messages'])}")
```

### 5.2 自定义状态字段

扩展 AgentState 添加自定义字段：

```python
from typing import Annotated, Any
from typing_extensions import TypedDict

def merge_conversation(left: list, right: list) -> list:
    """自定义归约器：保留最近N条消息"""
    MAX_HISTORY = 20
    combined = left + right
    return combined[-MAX_HISTORY:]

class CustomAgentState(TypedDict):
    messages: Annotated[list[dict[str, Any]], merge_conversation]
    
    # 新增字段：用户偏好
    user_preferences: dict[str, Any]
    
    # 新增字段：会话ID
    session_id: str
```

### 5.3 状态检查点

实现状态保存和恢复：

```python
import json
from pathlib import Path

def save_checkpoint(state: AgentState, path: str) -> None:
    """保存状态检查点"""
    # 确保 JSON 兼容（转换特定类型）
    serializable_state = {
        **state,
        "messages": state.get("messages", []),
    }
    Path(path).write_text(json.dumps(serializable_state, ensure_ascii=False))

def load_checkpoint(path: str) -> AgentState:
    """加载状态检查点"""
    content = Path(path).read_text()
    return json.loads(content)
```

### 5.4 状态迁移

当状态结构变化时，需要迁移旧状态：

```python
def migrate_state(old_state: dict) -> AgentState:
    """状态迁移：从旧格式迁移到新格式"""
    migration_version = old_state.get("version", 0)
    
    new_state = {
        "messages": old_state.get("messages", []),
        "tool_calls": old_state.get("tool_calls", []),
        "tool_results": old_state.get("tool_results", []),
        "is_complete": old_state.get("is_complete", False),
        "iteration": old_state.get("iteration", 0),
        "mode": old_state.get("mode", "build"),
    }
    
    # v0 -> v1 迁移
    if migration_version < 1:
        if "context" in old_state:
            # 将 context 字段转换为 preferences
            new_state["user_preferences"] = old_state["context"]
    
    return new_state
```

### 5.5 最佳实践总结

1. **使用 TypedDict 定义状态**
   - 提供类型提示和 IDE 自动补全
   - 便于文档化和代码审查

2. **合理使用 Annotated Reducer**
   - 列表类型优先使用归约器合并而非替换
   - 避免状态覆盖导致数据丢失

3. **设置边界条件**
   - 最大迭代次数防止无限循环
   - 消息历史上限防止上下文膨胀

4. **模式控制解耦**
   - PLAN/BUILD 模式分离计划和执行
   - 便于安全审计和用户控制

5. **状态可观测性**
   - 添加迭代计数便于调试
   - 记录状态转移日志

6. **定期清理状态**
   - 工具结果用完后及时清空
   - 释放不再需要的��间��态

## 6. 总结

状态管理是 Agent 系统的基石。它解决了多轮对话、工具调用和上下文维护等核心问题。jojo-code 通过 TypedDict + LangGraph 的组合，提供了简洁而强大的状态管理方案：

- **TypedDict** 定义清晰的状态结构
- **Annotated Reducer** 实现灵活的状态合并
- **StateGraph** 构建可维护的状态图
- **模式控制** 支持安全的计划执行分离

理解并合理运用这些设计模式，能够构建出更加可靠和可控的 Agent 系统。