# 用 LangGraph 构建你的第一个 Agent：从原理到实战

我看过太多 Agent 教程，都是"调用 API 就完事了"。但当你真正要做一个生产级 Agent 时，会发现根本不够：状态怎么管理？工具怎么组织？循环怎么控制？

这篇文章，我从原理到实战，带你构建一个真正可用的 Agent。

## Agent 的本质是什么？

先搞清楚概念：**Agent = LLM + 工具 + 循环**。

```
┌─────────────────────────────────────────────────────┐
│                    Agent 执行循环                    │
│                                                     │
│  ┌─────────┐      ┌─────────┐      ┌─────────┐    │
│  │  用户   │─────▶│   LLM   │─────▶│  工具   │    │
│  │  输入   │      │  (决策)  │      │ (执行)  │    │
│  └─────────┘      └─────────┘      └─────────┘    │
│                         ▲                │         │
│                         └────────────────┘         │
│                              循环继续               │
└─────────────────────────────────────────────────────┘
```

**LLM 的角色**：决策者。决定调用什么工具、返回什么回复。
**工具的角色**：执行者。读写文件、调用 API、执行命令。
**循环的角色**：让 Agent 能"思考→执行→再思考"。

## 为什么用 LangGraph？

传统的 LangChain Chain 是线性的：

```
输入 → 处理1 → 处理2 → 处理3 → 输出
```

但 Agent 需要循环：

```
输入 → 思考 → [有工具？] → 执行 → 思考 → [有工具？] → ... → 输出
```

LangGraph 专门为这种场景设计。

### LangGraph 核心概念

```
StateGraph（状态图）
├── State（状态）：在节点间流转的数据
├── Node（节点）：处理函数
├── Edge（边）：节点间的转移
└── Conditional Edge（条件边）：根据状态决定下一个节点
```

## 从零开始：构建一个文件操作 Agent

我们要做的 Agent 能：
1. 读取文件
2. 写入文件
3. 列出目录
4. 搜索内容

### 第一步：定义状态

状态是 Agent 的"记忆"，在所有节点间共享。

```python
from typing import TypedDict, Annotated, Any
from langchain_core.messages import BaseMessage

def merge_messages(left: list, right: list) -> list:
    """消息合并策略：追加而非替换"""
    return left + right

class AgentState(TypedDict):
    """Agent 状态定义
    
    为什么用 TypedDict？
    1. 类型提示，IDE 自动补全
    2. 文档化，一看就知道有哪些字段
    3. 静态检查，避免拼写错误
    """
    
    # 对话历史（追加）
    messages: Annotated[list[BaseMessage], merge_messages]
    
    # 待执行的工具调用
    tool_calls: list[dict[str, Any]]
    
    # 工具执行结果
    tool_results: list[str]
    
    # 是否完成
    is_complete: bool
    
    # 循环次数（防止无限循环）
    iteration: int
    
    # 当前工作目录
    workdir: str
```

**关键点：`Annotated[list, merge_messages]`**

这是 LangGraph 的"归约器"模式。当节点返回部分状态时，LangGraph 会用 `merge_messages` 函数合并，而不是直接替换。

```python
# 节点返回
return {"messages": [new_message]}

# LangGraph 自动执行
state["messages"] = merge_messages(state["messages"], [new_message])
# 结果：state["messages"] 现在包含旧消息 + 新消息
```

### 第二步：定义工具

