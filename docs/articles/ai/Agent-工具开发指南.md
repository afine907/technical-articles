# Agent 工具怎么写？从 0 到 1 开发你的第一个工具

你用 LangGraph 构建了 Agent，跑通了官方示例。现在想加个自己的工具，却发现不知道从哪下手。

我之前也是这样。Agent 跑起来了，但只会调用官方的几个工具。想加一个"查询数据库"的工具，折腾了一下午才搞定。

这篇文章，我来帮你从 0 到 1 写一个 Agent 工具。

## 工具是什么？

一句话：**工具就是 Agent 能调用的函数**。

LLM 本身只能"说话"，不能做实际的事。工具让 Agent 能读写文件、调用 API、执行命令。

打个比方：
- LLM 是大脑，负责决策
- 工具是手脚，负责执行

Agent 的执行流程：

```
用户输入 → LLM 决策"我要调用 read_file 工具" → 执行工具 → 返回结果 → LLM 继续决策
```

## 最简单的工具

先写一个最简单的：获取当前时间。

```python
from datetime import datetime

def get_current_time() -> str:
    """获取当前时间"""
    return datetime.now().strftime("%Y-%m-%d %H:%M:%S")
```

就这么简单，一个普通函数。

但要让 Agent 能调用，还需要两步：

**1. 定义工具 Schema**

告诉 LLM 这个工具叫什么、有什么参数：

```python
from langchain_core.tools import tool

@tool
def get_current_time() -> str:
    """获取当前时间
    
    Returns:
        当前时间的字符串，格式为 YYYY-MM-DD HH:MM:SS
    """
    return datetime.now().strftime("%Y-%m-%d %H:%M:%S")
```

`@tool` 装饰器会自动生成 Schema。

**2. 绑定到 LLM**

```python
from langchain_openai import ChatOpenAI

llm = ChatOpenAI(model="gpt-4")
llm_with_tools = llm.bind_tools([get_current_time])

# 测试
response = llm_with_tools.invoke("现在几点了？")
print(response.tool_calls)
# 输出: [{'name': 'get_current_time', 'args': {}, 'id': 'call_xxx'}]
```

LLM 看到问题后，决定调用 `get_current_time` 工具。

## 带参数的工具

实际场景中，大部分工具都有参数。

比如：读取文件指定行数。

```python
@tool
def read_file_lines(file_path: str, start_line: int = 1, end_line: int = 10) -> str:
    """读取文件的指定行
    
    Args:
        file_path: 文件路径
        start_line: 起始行号，从1开始
        end_line: 结束行号
    
    Returns:
        文件内容
    """
    try:
        with open(file_path, 'r', encoding='utf-8') as f:
            lines = f.readlines()
            return ''.join(lines[start_line-1:end_line])
    except FileNotFoundError:
        return f"错误：文件 {file_path} 不存在"
    except Exception as e:
        return f"读取失败：{str(e)}"
```

LLM 调用时会自动传参：

```python
response = llm_with_tools.invoke("读取 README.md 的前 5 行")
print(response.tool_calls)
# 输出: [{'name': 'read_file_lines', 'args': {'file_path': 'README.md', 'end_line': 5}, 'id': 'xxx'}]
```

注意：`start_line` 有默认值 1，LLM 可能不会传这个参数。你的代码要能处理。

## 工具注册

多个工具需要注册到 Registry：

```python
class ToolRegistry:
    def __init__(self):
        self.tools = {}
    
    def register(self, tool):
        """注册工具"""
        self.tools[tool.name] = tool
    
    def get_langchain_tools(self):
        """获取 LangChain 格式的工具列表"""
        return list(self.tools.values())
    
    def execute(self, name: str, args: dict) -> str:
        """执行工具"""
        if name not in self.tools:
            return f"错误：工具 {name} 不存在"
        
        tool = self.tools[name]
        return tool.invoke(args)

# 使用
registry = ToolRegistry()
registry.register(get_current_time)
registry.register(read_file_lines)

# 获取工具列表用于绑定
tools = registry.get_langchain_tools()
llm_with_tools = llm.bind_tools(tools)
```

## 完整示例

把前面的串起来，一个最小可用的 Agent：

```python
from langchain_openai import ChatOpenAI
from langchain_core.tools import tool
from datetime import datetime

@tool
def get_current_time() -> str:
    """获取当前时间"""
    return datetime.now().strftime("%Y-%m-%d %H:%M:%S")

@tool
def read_file(file_path: str) -> str:
    """读取文件内容"""
    try:
        with open(file_path, 'r', encoding='utf-8') as f:
            return f.read()
    except FileNotFoundError:
        return f"错误：文件不存在"

# 初始化
llm = ChatOpenAI(model="gpt-4")
tools = [get_current_time, read_file]
llm_with_tools = llm.bind_tools(tools)

# 执行
response = llm_with_tools.invoke("读取 README.md 的内容")
if response.tool_calls:
    for tc in response.tool_calls:
        if tc["name"] == "read_file":
            result = read_file.invoke(tc["args"])
            print(result)
```

## 我踩过的坑

**坑一：忘了写 docstring**

我一开始没写工具的文档字符串，LLM 根本不知道这个工具是干什么的，从来不调用。

解决：每个工具都要写 docstring，说明功能、参数、返回值。

**坑二：参数类型不明确**

```python
@tool
def search(query):  # ❌ 没有类型注解
    ...
```

LLM 不知道 `query` 是什么类型，可能传错参数。

解决：加上类型注解：

```python
@tool
def search(query: str) -> str:  # ✅ 明确类型
    ...
```

**坑三：工具返回了 None**

有些工具没有返回值（比如写文件），我直接 `return`，结果是 `None`。

LLM 看到 `None` 不知道发生了什么，会一直问。

解决：即使没有有意义的返回值，也返回一个确认信息：

```python
@tool
def write_file(file_path: str, content: str) -> str:
    """写入文件"""
    with open(file_path, 'w') as f:
        f.write(content)
    return f"已写入 {file_path}，共 {len(content)} 字符"  # ✅ 返回确认
```

## 下一步行动

1. **复制上面的代码**，跑通 `get_current_time` 工具
2. **加一个自己的工具**，比如查询天气、调用 API
3. **把工具注册到 Registry**，统一管理

工具开发的核心就是：定义函数 → 加 `@tool` 装饰器 → 写清楚文档 → 绑定到 LLM。

---

工具是 Agent 的"手脚"，写好工具，Agent 才能做真正有用的事。
