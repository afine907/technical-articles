# Agent 工具权限管理设计

> 本文介绍 Agent 工具权限管理架构的设计与实现，包括工具注册、执行流程、安全守卫机制和权限模式配置。

## 背景

在 Agent 系统中，工具（Tools）是 Agent 与外部世界交互的桥梁。工具可以执行文件操作、Shell 命令、网络请求等敏感操作，如果没有有效的权限管理机制，Agent 可能在用户不知情的情况下执行危险操作，导致数据泄露或系统损坏。

本文档分析 jojo-code 项目中工具权限管理的实现，涵盖以下内容：
- 权限管理架构设计
- 工具注册与执行流程
- 安全守卫机制
- 权限模式配置

目标读者是希望理解或实现 Agent 权限管理系统的开发者。

## 正文

### 1. 权限管理架构

权限管理系统采用分层架构设计，主要包含以下核心组件：

#### 1.1 核心模块结构

```
jojo_code/security/
├── permission.py     # 权限级别和结果定义
├── modes.py          # 权限模式和风险等级
├── manager.py        # 权限管理器
├── guards.py        # 守卫基类
├── path_guard.py    # 路径权限守卫
├── command_guard.py # Shell 命令守卫
└── risk.py         # 风险评估模块
```

#### 1.2 权限级别定义

权限管理系统定义了三种权限级别（`PermissionLevel`）：

- **ALLOW**: 自动允许，无需确认
- **CONFIRM**: 需要用户确认后才能执行
- **DENY**: 禁止执行

```python
class PermissionLevel(Enum):
    ALLOW = "allow"
    CONFIRM = "confirm"
    DENY = "deny"
```

权限级别之间可以进行比较：`DENY > CONFIRM > ALLOW`，在多个守卫检查时取最严格的级别。

#### 1.3 风险等级评估

系统定义了四个风险等级（`RiskLevel`）：

- **LOW**: 低风险，仅读取信息，不修改系统状态
- **MEDIUM**: 中风险，修改有限范围的文件或配置
- **HIGH**: 高风险，修改系统关键配置或多个文件
- **CRITICAL**: 极高风险，可能导致数据丢失或系统不可用

风险评估模块（`risk.py`）根据工具名称和参数自动评估风险等级，对 Shell 命令使用正则表达式匹配危险模式。

### 2. 工具注册与执行流程

#### 2.1 工具注册中心

`ToolRegistry` 是工具注册中心，负责管理所有可用工具：

```python
class ToolRegistry:
    def __init__(self, permission_manager=None, confirm_callback=None):
        self._tools: dict[str, BaseTool] = {}
        self._tool_categories: dict[str, str] = {}  # read/write 分类
        self._permission_manager = permission_manager
        self._confirm_callback = confirm_callback
```

系统预注册了以下工具类别：
- **文件工具**: read_file, write_file, edit_file, list_directory
- **搜索工具**: grep_search, glob_search
- **Web 工具**: web_search
- **Shell 工具**: run_command
- **代码分析工具**: analyze_python_file, find_python_dependencies 等
- **Git 工具**: git_status, git_diff, git_log 等
- **性能工具**: profile_python_file 等

#### 2.2 工具分类

工具按操作类型分为两类：
- **read**: 只读操作，不修改系统状态
- **write**: 写操作，可能修改系统状态

分类在注册时自动完成，影响后续的权限检查策略。

#### 2.3 执行流程

工具执行流程如下：

```
1. 调用 execute(name, args)
2. 权限检查 (通过 permission_manager.check)
3. 判断检查结果:
   - denied: 抛出 PermissionError
   - needs_confirm: 调用 confirm_callback 确认
   - allowed: 执行工具
4. 返回执行结果
```

关键代码：

```python
def execute(self, name: str, args: dict[str, Any]) -> str:
    # 权限检查
    if self._permission_manager is not None:
        result = self._permission_manager.check(name, args)
        
        if result.denied:
            raise PermissionError(f"权限拒绝: {result.reason}", result)
        
        if result.needs_confirm:
            if self._confirm_callback is not None:
                approved = self._confirm_callback(result)
                if not approved:
                    raise PermissionError("用户拒绝执行", result)
            else:
                raise PermissionError(f"操作需要确认: {result.reason}", result)
    
    # 执行工具
    tool = self.get(name)
    result = tool.invoke(args)
    return str(result)
```

### 3. 安全守卫机制

#### 3.1 守卫基类

所有守卫继承自 `BaseGuard` 基类：

```python
class BaseGuard(ABC):
    @abstractmethod
    def check(self, tool_name: str, args: dict[str, Any]) -> PermissionResult:
        pass
    
    @property
    @abstractmethod
    def name(self) -> str:
        pass
```

#### 3.2 路径权限守卫 (PathGuard)

路径守卫控制文件系统访问权限：

- **workspace 隔离**: 限制操作在指定工作空间内
- **路径白名单**: 明确允许访问的路径模式
- **路径黑名单**: 明确禁止访问的路径模式
- **写入确认**: 对特定路径的写入操作需要确认

检查流程：
```
1. 检查路径是否在 workspace 内
2. 检查黑名单模式匹配
3. 检查白名单模式匹配
4. 写入操作检查确认模式
```

支持 fnmatch 风格的通配符匹配（`*` 和 `**`）。

#### 3.3 命令权限守卫 (CommandGuard)

命令守卫控制 Shell 命令执行权限：

- **命令白名单**: 明确允许执行的命令
- **命令黑名单**: 明确禁止执行的命令
- **超时限制**: 最大执行时间限制
- **网络命令控制**: 禁用curl、wget等网络命令

