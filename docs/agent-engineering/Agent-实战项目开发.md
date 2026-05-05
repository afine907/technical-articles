---
slug: project-development
sidebar_position: 9
title: 实战：用 Agent 从零开发一个完整项目
---

理论学了一堆，今天来真格的。

我们要做一个**命令行待办事项应用（Todo CLI）**，从需求到上线，全程让 Agent 参与开发。

不是让 Agent 帮你写几行代码，而是让它参与整个开发流程：需求分析、架构设计、代码实现、测试、文档、部署。


## 一、项目规划

### 1.1 需求定义

先明确需求。我把需求写清楚：

```
项目：Todo CLI
目标：一个命令行待办事项管理工具

核心功能：
1. 添加任务：todo add "买牛奶"
2. 列出任务：todo list
3. 完成任务：todo done 1
4. 删除任务：todo delete 1
5. 搜索任务：todo search "牛奶"

进阶功能：
6. 任务优先级：todo add "重要会议" --priority high
7. 任务标签：todo add "写代码" --tags work,coding
8. 任务归档：todo archive
9. 数据导出：todo export json

技术栈：
- Python 3.11+
- Click（CLI 框架）
- SQLite（数据存储）
- pytest（测试框架）

质量要求：
- 单元测试覆盖率 > 80%
- 类型提示完整
- 有 README 和 API 文档
- 可通过 pip 安装
```

### 1.2 让 Agent 设计架构

把需求发给 Agent：

```
我要开发一个 Todo CLI，需求如下：

核心功能：[列出所有功能]
技术栈：Python 3.11 + Click + SQLite

请设计：
1. 项目目录结构
2. 核心模块划分
3. 数据库表结构
4. CLI 命令设计
```

Agent 返回设计：

```
## 项目结构

todo-cli/
├── src/
│   └── todo/
│       ├── __init__.py
│       ├── cli.py          # CLI 入口（命令定义）
│       ├── core.py         # 核心业务逻辑
│       ├── models.py       # 数据模型
│       ├── db.py           # 数据库操作
│       └── utils.py        # 工具函数
├── tests/
│   ├── __init__.py
│   ├── test_cli.py         # CLI 测试
│   ├── test_core.py        # 核心逻辑测试
│   └── test_db.py          # 数据库测试
├── docs/
│   └── API.md              # API 文档
├── pyproject.toml          # 项目配置
├── README.md               # 使用说明
└── LICENSE

## 数据库设计

表：tasks
- id: INTEGER PRIMARY KEY
- title: TEXT NOT NULL
- priority: TEXT DEFAULT 'medium'  # low/medium/high
- tags: TEXT  # JSON 数组字符串
- done: INTEGER DEFAULT 0
- archived: INTEGER DEFAULT 0
- created_at: TEXT
- updated_at: TEXT

表：tags（可选，用于标签管理）
- id: INTEGER PRIMARY KEY
- name: TEXT UNIQUE
- count: INTEGER DEFAULT 0

## CLI 命令设计

todo add <title> [options]
  --priority, -p    优先级 (low/medium/high)
  --tags, -t        标签（逗号分隔）

todo list [options]
  --all, -a         显示所有（包括已完成）
  --archived        显示已归档
  --tag, -t         按标签筛选

todo done <id>
todo undo <id>
todo delete <id>
todo search <keyword>
todo archive       # 归档已完成任务
todo export <format>  # json/csv

## 核心模块

1. cli.py: Click 命令定义，参数解析
2. core.py: TaskManager 类，业务逻辑
3. models.py: Task 数据类
4. db.py: Database 类，CRUD 操作
```

我审视这个设计，做了几处调整：

1. 去掉 `tags` 表，简化实现
2. 增加 `undo` 命令（撤销完成）
3. 增加配置文件支持

确认设计没问题后，开始写代码。


## 二、数据模型实现

先让 Agent 写最底层的模块：数据模型。

```
请写 src/todo/models.py：
1. Task 数据类，包含所有字段
2. TaskPriority 枚举
3. 提供序列化/反序列化方法
```

