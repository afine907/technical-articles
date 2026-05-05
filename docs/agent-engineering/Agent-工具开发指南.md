---
slug: tool-development
sidebar_position: 12
title: Agent 工具怎么写？从原理到最佳实践
---


你用 LangGraph 跑通了官方示例，现在想加自己的工具。但官方文档讲得很浅：加个 `@tool` 装饰器就完事了？

实际上，写好一个工具远不止这些。错误处理怎么做？参数验证怎么做？安全性怎么保证？性能怎么优化？

这篇文章，我从原理到最佳实践，深入讲解 Agent 工具开发。

## 工具的本质是什么？

工具 = **输入 Schema + 执行逻辑 + 输出格式**。

```
┌─────────────────────────────────────────────────┐
│                   Agent 调用工具                 │
└─────────────────────────────────────────────────┘
                      │
                      ▼
┌─────────────────────────────────────────────────┐
│  1. LLM 根据 Schema 生成参数                     │
│     {"path": "README.md", "lines": 10}          │
└─────────────────────────────────────────────────┘
                      │
                      ▼
┌─────────────────────────────────────────────────┐
│  2. 工具执行                                     │
│     - 参数验证                                   │
│     - 权限检查                                   │
│     - 执行操作                                   │
│     - 错误处理                                   │
└─────────────────────────────────────────────────┘
                      │
                      ▼
┌─────────────────────────────────────────────────┐
│  3. 返回结果                                     │
│     "README.md 的前 10 行是..."                  │
└─────────────────────────────────────────────────┘
```

LLM 不知道工具内部怎么实现，只知道：
1. 工具能做什么（从 description）
2. 需要什么参数（从 inputSchema）

## 工具 Schema 详解

### inputSchema 的作用

inputSchema 告诉 LLM：
- 需要传哪些参数
- 参数的类型是什么
- 哪些参数是必需的

```python
from langchain_core.tools import tool
from typing import Optional

@tool
def read_file(
    path: str,
    start_line: int = 1,
    end_line: Optional[int] = None,
    encoding: str = "utf-8",
) -> str:
    """读取文件的指定行
    
    Args:
        path: 文件路径（必需）
        start_line: 起始行号，从 1 开始（默认 1）
        end_line: 结束行号，不指定则读到文件末尾
        encoding: 文件编码（默认 utf-8）
    
    Returns:
        文件内容
    """
    pass
```

生成的 Schema：

```json
{
  "name": "read_file",
  "description": "读取文件的指定行",
  "parameters": {
    "type": "object",
    "properties": {
      "path": {
        "type": "string",
        "description": "文件路径（必需）"
      },
      "start_line": {
        "type": "integer",
        "description": "起始行号，从 1 开始（默认 1）",
        "default": 1
      },
      "end_line": {
        "type": "integer",
        "description": "结束行号，不指定则读到文件末尾"
      },
      "encoding": {
        "type": "string",
        "description": "文件编码（默认 utf-8）",
        "default": "utf-8"
      }
    },
    "required": ["path"]
  }
}
```

**LLM 如何使用这个 Schema**：

```
用户：读取 README.md 的前 10 行

LLM 推理：
- path = "README.md"（必需参数）
- end_line = 10（用户指定了"前 10 行"）
- start_line = 1（默认值）
- encoding = "utf-8"（默认值）

生成调用：
read_file(path="README.md", end_line=10)
```

### description 的写法

description 决定 LLM 是否会正确使用工具。

**❌ 错误示例**：

```python
@tool
def search(query: str) -> str:
    """搜索"""
    pass
```

问题：
- 搜索什么？文件？网络？数据库？
- 返回什么格式？
- 有什么限制？

**✅ 正确示例**：

```python
@tool
def search_files(keyword: str, directory: str = ".", max_results: int = 20) -> str:
    """在目录下搜索包含关键词的文件
    
    功能：
    - 搜索指定目录下所有文件
    - 返回包含关键词的文件列表
    - 支持递归搜索子目录
    
    限制：
    - 最多返回 max_results 个结果
    - 只搜索文本文件（跳过二进制文件）
    - 单文件大小限制 10MB
    
    Args:
        keyword: 搜索关键词
        directory: 搜索目录，默认当前目录
        max_results: 最大结果数，默认 20
    
    Returns:
        匹配的文件列表，格式：
        - 文件路径: 匹配行数
    """
    pass
```

