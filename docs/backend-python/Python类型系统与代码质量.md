---
sidebar_position: 4
title: Python 类型系统与代码质量
slug: python-type-system-quality
---

# Python 类型系统与代码质量

Python 项目的代码质量保障：没有 TypeScript 的类型系统，函数签名全是 `def process(data, config, callback=None)`，data 是什么类型？config 有哪些字段？返回值是什么？全靠猜。

```python
def process(data, config, callback=None):
    # data 是什么类型？dict？list？
    # config 有哪些字段？
    # callback 的参数签名是什么？
    # 返回值是什么？
    ...
```

没有类型提示，没有文档字符串，IDE 的自动补全完全失效。我只能一个函数一个函数地往里读，猜参数是什么，猜返回值是什么。一个简单的调试任务，我花了整整一天。

而在前端 TypeScript 项目里，一个接口改了字段，编译器立刻用红色波浪线告诉你哪里出问题。Python 不是不能有这种体验，只是很多人没用上。

这篇文章就是帮你从零搭建 Python 的类型安全体系。如果你是前端转过来的，会发现很多概念和 TypeScript 是对应的，只是名字不同。

## 为什么需要类型系统

### 动态类型的代价

Python 是动态类型语言，变量的类型在运行时才确定。灵活是灵活，但代价是：

1. **IDE 失去眼睛** -- 无法推断类型，自动补全变成猜谜游戏
2. **重构变成噩梦** -- 改了一个字段名，所有使用处都不会报错，直到运行时才炸
3. **协作沟通靠猜** -- 同事写的函数，你不知道该传什么进去

### 类型系统的收益

给 Python 加上类型提示，本质上是给动态语言装上静态检查层：

```
+------------------+     +------------------+     +------------------+
|   编写代码       | --> |   类型检查       | --> |   运行代码       |
| (Type Hints)     |     | (mypy / Pyright) |     | (Python Runtime) |
+------------------+     +------------------+     +------------------+
       |                        |                         |
  IDE 自动补全            编译期发现错误             实际执行逻辑
  参数提示                重构安全保障              动态灵活不变
  文档即代码              跨文件一致性检查           100% 兼容
```

关键点：类型提示 **不影响运行时行为**。Python 本身不会因为有了类型提示就变慢或者改变行为，类型检查是在代码运行之前由独立工具完成的。

## Type Hints 基础

### 与 TypeScript 的对照表

作为前端开发者，你对 TypeScript 很熟悉。这是 Python 类型提示和 TypeScript 的对照关系：

| 概念 | TypeScript | Python |
|------|-----------|--------|
| 基本类型 | `string`, `number`, `boolean` | `str`, `int`, `bool` |
| 数组 | `Array&lt;string&gt;` | `list[str]` |
| 可选参数 | `param?: string` | `param: str \| None = None` |
| 联合类型 | `string \| number` | `str \| int` |
| 字面量类型 | `"a" \| "b"` | `Literal["a", "b"]` |
| 空值 | `null \| undefined` | `None` |
| 函数类型 | `(x: string) => number` | `(x: str) -> int` |
| 字典/对象 | `{[key: string]: number}` | `dict[str, int]` |
| 泛型 | `Array&lt;T&gt;` | `list[T]` (T 是 TypeVar) |
| 接口 | `interface User {}` | `class User(BaseModel)` 或 `Protocol` |
| 元组 | `[string, number]` | `tuple[str, int]` |
| any | `any` | `Any` (尽量避免) |

### 基本类型标注

```python
# 变量标注
name: str = "Alice"
age: int = 30
scores: list[float] = [95.5, 87.0, 92.3]
is_active: bool = True

# 函数标注 -- 输入和输出
def calculate_average(scores: list[float]) -> float:
    return sum(scores) / len(scores)
```

### Optional 和 Union

```python
from typing import Optional, Union

# Optional[X] 等价于 X | None
def find_user(user_id: int) -> Optional[dict]:
    # 找到就返回 dict，找不到返回 None
    ...

# Union 表示多种类型之一
def format_value(value: Union[str, int]) -> str:
    return str(value)

# Python 3.10+ 可以用 | 语法（和 TS 一样）
def format_value(value: str | int) -> str:
    return str(value)
```

### Literal -- 精确到值的类型

```python
from typing import Literal

# 只允许这几个特定的字符串
def set_log_level(level: Literal["debug", "info", "warning", "error"]) -> None:
    ...

# TypeScript 对应：
# type LogLevel = "debug" | "info" | "warning" | "error";
# function setLogLevel(level: LogLevel): void {}
```