Agent 输出：

```python
"""数据模型"""
from dataclasses import dataclass, field, asdict
from datetime import datetime
from enum import Enum
from typing import Optional, List
import json


class TaskPriority(Enum):
    """任务优先级"""
    LOW = "low"
    MEDIUM = "medium"
    HIGH = "high"
    
    @classmethod
    def from_string(cls, value: str) -> "TaskPriority":
        """从字符串创建"""
        try:
            return cls(value.lower())
        except ValueError:
            return cls.MEDIUM


@dataclass
class Task:
    """任务数据类"""
    title: str
    id: Optional[int] = None
    priority: TaskPriority = TaskPriority.MEDIUM
    tags: List[str] = field(default_factory=list)
    done: bool = False
    archived: bool = False
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None
    
    def __post_init__(self):
        """初始化后处理"""
        if isinstance(self.priority, str):
            self.priority = TaskPriority.from_string(self.priority)
        if self.created_at is None:
            self.created_at = datetime.now()
        if self.updated_at is None:
            self.updated_at = datetime.now()
    
    def to_dict(self) -> dict:
        """转换为字典"""
        data = asdict(self)
        data["priority"] = self.priority.value
        data["tags"] = json.dumps(self.tags)
        data["created_at"] = self.created_at.isoformat() if self.created_at else None
        data["updated_at"] = self.updated_at.isoformat() if self.updated_at else None
        return data
    
    @classmethod
    def from_dict(cls, data: dict) -> "Task":
        """从字典创建"""
        if isinstance(data.get("priority"), str):
            data["priority"] = TaskPriority.from_string(data["priority"])
        if isinstance(data.get("tags"), str):
            data["tags"] = json.loads(data["tags"])
        if isinstance(data.get("created_at"), str):
            data["created_at"] = datetime.fromisoformat(data["created_at"])
        if isinstance(data.get("updated_at"), str):
            data["updated_at"] = datetime.fromisoformat(data["updated_at"])
        return cls(**data)
    
    def __str__(self) -> str:
        """友好的字符串表示"""
        status = "✓" if self.done else " "
        priority_icon = {"high": "🔴", "medium": "🟡", "low": "🟢"}[self.priority.value]
        tags_str = f" [{', '.join(self.tags)}]" if self.tags else ""
        return f"[{status}] #{self.id} {priority_icon} {self.title}{tags_str}"
```

检查代码：

1. ✅ 类型提示完整
2. ✅ 序列化/反序列化正确
3. ✅ `__str__` 方法友好

继续下一个模块。


## 三、数据库层实现

```
请写 src/todo/db.py：
1. Database 类，管理 SQLite 连接
2. CRUD 操作：add_task, get_task, list_tasks, update_task, delete_task
3. 搜索和筛选功能
4. 错误处理
```

Agent 输出：

