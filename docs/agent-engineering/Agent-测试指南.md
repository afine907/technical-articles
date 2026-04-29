---
sidebar_position: 13
title: Agent 怎么测试？从单元测试到端到端测试
---


你的 Agent 写完了，跑了几个例子觉得没问题。上线后，用户输入了一个特殊字符，Agent 崩溃了。

这不是偶然。Agent 的输出是 LLM 生成的，不确定性很高。传统软件测试方法不适用。

这篇文章，我系统讲解 Agent 测试的完整方法论。

## Agent 测试的三大难点

### 难点一：输出不确定性

传统测试：

```python
def test_add():
    assert add(1, 2) == 3  # 确定的
```

Agent 测试：

```python
def test_chat():
    response = agent.chat("你好")
    assert response == "???"  # 不确定！每次可能不一样
```

### 难点二：依赖外部服务

Agent 依赖 LLM API，测试时：
- 不能每次都调用真实 API（成本高、慢）
- 需要 Mock，但 Mock LLM 的行为很复杂

### 难点三：多步骤执行

Agent 是"思考→执行→再思考"的循环，不是单次函数调用。

```
用户输入 → 思考 → 工具调用1 → 思考 → 工具调用2 → 思考 → 输出

测试要验证：
- 思考逻辑对不对
- 工具调用对不对
- 最终输出对不对
```

## 测试金字塔：Agent 版

```
         ┌─────────────┐
         │  E2E 测试   │  最少（1-3 个）
         │  （全链路）  │
         ├─────────────┤
         │ 集成测试     │  少量（10-20 个）
         │（真实 LLM）  │
         ├─────────────┤
         │ 单元测试     │  大量（100+ 个）
         │（Mock LLM）  │
         └─────────────┘
```

原则：
- 单元测试：快、多、覆盖细节
- 集成测试：慢、少、验证真实行为
- E2E 测试：最慢、最少、验证完整流程

## 第一层：单元测试

### 测试工具函数

工具是纯函数，最容易测。

```python
# tests/test_tools.py
import pytest
from tempfile import TemporaryDirectory
from pathlib import Path
from my_agent.tools import read_file, write_file, list_files

class TestReadFile:
    """测试 read_file 工具"""
    
    def test_read_existing_file(self):
        """测试读取存在的文件"""
        with TemporaryDirectory() as tmpdir:
            test_file = Path(tmpdir) / "test.txt"
            test_file.write_text("Hello, World!", encoding="utf-8")
            
            result = read_file.invoke({"path": str(test_file)})
            
            assert "Hello, World!" in result
            assert "错误" not in result.lower()
    
    def test_read_nonexistent_file(self):
        """测试读取不存在的文件"""
        result = read_file.invoke({"path": "/nonexistent/file.txt"})
        
        assert "错误" in result or "不存在" in result
    
    def test_read_file_too_large(self):
        """测试读取超大文件"""
        with TemporaryDirectory() as tmpdir:
            large_file = Path(tmpdir) / "large.txt"
            large_file.write_bytes(b"x" * (15 * 1024 * 1024))  # 15MB
            
            result = read_file.invoke({
                "path": str(large_file),
                "max_size_mb": 10,
            })
            
            assert "过大" in result or "超过" in result
    
    def test_read_binary_file(self):
        """测试读取二进制文件"""
        with TemporaryDirectory() as tmpdir:
            binary_file = Path(tmpdir) / "binary.bin"
            binary_file.write_bytes(b"\x00\x01\x02\x03")
            
            result = read_file.invoke({"path": str(binary_file)})
            
            # 应该报错或提示编码问题
            assert "错误" in result or "编码" in result or "文本" in result

class TestWriteFile:
    """测试 write_file 工具"""
    
    def test_write_new_file(self):
        """测试写入新文件"""
        with TemporaryDirectory() as tmpdir:
            test_file = Path(tmpdir) / "new.txt"
            
            result = write_file.invoke({
                "path": str(test_file),
                "content": "Test content",
            })
            
            assert "成功" in result
            assert test_file.exists()
            assert test_file.read_text() == "Test content"
    
    def test_overwrite_existing_file(self):
        """测试覆盖已存在的文件"""
        with TemporaryDirectory() as tmpdir:
            test_file = Path(tmpdir) / "existing.txt"
            test_file.write_text("Old content")
            
            result = write_file.invoke({
                "path": str(test_file),
                "content": "New content",
            })
            
            assert "成功" in result
            assert test_file.read_text() == "New content"
    
    def test_write_to_system_directory(self):
        """测试写入系统目录（应该被拒绝）"""
        result = write_file.invoke({
            "path": "/etc/test.txt",
            "content": "hacked",
        })
        
        assert "拒绝" in result or "不允许" in result or "错误" in result
```