检查流程：
```
1. 检查 shell 工具是否启用
2. 检查超时限制
3. 检查黑名单命令
4. 检查网络命令
5. 检查白名单命令
6. 返回默认策略
```

黑名单默认包含：`rm -rf /`、`sudo` 等危险命令。

#### 3.4 权限管理器协调

`PermissionManager` 协调多个守卫进行检查：

```python
def check(self, tool_name: str, args: dict[str, Any]) -> PermissionResult:
    # 1. YOLO 模式直接放行
    if self._mode == PermissionMode.YOLO:
        return PermissionResult(PermissionLevel.ALLOW, tool_name, args)
    
    # 2. 检查调用次数限制
    if self._call_count >= self.config.max_tool_calls:
        return PermissionResult(PermissionLevel.DENY, ...)
    
    # 3. 评估风险等级
    risk = assess_risk(tool_name, args)
    
    # 4. ReadOnly 模式检查
    if self._mode == PermissionMode.READONLY:
        if risk in ("medium", "high", "critical"):
            return PermissionResult(PermissionLevel.DENY, ...)
    
    # 5. 运行守卫检查
    for guard in self.guards:
        result = guard.check(tool_name, args)
        if result.level > final_result.level:
            final_result = result
        if result.denied:
            return result
    
    # 6. 根据权限模式和风险等级调整决策
    return final_result
```

### 4. 权限模式配置

#### 4.1 权限模式 (PermissionMode)

系统提供五种权限模式：

| 模式 | 描述 | 写操作 | 确认要求 |
|------|------|--------|----------|
| `yolo` | 完全信任模式 | 允许 | 无需确认 |
| `auto_approve` | 自动批准模式 | 允许 | 仅高风险需确认 |
| `interactive` | 交互模式 | 允许 | 中高风险需确认 |
| `strict` | 严格模式 | 允许 | 所有操作需确认 |
| `readonly` | 只读模式 | 拒绝 | - |

权限模式决定了不同风险等级操作的处理方式：

```python
class PermissionMode(StrEnum):
    YOLO = "yolo"
    AUTO_APPROVE = "auto_approve"
    INTERACTIVE = "interactive"
    STRICT = "strict"
    READONLY = "readonly"
    
    def requires_confirmation(self, risk_level: RiskLevel) -> bool:
        if self == PermissionMode.YOLO:
            return False
        if self == PermissionMode.AUTO_APPROVE:
            return risk_level >= RiskLevel.HIGH
        if self == PermissionMode.INTERACTIVE:
            return risk_level > RiskLevel.LOW
        if self == PermissionMode.STRICT:
            return True
        if self == PermissionMode.READONLY:
            return True
        return True
```

#### 4.2 配置文件结构

权限配置通过 `PermissionConfig` 类管理，支持从 YAML 文件加载：

```yaml
workspace:
  root: "."
  allow_outside: false

file:
  allowed_paths: ["*"]
  denied_paths: [".env", "*.pem", "*.key"]
  confirm_on_write: []

shell:
  enabled: true
  allowed_commands: []
  denied_commands: ["rm -rf /", "sudo"]
  default: "confirm"
  max_timeout: 300
  allow_network: false

global:
  max_tool_calls: 100
  audit_log: true
  audit_log_path: ".jo jo-code/audit.log"
```

#### 4.3 预设配置

系统提供两种预设配置：

- **开发模式** (`development()`): 宽松配置，允许大多数操作但需要确认
- **生产模式** (`production()`): 严格配置，限制文件访问和命令执行

```python
@classmethod
def development(cls) -> "PermissionConfig":
    return cls(
        workspace_root=Path("."),
        allow_outside=False,
        denied_paths=[".env", "*.pem", "*.key"],
        shell_enabled=True,
        shell_default=PermissionLevel.CONFIRM,
        denied_commands=["rm -rf /", "rm -rf ~", "sudo"],
    )

@classmethod
def production(cls) -> "PermissionConfig":
    return cls(
        workspace_root=Path("."),
        allow_outside=False,
        allowed_paths=["src/**", "tests/**", "*.md", "*.txt"],
        denied_paths=[".env", ".git/**", "secrets/**", "*.pem", "*.key"],
        confirm_on_write=["**"],
        shell_enabled=True,
        allowed_commands=["ls", "cat", "head", "tail", "grep", "pytest"],
        denied_commands=["rm *", "sudo *", "curl *", "wget *"],
        shell_default=PermissionLevel.CONFIRM,
        allow_network=False,
        max_tool_calls=50,
    )
```

#### 4.4 审计日志

系统记录所有工具调用的审计日志，包括：
- 时间戳
- 工具名称
- 工具参数
- 权限检查结果
- 拒绝原因

审计日志支持缓冲区批量写入，提高性能。

## 总结

本文档介绍了 Agent 工具权限管理系统的设计与实现：

1. **权限管理架构**: 采用分层设计，包含权限级别、风险等级、权限管理器核心组件
2. **工具注册与执行流程**: 工具注册中心管理所有工具，执行时进行权限检查和用户确认
3. **安全守卫机制**: 路径守卫和命令守卫分别控制文件访问和命令执行权限
4. **权限模式配置**: 提供五种权限模式和预设配置，支持灵活的安全策略配置

该权限管理系统在安全性和可用性之间取得平衡，通过可配置的方式适应不同场景的需求。

## 参考资料

- [LangChain Tools](https://python.langchain.com/docs/modules/agents/tools/): LangChain 工具定义
- [Python fnmatch](https://docs.python.org/3/library/fnmatch.html): 文件名模式匹配
- [jojo-code 源码](https://github.com/anomalyco/jojo-code): 项目源码

---

**作者**: 
**日期**: 2026-04-24
**标签**: Agent, 权限管理, 安全架构