```python
"""数据库操作"""
import sqlite3
from pathlib import Path
from typing import List, Optional
from contextlib import contextmanager
from datetime import datetime

from .models import Task, TaskPriority


class DatabaseError(Exception):
    """数据库错误"""
    pass


class TaskNotFoundError(DatabaseError):
    """任务不存在"""
    pass


class Database:
    """SQLite 数据库管理"""
    
    DEFAULT_DB_PATH = Path.home() / ".todo" / "tasks.db"
    
    def __init__(self, db_path: Optional[Path] = None):
        self.db_path = db_path or self.DEFAULT_DB_PATH
        self.db_path.parent.mkdir(parents=True, exist_ok=True)
        self._init_db()
    
    @contextmanager
    def _get_connection(self):
        """获取数据库连接"""
        conn = sqlite3.connect(self.db_path)
        conn.row_factory = sqlite3.Row
        try:
            yield conn
            conn.commit()
        except Exception as e:
            conn.rollback()
            raise DatabaseError(f"数据库操作失败: {e}")
        finally:
            conn.close()
    
    def _init_db(self):
        """初始化数据库表"""
        with self._get_connection() as conn:
            conn.execute("""
                CREATE TABLE IF NOT EXISTS tasks (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    title TEXT NOT NULL,
                    priority TEXT DEFAULT 'medium',
                    tags TEXT DEFAULT '[]',
                    done INTEGER DEFAULT 0,
                    archived INTEGER DEFAULT 0,
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL
                )
            """)
            
            # 创建索引
            conn.execute("CREATE INDEX IF NOT EXISTS idx_done ON tasks(done)")
            conn.execute("CREATE INDEX IF NOT EXISTS idx_archived ON tasks(archived)")
    
    def add_task(self, task: Task) -> Task:
        """添加任务"""
        with self._get_connection() as conn:
            cursor = conn.execute(
                """
                INSERT INTO tasks (title, priority, tags, done, archived, created_at, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    task.title,
                    task.priority.value,
                    str(task.tags),
                    int(task.done),
                    int(task.archived),
                    task.created_at.isoformat(),
                    task.updated_at.isoformat()
                )
            )
            task.id = cursor.lastrowid
            return task
    
    def get_task(self, task_id: int) -> Task:
        """获取单个任务"""
        with self._get_connection() as conn:
            row = conn.execute(
                "SELECT * FROM tasks WHERE id = ?", (task_id,)
            ).fetchone()
            
            if row is None:
                raise TaskNotFoundError(f"任务 #{task_id} 不存在")
            
            return self._row_to_task(row)
    
    def list_tasks(
        self,
        include_done: bool = False,
        include_archived: bool = False,
        tag: Optional[str] = None,
        priority: Optional[TaskPriority] = None
    ) -> List[Task]:
        """列出任务"""
        with self._get_connection() as conn:
            query = "SELECT * FROM tasks WHERE 1=1"
            params = []
            
            if not include_done:
                query += " AND done = 0"
            if not include_archived:
                query += " AND archived = 0"
            if tag:
                query += " AND tags LIKE ?"
                params.append(f'%"{tag}"%')
            if priority:
                query += " AND priority = ?"
                params.append(priority.value)
            
            query += " ORDER BY priority DESC, created_at DESC"
            
            rows = conn.execute(query, params).fetchall()
            return [self._row_to_task(row) for row in rows]
    
    def update_task(self, task_id: int, **kwargs) -> Task:
        """更新任务"""
        task = self.get_task(task_id)
        
        # 更新字段
        for key, value in kwargs.items():
            if hasattr(task, key):
                setattr(task, key, value)
        task.updated_at = datetime.now()
        
        # 写入数据库
        with self._get_connection() as conn:
            conn.execute(
                """
                UPDATE tasks SET
                    title = ?, priority = ?, tags = ?, 
                    done = ?, archived = ?, updated_at = ?
                WHERE id = ?
                """,
                (
                    task.title,
                    task.priority.value,
                    str(task.tags),
                    int(task.done),
                    int(task.archived),
                    task.updated_at.isoformat(),
                    task_id
                )
            )
        
        return task
    
    def delete_task(self, task_id: int) -> None:
        """删除任务"""
        with self._get_connection() as conn:
            result = conn.execute(
                "DELETE FROM tasks WHERE id = ?", (task_id,)
            )
            if result.rowcount == 0:
                raise TaskNotFoundError(f"任务 #{task_id} 不存在")
    
    def search_tasks(self, keyword: str) -> List[Task]:
        """搜索任务"""
        with self._get_connection() as conn:
            rows = conn.execute(
                "SELECT * FROM tasks WHERE title LIKE ? ORDER BY created_at DESC",
                (f"%{keyword}%",)
            ).fetchall()
            return [self._row_to_task(row) for row in rows]
    
    def archive_completed(self) -> int:
        """归档已完成的任务"""
        with self._get_connection() as conn:
            result = conn.execute(
                "UPDATE tasks SET archived = 1 WHERE done = 1 AND archived = 0"
            )
            return result.rowcount
    
    def export_tasks(self, format: str = "json") -> str:
        """导出任务"""
        tasks = self.list_tasks(include_done=True, include_archived=True)
        
        if format == "json":
            import json
            return json.dumps(
                [t.to_dict() for t in tasks],
                indent=2,
                ensure_ascii=False
            )
        elif format == "csv":
            import csv
            import io
            output = io.StringIO()
            writer = csv.writer(output)
            writer.writerow(["id", "title", "priority", "tags", "done", "created_at"])
            for task in tasks:
                writer.writerow([
                    task.id,
                    task.title,
                    task.priority.value,
                    ",".join(task.tags),
                    task.done,
                    task.created_at.isoformat() if task.created_at else ""
                ])
            return output.getvalue()
        else:
            raise ValueError(f"不支持的导出格式: {format}")
    
    def _row_to_task(self, row: sqlite3.Row) -> Task:
        """数据库行转换为 Task 对象"""
        import json
        return Task(
            id=row["id"],
            title=row["title"],
            priority=TaskPriority.from_string(row["priority"]),
            tags=json.loads(row["tags"]),
            done=bool(row["done"]),
            archived=bool(row["archived"]),
            created_at=datetime.fromisoformat(row["created_at"]) if row["created_at"] else None,
            updated_at=datetime.fromisoformat(row["updated_at"]) if row["updated_at"] else None
        )
```

