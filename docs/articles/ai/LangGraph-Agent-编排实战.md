# LangGraph Agent 编排实战

LangGraph 是 LangChain 生态中的图状工作流编排框架，适用于构建可控、可观测的 Agent 系统。本文以 jojo-code 项目为例，详解 LangGraph Agent 的编排实现。

## 1. LangGraph 概述

### 1.1 为什么选择 LangGraph

相比传统的链式调用（Chain），LangGraph 的核心优势：

| 特性 | Chain | LangGraph |
|------|-------|----------|
| 执行模型 | 线性序列 | 有向图 |
| 循环支持 | 无 | 原生支持 |
| 状态管理 | 外部传入 | 内置状态流 |
| 中断/恢复 | 困难 | 天然支持 |
| 流程控制 | 固定 | 条件路由 |

对于 Agent 场景，需要「思考-执行-再思考」的循环机制，LangGraph 的图模型天然适配这一需求。

### 1.2 核心概念

- **StateGraph**：状态图容器，定义整个工作流
- **Node**：节点，代表一个处理单元
- **Edge**：边，连接节点定义流向
- **State**：状态，在节点间流转的共享数据
- **Reducer**：状态合并策略，定义如何更新状态

## 2. StateGraph 构建流程

### 2.1 定义状态

使用 TypedDict 定义状态类型：

```python
from typing_extensions import TypedDict
from typing import Annotated, Any

class AgentState(TypedDict):
    messages: Annotated[list[dict[str, Any]], merge_lists]
    tool_calls: list[dict[str, Any]]
    tool_results: list[str]
    is_complete: bool
    iteration: int
    mode: str

def merge_lists(left: list[Any] | None, right: list[Any] | None) -> list[Any]:
    if left is None:
        left = []
    if right is None:
        right = []
    return left + right
```

关键点：
- `messages` 使用 `Annotated` + reducer 实现消息追加而非覆盖
- 其他字段使用默认策略（新值替换旧值）

### 2.2 添加节点

```python
workflow = StateGraph(AgentState)

workflow.add_node("thinking", thinking_node)
workflow.add_node("execute", execute_node)
```

节点可以是普通函数或带状态的类：
- 函数签名：`def node(state: AgentState) -> dict[str, Any]`
- 返回状态片段（Partial），LangGraph 自动合并到全局状态

### 2.3 添加边

无条件的静态边：
```python
workflow.set_entry_point("thinking")      # 入口点
workflow.add_edge("execute", "thinking")  # 执行后返回思考
```

条件边（动态路由）：
```python
workflow.add_conditional_edges(
    "thinking",
    should_continue,  # 路由函数
    {
        "continue": "execute",
        "end": END,
    },
)
```

### 2.4 编译

```python
return workflow.compile()
```

编译后的图可直接调用：`graph.invoke({"messages": [...]})`

## 3. jojo-code 的 Agent Graph 实现

### 3.1 图结构

```
START → thinking → [条件路由] → execute → thinking → ... → END
                    │
                    ├── continue: execute
                    └── end: END
```

实际代码（`graph.py:10-42`）：

```python
def build_agent_graph() -> CompiledStateGraph[AgentState, None, AgentState, AgentState]:
    workflow = StateGraph(AgentState)

    # 添加节点
    workflow.add_node("thinking", thinking_node)
    workflow.add_node("execute", execute_node)

    # 入口点
    workflow.set_entry_point("thinking")

    # 条件边：从 thinking 根据 should_continue 决定去向
    workflow.add_conditional_edges(
        "thinking",
        should_continue,
        {
            "continue": "execute",
            "end": END,
        },
    )

    # 执行后返回思考节点，形成循环
    workflow.add_edge("execute", "thinking")

    return workflow.compile()
```

### 3.2 路由实现

`should_continue` 函数（`nodes.py:166-187`）：

```python
def should_continue(state: AgentState) -> Literal["continue", "end"]:
    if state["tool_calls"]:
        return "continue"
    if state["is_complete"]:
        return "end"
    if state["iteration"] >= MAX_ITERATIONS:
        return "end"
    return "end"
```