## 工具实现最佳实践

### 1. 参数验证

永远不要相信 LLM 生成的参数。

```python
from pathlib import Path

@tool
def read_file(path: str, max_size_mb: int = 10) -> str:
    """读取文件内容"""
    
    # 参数验证
    if not path:
        return "错误：文件路径不能为空"
    
    if max_size_mb <= 0 or max_size_mb > 100:
        return "错误：max_size_mb 必须在 1-100 之间"
    
    # 路径验证
    try:
        file_path = Path(path).resolve()
    except Exception as e:
        return f"错误：无效的路径 {path}"
    
    # 文件存在性检查
    if not file_path.exists():
        return f"错误：文件不存在 {path}"
    
    if not file_path.is_file():
        return f"错误：{path} 不是文件"
    
    # 文件大小检查
    size_mb = file_path.stat().st_size / 1024 / 1024
    if size_mb > max_size_mb:
        return f"错误：文件过大 ({size_mb:.1f}MB)，超过限制 ({max_size_mb}MB)"
    
    # 执行读取
    try:
        return file_path.read_text(encoding="utf-8")
    except UnicodeDecodeError:
        return "错误：文件编码不支持，可能不是文本文件"
    except PermissionError:
        return f"错误：没有权限读取 {path}"
    except Exception as e:
        return f"错误：{type(e).__name__}: {str(e)}"
```

### 2. 安全检查

工具是 Agent 的"手脚"，必须限制它的能力。

```python
import os
from pathlib import Path

# 定义安全边界
ALLOWED_DIRECTORIES = [
    Path.home() / "projects",
    Path("/tmp"),
]

DENIED_PATTERNS = [
    ".env",
    ".pem",
    ".key",
    "id_rsa",
    "credentials",
]

def is_path_allowed(path: Path) -> tuple[bool, str]:
    """检查路径是否允许访问"""
    
    # 解析绝对路径
    try:
        abs_path = path.resolve()
    except Exception as e:
        return False, f"无效路径: {e}"
    
    # 检查是否在允许的目录内
    in_allowed = any(
        str(abs_path).startswith(str(allowed))
        for allowed in ALLOWED_DIRECTORIES
    )
    
    if not in_allowed:
        return False, f"路径不在允许的目录内: {abs_path}"
    
    # 检查敏感文件
    path_str = str(abs_path).lower()
    for pattern in DENIED_PATTERNS:
        if pattern in path_str:
            return False, f"不允许访问敏感文件: {pattern}"
    
    return True, "OK"

@tool
def write_file(path: str, content: str) -> str:
    """写入文件"""
    
    # 安全检查
    file_path = Path(path)
    allowed, reason = is_path_allowed(file_path)
    
    if not allowed:
        return f"安全拒绝: {reason}"
    
    # 执行写入
    try:
        file_path.write_text(content, encoding="utf-8")
        return f"成功: 已写入 {path}"
    except Exception as e:
        return f"错误: {str(e)}"
```

### 3. 资源限制

防止工具消耗过多资源。

```python
import time
import signal
from contextlib import contextmanager

class TimeoutError(Exception):
    pass

@contextmanager
def time_limit(seconds: int):
    """执行时间限制"""
    def signal_handler(signum, frame):
        raise TimeoutError(f"执行超时 ({seconds}秒)")
    
    signal.signal(signal.SIGALRM, signal_handler)
    signal.alarm(seconds)
    
    try:
        yield
    finally:
        signal.alarm(0)

@tool
def execute_command(command: str, timeout: int = 30) -> str:
    """执行 shell 命令"""
    
    # 安全检查
    dangerous_commands = ["rm -rf", "sudo", "chmod 777", "> /dev/sda"]
    for dangerous in dangerous_commands:
        if dangerous in command:
            return f"安全拒绝: 不允许执行危险命令"
    
    # 资源限制
    try:
        with time_limit(timeout):
            import subprocess
            result = subprocess.run(
                command,
                shell=True,
                capture_output=True,
                text=True,
                timeout=timeout,
            )
            return result.stdout or result.stderr
    except TimeoutError:
        return f"错误: 命令执行超时 ({timeout}秒)"
    except Exception as e:
        return f"错误: {str(e)}"
```