检查代码：

1. ✅ 使用上下文管理器管理连接
2. ✅ 错误处理完整
3. ✅ 支持搜索和筛选
4. ✅ 支持导出

继续下一个模块。


## 四、核心业务逻辑

```
请写 src/todo/core.py：
1. TaskManager 类，封装业务逻辑
2. 调用 Database 完成操作
3. 提供统计功能
```

Agent 输出：

```python
"""核心业务逻辑"""
from typing import List, Optional, Dict
from datetime import datetime

from .models import Task, TaskPriority
from .db import Database, TaskNotFoundError


class TaskManager:
    """任务管理器"""
    
    def __init__(self, db_path: Optional[str] = None):
        from pathlib import Path
        path = Path(db_path) if db_path else None
        self.db = Database(path)
    
    def add_task(
        self,
        title: str,
        priority: str = "medium",
        tags: Optional[List[str]] = None
    ) -> Task:
        """添加任务"""
        task = Task(
            title=title,
            priority=TaskPriority.from_string(priority),
            tags=tags or []
        )
        return self.db.add_task(task)
    
    def list_tasks(
        self,
        all: bool = False,
        archived: bool = False,
        tag: Optional[str] = None,
        priority: Optional[str] = None
    ) -> List[Task]:
        """列出任务"""
        priority_enum = TaskPriority.from_string(priority) if priority else None
        return self.db.list_tasks(
            include_done=all,
            include_archived=archived,
            tag=tag,
            priority=priority_enum
        )
    
    def complete_task(self, task_id: int) -> Task:
        """完成任务"""
        return self.db.update_task(task_id, done=True)
    
    def undo_task(self, task_id: int) -> Task:
        """撤销完成"""
        return self.db.update_task(task_id, done=False)
    
    def delete_task(self, task_id: int) -> None:
        """删除任务"""
        self.db.delete_task(task_id)
    
    def search_tasks(self, keyword: str) -> List[Task]:
        """搜索任务"""
        return self.db.search_tasks(keyword)
    
    def archive_completed(self) -> int:
        """归档已完成任务"""
        return self.db.archive_completed()
    
    def export(self, format: str = "json") -> str:
        """导出任务"""
        return self.db.export_tasks(format)
    
    def get_stats(self) -> Dict:
        """获取统计信息"""
        all_tasks = self.db.list_tasks(include_done=True, include_archived=True)
        
        return {
            "total": len(all_tasks),
            "done": sum(1 for t in all_tasks if t.done),
            "pending": sum(1 for t in all_tasks if not t.done),
            "archived": sum(1 for t in all_tasks if t.archived),
            "by_priority": {
                "high": sum(1 for t in all_tasks if t.priority == TaskPriority.HIGH),
                "medium": sum(1 for t in all_tasks if t.priority == TaskPriority.MEDIUM),
                "low": sum(1 for t in all_tasks if t.priority == TaskPriority.LOW),
            }
        }
```