```python
from langchain_core.tools import tool
from pathlib import Path
import os

@tool
def read_file(path: str) -> str:
    """读取文件内容
    
    Args:
        path: 文件路径（相对或绝对）
    
    Returns:
        文件内容
    
    错误处理：
    - 文件不存在：返回错误信息
    - 权限不足：返回错误信息
    """
    try:
        full_path = Path(path)
        if not full_path.is_absolute():
            # 如果是相对路径，需要知道工作目录
            # 这里简化处理，假设是相对于当前目录
            pass
        
        if not full_path.exists():
            return f"错误：文件不存在 {path}"
        
        # 限制文件大小，避免读取超大文件
        size = full_path.stat().st_size
        if size > 10 * 1024 * 1024:  # 10MB
            return f"错误：文件过大 ({size / 1024 / 1024:.1f}MB)，超过 10MB 限制"
        
        content = full_path.read_text(encoding="utf-8")
        return content
    
    except PermissionError:
        return f"错误：没有权限读取 {path}"
    except Exception as e:
        return f"错误：{str(e)}"

@tool
def write_file(path: str, content: str) -> str:
    """写入文件
    
    Args:
        path: 文件路径
        content: 要写入的内容
    
    Returns:
        操作结果
    
    安全措施：
    - 不允许覆盖重要系统文件
    - 自动创建父目录
    """
    # 安全检查：不允许写入系统目录
    dangerous_paths = ["/etc", "/usr", "/bin", "/sbin", "/root"]
    abs_path = Path(path).resolve()
    
    for dangerous in dangerous_paths:
        if str(abs_path).startswith(dangerous):
            return f"错误：不允许写入系统目录 {dangerous}"
    
    try:
        # 自动创建父目录
        abs_path.parent.mkdir(parents=True, exist_ok=True)
        
        # 写入文件
        abs_path.write_text(content, encoding="utf-8")
        
        return f"成功：已写入 {path}，共 {len(content)} 字符"
    
    except Exception as e:
        return f"错误：{str(e)}"

@tool
def list_files(directory: str = ".", pattern: str = "*") -> str:
    """列出目录下的文件
    
    Args:
        directory: 目录路径，默认当前目录
        pattern: 文件模式，如 *.py，默认所有文件
    
    Returns:
        文件列表
    """
    try:
        dir_path = Path(directory)
        
        if not dir_path.exists():
            return f"错误：目录不存在 {directory}"
        
        if not dir_path.is_dir():
            return f"错误：{directory} 不是目录"
        
        # 搜索文件
        files = list(dir_path.glob(pattern))
        
        # 限制数量
        if len(files) > 100:
            files = files[:100]
            truncated = True
        else:
            truncated = False
        
        # 格式化输出
        result = []
        for f in files:
            if f.is_dir():
                result.append(f"[目录] {f.name}/")
            else:
                size = f.stat().st_size
                result.append(f"[文件] {f.name} ({size} bytes)")
        
        output = "\n".join(result)
        
        if truncated:
            output += f"\n\n... (共 {len(files)} 个，显示前 100 个)"
        
        return output
    
    except Exception as e:
        return f"错误：{str(e)}"

@tool
def search_in_file(path: str, keyword: str) -> str:
    """在文件中搜索关键词
    
    Args:
        path: 文件路径
        keyword: 搜索关键词
    
    Returns:
        匹配的行
    """
    try:
        content = Path(path).read_text(encoding="utf-8")
        lines = content.split("\n")
        
        matches = []
        for i, line in enumerate(lines, 1):
            if keyword in line:
                matches.append(f"第 {i} 行: {line.strip()}")
        
        if not matches:
            return f"未找到关键词 '{keyword}'"
        
        return "\n".join(matches[:50])  # 最多显示 50 个匹配
    
    except Exception as e:
        return f"错误：{str(e)}"

# 收集所有工具
TOOLS = [read_file, write_file, list_files, search_in_file]
```

### 第三步：定义节点

节点是 Agent 的"处理单元"。每个节点是一个函数，接收状态，返回状态更新。

