---
sidebar_position: 10
title: Agent + MCP：从原理到实战，一次讲清楚
slug: mcp-guide
---


Claude 发布了 MCP（Model Context Protocol），大家都在讨论。MCP 到底解决了什么问题？简单说：它给了 AI Agent 一个标准化的方式来连接外部数据源和工具——读 GitHub 仓库、查 Slack 消息、访问数据库——不用为每个服务单独写集成代码。

## MCP 到底解决什么问题？

假设你是一个 AI 应用开发者，你想让 Agent 能：

- 读取用户的 GitHub 仓库
- 查用户的 Slack 消息
- 访问用户的数据库

传统方案：

```
你的 App → 自己写 GitHub API 集成
你的 App → 自己写 Slack API 集成
你的 App → 自己写 Database 连接器

问题：
1. 每个 App 都要重复开发
2. API 变了要跟着改
3. 认证逻辑各不相同
```

MCP 的方案：

```
GitHub MCP Server ←──┐
Slack MCP Server   ←──┼── 所有 AI App 都能复用
DB MCP Server      ←──┘

好处：
1. 写一次，到处可用
2. 统一的协议
3. 社区维护
```

**核心价值：标准化**。就像 USB-C 统一了充电接口，MCP 统一了 AI 和外部系统的连接方式。

## MCP 协议详解

MCP 基于 JSON-RPC 2.0，通信方式有两种：

### 方式一：stdio（标准输入输出）

适合：本地工具、CLI 应用。

```
AI App ─── stdin/stdout ─── MCP Server

流程：
1. AI App 启动 MCP Server 进程
2. 通过 stdin 发送 JSON 请求
3. MCP Server 通过 stdout 返回 JSON 响应
```

### 方式二：HTTP + SSE

适合：远程服务、Web 应用。

```
AI App ─── HTTP/SSE ─── MCP Server

流程：
1. AI App 连接 MCP Server 的 HTTP 端点
2. 通过 POST 发送请求
3. 通过 SSE 接收流式响应
```

**我们重点讲 stdio**，因为更简单，也是 Claude Desktop 用的方式。

## MCP Server 的核心概念

一个 MCP Server 可以提供三类能力：

### 1. Tools（工具）

Agent 能调用的函数。

```python
# 定义一个工具
@server.list_tools()
async def list_tools():
    return [
        Tool(
            name="read_file",
            description="读取文件内容",
            inputSchema={
                "type": "object",
                "properties": {
                    "path": {
                        "type": "string",
                        "description": "文件路径"
                    }
                },
                "required": ["path"]
            }
        )
    ]

# 实现工具
@server.call_tool()
async def call_tool(name: str, arguments: dict):
    if name == "read_file":
        path = arguments["path"]
        with open(path) as f:
            content = f.read()
        return [TextContent(type="text", text=content)]
```

### 2. Resources（资源）

Agent 能读取的数据（文件、数据库记录等）。

```python
@server.list_resources()
async def list_resources():
    return [
        Resource(
            uri="file:///config.json",
            name="配置文件",
            mimeType="application/json"
        )
    ]

@server.read_resource()
async def read_resource(uri: str):
    if uri == "file:///config.json":
        with open("config.json") as f:
            return f.read()
```

**Tools vs Resources 的区别**：
- Tools：有副作用（写文件、发请求）
- Resources：只读（查询数据）

### 3. Prompts（提示词模板）

预定义的 Prompt，用户可以快速调用。

```python
@server.list_prompts()
async def list_prompts():
    return [
        Prompt(
            name="review_code",
            description="代码审查",
            arguments=[
                PromptArgument(name="code", required=True)
            ]
        )
    ]

@server.get_prompt()
async def get_prompt(name: str, arguments: dict):
    if name == "review_code":
        code = arguments["code"]
        return f"""请审查以下代码，指出问题和改进建议：

{code}

审查要点：
1. 代码风格
2. 潜在 bug
3. 性能问题
4. 安全隐患"""
```

## 完整的 MCP Server 示例

我写了一个真实的 MCP Server：项目助手，能读取项目文件、分析代码、生成文档。