### Callable -- 函数类型

```python
from collections.abc import Callable

# 一个接收两个 int、返回 bool 的函数
def apply_filter(
    data: list[int],
    predicate: Callable[[int], bool]
) -> list[int]:
    return [x for x in data if predicate(x)]

# 使用
result = apply_filter([1, 2, 3, 4, 5], lambda x: x > 3)
# result: [4, 5]
```

## 进阶类型系统

### TypeVar -- 泛型的基础

TypeVar 之于 Python，就像 `&lt;T&gt;` 之于 TypeScript。它让你写出适用于多种类型的通用函数：

```python
from typing import TypeVar, Sequence

T = TypeVar("T")

def first_element(items: Sequence[T]) -> T:
    """返回序列的第一个元素，类型由输入决定。"""
    return items[0]

# 调用时 mypy 会自动推断 T 的具体类型
name = first_element(["Alice", "Bob"])     # T = str
score = first_element([95, 87, 92])       # T = int
```

TypeVar 支持约束，限制泛型只能是特定类型：

```python
from typing import TypeVar

Numeric = TypeVar("Numeric", int, float)

def add(a: Numeric, b: Numeric) -> Numeric:
    return a + b

add(1, 2)        # OK
add(1.5, 2.3)    # OK
add("a", "b")    # mypy 报错: Type "str" is not a subtype of "int | float"
```

### Protocol -- 结构化类型

Protocol 是 Python 的"鸭子类型"版本，对应 TypeScript 的 interface 但更灵活 -- 只要对象有对应的属性和方法，就自动满足 Protocol，不需要显式继承：

```python
from typing import Protocol, runtime_checkable

@runtime_checkable
class Renderable(Protocol):
    def render(self) -> str: ...

class MarkdownBlock:
    def __init__(self, content: str) -> None:
        self.content = content

    def render(self) -> str:
        return f"<div>{self.content}</div>"

class HTMLBlock:
    def __init__(self, raw_html: str) -> None:
        self.raw_html = raw_html

    def render(self) -> str:
        return self.raw_html

def render_page(blocks: list[Renderable]) -> str:
    return "\n".join(b.render() for b in blocks)

# MarkdownBlock 和 HTMLBlock 都没显式继承 Renderable
# 但它们都有 render() -> str 方法，所以自动满足 Protocol
render_page([MarkdownBlock("hello"), HTMLBlock("<p>world</p>")])
```

TypeScript 对比：

```typescript
// TypeScript 中的 interface（显式声明实现）
interface Renderable {
  render(): string;
}

class MarkdownBlock implements Renderable {
  render(): string { return `<div>${this.content}</div>`; }
}
```

Python 的 Protocol 不需要 `implements` 关键字，只要有相同的方法签名就行。这就是鸭子类型："如果它走路像鸭子、叫声像鸭子，那它就是鸭子。"

### 泛型类

```python
from typing import TypeVar, Generic

T = TypeVar("T")

class Stack(Generic[T]):
    def __init__(self) -> None:
        self._items: list[T] = []

    def push(self, item: T) -> None:
        self._items.append(item)

    def pop(self) -> T:
        return self._items.pop()

    def peek(self) -> T:
        return self._items[-1]

# 使用 -- 类型由实例化时指定
int_stack: Stack[int] = Stack()
int_stack.push(42)
int_stack.push(3.14)  # mypy 报错: Type "float" is not assignable to "int"

str_stack: Stack[str] = Stack()
str_stack.push("hello")  # OK
```

## Pydantic 数据验证

Pydantic 是 Python 生态中最流行的数据验证库。在 AI Agent 开发中，你几乎必然会用它来定义 Agent 的输入输出结构、配置管理、API 请求响应。

### 为什么不用普通 dataclass

Python 自带的 `dataclass` 只做类型标注，**不做运行时验证**：

```python
from dataclasses import dataclass

@dataclass
class User:
    name: str
    age: int

user = User(name="Alice", age="thirty")  # 运行时不报错！age 变成了字符串
```

Pydantic 在实例化时会自动验证和转换类型：

```python
from pydantic import BaseModel

class User(BaseModel):
    name: str
    age: int

user = User(name="Alice", age="30")  # age 会自动转换为 int 30
user = User(name="Alice", age="thirty")  # PydanticValidationError!
```

### BaseModel 基础用法

