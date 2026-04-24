# Agent 工具权限管理

你做的 Agent 能执行命令、读写文件，万一用户让它执行 `rm -rf /` 怎么办？

我之前做的一个 Agent，工具权限是"全有或全无"。要么所有工具都能用，要么都不能用。后来发现这样不够灵活：

- 有些工具很危险（执行命令），应该只有管理员能用
- 有些工具很安全（读取文件），普通用户也能用
- 有些工具只在特定模式下可用

这篇文章，我来分享怎么设计工具权限管理。

## 权限分级

最简单的方式：把工具分成几类。

```python
class ToolCategory(Enum):
    READ = "read"      # 只读，安全
    WRITE = "write"    # 写入，有风险
    EXECUTE = "execute" # 执行命令，危险
    ADMIN = "admin"    # 管理员专用
```

工具注册时标记分类：

```python
registry.register("read_file", read_file, ToolCategory.READ)
registry.register("write_file", write_file, ToolCategory.WRITE)
registry.register("execute_command", execute_command, ToolCategory.EXECUTE)
registry.register("delete_file", delete_file, ToolCategory.ADMIN)
```

## 用户角色

定义用户角色，不同角色有不同权限：

```python
class UserRole(Enum):
    GUEST = "guest"    # 只读
    USER = "user"      # 读写
    ADMIN = "admin"    # 全部权限

PERMISSIONS = {
    UserRole.GUEST: [ToolCategory.READ],
    UserRole.USER: [ToolCategory.READ, ToolCategory.WRITE],
    UserRole.ADMIN: [ToolCategory.READ, ToolCategory.WRITE, ToolCategory.EXECUTE, ToolCategory.ADMIN],
}
```

## 权限检查

执行工具前检查权限：

```python
def execute_with_permission(tool_name: str, args: dict, role: UserRole) -> str:
    category = registry.categories.get(tool_name)
    allowed = PERMISSIONS.get(role, [])
    
    if category not in allowed:
        return f"错误：权限不足，无法执行 {tool_name}"
    
    return registry.execute(tool_name, args)
```

## 模式控制

除了用户角色，还可以用"模式"控制权限。

比如 jojo-code 有两种模式：
- **PLAN 模式**：只读，不执行写操作
- **BUILD 模式**：完整权限

```python
class PlanMode(Enum):
    PLAN = "plan"    # 只读
    BUILD = "build"  # 完整权限

def execute_with_mode(tool_name: str, args: dict, mode: str) -> str:
    category = registry.categories.get(tool_name)
    
    if mode == PlanMode.PLAN.value and category != ToolCategory.READ:
        return f"PLAN 模式下不允许执行 {tool_name}"
    
    return registry.execute(tool_name, args)
```

这样，用户可以在 PLAN 模式下安全地让 Agent 分析问题，不用担心它执行危险操作。

## 完整示例

```python
from enum import Enum
from typing import Dict, Callable

class ToolCategory(Enum):
    READ = "read"
    WRITE = "write"
    EXECUTE = "execute"

class UserRole(Enum):
    GUEST = "guest"
    USER = "user"
    ADMIN = "admin"

PERMISSIONS = {
    UserRole.GUEST: [ToolCategory.READ],
    UserRole.USER: [ToolCategory.READ, ToolCategory.WRITE],
    UserRole.ADMIN: [ToolCategory.READ, ToolCategory.WRITE, ToolCategory.EXECUTE],
}

class ToolRegistry:
    def __init__(self):
        self.tools: Dict[str, Callable] = {}
        self.categories: Dict[str, ToolCategory] = {}
    
    def register(self, name: str, func: Callable, category: ToolCategory):
        self.tools[name] = func
        self.categories[name] = category
    
    def execute(self, name: str, args: dict, role: UserRole) -> str:
        # 检查工具是否存在
        if name not in self.tools:
            return f"错误：工具 {name} 不存在"
        
        # 检查权限
        category = self.categories[name]
        allowed = PERMISSIONS.get(role, [])
        
        if category not in allowed:
            return f"错误：权限不足，无法执行 {name}（需要 {category.value} 权限）"
        
        # 执行
        return self.tools[name](**args)

# 使用
registry = ToolRegistry()
registry.register("read_file", read_file, ToolCategory.READ)
registry.register("write_file", write_file, ToolCategory.WRITE)
registry.register("execute_command", execute_command, ToolCategory.EXECUTE)

# Guest 用户尝试执行命令
result = registry.execute("execute_command", {"cmd": "ls"}, UserRole.GUEST)
# 输出: 错误：权限不足，无法执行 execute_command（需要 execute 权限）

# Admin 用户执行命令
result = registry.execute("execute_command", {"cmd": "ls"}, UserRole.ADMIN)
# 输出: 文件列表...
```

## 我踩过的坑

**坑一：权限检查遗漏**

有些地方直接调用工具，忘了检查权限。

解决：把权限检查放在统一的地方（Registry），而不是每个工具里。

**坑二：权限粒度太粗**

一开始只有"能用"和"不能用"两种，后来发现不够用。

解决：细分权限：读、写、执行、管理员。

**坑三：权限配置硬编码**

权限规则写死在代码里，改一下要重新部署。

解决：把权限配置抽出来，做成可配置的（文件或数据库）。

## 下一步行动

1. **列出你的工具**：每个工具的风险等级是什么
2. **定义用户角色**：哪些用户能用哪些工具
3. **加上权限检查**：统一在 Registry 里检查

---

权限管理不是一次性的，每加一个新工具，都要评估它的风险等级。