```python
from langchain_openai import ChatOpenAI
from langchain_core.messages import HumanMessage, AIMessage, SystemMessage, ToolMessage
import json

# 初始化 LLM
llm = ChatOpenAI(model="gpt-4-turbo", temperature=0)

# 绑定工具
llm_with_tools = llm.bind_tools(TOOLS)

def thinking_node(state: AgentState) -> dict:
    """思考节点：LLM 决策
    
    职责：
    1. 分析当前状态
    2. 决定是否需要调用工具
    3. 生成回复或工具调用
    
    返回：
    - tool_calls: 如果决定调用工具
    - is_complete: 如果任务完成
    """
    
    # 1. 准备消息
    messages = state["messages"].copy()
    
    # 2. 添加工具结果（如果有）
    if state.get("tool_results"):
        for i, result in enumerate(state["tool_results"]):
            tool_call_id = state["tool_calls"][i].get("id", f"call_{i}")
            messages.append(ToolMessage(
                content=result,
                tool_call_id=tool_call_id
            ))
    
    # 3. 调用 LLM
    response = llm_with_tools.invoke(messages)
    
    # 4. 解析结果
    tool_calls = []
    if hasattr(response, "tool_calls") and response.tool_calls:
        for tc in response.tool_calls:
            tool_calls.append({
                "name": tc["name"],
                "args": tc["args"],
                "id": tc.get("id", f"call_{len(tool_calls)}"),
            })
    
    # 5. 判断是否完成
    is_complete = len(tool_calls) == 0
    
    # 6. 添加 AI 消息
    new_messages = [response]
    
    return {
        "messages": new_messages,
        "tool_calls": tool_calls,
        "tool_results": [],  # 清空上一次的结果
        "is_complete": is_complete,
        "iteration": state.get("iteration", 0) + 1,
    }

def execute_node(state: AgentState) -> dict:
    """执行节点：运行工具
    
    职责：
    1. 遍历所有工具调用
    2. 执行并收集结果
    3. 错误处理
    """
    
    results = []
    tool_map = {t.name: t for t in TOOLS}
    
    for tool_call in state["tool_calls"]:
        name = tool_call["name"]
        args = tool_call["args"]
        
        # 查找工具
        if name not in tool_map:
            results.append(f"错误：未知工具 {name}")
            continue
        
        # 执行工具
        try:
            tool = tool_map[name]
            result = tool.invoke(args)
            results.append(result)
        except Exception as e:
            results.append(f"工具执行失败 {name}: {str(e)}")
    
    return {
        "tool_results": results,
        "tool_calls": [],  # 清空工具调用
    }
```

### 第四步：定义路由

路由决定"下一步去哪"。

```python
from typing import Literal

MAX_ITERATIONS = 20  # 防止无限循环

def should_continue(state: AgentState) -> Literal["continue", "end"]:
    """路由函数：决定是否继续循环
    
    规则：
    1. 有工具调用 → 继续
    2. 任务完成 → 结束
    3. 达到最大迭代 → 结束（防止无限循环）
    """
    
    # 检查是否还有工具要执行
    if state.get("tool_calls"):
        return "continue"
    
    # 检查任务是否完成
    if state.get("is_complete"):
        return "end"
    
    # 检查迭代次数
    if state.get("iteration", 0) >= MAX_ITERATIONS:
        return "end"
    
    # 默认结束
    return "end"
```

### 第五步：构建图

```python
from langgraph.graph import StateGraph, END
from langgraph.checkpoint.memory import MemorySaver

def build_agent_graph():
    """构建 Agent 状态图
    
    图结构：
    
        START
          │
          ▼
      thinking ──┬──[continue]──▶ execute ──┐
          ▲      │                          │
          │      └──[end]──▶ END            │
          │                                 │
          └─────────────────────────────────┘
    """
    
    # 创建图
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
        }
    )
    
    # 执行后返回思考节点
    workflow.add_edge("execute", "thinking")
    
    # 编译（可选：加上检查点支持对话恢复）
    checkpointer = MemorySaver()
    return workflow.compile(checkpointer=checkpointer)

# 创建 Agent
agent = build_agent_graph()
```

### 第六步：使用 Agent

```python
def create_initial_state(message: str, workdir: str = ".") -> AgentState:
    """创建初始状态"""
    
    system_prompt = f"""你是一个文件操作助手，帮助用户管理文件。

当前工作目录：{workdir}

你可以：
- read_file: 读取文件
- write_file: 写入文件
- list_files: 列出目录
- search_in_file: 搜索内容

规则：
1. 操作前确认路径
2. 写入前备份重要文件
3. 报告操作结果
"""
    
    return AgentState(
        messages=[
            SystemMessage(content=system_prompt),
            HumanMessage(content=message),
        ],
        tool_calls=[],
        tool_results=[],
        is_complete=False,
        iteration=0,
        workdir=workdir,
    )

# 示例 1：读取文件
state = create_initial_state("读取 README.md 的前 10 行")
result = agent.invoke(state)

print(result["messages"][-1].content)
# 输出：README.md 的前 10 行内容是...

# 示例 2：复杂任务
state = create_initial_state(
    "列出 src 目录下的所有 Python 文件，"
    "然后在每个文件中搜索 'TODO'"
)
result = agent.invoke(state)

# 示例 3：流式输出（实时看到执行过程）
async def run_with_streaming(message: str):
    state = create_initial_state(message)
    
    async for event in agent.astream(state):
        # thinking 事件
        if "thinking" in event:
            print(f"[思考] {event['thinking']['messages'][-1].content[:100]}...")
        
        # execute 事件
        if "execute" in event:
            for result in event["execute"]["tool_results"]:
                print(f"[执行] {result[:100]}...")

import asyncio
asyncio.run(run_with_streaming("读取 pyproject.toml"))
```