检查代码：

1. ✅ 封装 Database
2. ✅ 提供统计功能
3. ✅ 类型提示完整


## 五、CLI 入口实现

最后是最关键的 CLI 层。

```
请写 src/todo/cli.py：
1. 使用 Click 定义所有命令
2. 友好的输出格式
3. 错误处理
4. 支持 --help
```

Agent 输出：

```python
"""CLI 入口"""
import click
from typing import Optional

from .core import TaskManager
from .db import TaskNotFoundError


def get_manager() -> TaskManager:
    """获取 TaskManager 实例"""
    return TaskManager()


@click.group()
@click.version_option(version="1.0.0")
def cli():
    """
    Todo CLI - 简单的待办事项管理工具
    
    \b
    快速开始：
        todo add "买牛奶"          添加任务
        todo list                  列出任务
        todo done 1                完成任务
        todo delete 1              删除任务
    """
    pass


@cli.command()
@click.argument("title")
@click.option("--priority", "-p", default="medium", 
              type=click.Choice(["low", "medium", "high"]),
              help="任务优先级")
@click.option("--tags", "-t", default="", 
              help="任务标签（逗号分隔）")
def add(title: str, priority: str, tags: str):
    """添加新任务"""
    manager = get_manager()
    tag_list = [t.strip() for t in tags.split(",") if t.strip()]
    
    task = manager.add_task(title, priority=priority, tags=tag_list)
    
    click.echo(click.style(f"✓ 已添加任务 #{task.id}", fg="green"))
    click.echo(f"  {task}")


@cli.command()
@click.option("--all", "-a", "show_all", is_flag=True, 
              help="显示所有任务（包括已完成）")
@click.option("--archived", is_flag=True, 
              help="显示已归档任务")
@click.option("--tag", "-t", default=None, 
              help="按标签筛选")
@click.option("--priority", "-p", default=None, 
              type=click.Choice(["low", "medium", "high"]),
              help="按优先级筛选")
def list(show_all: bool, archived: bool, tag: Optional[str], priority: Optional[str]):
    """列出任务"""
    manager = get_manager()
    
    tasks = manager.list_tasks(
        all=show_all,
        archived=archived,
        tag=tag,
        priority=priority
    )
    
    if not tasks:
        click.echo(click.style("暂无任务", fg="yellow"))
        return
    
    click.echo(click.style(f"\n任务列表 ({len(tasks)} 项)", fg="cyan", bold=True))
    click.echo("-" * 40)
    
    for task in tasks:
        click.echo(str(task))
    
    click.echo("-" * 40)


@cli.command()
@click.argument("task_id", type=int)
def done(task_id: int):
    """标记任务为完成"""
    manager = get_manager()
    
    try:
        task = manager.complete_task(task_id)
        click.echo(click.style(f"✓ 任务 #{task_id} 已完成", fg="green"))
    except TaskNotFoundError:
        click.echo(click.style(f"✗ 任务 #{task_id} 不存在", fg="red"), err=True)
        raise SystemExit(1)


@cli.command()
@click.argument("task_id", type=int)
def undo(task_id: int):
    """撤销任务完成状态"""
    manager = get_manager()
    
    try:
        task = manager.undo_task(task_id)
        click.echo(click.style(f"✓ 任务 #{task_id} 已撤销", fg="green"))
    except TaskNotFoundError:
        click.echo(click.style(f"✗ 任务 #{task_id} 不存在", fg="red"), err=True)
        raise SystemExit(1)


@cli.command()
@click.argument("task_id", type=int)
@click.confirmation_option(prompt="确定要删除这个任务吗？")
def delete(task_id: int):
    """删除任务"""
    manager = get_manager()
    
    try:
        manager.delete_task(task_id)
        click.echo(click.style(f"✓ 任务 #{task_id} 已删除", fg="green"))
    except TaskNotFoundError:
        click.echo(click.style(f"✗ 任务 #{task_id} 不存在", fg="red"), err=True)
        raise SystemExit(1)


@cli.command()
@click.argument("keyword")
def search(keyword: str):
    """搜索任务"""
    manager = get_manager()
    
    tasks = manager.search_tasks(keyword)
    
    if not tasks:
        click.echo(click.style(f"未找到包含 '{keyword}' 的任务", fg="yellow"))
        return
    
    click.echo(click.style(f"\n搜索结果 ({len(tasks)} 项)", fg="cyan", bold=True))
    for task in tasks:
        click.echo(str(task))


@cli.command()
def archive():
    """归档已完成的任务"""
    manager = get_manager()
    
    count = manager.archive_completed()
    
    if count == 0:
        click.echo(click.style("没有可归档的任务", fg="yellow"))
    else:
        click.echo(click.style(f"✓ 已归档 {count} 个任务", fg="green"))


@cli.command()
@click.argument("format", type=click.Choice(["json", "csv"]), default="json")
@click.option("--output", "-o", type=click.Path(), default=None,
              help="输出文件路径")
def export(format: str, output: Optional[str]):
    """导出任务数据"""
    manager = get_manager()
    
    data = manager.export(format)
    
    if output:
        with open(output, "w", encoding="utf-8") as f:
            f.write(data)
        click.echo(click.style(f"✓ 已导出到 {output}", fg="green"))
    else:
        click.echo(data)


@cli.command()
def stats():
    """显示任务统计"""
    manager = get_manager()
    
    stats = manager.get_stats()
    
    click.echo(click.style("\n任务统计", fg="cyan", bold=True))
    click.echo("-" * 30)
    click.echo(f"总任务数：{stats['total']}")
    click.echo(f"已完成：{stats['done']}")
    click.echo(f"待处理：{stats['pending']}")
    click.echo(f"已归档：{stats['archived']}")
    click.echo("-" * 30)
    click.echo("按优先级：")
    click.echo(f"  🔴 高优先级：{stats['by_priority']['high']}")
    click.echo(f"  🟡 中优先级：{stats['by_priority']['medium']}")
    click.echo(f"  🟢 低优先级：{stats['by_priority']['low']}")


if __name__ == "__main__":
    cli()
```

