# 实战：用 Agent 写一个完整项目

理论学了这么多，今天来个实战：用 Agent 从零开始写一个完整项目。

我们要做的：一个命令行待办事项应用（Todo CLI）。

## 需求定义

先明确需求：

```
项目：Todo CLI
功能：
1. 添加任务：todo add "买牛奶"
2. 列出任务：todo list
3. 完成任务：todo done 1
4. 删除任务：todo delete 1

技术栈：
- Python 3.11
- Click（CLI 框架）
- SQLite（数据存储）

质量要求：
- 有单元测试
- 有 README 文档
```

## 第一步：让 Agent 设计架构

输入给 Agent：

```
我要写一个 Todo CLI，需求如下：
1. 添加任务：todo add "买牛奶"
2. 列出任务：todo list
3. 完成任务：todo done 1
4. 删除任务：todo delete 1

技术栈：Python 3.11 + Click + SQLite

请设计项目结构和关键模块。
```

Agent 输出：

```
项目结构：
todo-cli/
├── todo/
│   ├── __init__.py
│   ├── cli.py      # CLI 入口
│   ├── models.py   # 数据模型
│   └── db.py       # 数据库操作
├── tests/
│   └── test_todo.py
├── requirements.txt
└── README.md

关键模块：
1. cli.py：使用 Click 定义命令
2. models.py：Task 数据类
3. db.py：SQLite CRUD 操作
```

我确认这个设计没问题。

## 第二步：让 Agent 写代码

逐个文件让 Agent 写：

**models.py**：

```
请写 todo/models.py，定义 Task 数据类和数据库表结构。
```

Agent 输出：

```python
from dataclasses import dataclass
from datetime import datetime
from typing import Optional

@dataclass
class Task:
    id: Optional[int]
    title: str
    done: bool = False
    created_at: datetime = None
    
    def __post_init__(self):
        if self.created_at is None:
            self.created_at = datetime.now()
```

**db.py**：

```
请写 todo/db.py，实现 SQLite 数据库操作。
```

Agent 输出：

```python
import sqlite3
from pathlib import Path
from typing import List
from .models import Task

DB_PATH = Path.home() / ".todo.db"

def init_db():
    """初始化数据库"""
    conn = sqlite3.connect(DB_PATH)
    conn.execute("""
        CREATE TABLE IF NOT EXISTS tasks (
            id INTEGER PRIMARY KEY,
            title TEXT NOT NULL,
            done INTEGER DEFAULT 0,
            created_at TEXT
        )
    """)
    conn.commit()
    conn.close()

def add_task(title: str) -> Task:
    """添加任务"""
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.execute(
        "INSERT INTO tasks (title, created_at) VALUES (?, ?)",
        (title, datetime.now().isoformat())
    )
    task_id = cursor.lastrowid
    conn.commit()
    conn.close()
    return Task(id=task_id, title=title)

def list_tasks() -> List[Task]:
    """列出所有任务"""
    conn = sqlite3.connect(DB_PATH)
    rows = conn.execute("SELECT id, title, done, created_at FROM tasks").fetchall()
    conn.close()
    return [
        Task(id=r[0], title=r[1], done=bool(r[2]), created_at=datetime.fromisoformat(r[3]))
        for r in rows
    ]
```

**cli.py**：

```
请写 todo/cli.py，用 Click 实现 CLI 命令。
```

Agent 输出：

```python
import click
from .db import init_db, add_task, list_tasks, complete_task, delete_task

@click.group()
def cli():
    """Todo CLI - 管理你的待办事项"""
    init_db()

@cli.command()
@click.argument("title")
def add(title: str):
    """添加任务"""
    task = add_task(title)
    click.echo(f"✓ 已添加任务 #{task.id}: {title}")

@cli.command()
def list():
    """列出所有任务"""
    tasks = list_tasks()
    if not tasks:
        click.echo("暂无任务")
        return
    for task in tasks:
        status = "✓" if task.done else " "
        click.echo(f"[{status}] #{task.id} {task.title}")

@cli.command()
@click.argument("task_id", type=int)
def done(task_id: int):
    """完成任务"""
    complete_task(task_id)
    click.echo(f"✓ 任务 #{task_id} 已完成")

if __name__ == "__main__":
    cli()
```

