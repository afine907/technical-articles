---
slug: state-management
sidebar_position: 1
title: Agent 状态混乱？三招搞定
---

# Agent 状态混乱？三招搞定

你有没有遇到过这种情况：

Agent 在第一轮对话里说"好的，我来帮你写一个 React 组件"，第二轮却开始用 Vue，第三轮又变成了原生 JavaScript。你问它"为什么变了？"，它说"抱歉，我不确定你之前说了什么"。

我当时就懵了：这 Agent 怎么跟金鱼一样，7秒就忘了？

折腾了一下午，终于搞明白了——状态管理没做好。

## 问题定位

Agent 的状态就像应用的"记忆"。但跟普通的 Web 应用不同，Agent 的状态会不断变化：

- 用户说了一句话 → 状态变了
- Agent 决定调用工具 → 状态变了
- 工具执行完了 → 状态又变了
- 循环了50轮 → 状态已经面目全非

最坑的是，这些状态变化是无序的。你不知道 Agent 下一秒会做什么决策，也不知道它会调用哪个工具。

所以状态管理的核心问题是：**如何让状态变化可预测？**

## 三招搞定

我试过很多方案，最后总结出三招，基本能解决90%的状态混乱问题。

### 第一招：用 TypedDict 定义状态结构

别用 dict 到处传，太容易出错了。

```python
from typing import TypedDict, Annotated

class AgentState(TypedDict):
    messages: list[dict]      # 对话历史
    tool_calls: list[dict]    # 待执行工具
    tool_results: list[str]   # 工具结果
    is_complete: bool         # 是否完成
    iteration: int            # 循环次数
```

这样有什么好处？

1. **IDE 会提示**：你输入 `state["mes`，IDE 会自动补全 `messages`
2. **类型检查**：如果赋值类型不对，IDE 会标红
3. **文档化**：一看 TypedDict 就知道有哪些字段

我之前踩过一个坑：状态里有个字段叫 `tool_results`，有个节点返回了 `tool_result`（少了 s），结果状态一直没更新。改成 TypedDict 后，这种低级错误立刻就能发现。

### 第二招：用 Annotated 实现状态合并

状态更新有两种方式：替换和合并。

替换就是直接覆盖，比如 `is_complete = True`。
合并就是追加，比如 `messages` 每次追加新消息。

LangGraph 提供了 `Annotated` 来定义合并策略：

```python
def merge_lists(left: list, right: list) -> list:
    return left + right

class AgentState(TypedDict):
    messages: Annotated[list[dict], merge_lists]  # 追加
    tool_calls: list[dict]  # 替换
```

这样，节点只需要返回部分状态：

```python
def thinking_node(state: AgentState) -> dict:
    # 只返回要更新的字段
    return {
        "tool_calls": [...],
        "is_complete": False,
    }
```

LangGraph 会自动：
- 用 `merge_lists` 合并 `messages`
- 直接替换 `tool_calls`

我之前踩过一个坑：节点返回了完整状态，结果不小心覆盖了之前的消息历史。改成 Annotated 后，再也不用担心这个问题了。

### 第三招：设置边界条件

Agent 是循环执行的，如果没有边界条件，会无限循环。

我之前写过一个 Agent，忘了设置迭代上限。用户输入一个复杂的任务，Agent 一直在那里循环，我等了5分钟还没停。最后只能强制杀进程。

最简单的边界条件：

```python
MAX_ITERATIONS = 50

def should_continue(state: AgentState) -> str:
    # 有工具要执行 → 继续
    if state["tool_calls"]:
        return "continue"
    
    # 任务完成 → 结束
    if state["is_complete"]:
        return "end"
    
    # 达到上限 → 结束
    if state["iteration"] >= MAX_ITERATIONS:
        return "end"
    
    return "end"
```

这样，Agent 最多循环50次就会停止，不会无限跑下去。

## 完整代码示例

这是 jojo-code 的状态定义，简化版：

```python
from typing import TypedDict, Annotated, Any

def merge_lists(left: list | None, right: list | None) -> list:
    if left is None: left = []
    if right is None: right = []
    return left + right

class AgentState(TypedDict):
    """Agent 状态定义"""
    messages: Annotated[list[dict[str, Any]], merge_lists]
    tool_calls: list[dict[str, Any]]
    tool_results: list[str]
    is_complete: bool
    iteration: int

def create_initial_state(message: str) -> AgentState:
    """创建初始状态"""
    return AgentState(
        messages=[{"role": "user", "content": message}],
        tool_calls=[],
        tool_results=[],
        is_complete=False,
        iteration=0,
    )
```

使用方式：

```python
# 创建初始状态
state = create_initial_state("帮我写一个按钮组件")

# 节点更新状态
def thinking_node(state: AgentState) -> dict:
    return {
        "tool_calls": [{"name": "write_file", "args": {...}}],
        "iteration": state["iteration"] + 1,
    }

def execute_node(state: AgentState) -> dict:
    results = []
    for tc in state["tool_calls"]:
        results.append(execute_tool(tc))
    
    return {
        "tool_results": results,
        "tool_calls": [],  # 清空
    }
```

## 我踩过的坑

**坑一：状态字段命名不一致**

有个节点返回 `tool_result`，另一个节点读取 `tool_results`（多了个 s），结果一直是空的。

解决：用 TypedDict 定义，IDE 会提示正确字段名。

**坑二：忘了清空状态**

工具执行完后，忘了清空 `tool_calls`，导致下一轮又执行了一遍。

解决：execute_node 返回时清空 `tool_calls: []`。

**坑三：状态膨胀**

我把所有东西都塞进状态：用户信息、系统配置、临时变量...状态越来越大，最后超出上下文窗口。

解决：状态只保留必要的，临时变量放节点局部变量里。

## 下一步行动

1. **检查你的 Agent**：看看状态是怎么定义的，有没有类型提示
2. **加上边界条件**：设置最大迭代次数，防止无限循环
3. **使用 TypedDict**：让状态结构清晰，减少低级错误

如果想要现成的方案，可以直接看 jojo-code 的实现，在 `src/jojo_code/agent/state.py` 里。核心代码不到 50 行。

---

记住一点：状态管理的目标是让状态变化可预测。用 TypedDict 定义结构，用 Annotated 控制合并，用边界条件防止失控。