### 4. 结构化输出

返回结构化数据，方便 LLM 解析。

```python
import json
from typing import Any

@tool
def analyze_code(file_path: str) -> str:
    """分析代码文件"""
    
    # 分析代码
    result = {
        "file": file_path,
        "language": detect_language(file_path),
        "lines": 0,
        "functions": [],
        "classes": [],
        "imports": [],
        "complexity": "low",
    }
    
    # ... 分析逻辑 ...
    
    # 返回 JSON 字符串
    return json.dumps(result, ensure_ascii=False, indent=2)

# LLM 看到的输出：
"""
{
  "file": "main.py",
  "language": "Python",
  "lines": 150,
  "functions": ["main", "process_data", "save_result"],
  "classes": ["DataProcessor"],
  "imports": ["json", "pathlib", "typing"],
  "complexity": "medium"
}
"""
```

## 工具注册和管理

### 简单方案：列表管理

```python
# 定义工具列表
TOOLS = [
    read_file,
    write_file,
    list_files,
    search_files,
]

# 绑定到 LLM
from langchain_openai import ChatOpenAI

llm = ChatOpenAI(model="gpt-4")
llm_with_tools = llm.bind_tools(TOOLS)
```

### 进阶方案：工具注册表

```python
from typing import Callable, Any
from dataclasses import dataclass, field
from enum import Enum

class ToolCategory(Enum):
    READ = "read"      # 只读操作
    WRITE = "write"    # 写入操作
    EXECUTE = "execute"  # 执行命令
    NETWORK = "network"  # 网络请求

@dataclass
class RegisteredTool:
    tool: Callable
    category: ToolCategory
    cost: float = 0.0  # 预估成本
    risk: str = "low"  # low / medium / high

class ToolRegistry:
    """工具注册表"""
    
    def __init__(self):
        self._tools: dict[str, RegisteredTool] = {}
    
    def register(
        self,
        tool: Callable,
        category: ToolCategory,
        cost: float = 0.0,
        risk: str = "low",
    ):
        """注册工具"""
        name = tool.name
        self._tools[name] = RegisteredTool(
            tool=tool,
            category=category,
            cost=cost,
            risk=risk,
        )
    
    def get_tool(self, name: str) -> RegisteredTool | None:
        """获取工具"""
        return self._tools.get(name)
    
    def get_tools_by_category(self, category: ToolCategory) -> list[Callable]:
        """按类别获取工具"""
        return [
            rt.tool for rt in self._tools.values()
            if rt.category == category
        ]
    
    def get_tools_by_risk(self, max_risk: str = "medium") -> list[Callable]:
        """按风险等级获取工具"""
        risk_levels = {"low": 1, "medium": 2, "high": 3}
        max_level = risk_levels[max_risk]
        
        return [
            rt.tool for rt in self._tools.values()
            if risk_levels[rt.risk] <= max_level
        ]
    
    def get_langchain_tools(self) -> list[Callable]:
        """获取 LangChain 格式的工具列表"""
        return [rt.tool for rt in self._tools.values()]

# 使用
registry = ToolRegistry()

registry.register(read_file, ToolCategory.READ, cost=0.001, risk="low")
registry.register(write_file, ToolCategory.WRITE, cost=0.002, risk="medium")
registry.register(execute_command, ToolCategory.EXECUTE, cost=0.01, risk="high")

# 按风险等级选择工具
safe_tools = registry.get_tools_by_risk("low")  # 只允许低风险工具
```

## 异步工具

LLM 调用是异步的，工具也应该是异步的。