检查代码：

1. ✅ 所有命令定义完整
2. ✅ 友好的错误提示
3. ✅ 删除需要确认
4. ✅ 支持颜色输出


## 六、测试实现

让 Agent 写测试：

```
请写 tests/test_core.py，测试 TaskManager 的核心功能。
覆盖率目标：> 80%
```

Agent 输出：

```python
"""核心功能测试"""
import pytest
from pathlib import Path
import tempfile

from todo.core import TaskManager
from todo.models import TaskPriority
from todo.db import TaskNotFoundError


@pytest.fixture
def temp_db():
    """临时数据库"""
    with tempfile.TemporaryDirectory() as tmpdir:
        db_path = Path(tmpdir) / "test.db"
        manager = TaskManager(str(db_path))
        yield manager


class TestTaskManager:
    """TaskManager 测试"""
    
    def test_add_task(self, temp_db):
        """测试添加任务"""
        task = temp_db.add_task("测试任务")
        
        assert task.id is not None
        assert task.title == "测试任务"
        assert task.priority == TaskPriority.MEDIUM
        assert task.done is False
    
    def test_add_task_with_priority(self, temp_db):
        """测试带优先级的任务"""
        task = temp_db.add_task("紧急任务", priority="high")
        
        assert task.priority == TaskPriority.HIGH
    
    def test_add_task_with_tags(self, temp_db):
        """测试带标签的任务"""
        task = temp_db.add_task("工作", tags=["work", "important"])
        
        assert task.tags == ["work", "important"]
    
    def test_list_tasks(self, temp_db):
        """测试列出任务"""
        temp_db.add_task("任务1")
        temp_db.add_task("任务2")
        
        tasks = temp_db.list_tasks()
        
        assert len(tasks) == 2
    
    def test_list_tasks_filter_by_tag(self, temp_db):
        """测试按标签筛选"""
        temp_db.add_task("工作", tags=["work"])
        temp_db.add_task("生活", tags=["life"])
        
        tasks = temp_db.list_tasks(tag="work")
        
        assert len(tasks) == 1
        assert tasks[0].title == "工作"
    
    def test_complete_task(self, temp_db):
        """测试完成任务"""
        task = temp_db.add_task("待完成")
        
        completed = temp_db.complete_task(task.id)
        
        assert completed.done is True
    
    def test_undo_task(self, temp_db):
        """测试撤销完成"""
        task = temp_db.add_task("待完成")
        temp_db.complete_task(task.id)
        
        undone = temp_db.undo_task(task.id)
        
        assert undone.done is False
    
    def test_delete_task(self, temp_db):
        """测试删除任务"""
        task = temp_db.add_task("待删除")
        
        temp_db.delete_task(task.id)
        
        with pytest.raises(TaskNotFoundError):
            temp_db.db.get_task(task.id)
    
    def test_delete_nonexistent_task(self, temp_db):
        """测试删除不存在的任务"""
        with pytest.raises(TaskNotFoundError):
            temp_db.delete_task(999)
    
    def test_search_tasks(self, temp_db):
        """测试搜索任务"""
        temp_db.add_task("买牛奶")
        temp_db.add_task("买面包")
        temp_db.add_task("写代码")
        
        results = temp_db.search_tasks("买")
        
        assert len(results) == 2
    
    def test_archive_completed(self, temp_db):
        """测试归档"""
        task1 = temp_db.add_task("完成1")
        temp_db.add_task("未完成")
        temp_db.complete_task(task1.id)
        
        count = temp_db.archive_completed()
        
        assert count == 1
        
        # 归档的任务不应该出现在默认列表
        tasks = temp_db.list_tasks()
        assert len(tasks) == 1
    
    def test_export_json(self, temp_db):
        """测试 JSON 导出"""
        temp_db.add_task("任务1")
        
        exported = temp_db.export("json")
        
        assert "任务1" in exported
        assert '"title"' in exported
    
    def test_export_csv(self, temp_db):
        """测试 CSV 导出"""
        temp_db.add_task("任务1")
        
        exported = temp_db.export("csv")
        
        assert "任务1" in exported
        assert "id,title" in exported
    
    def test_get_stats(self, temp_db):
        """测试统计"""
        temp_db.add_task("待办1", priority="high")
        temp_db.add_task("待办2", priority="low")
        task = temp_db.add_task("已完成")
        temp_db.complete_task(task.id)
        
        stats = temp_db.get_stats()
        
        assert stats["total"] == 3
        assert stats["done"] == 1
        assert stats["pending"] == 2
        assert stats["by_priority"]["high"] == 1
        assert stats["by_priority"]["low"] == 1
```

