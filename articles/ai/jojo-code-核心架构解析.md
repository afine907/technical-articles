# jojo-code 核心架构解析

> 一个 TypeScript CLI 与 Python Agent 核心协同工作的 AI 编码助手架构设计

## 背景

- 为什么要写这篇文章？
- 解决什么问题？
- 目标读者是谁？

jojo-code 是一个 AI 编码助手，采用 TypeScript CLI + Python Core 的双语言架构设计。TypeScript 负责用户界面和交互，Python 承担 Agent 推理和工具执行，两者通过 JSON-RPC 进行进程间通信。本文深入解析其核心架构设计，帮助读者理解如何将大语言模型能力与本地开发工具进行高效整合。

## 正文

### 1. 整体架构设计

jojo-code 采用分层架构设计，核心组件包括：

- **CLI 层**（TypeScript）：用户交互界面，负责输入收集、输出展示
- **Server 层**（Python）：JSON-RPC 服务器，运行 Agent 核心逻辑
- **Agent 层**（Python）：基于 LangGraph 的状态图推理引擎
- **Tools 层**（Python）：文件系统、Shell、Git 等工具集
- **Security 层**（Python）：权限检查和审计日志

整体数据流如下：

```
用户输入 (TS CLI)
    ↓
JsonRpcClient --stdio--> Python JSON-RPC Server
    ↓
Agent Graph (LangGraph 状态图)
    ↓
┌─────────────┴─────────────┐
Thinking Node        Execute Node
(LLM 推理)           (工具执行)
```

### 2. TypeScript CLI + Python Core 的双语言架构

#### 2.1 设计动机

- **TypeScript 优势**：成熟的类型系统、优秀的 IDE 支持、丰富的前端生态
- **Python 优势**：LangChain/LangGraph 生态强大、AI 开发库丰富
- **进程隔离**：Python 进程独立运行，CLI 崩溃不影响 Agent

#### 2.2 CLI 实现

TypeScript CLI 位于 `packages/cli/src/client/jsonrpc.ts`，核心类 `JsonRpcClient` 通过 `child_process` 启动 Python 子进程：

```typescript
// 启动 Python 服务器
const proc = spawn(this.pythonPath, ['-m', 'jojo_code.server.main'], {
  stdio: ['pipe', 'pipe', 'pipe'],
});
```

自动检测虚拟环境路径：

```typescript
const possiblePaths = [
  process.cwd() + '/../../.venv/bin/python3',
  process.cwd() + '/.venv/bin/python3',
];
```

请求发送和响应接收：

```typescript
async request<T>(method: string, params: Record<string, unknown>): Promise<T> {
  proc.stdin.write(JSON.stringify(request) + '\n');
  // 等待 stdout 返回响应
}
```

支持流式响应：

```typescript
async *stream(method: string, params): AsyncGenerator<StreamChunk> {
  for await (const chunk of this.client.stream('chat', { message: input })) {
    yield chunk;
  }
}
```

#### 2.3 Python Server 实现

Python Server 位于 `jojo_code/server/`，主入口：

```python
# jojo_code/server/main.py
def main():
    register_handlers()
    server = get_server()
    server.run()
```

JSON-RPC 服务器位于 `jojo_code/server/jsonrpc.py`，通过 `sys.stdin`/`sys.stdout` 进行进程间通信：

```python
class JsonRpcServer:
    def run(self):
        for line in sys.stdin:
            request = self._parse_request(line)
            response = self._handle_request(request)
            print(response.to_json(), flush=True)
```

### 3. JSON-RPC 通信机制

#### 3.1 协议格式

请求格式：

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "chat",
  "params": { "message": "分析这个文件", "stream": false }
}
```

响应格式：

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "result": { "content": "..." }
}
```

错误响应：

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "error": { "code": -32601, "message": "Method not found" }
}
```

#### 3.2 Handler 注册

使用装饰器模式注册处理器：

```python
server = get_server()

@server.method("chat")
def handle_chat(message: str, stream: bool = False):
    return _sync_chat(state) if not stream else _stream_chat(state)

@server.method("clear")
def handle_clear():
    _conversation_memory.clear()
    return {"status": "ok"}