### 测试状态管理

```python
# tests/test_state.py
import pytest
from my_agent.state import AgentState, merge_lists

class TestState:
    """测试状态管理"""
    
    def test_merge_lists(self):
        """测试列表合并"""
        left = [{"role": "user", "content": "Hello"}]
        right = [{"role": "assistant", "content": "Hi"}]
        
        result = merge_lists(left, right)
        
        assert len(result) == 2
        assert result[0]["content"] == "Hello"
        assert result[1]["content"] == "Hi"
    
    def test_merge_lists_with_none(self):
        """测试 None 处理"""
        result = merge_lists(None, [{"role": "user", "content": "Test"}])
        
        assert len(result) == 1
        assert result[0]["content"] == "Test"
    
    def test_state_type_validation(self):
        """测试状态类型验证"""
        state: AgentState = {
            "messages": [],
            "tool_calls": [],
            "tool_results": [],
            "is_complete": False,
            "iteration": 0,
        }
        
        # 验证必需字段
        assert "messages" in state
        assert "tool_calls" in state
        assert "is_complete" in state
```

### 测试路由逻辑

```python
# tests/test_router.py
import pytest
from my_agent.router import should_continue

class TestRouter:
    """测试路由逻辑"""
    
    def test_continue_when_has_tool_calls(self):
        """有工具调用时应该继续"""
        state = {
            "messages": [],
            "tool_calls": [{"name": "read_file", "args": {}}],
            "is_complete": False,
            "iteration": 0,
        }
        
        result = should_continue(state)
        
        assert result == "continue"
    
    def test_end_when_complete(self):
        """任务完成时应该结束"""
        state = {
            "messages": [],
            "tool_calls": [],
            "is_complete": True,
            "iteration": 5,
        }
        
        result = should_continue(state)
        
        assert result == "end"
    
    def test_end_when_max_iterations(self):
        """达到最大迭代次数应该结束"""
        state = {
            "messages": [],
            "tool_calls": [{"name": "read_file", "args": {}}],
            "is_complete": False,
            "iteration": 20,  # 达到上限
        }
        
        result = should_continue(state)
        
        assert result == "end"  # 强制结束，防止无限循环
```

## 第二层：集成测试（Mock LLM）

### Mock LLM 响应

```python
# tests/test_agent_integration.py
import pytest
from unittest.mock import Mock, patch
from my_agent.graph import build_agent_graph
from my_agent.state import create_initial_state

class TestAgentIntegration:
    """集成测试（Mock LLM）"""
    
    @pytest.fixture
    def mock_llm(self):
        """创建 Mock LLM"""
        mock = Mock()
        
        # 模拟 LLM 响应
        mock.invoke.return_value = Mock(
            content="我已读取文件",
            tool_calls=[{
                "name": "read_file",
                "args": {"path": "README.md"},
                "id": "call_123",
            }]
        )
        
        return mock
    
    def test_agent_calls_correct_tool(self, mock_llm):
        """测试 Agent 调用正确的工具"""
        with patch("my_agent.nodes.get_llm", return_value=mock_llm):
            graph = build_agent_graph()
            state = create_initial_state("读取 README.md")
            
            result = graph.invoke(state)
            
            # 验证：调用了 read_file 工具
            assert len(result["tool_calls"]) > 0
            assert result["tool_calls"][0]["name"] == "read_file"
    
    def test_agent_completes_after_tool_execution(self, mock_llm):
        """测试工具执行后 Agent 完成"""
        # 第一次调用返回工具调用
        mock_llm.invoke.side_effect = [
            Mock(
                content="",
                tool_calls=[{"name": "read_file", "args": {"path": "test.txt"}, "id": "call_1"}]
            ),
            # 第二次调用返回最终回复
            Mock(
                content="文件内容是...",
                tool_calls=[]
            )
        ]
        
        with patch("my_agent.nodes.get_llm", return_value=mock_llm):
            graph = build_agent_graph()
            state = create_initial_state("读取 test.txt")
            
            result = graph.invoke(state)
            
            # 验证：Agent 最终完成了
            assert result["is_complete"] == True
            assert len(result["messages"]) > 1
```