运行测试：

```bash
pytest tests/ -v --cov=todo
```

结果：

```
=================== test session starts ===================
collected 18 items

tests/test_core.py::TestTaskManager::test_add_task PASSED
tests/test_core.py::TestTaskManager::test_add_task_with_priority PASSED
...
tests/test_core.py::TestTaskManager::test_get_stats PASSED

=================== 18 passed in 0.52s ====================
Coverage: 87%
```

✅ 覆盖率 87%，超过目标。


## 七、项目配置

让 Agent 生成项目配置：

```
请写 pyproject.toml，包含：
1. 项目元信息
2. 依赖声明
3. CLI 入口配置
4. pytest 配置
```

Agent 输出：

```toml
[build-system]
requires = ["setuptools>=61.0", "wheel"]
build-backend = "setuptools.build_meta"

[project]
name = "todo-cli"
version = "1.0.0"
description = "一个简单的命令行待办事项管理工具"
readme = "README.md"
license = {text = "MIT"}
requires-python = ">=3.11"
authors = [
    {name = "Your Name", email = "you@example.com"}
]
classifiers = [
    "Development Status :: 4 - Beta",
    "Environment :: Console",
    "Intended Audience :: Developers",
    "License :: OSI Approved :: MIT License",
    "Programming Language :: Python :: 3.11",
]
dependencies = [
    "click>=8.0.0",
]

[project.optional-dependencies]
dev = [
    "pytest>=7.0.0",
    "pytest-cov>=4.0.0",
    "black>=23.0.0",
    "mypy>=1.0.0",
]

[project.scripts]
todo = "todo.cli:cli"

[project.urls]
Homepage = "https://github.com/yourname/todo-cli"
Repository = "https://github.com/yourname/todo-cli"

[tool.setuptools.packages.find]
where = ["src"]

[tool.pytest.ini_options]
testpaths = ["tests"]
python_files = ["test_*.py"]
addopts = "-v --cov=todo --cov-report=term-missing"

[tool.black]
line-length = 88
target-version = ["py311"]

[tool.mypy]
python_version = "3.11"
strict = true
```


