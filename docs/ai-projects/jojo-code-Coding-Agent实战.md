---
sidebar_position: 1
title: jojo-code 从零实现 Coding Agent
slug: jojo-code-coding-agent
---

# jojo-code 从零实现 Coding Agent

> Claude Code、Cursor、Windsurf 这些 AI 编码工具到底是怎么实现的？与其天天用别人的工具，不如自己造一个。jojo-code 就是这样一个项目——从零实现一个轻量级的 AI Coding Agent，100% Python，LangGraph 状态机驱动，Textual TUI 界面，WebSocket 服务端。

## 一、项目定位

```
┌──────────────────────────────────────────────────────┐
│  jojo-code vs 其他 Coding Agent                       │
│                                                       │
│  Claude Code    — Anthropic 官方，功能最强             │
│  Cursor         — IDE 集成，编辑体验最好               │
│  Aider          — 终端工具，Git 集成好                 │
│  jojo-code      — 学习项目，架构最清晰                 │
│                                                       │
│  核心目标：理解 Coding Agent 的核心原理                 │
│  技术栈：Python + LangGraph + Textual + WebSocket     │
└──────────────────────────────────────────────────────┘
```

## 二、核心架构

```
┌─────────────────────────────────────────────────────────┐
│                    jojo-code 架构                         │
│                                                          │
│  ┌──────────┐    ┌──────────┐    ┌──────────┐          │
│  │ TUI 界面  │───→│ WebSocket│───→│ Agent    │          │
│  │(Textual)  │    │  Server  │    │ Engine   │          │
│  └──────────┘    └──────────┘    └────┬─────┘          │
│                                       │                  │
│                              ┌────────┴────────┐        │
│                              ↓                  ↓        │
│                        ┌──────────┐    ┌──────────┐    │
│                        │ LangGraph│    │ Tool     │    │
│                        │ 状态机    │    │ Registry │    │
│                        └──────────┘    └──────────┘    │
│                              │                  │        │
│                              ↓                  ↓        │
│                        ┌──────────┐    ┌──────────┐    │
│                        │ LLM API  │    │ 文件/终端 │    │
│                        │ (多模型)  │    │ 工具集   │    │
│                        └──────────┘    └──────────┘    │
└─────────────────────────────────────────────────────────┘
```

## 三、LangGraph 状态机

### 3.1 状态定义

```python
from typing import TypedDict, Annotated, Sequence
from langgraph.graph import StateGraph, END
from langgraph.graph.message import add_messages

class AgentState(TypedDict):
    messages: Annotated[Sequence, add_messages]
    current_tool: str | None
    tool_results: list
    iteration: int
    max_iterations: int

# 状态流转图
"""
[START] → think → decide → act → observe → decide
                          ↑                │
                          │   ┌────────────┘
                          │   ↓
                          └── (循环直到完成或达到最大迭代次数)
                                    ↓
                                  [END]
"""
```

### 3.2 状态机实现

```python
from langchain_openai import ChatOpenAI

llm = ChatOpenAI(model="gpt-4o", temperature=0)

def think_node(state: AgentState) -> dict:
    """思考节点 - 调用 LLM 分析当前状态"""
    response = llm.invoke(state["messages"])
    return {
        "messages": [response],
        "iteration": state["iteration"] + 1,
    }

def decide_node(state: AgentState) -> str:
    """决策节点 - 决定下一步行动"""
    last_message = state["messages"][-1]

    # 检查是否需要调用工具
    if last_message.tool_calls:
        return "act"

    # 检查是否达到最大迭代次数
    if state["iteration"] >= state["max_iterations"]:
        return "end"

    return "end"

def act_node(state: AgentState) -> dict:
    """执行节点 - 调用工具"""
    last_message = state["messages"][-1]
    results = []

    for tool_call in last_message.tool_calls:
        tool_name = tool_call["name"]
        tool_args = tool_call["args"]
        result = execute_tool(tool_name, tool_args)
        results.append({"tool": tool_name, "result": result})

    return {"tool_results": results}

# 构建状态机
workflow = StateGraph(AgentState)
workflow.add_node("think", think_node)
workflow.add_node("act", act_node)

workflow.set_entry_point("think")
workflow.add_conditional_edges("think", decide_node, {
    "act": "act",
    "end": END,
})
workflow.add_edge("act", "think")

app = workflow.compile()
```

## 四、工具系统

```python
from langchain_core.tools import tool

@tool
def read_file(file_path: str) -> str:
    """读取文件内容"""
    with open(file_path, "r") as f:
        return f.read()

@tool
def write_file(file_path: str, content: str) -> str:
    """写入文件内容"""
    with open(file_path, "w") as f:
        f.write(content)
    return f"File {file_path} written successfully"

@tool
def run_command(command: str) -> str:
    """执行终端命令"""
    import subprocess
    result = subprocess.run(
        command, shell=True, capture_output=True, text=True, timeout=30
    )
    return result.stdout + result.stderr

@tool
def search_code(pattern: str, directory: str = ".") -> str:
    """搜索代码"""
    import subprocess
    result = subprocess.run(
        f"grep -r '{pattern}' {directory} --include='*.py' --include='*.js'",
        shell=True, capture_output=True, text=True
    )
    return result.stdout

# 工具注册表
class ToolRegistry:
    def __init__(self):
        self.tools = {}

    def register(self, tool_fn):
        self.tools[tool_fn.name] = tool_fn
        return tool_fn

    def get_tools(self):
        return list(self.tools.values())

    def execute(self, name: str, **args):
        if name not in self.tools:
            raise ValueError(f"Unknown tool: {name}")
        return self.tools[name].invoke(args)

registry = ToolRegistry()
registry.register(read_file)
registry.register(write_file)
registry.register(run_command)
registry.register(search_code)
```

## 五、踩坑记录

### 坑 1：Agent 陷入无限循环

**问题**：Agent 不断调用工具但没有进展，陷入死循环。

**解决**：设置 `max_iterations`（默认 10），超过后强制终止。同时加入"进展检测"——如果连续 3 次调用同一工具且结果相同，自动终止。

### 坑 2：工具执行超时

**问题**：Agent 执行了一个死循环的终端命令，整个系统卡住。

**解决**：所有工具执行都加 `timeout`（默认 30 秒），超时后强制 kill 进程。

### 坑 3：文件操作的安全性

**问题**：Agent 有可能删除或覆盖重要文件。

**解决**：
1. 默认只读模式，写操作需要用户确认
2. 限制可操作目录（sandbox）
3. 写操作前自动备份

### 坑 4：Token 消耗不可控

**问题**：复杂任务需要 20+ 轮迭代，Token 消耗爆炸。

**解决**：实现 Token 预算机制，超过阈值后自动压缩上下文或终止。

## 七、参考资料

- jojo-code GitHub：https://github.com/afine907/jojo-code
- LangGraph 官方文档：https://langchain-ai.github.io/langgraph/
- Claude Code 架构分析：https://docs.anthropic.com/en/docs/claude-code
- Textual 框架：https://textual.textualize.io/
