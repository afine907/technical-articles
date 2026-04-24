# 用 LangGraph 10分钟构建你的第一个 Agent

我之前试过用 LangChain 构建 Agent，代码写了一堆，但还是搞不清楚 Agent 到底是怎么运转的。

直到我用了 LangGraph，才发现原来 Agent 的核心逻辑就那么几行代码。

这篇文章，我来帮你10分钟构建一个能跑的 Agent。

## Agent 是什么？

一句话：**Agent = LLM + 工具 + 循环**。

- LLM 负责决策（调用哪个工具、返回什么回复）
- 工具负责执行（读文件、写代码、搜索等）
- 循环负责迭代（决策→执行→再决策）

传统的方式是写一个 while 循环，但这样代码很难维护。LangGraph 用图的方式来组织这些组件，更清晰。

## 最小 Agent 代码

只需要5步：

### 1. 定义状态

```python
from typing import TypedDict

class AgentState(TypedDict):
    messages: list[dict]
    tool_calls: list[dict]
    is_complete: bool
```

### 2. 定义工具

```python
def read_file(path: str) -> str:
    """读取文件"""
    with open(path) as f:
        return f.read()

tools = [read_file]
```

### 3. 定义节点

```python
def thinking_node(state: AgentState) -> dict:
    """LLM 决策"""
    response = llm.invoke(state["messages"])
    
    # 解析工具调用
    tool_calls = response.tool_calls or []
    
    return {
        "tool_calls": tool_calls,
        "is_complete": len(tool_calls) == 0,
    }

def execute_node(state: AgentState) -> dict:
    """执行工具"""
    results = []
    for tc in state["tool_calls"]:
        result = execute_tool(tc["name"], tc["args"])
        results.append(result)
    
    return {
        "tool_results": results,
        "tool_calls": [],
    }
```

### 4. 定义路由

```python
def should_continue(state: AgentState) -> str:
    """决定下一步"""
    if state["tool_calls"]:
        return "continue"
    if state["is_complete"]:
        return "end"
    return "end"
```

### 5. 构建图

```python
from langgraph.graph import StateGraph, END

# 创建图
workflow = StateGraph(AgentState)

# 添加节点
workflow.add_node("thinking", thinking_node)
workflow.add_node("execute", execute_node)

# 设置入口
workflow.set_entry_point("thinking")

# 添加条件边
workflow.add_conditional_edges(
    "thinking",
    should_continue,
    {"continue": "execute", "end": END}
)

# 执行后返回思考
workflow.add_edge("execute", "thinking")

# 编译
graph = workflow.compile()
```

运行：

```python
initial_state = {
    "messages": [{"role": "user", "content": "读取 README.md"}],
    "tool_calls": [],
    "is_complete": False,
}

result = graph.invoke(initial_state)
print(result["messages"][-1]["content"])
```

## 执行流程

用一个简单的例子说明：

```
用户输入: "读取 README.md"

第1轮: thinking_node
  → LLM 决定调用 read_file("README.md")
  → 返回 {"tool_calls": [{"name": "read_file", ...}]}

第2轮: should_continue
  → tool_calls 非空
  → 返回 "continue"

第3轮: execute_node
  → 执行 read_file("README.md")
  → 返回 {"tool_results": ["文件内容..."]}

第4轮: thinking_node
  → LLM 看到文件内容
  → 决定返回回复
  → 返回 {"is_complete": True}

第5轮: should_continue
  → is_complete = True
  → 返回 "end"

结束
```

## 常见问题

**Q: 为什么 execute 后要回到 thinking？**

A: 因为工具执行完，LLM 需要看结果再决定下一步。比如读取文件后，可能需要分析内容、继续读取其他文件，或直接回复用户。

**Q: 怎么防止无限循环？**

A: 加一个迭代计数器：

```python
def should_continue(state: AgentState) -> str:
    if state.get("iteration", 0) >= 50:
        return "end"
    # ... 其他判断
```

**Q: 怎么让 LLM 调用工具？**

A: 用 `bind_tools`：

```python
llm = ChatOpenAI(model="gpt-4")
llm_with_tools = llm.bind_tools(tools)

response = llm_with_tools.invoke(messages)
tool_calls = response.tool_calls
```

## 我踩过的坑

**坑一：忘了绑定工具**

一开始我直接用 `llm.invoke()`，LLM 根本不知道有哪些工具可用。

解决：用 `llm.bind_tools(tools)` 把工具信息传给 LLM。

**坑二：消息格式不对**

LangGraph 的状态是字典，但 LangChain 的 LLM 需要 Message 对象。

解决：在节点里转换：

```python
from langchain_core.messages import HumanMessage

messages = [HumanMessage(content=m["content"]) for m in state["messages"]]
```

**坑三：状态没更新**

我返回了 `{"tool_results": results}`，但下一轮 `state["tool_results"]` 还是空的。

解决：检查节点返回值是否正确，LangGraph 会自动合并。

## 下一步行动

1. **复制上面的代码**，跑通最小 Agent
2. **加一个工具**，比如写文件或搜索
3. **打印中间状态**，理解每一步发生了什么

完整代码在 jojo-code 的 `src/jojo_code/agent/graph.py`，大概 50 行。

---

Agent 不神秘，就是 LLM + 工具 + 循环。LangGraph 用图的方式把这三者组织起来，代码清晰很多。