## 可视化 Agent 流程

LangGraph 支持可视化：

```python
from IPython.display import Image, display

# 生成图的可视化
graph_image = agent.get_graph().draw_mermaid_png()

# 保存或显示
with open("agent_graph.png", "wb") as f:
    f.write(graph_image)
```

生成的图：

```
graph TD
    START --> thinking
    thinking --> |continue| execute
    thinking --> |end| END
    execute --> thinking
```

## 调试技巧

### 1. 打印中间状态

```python
def thinking_node(state: AgentState) -> dict:
    print(f"[DEBUG] 当前迭代: {state.get('iteration', 0)}")
    print(f"[DEBUG] 消息数: {len(state['messages'])}")
    print(f"[DEBUG] 待执行工具: {len(state.get('tool_calls', []))}")
    
    # ... 正常逻辑
```

### 2. 使用 LangSmith 追踪

```python
import os

os.environ["LANGCHAIN_TRACING_V2"] = "true"
os.environ["LANGCHAIN_API_KEY"] = "lsv2_xxx"
os.environ["LANGCHAIN_PROJECT"] = "my-agent"

# 现在所有调用都会被追踪到 LangSmith
```

### 3. 断点续传

```python
# 使用检查点保存状态
config = {"configurable": {"thread_id": "conversation-123"}}

# 执行
result = agent.invoke(state, config=config)

# 稍后恢复
# LangGraph 会自动从检查点恢复
continuation = agent.invoke({"messages": [HumanMessage("继续")]}, config=config)
```

## 性能优化

### 1. 减少消息历史

```python
def truncate_messages(messages: list, max_count: int = 20) -> list:
    """保留最近 N 条消息"""
    if len(messages) <= max_count:
        return messages
    
    # 保留系统消息
    system_messages = [m for m in messages if isinstance(m, SystemMessage)]
    other_messages = [m for m in messages if not isinstance(m, SystemMessage)]
    
    # 保留最近的消息
    recent = other_messages[-(max_count - len(system_messages)):]
    
    return system_messages + recent
```

### 2. 并行执行工具

```python
import asyncio

async def execute_tools_parallel(tool_calls: list) -> list[str]:
    """并行执行多个工具"""
    tasks = [execute_tool_async(tc) for tc in tool_calls]
    return await asyncio.gather(*tasks)
```

### 3. 缓存 LLM 响应

```python
from langchain.cache import InMemoryCache
from langchain.globals import set_llm_cache

# 启用缓存
set_llm_cache(InMemoryCache())

# 相同的输入会直接返回缓存结果
```

## 我踩过的真实坑

### 坑一：忘了类型转换

**现象**：LLM 返回的工具参数类型不对。

```python
# LLM 返回
tool_calls = [{"name": "read_file", "args": {"path": 123}}]  # 数字而不是字符串

# 工具期望
def read_file(path: str) -> str:  # 期望字符串
    ...
```

**解决**：工具里做类型检查。

```python
def read_file(path) -> str:
    path = str(path)  # 强制转换
    ...
```

### 坑二：工具抛异常导致 Agent 崩溃

**现象**：工具报错，整个 Agent 停止。

**解决**：在工具里捕获所有异常。

```python
@tool
def read_file(path: str) -> str:
    try:
        # 可能出错的操作
        ...
    except Exception as e:
        return f"错误：{str(e)}"  # 返回错误信息，不抛异常
```

### 坑三：无限循环

**现象**：Agent 一直在执行工具，停不下来。

**原因**：should_continue 的逻辑有漏洞。

**解决**：加迭代上限。

```python
def should_continue(state):
    if state.get("iteration", 0) >= 20:
        return "end"  # 强制结束
    ...
```

## 下一步行动

1. **复制代码跑通**：先把上面的代码完整运行一遍
2. **加自己的工具**：比如数据库查询、API 调用
3. **加监控和日志**：追踪每次工具调用
4. **处理边界情况**：错误、超时、取消

---

Agent 不是魔法，是 LLM + 工具 + 循环的组合。理解了这三者的关系，你就能构建任何类型的 Agent。