```python
# project_assistant_server.py
from mcp.server import Server
from mcp.server.stdio import stdio_server
from mcp.types import Tool, TextContent, Resource, Prompt, PromptArgument
from pathlib import Path
import json

server = Server("project-assistant")

# ===== Tools =====

@server.list_tools()
async def list_tools():
    return [
        Tool(
            name="list_files",
            description="列出项目文件",
            inputSchema={
                "type": "object",
                "properties": {
                    "directory": {"type": "string", "description": "目录路径"},
                    "pattern": {"type": "string", "description": "文件模式，如 *.py"}
                }
            }
        ),
        Tool(
            name="read_file",
            description="读取文件内容",
            inputSchema={
                "type": "object",
                "properties": {
                    "path": {"type": "string", "description": "文件路径"}
                },
                "required": ["path"]
            }
        ),
        Tool(
            name="analyze_code",
            description="分析代码结构",
            inputSchema={
                "type": "object",
                "properties": {
                    "path": {"type": "string", "description": "代码文件路径"}
                },
                "required": ["path"]
            }
        )
    ]

@server.call_tool()
async def call_tool(name: str, arguments: dict):
    if name == "list_files":
        directory = Path(arguments.get("directory", "."))
        pattern = arguments.get("pattern", "*")
        files = list(directory.glob(pattern))
        result = "\n".join(str(f) for f in files[:100])  # 最多 100 个
        return [TextContent(type="text", text=result)]
    
    elif name == "read_file":
        path = Path(arguments["path"])
        if not path.exists():
            return [TextContent(type="text", text=f"错误：文件不存在 {path}")]
        content = path.read_text(encoding="utf-8")
        return [TextContent(type="text", text=content)]
    
    elif name == "analyze_code":
        path = Path(arguments["path"])
        code = path.read_text(encoding="utf-8")
        
        # 简单的代码分析
        lines = code.split("\n")
        imports = [l for l in lines if l.startswith("import ") or l.startswith("from ")]
        functions = [l for l in lines if l.startswith("def ")]
        classes = [l for l in lines if l.startswith("class ")]
        
        analysis = f"""代码分析：{path.name}

统计：
- 总行数：{len(lines)}
- 导入：{len(imports)}
- 函数：{len(functions)}
- 类：{len(classes)}

导入列表：
{chr(10).join(imports[:10])}

函数列表：
{chr(10).join(functions[:10])}
"""
        return [TextContent(type="text", text=analysis)]
    
    raise ValueError(f"未知工具：{name}")

# ===== Resources =====

@server.list_resources()
async def list_resources():
    return [
        Resource(
            uri="project:///README.md",
            name="README",
            mimeType="text/markdown"
        ),
        Resource(
            uri="project:///pyproject.toml",
            name="项目配置",
            mimeType="text/toml"
        )
    ]

@server.read_resource()
async def read_resource(uri: str):
    if uri.startswith("project:///"):
        filename = uri.replace("project:///", "")
        path = Path(filename)
        if path.exists():
            return path.read_text(encoding="utf-8")
    return None

# ===== Prompts =====

@server.list_prompts()
async def list_prompts():
    return [
        Prompt(
            name="review_project",
            description="审查整个项目",
            arguments=[]
        ),
        Prompt(
            name="explain_code",
            description="解释代码",
            arguments=[
                PromptArgument(name="file", description="文件路径", required=True)
            ]
        )
    ]

@server.get_prompt()
async def get_prompt(name: str, arguments: dict):
    if name == "review_project":
        return """请审查当前项目：

1. 分析项目结构
2. 检查代码质量
3. 指出改进建议

使用 list_files 和 analyze_code 工具进行分析。"""
    
    elif name == "explain_code":
        file = arguments.get("file")
        return f"""请解释以下代码的作用和实现原理：

文件：{file}

使用 read_file 工具读取代码，然后：
1. 解释主要功能
2. 说明关键逻辑
3. 指出设计模式"""

# ===== 启动 =====

async def main():
    async with stdio_server() as (read_stream, write_stream):
        await server.run(read_stream, write_stream)

if __name__ == "__main__":
    import asyncio
    asyncio.run(main)
```

## 连接到 Claude Desktop

配置 `~/Library/Application Support/Claude/claude_desktop_config.json`（macOS）：

```json
{
  "mcpServers": {
    "project-assistant": {
      "command": "python",
      "args": ["/Users/xxx/project_assistant_server.py"],
      "env": {
        "PYTHONUNBUFFERED": "1"
      }
    }
  }
}
```

重启 Claude Desktop，在对话中就能用了：

```
你：分析一下当前项目的代码结构

Claude：[调用 list_files 和 analyze_code]
根据分析，项目有 15 个 Python 文件，主要模块：
- core/: 核心逻辑
- utils/: 工具函数
- tests/: 测试用例
...
```

## 连接到你的 Agent

如果你有自己的 Agent（LangGraph），可以用 MCP Client：

```python
from mcp import ClientSession
from mcp.client.stdio import stdio_client, StdioServerParameters
from contextlib import asynccontextmanager

class MCPToolProvider:
    """把 MCP Server 包装成 LangGraph 工具"""
    
    def __init__(self, command: str, args: list[str]):
        self.command = command
        self.args = args
        self.session = None
    
    @asynccontextmanager
    async def connect(self):
        """连接到 MCP Server"""
        server = StdioServerParameters(
            command=self.command,
            args=self.args
        )
        
        async with stdio_client(server) as (read, write):
            async with ClientSession(read, write) as session:
                self.session = session
                await session.initialize()
                yield self
    
    async def get_tools(self):
        """获取 MCP 工具列表"""
        result = await self.session.list_tools()
        return result.tools
    
    async def call_tool(self, name: str, arguments: dict):
        """调用 MCP 工具"""
        result = await self.session.call_tool(name, arguments)
        return result.content[0].text

# 在 LangGraph 中使用
async def thinking_node(state):
    # 连接 MCP
    async with MCPToolProvider("python", ["project_assistant_server.py"]).connect() as mcp:
        # 获取工具
        tools = await mcp.get_tools()
        
        # 调用工具
        files = await mcp.call_tool("list_files", {"pattern": "*.py"})
        
        return {"files": files}
```

