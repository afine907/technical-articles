# jojo-Code：从零构建一个 AI 编码助手

> 为什么自己造轮子？因为想真正理解 Agent 是如何工作的。

## 起因

用了一段时间 Claude Code，感觉很强大。但有几个问题让我不舒服：

1. **黑盒**：不知道它内部怎么决策的
2. **不可控**：无法自定义工具和行为
3. **贵**：每月 $20

我想：**能不能自己做一个？**

不是为了替代，而是为了理解。通过亲手构建，深入理解 Agent 的工作原理。

## 设计目标

**简单原则**：
- 全 Python 实现（我熟悉的语言）
- 基于 LangGraph（可可视化调试）
- 终端 TUI（不依赖 IDE）
- 可自托管（完全本地运行）

**功能目标**：
- 文件读写、代码搜索
- Shell 命令执行
- Git 操作
- Web 搜索

## 架构设计

### 整体架构

```
┌─────────────────┐            ┌──────────────────┐
│   Textual CLI   │            │  FastAPI Server  │
│   (终端 TUI)    │◄──────────►│  + WebSocket     │
│                 │            │                  │
│  - 消息列表     │            │  - LangGraph     │
│  - 输入框       │            │  - 20+ Tools     │
│  - 状态栏       │            │  - Memory        │
└─────────────────┘            └──────────────────┘
```

为什么分离 CLI 和 Server？

1. **灵活部署**：可以本地运行，也可以远程部署
2. **多客户端**：未来可以做 Web UI、VSCode 插件
3. **独立升级**：Server 和 CLI 可以分别更新

### LangGraph 状态机

Agent 的核心是状态机：

```python
from langgraph.graph import StateGraph

class AgentState(TypedDict):
    messages: list[BaseMessage]
    tool_calls: list[ToolCall]

# 定义节点
def thinking(state: AgentState) -> AgentState:
    """LLM 思考，决定是否调用工具"""
    response = llm.invoke(state["messages"])
    return {"tool_calls": response.tool_calls}

def execute(state: AgentState) -> AgentState:
    """执行工具调用"""
    results = []
    for call in state["tool_calls"]:
        result = tools[call.name].invoke(call.args)
        results.append(result)
    return {"messages": results}

# 构建图
graph = StateGraph(AgentState)
graph.add_node("thinking", thinking)
graph.add_node("execute", execute)
graph.add_edge("thinking", "execute")
graph.add_edge("execute", "thinking")  # 循环

# 运行
app = graph.compile()
result = app.invoke({"messages": ["帮我写一个函数"]})
```

这个设计的优点：

1. **可视化**：LangGraph 可以生成状态图，调试方便
2. **可中断**：每个节点都是独立的，可以暂停和恢复
3. **易扩展**：添加新节点即可增加功能

### 工具系统

工具是 Agent 的"手"。设计原则：

```python
from langchain_core.tools import tool

@tool
def read_file(file_path: str) -> str:
    """读取文件内容
    
    Args:
        file_path: 文件路径
        
    Returns:
        文件内容
    """
    return Path(file_path).read_text()
```

**插件式设计**：

```python
# 所有工具注册到一个字典
TOOLS = {
    "read_file": read_file,
    "write_file": write_file,
    "execute_shell": execute_shell,
    # ...
}

# Agent 自动发现和调用
llm_with_tools = llm.bind_tools(list(TOOLS.values()))
```

添加新工具只需：

1. 定义函数并加 `@tool` 装饰器
2. 添加到 TOOLS 字典
3. 完成！

### 权限控制

敏感操作需要用户确认：

```python
@tool
def execute_shell(command: str) -> str:
    """执行 Shell 命令（需要确认）"""
    # 检查权限
    if need_permission(command):
        granted = ask_user(f"执行命令: {command}?")
        if not granted:
            return "用户拒绝"
    
    return subprocess.run(command, shell=True, capture_output=True)
```

## 实现细节

### Textual TUI

Textual 是一个优秀的 Python TUI 框架：