```

#### 3.3 可用方法

- `chat`：发送聊天消息
- `clear`：清空对话历史
- `get_model`：获取当前模型
- `get_stats`：获取会话统计
- `permission/mode`：获取/设置权限模式
- `permission/confirm`：确认权限请求
- `audit/query`：查询审计日志

### 4. Agent 执行流程

#### 4.1 LangGraph 状态图

Agent 基于 LangGraph 实现，位于 `jojo_code/agent/graph.py`：

```python
def build_agent_graph():
    workflow = StateGraph(AgentState)
    
    workflow.add_node("thinking", thinking_node)
    workflow.add_node("execute", execute_node)
    
    workflow.set_entry_point("thinking")
    
    workflow.add_conditional_edges(
        "thinking",
        should_continue,
        {"continue": "execute", "end": END},
    )
    
    workflow.add_edge("execute", "thinking")
    
    return workflow.compile()
```

图结构：

```
START → thinking → [continue → execute → thinking]
                    [or → END]
```

#### 4.2 Agent 状态定义

状态定义位于 `jojo_code/agent/state.py`：

```python
class AgentState(TypedDict):
    messages: Annotated[list[dict], merge_lists]  # 对话历史
    tool_calls: list[dict]                        # 待执行工具调用
    tool_results: list[str]                    # 工具执行结果
    is_complete: bool                          # 任务是否完成
    iteration: int                            # 循环次数
    mode: str                                # 模式 (BUILD/PLAN)
```

#### 4.3 Thinking Node

Thinking Node 负责 LLM 推理：

```python
def thinking_node(state: AgentState) -> dict:
    llm = get_llm()
    messages = state["messages"]
    
    # 添加工具结果到消息历史
    for i, result in enumerate(state["tool_results"]):
        messages.append(ToolMessage(content=result))
    
    # 根据模式决定是否绑定工具
    if mode == PlanMode.PLAN:
        llm_with_tools = llm  # PLAN 模式不绑定工具
    else:
        llm_with_tools = llm.bind_tools(tools)  # BUILD 模式绑定工具
    
    response = llm_with_tools.invoke(messages)
    
    return {
        "messages": [{"role": "assistant", "content": response.content}],
        "tool_calls": response.tool_calls,
        "is_complete": len(response.tool_calls) == 0,
        "iteration": state["iteration"] + 1,
    }
```

关键点：
- 支持 BUILD 和 PLAN 两种模式
- PLAN 模式只输出计划，阻止写操作
- 工具有结果后追加到消息历史

#### 4.4 Execute Node

Execute Node 负责工具执行：

```python
def execute_node(state: AgentState) -> dict:
    registry = get_tool_registry()
    results = []
    
    for tool_call in state["tool_calls"]:
        result = registry.execute(tool_call["name"], tool_call["args"])
        results.append(result)
    
    return {
        "tool_results": results,
        "tool_calls": [],
    }
```

#### 4.5 路由判断

```python
def should_continue(state: AgentState) -> Literal["continue", "end"]:
    if state["tool_calls"]:
        return "continue"
    if state["is_complete"]:
        return "end"
    if state["iteration"] >= MAX_ITERATIONS:  # 50 次
        return "end"
    return "end"
```

#### 4.6 工具注册与执行

工具注册中心位于 `jojo_code/tools/registry.py`：

```python
class ToolRegistry:
    def __init__(self):
        self._tools = {}
        self._register_default_tools()
    
    def _register_default_tools(self):
        default_tools = [
            read_file, write_file, edit_file,
            grep_search, glob_search,
            run_command,
            git_status, git_diff, git_log,
            # ... 更多工具
        ]
        for tool in default_tools:
            self._tools[tool.name] = tool
```

权限检查：

```python
def execute(self, name: str, args: dict) -> str:
    if self._permission_manager:
        result = self._permission_manager.check(name, args)
        if result.denied:
            raise PermissionError(result.reason)
    
    tool = self.get(name)
    return str(tool.invoke(args))
```

## 总结

- TypeScript CLI + Python Core 双语言架构结合两者优势
- JSON-RPC 通过 stdio 实现进程间高效通信
- LangGraph 状态图驱动 Agent 推理循环
- 工具注册中心统一管理文件系统、Shell、Git 等能力
- 权限检查和审计日志保障操作安全

## 参考资料

- [LangGraph 文档](https://langchain-ai.github.io/langgraph/)
- [JSON-RPC 2.0 规范](https://www.jsonrpc.org/specification)
- [LangChain Tools](https://python.langchain.com/docs/modules/agents/tools/)

---

**作者**: 
**日期**: 2026-04-24
**标签**: jojo-code, 架构设计, AI Agent