### 测试完整流程

```python
def test_agent_full_workflow():
    """测试 Agent 完整工作流"""
    
    # 准备测试文件
    with TemporaryDirectory() as tmpdir:
        test_file = Path(tmpdir) / "test.txt"
        test_file.write_text("Hello from test file")
        
        # 创建 Agent
        graph = build_agent_graph()
        
        # Mock LLM
        with patch("my_agent.nodes.llm_with_tools") as mock_llm:
            mock_llm.invoke.side_effect = [
                # 第一次：决定调用工具
                Mock(tool_calls=[{
                    "name": "read_file",
                    "args": {"path": str(test_file)},
                    "id": "call_1"
                }]),
                # 第二次：返回结果
                Mock(content="文件内容是 'Hello from test file'", tool_calls=[])
            ]
            
            # 执行
            state = create_initial_state(f"读取 {test_file}")
            result = graph.invoke(state)
            
            # 验证
            assert result["is_complete"] == True
            assert len(result["tool_results"]) == 1
            assert "Hello from test file" in result["tool_results"][0]
```

## 第三层：端到端测试（真实 LLM）

### 测试真实 Agent

```python
# tests/test_agent_e2e.py
import pytest
from my_agent.graph import build_agent_graph
from my_agent.state import create_initial_state

@pytest.fixture
def real_agent():
    """创建真实 Agent（需要真实 API Key）"""
    return build_agent_graph()

@pytest.mark.integration
class TestAgentE2E:
    """端到端测试（真实 LLM）"""
    
    def test_simple_query(self, real_agent):
        """测试简单查询"""
        state = create_initial_state("现在几点了？")
        
        result = real_agent.invoke(state)
        
        # 验证：有输出且完成
        assert result["is_complete"] == True
        assert len(result["messages"]) > 0
        
        # 验证：输出包含时间信息
        last_msg = result["messages"][-1].content
        assert any(kw in last_msg for kw in ["时间", "点", ":", "时"])
    
    def test_file_operation(self, real_agent, tmp_path):
        """测试文件操作"""
        test_file = tmp_path / "test.txt"
        test_file.write_text("Test content for E2E")
        
        state = create_initial_state(f"读取 {test_file} 的内容")
        
        result = real_agent.invoke(state)
        
        # 验证：读取成功
        assert "Test content for E2E" in str(result["messages"])
    
    def test_error_handling(self, real_agent):
        """测试错误处理"""
        state = create_initial_state("读取 /nonexistent/file.txt")
        
        result = real_agent.invoke(state)
        
        # 验证：没有崩溃，返回了错误信息
        assert result["is_complete"] == True
        assert any(
            "错误" in str(msg) or "不存在" in str(msg)
            for msg in result["messages"]
        )
```

### 跳过集成测试

```python
# 默认不运行集成测试（需要 API Key 和费用）
# 运行方式：pytest -m integration tests/

# pytest.ini
[pytest]
markers =
    integration: marks tests as integration tests (deselect with '-m "not integration"')
```

## 测试数据管理

### 测试用例数据化