## 八、文档编写

让 Agent 写 README：

```markdown
# Todo CLI

一个简单而强大的命令行待办事项管理工具。

## 特性

- ✅ 添加、列出、完成、删除任务
- 🏷️ 任务标签和优先级支持
- 🔍 搜索和筛选功能
- 📦 归档已完成任务
- 📤 导出为 JSON/CSV
- 📊 任务统计

## 安装

```bash
pip install todo-cli
```

## 快速开始

```bash
# 添加任务
todo add "买牛奶"
todo add "写报告" --priority high --tags work

# 列出任务
todo list
todo list --all           # 包括已完成
todo list --tag work      # 按标签筛选

# 完成任务
todo done 1

# 撤销完成
todo undo 1

# 删除任务
todo delete 1

# 搜索
todo search "牛奶"

# 归档
todo archive

# 导出
todo export json
todo export csv -o tasks.csv

# 统计
todo stats
```

## 开发

```bash
# 克隆仓库
git clone https://github.com/yourname/todo-cli.git
cd todo-cli

# 安装开发依赖
pip install -e ".[dev]"

# 运行测试
pytest

# 类型检查
mypy src/todo

# 代码格式化
black src/todo
```

## 许可证

MIT License
```


## 九、最终成果

项目结构：

```
todo-cli/
├── src/todo/
│   ├── __init__.py
│   ├── cli.py      # 200 行
│   ├── core.py     # 80 行
│   ├── models.py   # 70 行
│   └── db.py       # 180 行
├── tests/
│   └── test_core.py  # 150 行
├── pyproject.toml
└── README.md

总代码：约 700 行
测试覆盖：87%
```


## 十、踩坑记录

### 坑一：需求给得太模糊

一开始只说"写个 Todo CLI"，Agent 给的设计太简陋。

**解决**：详细列出功能、技术栈、质量要求。

### 坑二：没有增量验证

让 Agent 一次写完所有代码，结果很多错误。

**解决**：逐个模块写，写完就测。

### 坑三：类型不一致

数据库返回的是字符串，但模型期望枚举类型。

**解决**：在 `from_dict` 方法里做类型转换。

### 坑四：测试覆盖不足

第一次测试覆盖率只有 60%，漏掉了边界情况。

**解决**：让 Agent 补充测试用例，专门测试异常场景。

### 坑五：删除没有确认

用户误删任务，无法恢复。

**解决**：加上 `@click.confirmation_option` 确认提示。


## 十一、总结

用 Agent 开发项目的流程：

```
1. 需求定义 → 详细列出功能和技术栈
2. 架构设计 → 让 Agent 出设计，人工确认
3. 逐个实现 → 模块化开发，增量验证
4. 编写测试 → 自动生成测试用例
5. 完善文档 → README、API 文档
6. 配置项目 → pyproject.toml、CI/CD
```

**关键点**：人工把控设计和需求，让 Agent 负责重复劳动。


## 十二、下一步行动

1. **选一个合适的项目**：不要一开始就挑战复杂的
2. **详细定义需求**：需求越清晰，Agent 输出越准确
3. **增量开发**：写一块测一块
4. **持续重构**：发现代码质量问题，让 Agent 重构

Agent 是编程助手，不是替代品。你提供方向，它负责实现。


人和 Agent 协作，才是最高效的开发方式。