```python
from textual.app import App
from textual.widgets import Header, Footer, Static

class ChatApp(App):
    """主应用"""
    
    def compose(self):
        yield Header()
        yield ChatView()      # 消息列表
        yield InputBox()      # 输入框
        yield StatusBar()     # 状态栏
        yield Footer()
    
    async def on_input_submitted(self, message):
        """用户提交输入"""
        response = await self.send_to_agent(message.text)
        self.chat_view.add_message(response)
```

### WebSocket 通信

CLI 和 Server 通过 WebSocket 通信：

```python
# Server 端
@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    await websocket.accept()
    
    while True:
        data = await websocket.receive_json()
        response = await agent.run(data["message"])
        await websocket.send_json({"response": response})

# CLI 端
async def send_message(message: str):
    async with websockets.connect(SERVER_URL) as ws:
        await ws.send(json.dumps({"message": message}))
        response = await ws.recv()
        return json.loads(response)
```

### 流式输出

长响应需要流式输出，用户体验更好：

```python
# Server 端
async def stream_response(message: str):
    async for chunk in agent.stream(message):
        yield json.dumps({"chunk": chunk})

# CLI 端
async def display_stream(stream):
    async for data in stream:
        self.chat_view.append(data["chunk"])
```

## 踩过的坑

### 坑一：Token 限制

大文件的 token 数可能超出上下文限制。

**解决**：

```python
def truncate_content(content: str, max_tokens: int = 8000) -> str:
    tokens = tiktoken.count(content)
    if tokens <= max_tokens:
        return content
    
    # 按行截断
    lines = content.split("\n")
    result = []
    current_tokens = 0
    
    for line in lines:
        line_tokens = tiktoken.count(line)
        if current_tokens + line_tokens > max_tokens:
            break
        result.append(line)
        current_tokens += line_tokens
    
    return "\n".join(result) + "\n... (truncated)"
```

### 坑二：工具调用死循环

Agent 有时会反复调用同一个工具。

**解决**：

```python
MAX_TOOL_CALLS = 10

def execute_with_limit(state: AgentState) -> AgentState:
    if state["call_count"] >= MAX_TOOL_CALLS:
        return {"messages": ["达到最大调用次数，停止"]}
    
    # 执行工具...
    return {"call_count": state["call_count"] + 1}
```

### 坑三：权限控制太烦

每次操作都确认，用户会疯。

**解决**：

```python
# 白名单：不需要确认的操作
SAFE_COMMANDS = ["ls", "cat", "grep", "git status"]

def need_permission(command: str) -> bool:
    base_cmd = command.split()[0]
    return base_cmd not in SAFE_COMMANDS
```

## 与其他工具对比

| 特性 | jojo-Code | Claude Code | Aider |
|------|-----------|-------------|-------|
| 开源 | ✅ | ❌ | ✅ |
| 自托管 | ✅ | ❌ | ✅ |
| 终端 TUI | ✅ | ✅ | ✅ |
| Python 原生 | ✅ | ❌ | ✅ |
| LangGraph | ✅ | ❌ | ❌ |
| 远程部署 | ✅ | ❌ | ❌ |

**jojo-Code 的定位**：

- **学习工具**：清晰的架构，适合学习 Agent 开发
- **轻量替代**：功能够用，完全本地，成本可控
- **扩展平台**：插件式设计，易于添加自定义工具

## 下一步计划

1. **发布 PyPI**：让用户一行命令安装
2. **Web UI**：做基于 React 的 Web 界面
3. **VSCode 插件**：集成到编辑器
4. **更多工具**：数据库操作、API 调用、代码分析

## 总结

通过构建 jojo-Code，我学到了：

1. **Agent 不神秘**：就是状态机 + 工具调用
2. **LangGraph 真好用**：可视化调试太重要了
3. **TUI 开发很有趣**：Textual 框架很强大
4. **工程化很重要**：测试、CI/CD、文档一个都不能少

**项目地址**: https://github.com/afine907/jojo-code

如果觉得有用，给个 Star ⭐