```python
from pydantic import BaseModel, Field

class AgentConfig(BaseModel):
    """Agent 的配置模型。"""

    model_name: str = Field(description="模型名称，如 gpt-4")
    temperature: float = Field(default=0.7, ge=0.0, le=2.0)
    max_tokens: int = Field(default=4096, gt=0)
    system_prompt: str = "You are a helpful assistant."
    tools: list[str] = Field(default_factory=list)

# 类型自动转换
config = AgentConfig(
    model_name="gpt-4",
    temperature="0.5",    # str -> float: 自动转换
    max_tokens="2048",    # str -> int: 自动转换
)

# 验证失败会抛出 ValidationError
config = AgentConfig(
    model_name="gpt-4",
    temperature=5.0,      # 超出 [0.0, 2.0] 范围
    max_tokens=-1,        # 小于 0
)
# pydantic.ValidationError: 2 validation errors for AgentConfig
```

### 自定义验证器

```python
from pydantic import BaseModel, field_validator, model_validator

class ChatMessage(BaseModel):
    role: str
    content: str

    @field_validator("role")
    @classmethod
    def validate_role(cls, v: str) -> str:
        allowed_roles = {"system", "user", "assistant", "tool"}
        if v not in allowed_roles:
            raise ValueError(f"role 必须是 {allowed_roles} 之一，收到: {v}")
        return v

    @field_validator("content")
    @classmethod
    def validate_content(cls, v: str) -> str:
        if len(v) > 32000:
            raise ValueError("content 不能超过 32000 字符")
        return v.strip()

    @model_validator(mode="after")
    def validate_model(self) -> "ChatMessage":
        if self.role == "system" and len(self.content) > 1000:
            raise ValueError("system 消息不宜过长，建议控制在 1000 字符以内")
        return self
```

### model_config -- 行为配置

```python
from pydantic import BaseModel

class StrictConfig(BaseModel):
    model_config = {
        # 禁止未知字段 -- 类似 TS 的 strict mode
        "extra": "forbid",
        # 禁止属性赋值后修改（冻结实例）
        "frozen": True,
        # 枚举值自动转换
        "use_enum_values": True,
    }

    name: str
    value: int

# extra="forbid" 时，传入未知字段会报错
StrictConfig(name="test", value=42, unknown="field")  # ValidationError
```

### 嵌套模型 -- Agent 输出结构

```python
from pydantic import BaseModel

class ToolCall(BaseModel):
    """Agent 调用工具的结构。"""
    name: str
    arguments: dict[str, str | int | float | bool | None]

class AgentResponse(BaseModel):
    """Agent 的完整响应。"""
    content: str
    tool_calls: list[ToolCall] = []
    finish_reason: str
    usage: dict[str, int]

# 嵌套数据自动解析
response = AgentResponse.model_validate({
    "content": "",
    "tool_calls": [
        {"name": "search_web", "arguments": {"query": "Python type hints"}}
    ],
    "finish_reason": "tool_calls",
    "usage": {"prompt_tokens": 100, "completion_tokens": 50}
})

# 通过点号访问，类型安全
print(response.tool_calls[0].name)  # "search_web"
```

### Pydantic v2 vs v1

如果你在老项目中看到 `validator` 而不是 `field_validator`，那是 v1 语法。v2 的主要变化：

| 特性 | v1 | v2 |
|------|----|----|
| 验证器装饰器 | `@validator` | `@field_validator` |
| 模型验证 | `@root_validator` | `@model_validator` |
| 底层引擎 | 自研 | `pydantic-core` (Rust) |
| 性能 | 一般 | 快 5-50 倍 |
| model_config | `class Config:` | `model_config = {}` (字典) |

新项目直接用 v2，不要回头用 v1。

## mypy -- 静态类型检查器

mypy 是 Python 生态的标准类型检查器。如果把它比作前端工具链，mypy 大致等于 TypeScript 编译器的类型检查部分。

### 快速开始

```bash
pip install mypy
mypy your_project/
```

### strict 模式

就像 TypeScript 的 `strict: true`，mypy 的 strict 模式会开启所有严格的检查选项：

```bash
mypy --strict your_project/
```

等价于：

```bash
mypy --disallow-any-generics \
     --disallow-untyped-defs \
     --disallow-untyped-calls \
     --disallow-incomplete-defs \
     --no-implicit-optional \
     --warn-return-any \
     --warn-unused-configs \
     --warn-unused-ignores \
     --strict-equality \
     --strict-concatenate \
     --check-untyped-defs \
     --disallow-subclassing-any \
     your_project/
```

