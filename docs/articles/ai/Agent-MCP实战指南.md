# Agent + MCP：模型上下文协议实战

Claude 发布了 MCP（Model Context Protocol），号称是"AI 的 USB-C"。到底是什么？怎么用？

我研究了一下，发现 MCP 是一个让 Agent 能"即插即用"连接各种数据源和工具的协议。

这篇文章，我来分享 MCP 是什么，以及怎么用。

## MCP 是什么？

打个比方：

**以前**：每个 AI 应用都要自己实现各种连接器。

```
AI 应用 A → 自己写 GitHub 连接器
AI 应用 B → 自己写 Slack 连接器
AI 应用 C → 自己写数据库连接器

结果：重复造轮子，质量参差不齐
```

**MCP 后**：统一的协议，一次开发，到处可用。

```
MCP Server（GitHub）←→ MCP Client（Claude）
MCP Server（Slack）  ←→ MCP Client（你的 Agent）
MCP Server（Database）←→ MCP Client（其他 AI）

结果：开发者只需写 MCP Server，所有 AI 应用都能用
```

## MCP 架构

```
┌─────────────────────────────────────────┐
│           AI 应用（Claude / Agent）       │
│                                         │
│  ┌─────────────┐                        │
│  │ MCP Client  │                        │
│  └─────────────┘                        │
└─────────────────┬───────────────────────┘
                  │ MCP 协议
                  ▼
┌─────────────────────────────────────────┐
│           MCP Server                     │
│  ┌─────────────┐  ┌─────────────┐       │
│  │   Tools     │  │  Resources  │       │
│  │  （工具）    │  │  （资源）    │       │
│  └─────────────┘  └─────────────┘       │
└─────────────────────────────────────────┘
                  │
                  ▼
         外部系统（GitHub / Slack / DB）
```

**核心概念**：
- **Tools**：Agent 能调用的函数
- **Resources**：Agent 能读取的数据
- **Prompts**：预定义的 Prompt 模板

## 快速开始：写一个 MCP Server

用 Python 写一个最简单的 MCP Server，提供"获取时间"工具。

```python
# time_server.py
from mcp.server import Server
from mcp.server.stdio import stdio_server
from mcp.types import Tool, TextContent
from datetime import datetime

# 创建 Server
server = Server("time-server")

# 定义工具
@server.list_tools()
async def list_tools():
    return [
        Tool(
            name="get_current_time",
            description="获取当前时间",
            inputSchema={"type": "object", "properties": {}}
        )
    ]

# 处理工具调用
@server.call_tool()
async def call_tool(name: str, arguments: dict):
    if name == "get_current_time":
        time = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        return [TextContent(type="text", text=f"当前时间：{time}")]
    
    raise ValueError(f"未知工具：{name}")

# 启动
async def main():
    async with stdio_server() as (read_stream, write_stream):
        await server.run(read_stream, write_stream)

if __name__ == "__main__":
    import asyncio
    asyncio.run(main())
```

## 连接到 Claude Desktop

Claude Desktop 支持 MCP。配置 `claude_desktop_config.json`：

```json
{
  "mcpServers": {
    "time": {
      "command": "python",
      "args": ["/path/to/time_server.py"]
    }
  }
}
```

重启 Claude Desktop，就能在对话中调用这个工具了：

```
你：现在几点了？

Claude：[调用 get_current_time 工具]
当前时间：2026-04-24 20:30:00
```

## 连接到你的 Agent

如果你有自己的 Agent，可以用 MCP Client SDK：

```python
from mcp import ClientSession
from mcp.client.stdio import stdio_client

async def use_mcp_tools():
    # 连接到 MCP Server
    async with stdio_client("python", ["time_server.py"]) as (read, write):
        async with ClientSession(read, write) as session:
            await session.initialize()
            
            # 列出可用工具
            tools = await session.list_tools()
            print(f"可用工具：{[t.name for t in tools.tools]}")
            
            # 调用工具
            result = await session.call_tool("get_current_time", {})
            print(result.content[0].text)

# 运行
import asyncio
asyncio.run(use_mcp_tools())
```

## 实际例子：GitHub MCP Server

官方提供了 GitHub MCP Server，让 Agent 能操作 GitHub：

```json
{
  "mcpServers": {
    "github": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-github"],
      "env": {
        "GITHUB_TOKEN": "ghp_xxx"
      }
    }
  }
}
```

Agent 就能：

```
你：帮我查看 afine907/jojo-code 的最新 issue

Claude：[调用 GitHub MCP 工具]
最新的 issue 是 #25：Agent 在长对话中会崩溃...
```

## MCP vs 传统方案对比

| 方案 | 优点 | 缺点 |
|------|------|------|
| 传统 API | 直接调用 | 每个应用重复实现 |
| LangChain Tools | 统一接口 | 仅限 LangChain 生态 |
| MCP | 跨平台、标准化 | 相对较新，生态还在发展 |

**什么时候用 MCP**：
- 需要跨多个 AI 应用共享工具
- 想让 Claude Desktop 也能用你的工具
- 想标准化你的工具接口

**什么时候不用**：
- 只有一个应用，不需要共享
- MCP 生态还没覆盖你的场景
- 项目已经用 LangChain Tools，迁移成本高

## 我踩过的坑

**坑一：MCP Server 启动失败**

配置了路径，但 Claude Desktop 没有报错，就是调不了。

解决：检查路径是否正确，用绝对路径：

```json
{
  "command": "python",
  "args": ["/Users/xxx/time_server.py"]  // ✅ 绝对路径
}
```

**坑二：工具返回格式错误**

返回了字符串，但 MCP 期望的是结构化对象。

解决：用 `TextContent` 包装：

```python
return [TextContent(type="text", text="你的内容")]
```

**坑三：异步问题**

在同步函数里调用异步 MCP 方法，报错。

解决：全部用 async/await：

```python
async def call_tool():
    result = await session.call_tool(...)
```

## 下一步行动

1. **跑通官方示例**：GitHub MCP Server 或 Filesystem MCP Server
2. **写一个自己的 MCP Server**：封装你的内部工具
3. **在 Claude Desktop 测试**：验证是否可用

MCP 的核心价值是：**一次开发，到处可用**。

---

MCP 就像 AI 的 USB-C：统一的接口，让 Agent 能即插即用各种工具和数据源。