路由逻辑：
1. 有待执行工具 → 继续执行
2. 任务标记完成 → 结束
3. 达到最大迭代次数 → 结束
4. 其他情况 → 结束

### 3.3 单例模式

`graph.py:46-54` 提供全局图实例：

```python
_graph: CompiledStateGraph[AgentState, None, AgentState, AgentState] | None = None

def get_agent_graph() -> CompiledStateGraph[AgentState, None, AgentState, AgentState]:
    global _graph
    if _graph is None:
        _graph = build_agent_graph()
    return _graph
```

## 4. 节点实现详解

### 4.1 thinking_node - LLM 调用

核心逻辑（`nodes.py:36-135`）：

```python
def thinking_node(state: AgentState) -> dict[str, Any]:
    llm = get_llm()
    registry = get_tool_registry()
    mode = state.get("mode", PlanMode.BUILD.value)

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
            else:
                messages.append(HumanMessage(content=content))
        else:
            messages.append(msg)

    # 添加工具结果到消息
    for i, result in enumerate(state["tool_results"]):
        tool_call_id = tool_calls[i].get("id", f"call_{i}") if i < len(tool_calls) else f"call_{i}"
        messages.append(ToolMessage(content=result, tool_call_id=tool_call_id))

    # 绑定工具
    tools = registry.get_langchain_tools()
    if mode == PlanMode.PLAN.value:
        llm_with_tools = llm  # PLAN 模式不绑定工具
    else:
        llm_with_tools = llm.bind_tools(tools) if tools else llm

    # 调用 LLM
    response = llm_with_tools.invoke(messages)

    # 解析工具调用
    tool_calls: list[dict[str, Any]] = []
    if hasattr(response, "tool_calls") and response.tool_calls:
        for tc in response.tool_calls:
            tool_calls.append({
                "name": tc["name"],
                "args": tc["args"],
                "id": tc.get("id", "call_" + str(len(tool_calls))),
            })

    # 判断完成
    is_complete = len(tool_calls) == 0

    return {
        "messages": new_messages,
        "tool_calls": tool_calls,
        "tool_results": [],
        "is_complete": is_complete,
        "iteration": state["iteration"] + 1,
    }
```

关键处理：
1. **消息转换**：将字典格式转为 LangChain 消息对象
2. **上下文注入**：将工具执行结果填入消息历史
3. **模式支持**：PLAN 模式下阻止写操作工具
4. **工具调用解析**：提取 LLM 返回的工具调用

### 4.2 execute_node - 工具执行

核心逻辑（`nodes.py:138-163`）：

```python
def execute_node(state: AgentState) -> dict[str, Any]:
    registry = get_tool_registry()
    results: list[str] = []

    for tool_call in state["tool_calls"]:
        try:
            if "name" not in tool_call or "args" not in tool_call:
                results.append("Error: tool_call missing 'name' or 'args' key")
                continue
            result = registry.execute(tool_call["name"], tool_call["args"])
            results.append(result)
        except Exception as e:
            results.append(f"Error executing {tool_call.get('name', 'unknown')}: {e}")

    return {
        "tool_results": results,
        "tool_calls": [],  # 清空工具调用
    }
```

关键处理：
1. **遍历执行**：逐个执行工具调用
2. **错误捕获**：单个工具失败不影响其他
3. **结果收集**：返回执行结果供 thinking 节点使用

### 4.3 PLAN 模式特殊处理

在 PLAN 模式下，写操作工具被阻止执行（`nodes.py:96-118`）：

```python
if mode == PlanMode.PLAN.value and tool_calls:
    write_tools = [
        tc for tc in tool_calls if registry._tool_categories.get(tc["name"], "read") == "write"
    ]
    if write_tools:
        plan_ops = []
        for tc in write_tools:
            plan_ops.append(f"{tc['name']}({tc['args']})")
        plan_text = (
            "Plan 模式阻止写操作。将要执行的写操作: "
            + ", ".join(plan_ops)
            + ". 这是只读计划，实际执行将切换回 BUILD 模式或继续分析。"
        )
        return {
            "messages": [{"role": "assistant", "content": plan_text}],
            "tool_calls": [],
            "tool_results": [],
            "is_complete": True,
            "iteration": state["iteration"] + 1,
        }
```