常见的 `mypy.ini` 配置：

```ini
[mypy]
python_version = 3.11
strict = true
warn_return_any = true
warn_unused_configs = true

# 第三方库没有类型提示时跳过检查
[mypy-langchain.*]
ignore_missing_imports = true

[mypy-openai.*]
ignore_missing_imports = true

# 只对特定文件启用严格模式
[mypy-tests.*]
disallow_untyped_defs = false
```

### 渐进式启用 strict

如果你在已有项目中引入 mypy，不要一步到位开 strict，那会产出几百个错误让人崩溃。推荐渐进式策略：

```bash
# 第一步：先跑普通模式，看看有多少问题
mypy your_project/ --ignore-missing-imports

# 第二步：对新代码启用 strict
# 在 pyproject.toml 中设置
[tool.mypy]
python_version = "3.11"
files = ["src"]
ignore_missing_imports = true

# 第三步：逐步收紧，对已有文件消除错误
# 对无法立即修复的文件，用 [[tool.mypy.overrides]] 临时放行
[[tool.mypy.overrides]]
module = "legacy_module.*"
disallow_untyped_defs = false
```

### 常见 mypy 错误及修复

```python
# 错误 1: Missing return type annotation
# 修复：加上返回值类型
def process(data):        # Bad
def process(data: dict) -> list[str]:  # Good

# 错误 2: Incompatible return type
# 修复：确保返回值类型一致
def get_name(user: dict | None) -> str:
    if user is None:
        return None   # Bad: 期望 str 但返回 None
    return user["name"]

# 修复版本
def get_name(user: dict | None) -> str | None:  # 声明可以返回 None
    if user is None:
        return None
    return user["name"]

# 错误 3: Argument has incompatible type
# 修复：使用 cast 或 TypeGuard
from typing import cast

def process(value: str | int) -> str:
    # mypy 不知道 value 一定是 str
    return value.upper()  # Bad: int 没有 upper()

# 修复
def process(value: str | int) -> str:
    if isinstance(value, str):
        return value.upper()  # mypy 能推断这里 value 是 str
    return str(value)
```

## ruff -- 现代 Python Linter 和 Formatter

ruff 是用 Rust 写的 Python linter，速度快得离谱（比 flake8 快 10-100 倍）。它集成了 flake8、isort、pylint、pycodestyle 等十几个工具的功能，是 2024-2026 年 Python 社区的事实标准。

### 安装和基本使用

```bash
pip install ruff

# 检查
ruff check .

# 自动修复
ruff check --fix .

# 格式化（替代 black）
ruff format .

# 检查格式化是否会改变文件（CI 中常用）
ruff format --check .
```

### pyproject.toml 配置

```toml
[tool.ruff]
# 目标 Python 版本
target-version = "py311"
# 每行最大长度
line-length = 88

[tool.ruff.lint]
# 启用的规则集
select = [
    "E",    # pycodestyle errors
    "W",    # pycodestyle warnings
    "F",    # pyflakes
    "I",    # isort (import 排序)
    "N",    # pep8-naming
    "UP",   # pyupgrade (自动升级旧语法)
    "B",    # flake8-bugbear (常见 bug 模式)
    "SIM",  # flake8-simplify (简化代码)
    "TCH",  # type-checking imports 优化
    "RUF",  # ruff 自身的规则
]
# 忽略的规则
ignore = [
    "E501",  # 行长度交给 formatter
]

[tool.ruff.lint.isort]
known-first-party = ["my_project"]

[tool.ruff.format]
# 使用双引号（和 black 一致）
quote-style = "double"
```

### ruff 的亮点规则

```python
# B006: 可变默认参数（常见 bug）
def add_item(item, items=[]):    # Bad: 默认列表会在多次调用间共享
    items.append(item)
    return items

def add_item(item, items=None):  # Good
    if items is None:
        items = []
    items.append(item)
    return items

# UP006: 使用现代类型语法
from typing import List, Dict    # Bad: 旧写法
def process(items: List[str]) -> Dict[str, int]: ...

def process(items: list[str]) -> dict[str, int]: ...  # Good: Python 3.9+

# TCH001: 避免循环导入的 import 位置
from typing import TYPE_CHECKING  # Good: 仅用于类型检查的 import

if TYPE_CHECKING:
    from my_project.models import User  # 只在类型检查时导入
```