```python
import aiofiles
import asyncio

@tool
async def read_file_async(path: str) -> str:
    """异步读取文件"""
    
    try:
        async with aiofiles.open(path, mode='r', encoding='utf-8') as f:
            content = await f.read()
        return content
    except Exception as e:
        return f"错误: {str(e)}"

# 在 Agent 中使用
async def execute_node(state: AgentState) -> dict:
    """执行节点（异步版本）"""
    
    results = []
    for tc in state["tool_calls"]:
        tool = get_tool(tc["name"])
        
        # 异步执行
        if asyncio.iscoroutinefunction(tool.invoke):
            result = await tool.ainvoke(tc["args"])
        else:
            result = tool.invoke(tc["args"])
        
        results.append(result)
    
    return {"tool_results": results}
```

## 工具测试

工具必须有单元测试。

```python
import pytest
from tempfile import TemporaryDirectory
from pathlib import Path

def test_read_file_exists():
    """测试读取存在的文件"""
    with TemporaryDirectory() as tmpdir:
        test_file = Path(tmpdir) / "test.txt"
        test_file.write_text("Hello, World!")
        
        result = read_file.invoke({"path": str(test_file)})
        
        assert "Hello, World!" in result
        assert "错误" not in result

def test_read_file_not_exists():
    """测试读取不存在的文件"""
    result = read_file.invoke({"path": "/nonexistent/file.txt"})
    
    assert "错误" in result
    assert "不存在" in result

def test_read_file_too_large():
    """测试读取超大文件"""
    with TemporaryDirectory() as tmpdir:
        test_file = Path(tmpdir) / "large.txt"
        # 创建 15MB 文件
        test_file.write_bytes(b"x" * (15 * 1024 * 1024))
        
        result = read_file.invoke({
            "path": str(test_file),
            "max_size_mb": 10,
        })
        
        assert "错误" in result
        assert "过大" in result

def test_read_file_binary():
    """测试读取二进制文件"""
    with TemporaryDirectory() as tmpdir:
        test_file = Path(tmpdir) / "binary.bin"
        test_file.write_bytes(b"\x00\x01\x02\x03")
        
        result = read_file.invoke({"path": str(test_file)})
        
        assert "错误" in result or "编码" in result

# 运行测试
# pytest tests/test_tools.py -v
```

## 我踩过的真实坑

### 坑一：参数类型错误

**现象**：LLM 生成了错误的参数类型。

```python
# LLM 生成的调用
read_file.invoke({"path": 123})  # 数字而不是字符串

# 工具内部报错
# AttributeError: 'int' object has no attribute 'exists'
```

**解决**：参数强制转换 + 类型检查。

```python
def read_file(path: str) -> str:
    path = str(path)  # 强制转换
    
    if not isinstance(path, str):
        return "错误: path 必须是字符串"
    
    # ... 继续处理
```

### 坑二：工具返回 None

**现象**：工具没有返回值，LLM 不知道发生了什么。

```python
@tool
def write_file(path: str, content: str):
    """写入文件"""
    Path(path).write_text(content)
    # 没有 return！
```

**解决**：永远返回明确的确认信息。

```python
@tool
def write_file(path: str, content: str) -> str:
    """写入文件"""
    Path(path).write_text(content)
    return f"成功: 已写入 {path}，共 {len(content)} 字符"  # 明确返回
```

### 坑三：工具抛异常

**现象**：工具抛异常，Agent 崩溃。

```python
@tool
def read_file(path: str) -> str:
    with open(path) as f:  # 可能抛 FileNotFoundError
        return f.read()
```

**解决**：捕获所有异常，返回错误信息。

```python
@tool
def read_file(path: str) -> str:
    try:
        with open(path) as f:
            return f.read()
    except FileNotFoundError:
        return f"错误: 文件不存在 {path}"
    except Exception as e:
        return f"错误: {type(e).__name__}: {str(e)}"
```

## 下一步行动

1. **定义你的工具列表**：Agent 需要什么能力？
2. **写第一个工具**：从最简单的开始
3. **加参数验证和安全检查**：不要相信任何输入
4. **写单元测试**：每个工具至少 3 个测试用例

工具是 Agent 的"手脚"，写好工具，Agent 才能做真正有用的事。

---

工具不是简单的函数包装，而是需要考虑：参数验证、安全检查、资源限制、错误处理、结构化输出。这些做好了，Agent 才可靠。