## 5. 完整代码示例和流程图

### 5.1 端到端调用示例

```python
from jojo_code.agent.graph import get_agent_graph
from jojo_code.agent.state import create_initial_state

# 获取图实例
graph = get_agent_graph()

# 创建初始状态
initial_state = create_initial_state(
    user_message="请帮我读取当前目录下的所有 Python 文件",
    mode="build"
)

# 执行
result = graph.invoke(initial_state)

# 查看结果
print(result["messages"])
```

### 5.2 执行流程图

```
┌─────────────────────────────────────────────────────────────┐
│                      用户输入                               │
└─────────────────────┬───────────────────────────────────────┘
                      ▼
┌─────────────────────────────────────────────────────────────┐
│                    thinking_node                             │
│  ┌─────────────────────────────────────────────────────┐   │
│  │ 1. 读取 messages + tool_results                    │   │
│  │ 2. 调用 LLM（有/无工具）                            │   │
│  │ 3. 解析 tool_calls                                 │   │
│  │ 4. 判断 is_complete                               │   │
│  └─────────────────────────────────────────────────────┘   │
└──────┬──────────────────────┬───────────────────────────────┘
       │                      │
       ▼                      ▼
┌──────────────┐      ┌──────────────┐
│ tool_calls   │      │ is_complete  │
│ 非空         │      │ = true      │
└──────┬───────┘      └──────┬───────┘
       │                     │
       ▼                     ▼
┌──────────────────────────────────────────────────────────────┐
│                   should_continue 路由                        │
│  - tool_calls 非空 → "continue"                              │
│  - is_complete = true → "end"                                │
│  - iteration >= 50 → "end"                                   │
└──────────────────────┬─────────────────────────────────────────┘
                       │
              ┌────────┴────────┐
              ▼                 ▼
    ┌─────────────────┐  ┌──────────┐
    │ execution_node │  │   END    │
    │                │  │          │
    │ 1. 遍历执行     │  │ 任务结束 │
    │ 2. 捕获异常     │  └──────────┘
    │ 3. 收集结果    │
    └────────┬──────┘
             │
             ▼
      返回 thinking_node
```

### 5.3 状态流转

```
初始状态
├── messages: [{role: "user", content: "用户输入"}]
├── tool_calls: []
├── tool_results: []
├── is_complete: false
├── iteration: 0
└── mode: "build"

    ▼ thinking_node

中间状态 (第N轮)
├── messages: [..., {role: "assistant", content: "调用工具"}, ...]
├── tool_calls: [{"name": "read_file", "args": {"path": "xxx.py"}}]
├── tool_results: []
├── is_complete: false
├── iteration: N
└── mode: "build"

    ▼ execution_node

工具执行后
├── messages: [..., {role: "assistant", content: "调用工具"}, ...]
├── tool_calls: []
├── tool_results: ["文件内容..."]
├── is_complete: false
├── iteration: N
└── mode: "build"

    ▼ thinking_node (继续循环或结束)

最终状态
├── messages: [..., {role: "assistant", content: "最终回复"}]
├── tool_calls: []
├── tool_results: []
├── is_complete: true
└── iteration: N
```

## 总结

LangGraph 为 Agent 编排提供了清晰的图模型：

1. **状态定义**：TypedDict + Reducer 实现灵活的状态管理
2. **图构建**：add_node + add_edge + add_conditional_edges 构建工作流
3. **条件路由**：函数返回路由标签，LangGraph 自动分发
4. **循环机制**：execute → thinking 边形成天然的 Agent 循环

jojo-code 的实现展示了 LLM Agent 的典型模式：LLM 决策 → 工具执行 → 结果反馈 → 再次决策。理解这一模式对构建其他 Agent 系统有重要参考价值。