## 项目脚手架和配置

一个标准的 Python Agent 项目结构：

```
my-agent-project/
+-- pyproject.toml          # 项目配置 (替代 setup.py + requirements.txt)
+-- mypy.ini                # mypy 配置（或写在 pyproject.toml 中）
+-- .pre-commit-config.yaml # pre-commit hooks
+-- src/
|   +-- my_agent/
|       +-- __init__.py
|       +-- config.py       # Agent 配置（Pydantic Settings）
|       +-- models.py       # 数据模型
|       +-- agent.py        # Agent 核心逻辑
|       +-- tools.py        # 工具定义
|       +-- prompts.py      # Prompt 模板
+-- tests/
|   +-- __init__.py
|   +-- test_agent.py
|   +-- test_tools.py
+-- docs/
+-- README.md
```

### pyproject.toml 完整模板

```toml
[build-system]
requires = ["hatchling"]
build-backend = "hatchling.build"

[project]
name = "my-agent"
version = "0.1.0"
description = "AI Agent project"
requires-python = ">=3.11"
dependencies = [
    "pydantic>=2.0",
    "openai>=1.0",
]

[project.optional-dependencies]
dev = [
    "mypy>=1.8",
    "ruff>=0.4",
    "pre-commit>=3.7",
    "pytest>=8.0",
    "pytest-asyncio>=0.23",
]

[tool.ruff]
target-version = "py311"
line-length = 88

[tool.ruff.lint]
select = ["E", "W", "F", "I", "N", "UP", "B", "SIM", "RUF"]

[tool.mypy]
python_version = "3.11"
strict = true
ignore_missing_imports = true

[tool.pytest.ini_options]
asyncio_mode = "auto"
testpaths = ["tests"]
```

## Pre-commit Hooks -- 把质量关卡前移

pre-commit 在你 `git commit` 的时候自动运行检查，不合格的代码不允许提交：

```yaml
# .pre-commit-config.yaml
repos:
  - repo: https://github.com/astral-sh/ruff-pre-commit
    rev: v0.4.4
    hooks:
      - id: ruff
        args: [--fix]
      - id: ruff-format

  - repo: https://github.com/pre-commit/mirrors-mypy
    rev: v1.10.0
    hooks:
      - id: mypy
        additional_dependencies: [pydantic, types-requests]
```

安装：

```bash
pip install pre-commit
pre-commit install
```

工作流：

```
  开发者执行 git commit
         |
         v
  pre-commit 自动触发
         |
    +----+----+
    |         |
    v         v
  ruff      mypy
  check     check
    |         |
    +----+----+
         |
    全部通过？
    /       \
   Yes       No
    |         |
    v         v
  提交成功   阻止提交
             显示错误
```

## CI 集成

在 GitHub Actions 中运行类型检查和 lint：

```yaml
# .github/workflows/quality.yml
name: Code Quality

on:
  push:
    branches: [main, develop]
  pull_request:
    branches: [main]

jobs:
  quality:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Set up Python
        uses: actions/setup-python@v5
        with:
          python-version: "3.11"

      - name: Install dependencies
        run: |
          pip install -e ".[dev]"

      - name: Ruff lint
        run: ruff check .

      - name: Ruff format check
        run: ruff format --check .

      - name: mypy
        run: mypy src/

      - name: pytest
        run: pytest tests/ -v
```

## 常见坑和注意事项

### 坑 1: `Any` 是类型系统的漏洞

```python
from typing import Any

def process(data: Any) -> Any:  # 等于没有类型提示
    return data["key"]

# Any 会传染：和 Any 交互的值也会变成 Any
def handle(data: Any) -> str:
    result = data["items"]  # result 的类型是 Any
    return result.upper()   # mypy 不报错，但运行时可能炸
```

**对策**：用 `unknown` 代替（TypeScript 的 `unknown`）。Python 中可以自定义：

```python
from typing import TypeVar

Unknown = TypeVar("Unknown")  # 显式标记"我不确定类型"
```

### 坑 2: Optional 的隐含陷阱

```python
# Python 3.10 之前，Optional[str] 需要 from typing import Optional
# 但更常见的错误是忘记处理 None 的情况

def get_user_name(user_id: int) -> Optional[str]:
    ...

# Bad: 直接使用，可能 NPE
name = get_user_name(1)
print(name.lower())  # 如果返回 None，这里就炸了

# Good: 先检查
name = get_user_name(1)
if name is not None:
    print(name.lower())

# 或者用 or 断言
name = get_user_name(1) or "unknown"
print(name.lower())
```

