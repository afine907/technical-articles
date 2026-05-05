---
sidebar_position: 1
title: jojo-code 架构解析
slug: jojo-code-architecture
---

# jojo-code 架构解析

我做了很多 Agent 项目，最后沉淀下来一个开源项目：jojo-code。

这篇文章，我来拆解它的架构，帮你理解一个 Agent CLI 是怎么设计的。

## 整体架构

```
jojo-code/
├── packages/cli/          # TypeScript CLI（用户界面）
│   ├── src/
│   │   ├── app.tsx        # 主应用
│   │   ├── components/    # UI 组件
│   │   ├── hooks/         # React Hooks
│   │   └── client/        # JSON-RPC 客户端
│   └── package.json
│
└── src/jojo_code/         # Python Core（AI 逻辑）
    ├── server/            # JSON-RPC Server
    ├── agent/             # LangGraph Agent
    ├── tools/             # 工具集
    └── memory/            # 记忆管理
```

核心设计：**前后端分离，JSON-RPC 通信**。

## TypeScript CLI：用户界面

用 ink（React for CLI）实现，好处是：
- React 组件化
- 声明式 UI
- 丰富的生态系统

核心组件：

```typescript
// app.tsx
function App() {
  const { messages, sendMessage, isLoading } = useAgent();
  
  return (
    <Box flexDirection="column">
      <ChatView messages={messages} />
      <InputBox onSend={sendMessage} />
      <StatusBar isLoading={isLoading} />
    </Box>
  );
}
```

useAgent Hook 负责与 Python Server 通信：

```typescript
function useAgent() {
  const client = useMemo(() => new JsonRpcClient(), []);
  const [messages, setMessages] = useState<Message[]>([]);
  
  const sendMessage = async (input: string) => {
    setMessages(prev => [...prev, { role: 'user', content: input }]);
    
    for await (const chunk of client.stream('chat', { message: input })) {
      if (chunk.type === 'content') {
        // 实时更新
        updateLastMessage(chunk.text);
      }
    }
  };
  
  return { messages, sendMessage };
}
```

## Python Core：AI 逻辑

### Agent 结构

用 LangGraph 实现：

```python
# graph.py
workflow = StateGraph(AgentState)
workflow.add_node("thinking", thinking_node)
workflow.add_node("execute", execute_node)

workflow.add_conditional_edges("thinking", should_continue)
workflow.add_edge("execute", "thinking")

graph = workflow.compile()
```

### 工具系统

```python
# tools/registry.py
class ToolRegistry:
    def __init__(self):
        self.tools = {}
        self.categories = {}  # read/write 分类
    
    def register(self, name: str, func, category: str = "read"):
        self.tools[name] = func
        self.categories[name] = category
    
    def execute(self, name: str, args: dict) -> str:
        return self.tools[name](**args)
```

### 记忆管理

```python
# memory/conversation.py
class ConversationMemory:
    def __init__(self, max_tokens=100000):
        self.messages = []
        self.max_tokens = max_tokens
    
    def add(self, message):
        self.messages.append(message)
        if self.count_tokens() > self.max_tokens:
            self._compress()
```

## 关键设计决策

### 1. 为什么用 JSON-RPC over stdio？

不用 HTTP，因为：
- CLI 是单机应用，不需要网络
- stdio 更简单，没有端口冲突
- 性能更好，没有 HTTP 开销

### 2. 为什么前后端分离？

不用 Python 写 UI，因为：
- ink (React CLI) 更成熟
- TypeScript 类型安全
- 前端开发者友好

### 3. 为什么用 LangGraph？

不用 LangChain Chain，因为：
- Agent 需要循环（决策→执行→再决策）
- LangGraph 的图模型更适合
- 状态管理更清晰

## 启动流程

```
1. 用户运行 `jojo-code`
   ↓
2. TypeScript CLI 启动
   ↓
3. spawn Python subprocess
   ↓
4. Python 初始化 Agent
   ↓
5. 等待 stdin 输入
   ↓
6. 用户输入 → TypeScript → JSON-RPC → Python
   ↓
7. Python Agent 处理 → 流式返回
   ↓
8. TypeScript 实时渲染 UI
```

## 扩展点

想加新功能，改这些地方：

**加新工具**：`src/jojo_code/tools/` 下新建文件
**改 UI**：`packages/cli/src/components/` 下修改
**加新模式**：`src/jojo_code/agent/modes.py`

## 我踩过的坑

**坑一：stdin/stdout 编码**

Windows 下默认不是 UTF-8，中文会乱码。

解决：Python 里设置 `sys.stdin.reconfigure(encoding='utf-8')`

**坑二：进程不退出**

用户按 Ctrl+C，Python 进程还在跑。

解决：TypeScript 监听退出信号，kill 子进程。

**坑三：类型不同步**

Python 和 TypeScript 的接口定义手动维护，经常不一致。

解决：加单元测试，验证接口兼容性。


jojo-code 是一个最小可行的 Agent CLI 架构，核心代码不到 1000 行，适合学习参考。