## 我踩过的坑（真实经验）

### 坑一：MCP Server 没有输出

**现象**：配置了 MCP，但 Claude Desktop 没有任何反应。

**原因**：Python 输出被缓冲了。

**解决**：

```python
# 方法一：环境变量
"env": {"PYTHONUNBUFFERED": "1"}

# 方法二：代码里刷新
import sys
print(result, flush=True)
sys.stdout.flush()
```

### 坑二：工具参数类型错误

**现象**：Claude 调用工具时报错 "Invalid arguments"。

**原因**：inputSchema 定义和实际调用不匹配。

```python
# 错误
inputSchema={
    "properties": {
        "path": {"type": "string"}
    }
}
# Claude 可能传：{"path": 123}  # 数字而不是字符串

# 正确
inputSchema={
    "type": "object",
    "properties": {
        "path": {"type": "string"}
    },
    "required": ["path"]
}
```

### 坑三：工具返回内容太长

**现象**：读取大文件后，Claude 报错。

**原因**：MCP 返回的内容有大小限制（约 1MB）。

**解决**：

```python
MAX_CONTENT_SIZE = 100 * 1024  # 100KB

async def call_tool(name: str, arguments: dict):
    if name == "read_file":
        content = Path(arguments["path"]).read_text()
        
        # 截断过长内容
        if len(content) > MAX_CONTENT_SIZE:
            content = content[:MAX_CONTENT_SIZE]
            content += f"\n\n... (内容过长，已截断，共 {len(content)} 字符)"
        
        return [TextContent(type="text", text=content)]
```

### 坑四：异步问题

**现象**：在同步函数里调用 MCP，报错 "coroutine was never awaited"。

**原因**：MCP 是全异步的。

**解决**：全链路 async/await。

```python
# 错误
def get_tools():  # 同步函数
    return await session.list_tools()  # ❌

# 正确
async def get_tools():  # 异步函数
    return await session.list_tools()  # ✅
```

### 坑五：MCP Server 崩溃没有提示

**现象**：调用工具后没反应，也不知道哪里错了。

**解决**：加日志。

```python
import logging

logging.basicConfig(
    level=logging.DEBUG,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s',
    handlers=[logging.FileHandler('mcp_server.log')]
)

logger = logging.getLogger(__name__)

@server.call_tool()
async def call_tool(name: str, arguments: dict):
    logger.info(f"调用工具: {name}, 参数: {arguments}")
    try:
        result = await do_something(arguments)
        logger.info(f"工具返回: {result[:100]}...")
        return result
    except Exception as e:
        logger.error(f"工具失败: {e}", exc_info=True)
        raise
```

## 现成的 MCP Server 推荐

不用自己写，社区有很多现成的：

| MCP Server | 功能 |
|-----------|------|
| `@modelcontextprotocol/server-github` | GitHub 操作 |
| `@modelcontextprotocol/server-filesystem` | 文件系统 |
| `@modelcontextprotocol/server-postgres` | PostgreSQL |
| `@modelcontextprotocol/server-slack` | Slack |
| `@modelcontextprotocol/server-brave-search` | Brave 搜索 |

使用示例：

```json
{
  "mcpServers": {
    "github": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-github"],
      "env": {
        "GITHUB_TOKEN": "ghp_xxx"
      }
    },
    "filesystem": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-filesystem", "/Users/xxx/projects"]
    }
  }
}
```

## MCP vs LangChain Tools

| 对比 | LangChain Tools | MCP |
|------|----------------|-----|
| 生态 | LangChain 专属 | 跨平台（Claude、Cursor 等） |
| 学习成本 | 低 | 中（新协议） |
| 工具数量 | 多 | 少（但增长快） |
| 适用场景 | 单一应用 | 需要跨多个 AI 应用共享 |

**我的建议**：
- 如果只用 LangChain：继续用 LangChain Tools
- 如果想复用工具：MCP
- 如果想让 Claude Desktop 也能用：MCP

## 下一步行动

1. **跑通官方示例**：先试试 GitHub MCP Server
2. **写一个简单的 MCP Server**：包装你常用的工具
3. **在 Claude Desktop 测试**：验证是否可用
4. **集成到你的 Agent**：用 MCP Client SDK

MCP 的核心价值是：**一次开发，到处可用**。虽然现在生态还不大，但协议设计得很清晰，值得投入时间学习。

---

MCP 就像 AI 的 USB-C：统一的接口，让 Agent 能即插即用各种工具和数据源。现在还在早期，但值得提前布局。