## 第三步：让 Agent 写测试

```
请写 tests/test_todo.py，测试核心功能。
```

Agent 输出：

```python
import pytest
from todo.db import init_db, add_task, list_tasks, complete_task
from todo.models import Task

@pytest.fixture
def clean_db(tmp_path, monkeypatch):
    """每个测试用独立的数据库"""
    monkeypatch.setattr("todo.db.DB_PATH", tmp_path / "test.db")
    init_db()

def test_add_task(clean_db):
    task = add_task("买牛奶")
    assert task.id is not None
    assert task.title == "买牛奶"
    assert task.done == False

def test_list_tasks(clean_db):
    add_task("任务1")
    add_task("任务2")
    tasks = list_tasks()
    assert len(tasks) == 2

def test_complete_task(clean_db):
    task = add_task("测试任务")
    complete_task(task.id)
    tasks = list_tasks()
    assert tasks[0].done == True
```

## 第四步：让 Agent 写文档

```
请写 README.md，包括安装和使用说明。
```

Agent 输出：

```markdown
# Todo CLI

一个简单的命令行待办事项管理工具。

## 安装

```bash
pip install todo-cli
```

## 使用

```bash
# 添加任务
todo add "买牛奶"

# 列出任务
todo list

# 完成任务
todo done 1

# 删除任务
todo delete 1
```

## 开发

```bash
# 安装开发依赖
pip install -e ".[dev]"

# 运行测试
pytest
```
```

## 第五步：验证和调整

运行测试：

```bash
pytest tests/
```

发现报错：

```
NameError: name 'complete_task' is not defined
```

让 Agent 修复：

```
db.py 里缺少 complete_task 和 delete_task 函数，请补充。
```

Agent 补充：

```python
def complete_task(task_id: int):
    """完成任务"""
    conn = sqlite3.connect(DB_PATH)
    conn.execute("UPDATE tasks SET done = 1 WHERE id = ?", (task_id,))
    conn.commit()
    conn.close()

def delete_task(task_id: int):
    """删除任务"""
    conn = sqlite3.connect(DB_PATH)
    conn.execute("DELETE FROM tasks WHERE id = ?", (task_id,))
    conn.commit()
    conn.close()
```

再次运行测试，全部通过。

## 最终成果

```
todo-cli/
├── todo/
│   ├── __init__.py
│   ├── cli.py      # 85 行
│   ├── models.py   # 15 行
│   └── db.py       # 60 行
├── tests/
│   └── test_todo.py  # 30 行
├── requirements.txt
└── README.md

总代码：约 200 行
```

## 我踩过的坑

**坑一：需求给得太模糊**

一开始只说"写个 Todo CLI"，Agent 给出的设计很简陋。

解决：详细列出功能、技术栈、质量要求。

**坑二：没有增量验证**

让 Agent 一次写完所有代码，结果很多错误，改起来很痛苦。

解决：逐个文件写，写完就测。

**坑三：忘了依赖**

Agent 写了代码，但没写 requirements.txt，我手动装的依赖。

解决：最后让 Agent 检查并生成依赖文件。

## 经验总结

用 Agent 写项目的流程：

```
1. 明确需求 → 详细列出功能和技术栈
2. 设计架构 → 让 Agent 先出设计，人工确认
3. 逐个实现 → 一个文件一个文件写
4. 写测试 → 自动生成测试用例
5. 写文档 → README、使用说明
6. 验证修复 → 跑测试，发现错误让 Agent 修复
```

关键点：**人工把关设计和需求，让 Agent 负责重复劳动**。

## 下一步行动

1. **选一个简单的项目**：不要一开始就挑战复杂的
2. **详细定义需求**：需求越清晰，Agent 给出的代码越准确
3. **增量开发**：写一块测一块，不要一次写完

Agent 是你的编程助手，不是替代品。你提供方向，它负责实现。

---

用 Agent 写项目，关键在于"人机协作"：人负责决策，Agent 负责执行。