```python
# tests/test_cases.py

TEST_CASES = [
    {
        "name": "simple_greeting",
        "input": "你好",
        "expected_keywords": ["你好", "帮助", "什么"],
        "should_call_tools": False,
    },
    {
        "name": "read_file",
        "input": "读取 README.md",
        "expected_tools": ["read_file"],
        "expected_keywords": ["README", "内容"],
    },
    {
        "name": "complex_task",
        "input": "列出所有 Python 文件并搜索 TODO",
        "expected_tools": ["list_files", "search_in_file"],
    },
]

@pytest.mark.parametrize("case", TEST_CASES)
def test_agent_cases(case, real_agent):
    """参数化测试"""
    state = create_initial_state(case["input"])
    result = real_agent.invoke(state)
    
    # 验证工具调用
    if "expected_tools" in case:
        tool_names = [tc["name"] for tc in result.get("tool_calls", [])]
        for expected_tool in case["expected_tools"]:
            assert expected_tool in tool_names
    
    # 验证关键词
    if "expected_keywords" in case:
        last_msg = str(result["messages"][-1].content)
        assert any(kw in last_msg for kw in case["expected_keywords"])
```

## 性能测试

### 测试响应时间

```python
import time

def test_agent_response_time(real_agent):
    """测试 Agent 响应时间"""
    state = create_initial_state("你好")
    
    start = time.time()
    result = real_agent.invoke(state)
    elapsed = time.time() - start
    
    # 验证：响应时间小于 10 秒
    assert elapsed < 10, f"响应时间过长: {elapsed:.2f}s"
    print(f"响应时间: {elapsed:.2f}s")
```

### 测试 Token 消耗

```python
def test_agent_token_usage(real_agent):
    """测试 Agent Token 消耗"""
    state = create_initial_state("读取 README.md")
    
    result = real_agent.invoke(state)
    
    # 计算总 token
    total_tokens = sum(
        len(msg.content.split()) * 1.3  # 粗略估算
        for msg in result["messages"]
        if hasattr(msg, "content")
    )
    
    # 验证：Token 消耗合理（小于 5000）
    assert total_tokens < 5000, f"Token 消耗过高: {total_tokens}"
    print(f"估算 Token: {total_tokens}")
```

## 测试覆盖率

### 配置 pytest-cov

```ini
# pytest.ini
[pytest]
addopts = --cov=my_agent --cov-report=html --cov-report=term
testpaths = tests
```

### 运行覆盖率测试

```bash
pytest --cov=my_agent --cov-report=html
```

目标：
- 工具函数：100%
- 状态管理：90%+
- 节点逻辑：80%+
- 整体：70%+

## 我踩过的真实坑

### 坑一：忘了 Mock 导致费用爆炸

```python
# 错误：没有 Mock
def test_agent():
    agent = build_agent_graph()  # 使用真实 LLM
    result = agent.invoke(...)   # 每次测试都调用 API
```

解决：默认 Mock，集成测试单独标记。

### 坑二：测试依赖环境

```python
# 错误：硬编码路径
def test_read_file():
    result = read_file.invoke({"path": "/Users/xxx/test.txt"})
```

解决：用临时目录。

```python
def test_read_file():
    with TemporaryDirectory() as tmpdir:
        test_file = Path(tmpdir) / "test.txt"
        ...
```

### 坑三：测试不够独立

```python
# 错误：测试互相依赖
def test_1():
    global_state["value"] = 1

def test_2():
    assert global_state["value"] == 1  # 依赖 test_1
```

解决：每个测试独立初始化状态。

## 下一步行动

1. **给工具写单元测试**：至少 3 个测试用例（正常、异常、边界）
2. **Mock LLM 写集成测试**：验证 Agent 调用了正确的工具
3. **标记集成测试**：用 `@pytest.mark.integration` 单独运行
4. **配置覆盖率**：确保关键代码被测试覆盖

---

Agent 测试的核心是：**不测输出内容，测行为和流程**。工具测函数，决策测逻辑，流程测完整性。
