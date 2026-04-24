# Agent 怎么测试？从单元测试到集成测试

你的 Agent 写完了，跑了几个例子觉得没问题。结果用户一用，各种奇怪错误。

我之前做过一个 Agent，自己测了 10 个 case 都通过。上线后用户输入了一个特殊字符，Agent 直接崩溃了。

这篇文章，我来分享怎么给 Agent 写测试。

## 为什么 Agent 测试难？

传统代码的测试：输入 A，期望输出 B，断言 `result == B`。

Agent 的输出是 LLM 生成的，每次都可能不一样。你怎么断言？

所以 Agent 测试的核心思路是：**不测输出内容，测行为和流程**。

- ✅ 测试：Agent 是否调用了正确的工具
- ✅ 测试：工具参数是否正确
- ✅ 测试：错误处理是否正常
- ❌ 不测：Agent 返回的具体文本

## 第一层：工具测试

工具是纯函数，最容易测。

```python
import pytest
from my_agent.tools import read_file, get_current_time

def test_get_current_time():
    """测试时间工具"""
    result = get_current_time.invoke({})
    assert "202" in result  # 包含年份
    assert ":" in result    # 包含冒号

def test_read_file_exists():
    """测试读取存在的文件"""
    result = read_file.invoke({"file_path": "README.md"})
    assert len(result) > 0

def test_read_file_not_exists():
    """测试读取不存在的文件"""
    result = read_file.invoke({"file_path": "not_exist.txt"})
    assert "错误" in result or "不存在" in result
```

这是最基础的测试，确保工具本身没问题。

## 第二层：决策测试

测试 LLM 是否选择了正确的工具。

```python
from unittest.mock import Mock, patch
from langchain_core.messages import HumanMessage

def test_llm_chooses_time_tool():
    """测试 LLM 是否选择时间工具"""
    # Mock LLM 响应
    mock_llm = Mock()
    mock_llm.invoke.return_value = Mock(
        tool_calls=[{"name": "get_current_time", "args": {}}]
    )
    
    llm_with_tools = mock_llm.bind_tools([get_current_time])
    response = llm_with_tools.invoke("现在几点了？")
    
    # 验证：选择了正确的工具
    assert response.tool_calls[0]["name"] == "get_current_time"

def test_llm_chooses_read_file_tool():
    """测试 LLM 是否选择文件读取工具"""
    mock_llm = Mock()
    mock_llm.invoke.return_value = Mock(
        tool_calls=[{"name": "read_file", "args": {"file_path": "test.txt"}}]
    )
    
    llm_with_tools = mock_llm.bind_tools([read_file])
    response = llm_with_tools.invoke("读取 test.txt")
    
    assert response.tool_calls[0]["name"] == "read_file"
    assert response.tool_calls[0]["args"]["file_path"] == "test.txt"
```

关键点：**用 Mock 模拟 LLM 响应**，不实际调用 API。

## 第三层：流程测试

测试完整的执行流程。

```python
from my_agent.graph import build_agent_graph
from my_agent.state import create_initial_state

def test_agent_flow():
    """测试 Agent 完整流程"""
    graph = build_agent_graph()
    state = create_initial_state("读取 README.md 的内容")
    
    # 执行
    result = graph.invoke(state)
    
    # 验证
    assert result["is_complete"] == True
    assert len(result["messages"]) > 0
    assert "tool_results" in result

def test_agent_error_handling():
    """测试 Agent 错误处理"""
    graph = build_agent_graph()
    state = create_initial_state("读取不存在的文件 xyz.txt")
    
    result = graph.invoke(state)
    
    # 验证：有错误信息但不崩溃
    assert result["is_complete"] == True
    assert any("错误" in str(m) or "不存在" in str(m) for m in result["tool_results"])
```

## 第四层：集成测试

实际调用 LLM，验证端到端效果。

```python
import pytest

@pytest.fixture
def real_agent():
    """创建真实的 Agent"""
    from my_agent.graph import build_agent_graph
    return build_agent_graph()

def test_real_agent_time_query(real_agent):
    """真实测试：时间查询"""
    state = create_initial_state("现在几点了？")
    result = real_agent.invoke(state)
    
    # 验证：有回复且包含时间信息
    assert len(result["messages"]) > 0
    last_msg = result["messages"][-1]
    assert any(kw in str(last_msg) for kw in [":", "点", "时"])

def test_real_agent_file_read(real_agent, tmp_path):
    """真实测试：文件读取"""
    # 创建临时文件
    test_file = tmp_path / "test.txt"
    test_file.write_text("Hello, Agent!")
    
    state = create_initial_state(f"读取 {test_file} 的内容")
    result = real_agent.invoke(state)
    
    assert "Hello, Agent!" in str(result["messages"])
```

注意：集成测试要控制变量，用临时文件，不要依赖环境。

## 测试数据管理

把测试用例抽出来，方便维护：

```python
# test_cases.py
TEST_CASES = [
    {
        "input": "现在几点了？",
        "expected_tools": ["get_current_time"],
        "description": "时间查询",
    },
    {
        "input": "读取 README.md",
        "expected_tools": ["read_file"],
        "description": "文件读取",
    },
    {
        "input": "帮我创建一个 Python 文件",
        "expected_tools": ["write_file"],
        "description": "文件写入",
    },
]

# test_agent.py
@pytest.mark.parametrize("case", TEST_CASES)
def test_agent_cases(case):
    """参数化测试"""
    state = create_initial_state(case["input"])
    result = agent.invoke(state)
    
    # 验证：调用了期望的工具
    tool_names = [tc["name"] for tc in result.get("tool_calls", [])]
    for expected in case["expected_tools"]:
        assert expected in tool_names
```

## 测试覆盖率

检查哪些代码没测到：

```bash
# 安装 pytest-cov
pip install pytest-cov

# 运行测试并生成覆盖率报告
pytest --cov=my_agent --cov-report=html
```

目标：
- 工具函数：100% 覆盖
- 状态管理：80%+ 覆盖
- LLM 调用：用 Mock，不测实际响应

## 我踩过的坑

**坑一：忘了 Mock LLM**

集成测试里忘了 Mock，每次跑测试都调用真实 API，费用爆炸。

解决：用 `@pytest.mark.integration` 标记集成测试，默认不跑：

```python
@pytest.mark.integration
def test_real_agent():
    ...

# 运行时排除
pytest -m "not integration"
```

**坑二：测试依赖环境**

测试用了硬编码路径 `/Users/xxx/file.txt`，CI 环境跑不通。

解决：用 `tmp_path` fixture：

```python
def test_file_operation(tmp_path):
    test_file = tmp_path / "test.txt"  # ✅ 临时目录
    ...
```

**坑三：测试不够独立**

第二个测试依赖第一个测试的结果，改了第一个，第二个就挂了。

解决：每个测试用 `setUp` 重置状态：

```python
def setUp(self):
    self.agent = build_agent_graph()
    self.state = create_initial_state("")
```

## 下一步行动

1. **给工具写单元测试**：至少测正常和异常两种情况
2. **Mock LLM 测试决策**：验证工具选择逻辑
3. **写一个集成测试**：端到端跑通一个简单任务

测试的核心是：**分层测试，不测随机输出**。工具测函数，决策测逻辑，流程测完整性。

---

没有测试的 Agent，就像没有刹车的车。能跑，但不安全。