### 坑 3: mypy 不检查运行时行为

```python
# mypy 不会在运行时强制检查类型，它只做静态分析
def add(a: int, b: int) -> int:
    return a + b

add("hello", "world")  # mypy 会报错，但如果你不跑 mypy 就不会发现

# 重要：mypy 的价值在于你真的在 CI 中运行它
```

### 坑 4: pydantic 的字段顺序陷阱

```python
from pydantic import BaseModel, Field

# 错误：有默认值的字段不能放在没有默认值的字段前面
class Bad(BaseModel):
    name: str = "default"  # 有默认值
    age: int               # 没有默认值 -- 报错！

# 正确：没有默认值的字段放前面
class Good(BaseModel):
    age: int               # 没有默认值
    name: str = "default"  # 有默认值 -- OK
```

### 坑 5: ruff format 和手动格式化的冲突

```bash
# 如果团队里有人用 black，有人用 ruff format，
# 两边的格式化规则不完全一致，会导致无意义的 diff

# 解决方案：全团队统一用 ruff format
# 在 CI 中加 ruff format --check
# 在 pre-commit 中加 ruff-format hook
# 不要同时配置 black 和 ruff format
```

## TypeScript 开发者快速对照

如果你来自前端背景，这张对照表可以帮助你快速建立心智模型：

| 你要做的事 | TypeScript 写法 | Python 写法 |
|-----------|----------------|-------------|
| 定义对象结构 | `interface User { name: string; age: number }` | `class User(BaseModel): name: str; age: int` |
| 可选属性 | `name?: string` | `name: str \| None = None` |
| 只读属性 | `readonly name: string` | `name: str` + model_config `frozen=True` |
| 联合类型 | `"a" \| "b" \| "c"` | `Literal["a", "b", "c"]` |
| 泛型函数 | `function first&lt;T&gt;(arr: T[]): T` | `def first(items: Sequence[T]) -> T` |
| 类型守卫 | `if (typeof x === "string")` | `if isinstance(x, str)` |
| 类型断言 | `x as string` | `cast(str, x)` |
| 导入类型 | `import type { User }` | `from typing import TYPE_CHECKING` |
| 编译检查 | `tsc --noEmit` | `mypy --strict src/` |
| 格式化 | Prettier + ESLint | ruff format + ruff check |
| 包管理 | package.json + tsconfig.json | pyproject.toml |
| CI 检查 | `tsc && eslint && prettier --check` | `mypy && ruff check && ruff format --check` |

## 总结

从 TypeScript 转到 Python，类型系统不是"从有到无"，而是"从强制到可选但推荐"。你需要主动构建类型安全体系：

1. **写代码时** -- 加上类型提示，用 Pydantic 定义数据结构
2. **提交时** -- pre-commit hooks 自动运行 ruff 和 mypy
3. **CI 中** -- 强制检查，不合格的代码不合并
4. **渐进推进** -- 不求一步到位，每次重构时多加一点类型覆盖

工具链一览：

```
  代码编辑器
  +-- VS Code / PyCharm (类型提示自动补全)
  |
  pre-commit hooks
  +-- ruff check (linting)
  +-- ruff format (格式化)
  +-- mypy (类型检查)
  |
  CI/CD
  +-- ruff check --check (确保格式正确)
  +-- mypy --strict (严格类型检查)
  +-- pytest (测试)
```

当你把这套体系跑起来，写 Python 的体验会非常接近 TypeScript -- IDE 补全流畅、重构有底气、代码质量有保障。区别只是你需要自己搭建这些工具，而 TypeScript 项目大多从脚手架就帮你配好了。

## 参考资料

- [mypy 官方文档](https://mypy.readthedocs.io/) -- 类型检查器完整指南
- [Pydantic V2 文档](https://docs.pydantic.dev/latest/) -- 数据验证库官方文档
- [Ruff 文档](https://docs.astral.sh/ruff/) -- 现代 Python linter
- [Python typing 模块文档](https://docs.python.org/3/library/typing.html) -- 标准库类型提示
- [PEP 484 -- Type Hints](https://peps.python.org/pep-0484/) -- 类型提示的原始规范
- [PEP 695 -- Type Parameter Syntax](https://peps.python.org/pep-0695/) -- Python 3.12 新泛型语法
- [pre-commit 文档](https://pre-commit.com/) -- Git hooks 框架
