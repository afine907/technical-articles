---
sidebar_position: 1
title: smart-city-agent 多 Agent 协同实战
slug: smart-city-agent-multi-agent
---

# smart-city-agent 多 Agent 协同实战

城市交通信号控制：用多 Agent 强化学习替代传统定时控制。三个 Agent（交通、能源、应急）各有自己的优化目标，交通 Agent 想让所有车都走，能源 Agent 说电不够了，应急 Agent 要让救护车先过——怎么让它们学会协作而不是互相打架？

---

## 一、问题定义：智慧城市到底要解决什么？

### 1.1 城市管理的三大矛盾

一座城市的运行，本质上是在解决三个互相矛盾的问题：

```
┌──────────────────────────────────────────────────┐
│              智慧城市三大核心矛盾                  │
├──────────────────────────────────────────────────┤
│                                                  │
│   交通效率          能源节约          应急响应     │
│      │                │                 │        │
│   "车要快走"      "电要少用"       "救护车要先过" │
│      │                │                 │        │
│      └────────────────┼─────────────────┘        │
│                       │                          │
│               三者互相制约                         │
│                                                  │
│   交通灯全绿 → 车快了 → 电费暴涨 → 不可持续       │
│   省电模式   → 车堵了 → 应急救护过不去 → 出人命    │
│   应急优先   → 其他全停 → 大面积拥堵 → 效率崩盘    │
│                                                  │
└──────────────────────────────────────────────────┘
```

传统做法是用规则引擎：早高峰开这个方案，晚高峰开那个方案。问题是城市是动态的——一场暴雨、一次演唱会、一个交通事故，就能让规则全部失效。

所以我们想：能不能让 AI 自己学会怎么调配？

### 1.2 为什么用强化学习？

传统监督学习需要"标准答案"——你需要标注"这个路口应该亮 30 秒绿灯"。但现实中没有标准答案，只有"效果好不好"。

强化学习正好解决这个问题：

- **不需要标注数据**：Agent 自己试错学习
- **天然适合序列决策**：红绿灯控制就是一步步做决策
- **可以处理动态环境**：车流、天气、突发状况都在变

---

## 二、多 Agent 架构设计

### 2.1 为什么不用一个 Agent？

你可能想：搞一个大 Agent 不就行了？统一管理交通、能源、应急。

理论上可以，但实践中会遇到几个问题：

1. **状态空间爆炸**：一个 Agent 要同时处理交通流、电力负荷、应急优先级，状态空间是指数级增长的
2. **目标冲突**：交通优化和能源节约是矛盾的，一个 Agent 很难同时优化两个目标
3. **可扩展性差**：加一个新的管理维度（比如环境监测），就要重写整个 Agent

多 Agent 的好处是：每个 Agent 专注一个领域，通过协作达成全局最优。

### 2.2 整体架构

```
┌──────────────────────────────────────────────────────────────┐
│                   smart-city-agent 系统架构                   │
├──────────────────────────────────────────────────────────────┤
│                                                              │
│  ┌──────────────────────────────────────────────────────┐   │
│  │                   环境模拟层                          │   │
│  │  ┌──────────┐  ┌──────────┐  ┌──────────┐          │   │
│  │  │ 路网模型  │  │ 电力网络  │  │ 应急事件  │          │   │
│  │  └────┬─────┘  └────┬─────┘  └────┬─────┘          │   │
│  └───────┼──────────────┼──────────────┼───────────────┘   │
│          │              │              │                     │
│          ↓              ↓              ↓                     │
│  ┌──────────────────────────────────────────────────────┐   │
│  │                  共享状态空间                          │   │
│  │         city_state: Dict[str, Any]                   │   │
│  └───────┬──────────────┬──────────────┬───────────────┘   │
│          │              │              │                     │
│          ↓              ↓              ↓                     │
│  ┌──────────┐   ┌──────────┐   ┌──────────┐               │
│  │ 交通Agent │   │ 能源Agent │   │ 应急Agent │               │
│  │ (Traffic) │   │ (Energy)  │   │(Emergency)│               │
│  │           │   │           │   │           │               │
│  │ 观察:     │   │ 观察:     │   │ 观察:     │               │
│  │ - 车流量   │   │ - 电力负荷 │   │ - 事件位置 │               │
│  │ - 拥堵程度 │   │ - 时间段   │   │ - 紧急程度 │               │
│  │ - 等待时间 │   │ - 温度     │   │ - 影响范围 │               │
│  │           │   │           │   │           │               │
│  │ 动作:     │   │ 动作:     │   │ 动作:     │               │
│  │ - 调整信号 │   │ - 调整功率 │   │ - 插队优先 │               │
│  │ - 切换模式 │   │ - 削峰填谷 │   │ - 封路改道 │               │
│  └─────┬─────┘   └─────┬─────┘   └─────┬─────┘               │
│        │               │               │                     │
│        └───────────────┼───────────────┘                     │
│                        ↓                                     │
│              ┌─────────────────┐                             │
│              │   协调器         │                             │
│              │  (Coordinator)  │                             │
│              │                 │                             │
│              │  消息传递        │                             │
│              │  冲突裁决        │                             │
│              │  全局奖励计算    │                             │
│              └─────────────────┘                             │
│                                                              │
└──────────────────────────────────────────────────────────────┘
```

三个 Agent 各自负责一个领域，但它们共享同一个城市状态，通过协调器进行通信和冲突裁决。

---

## 三、强化学习基础

在讲具体实现之前，先快速过一遍强化学习的核心概念。如果你已经熟悉，可以直接跳到下一节。

### 3.1 四个核心概念

```
┌─────────────────────────────────────────────────┐
│            强化学习核心循环                       │
├─────────────────────────────────────────────────┤
│                                                 │
│          ┌───────────────┐                      │
│          │    Agent      │                      │
│          │  (决策者)      │                      │
│          └───────┬───────┘                      │
│                  │ 动作 a                        │
│                  ↓                              │
│          ┌───────────────┐                      │
│          │  Environment  │                      │
│          │  (环境)       │                      │
│          └───────┬───────┘                      │
│                  │                              │
│                  ├─→ 新状态 s'                   │
│                  └─→ 奖励 r                      │
│                  │                              │
│                  ↓                              │
│          Agent 根据奖励更新策略                    │
│                                                 │
└─────────────────────────────────────────────────┘
```

- **State（状态）**：环境当前的情况。对交通 Agent 来说，就是各路口的车流量、排队长度等
- **Action（动作）**：Agent 能做的事。比如调整信号灯时长、切换相位
- **Reward（奖励）**：Agent 做得好不好。车流顺畅给正分，堵车给负分
- **Policy（策略）**：Agent 的决策逻辑。给定状态，选择什么动作

### 3.2 Q-Learning

最基础的 RL 算法。核心思想：维护一张 Q 表，记录每个状态下每个动作的价值。

```python
import numpy as np

class QLearningAgent:
    """Q-Learning Agent 基础实现"""

    def __init__(self, n_states: int, n_actions: int,
                 learning_rate: float = 0.1,
                 discount_factor: float = 0.95,
                 epsilon: float = 0.1):
        self.q_table = np.zeros((n_states, n_actions))
        self.lr = learning_rate
        self.gamma = discount_factor
        self.epsilon = epsilon
        self.n_actions = n_actions

    def choose_action(self, state: int) -> int:
        """epsilon-greedy 策略选择动作"""
        if np.random.random() < self.epsilon:
            return np.random.randint(self.n_actions)
        return int(np.argmax(self.q_table[state]))

    def update(self, state: int, action: int,
               reward: float, next_state: int):
        """更新 Q 表"""
        best_next = np.max(self.q_table[next_state])
        td_target = reward + self.gamma * best_next
        td_error = td_target - self.q_table[state, action]
        self.q_table[state, action] += self.lr * td_error
```

### 3.3 PPO（Proximal Policy Optimization）

Q-Learning 适合离散、低维的动作空间。但城市交通的状态和动作空间很大，Q 表存不下。

PPO 是目前最常用的策略梯度算法，用神经网络近似策略函数，适合连续或高维动作空间。

```python
import torch
import torch.nn as nn

class PPOActorCritic(nn.Module):
    """PPO 的 Actor-Critic 网络"""

    def __init__(self, state_dim: int, action_dim: int):
        super().__init__()
        # 共享特征提取层
        self.shared = nn.Sequential(
            nn.Linear(state_dim, 128),
            nn.ReLU(),
            nn.Linear(128, 64),
            nn.ReLU(),
        )
        # Actor: 输出动作概率
        self.actor = nn.Linear(64, action_dim)
        # Critic: 输出状态价值
        self.critic = nn.Linear(64, 1)

    def forward(self, state):
        features = self.shared(state)
        action_logits = self.actor(features)
        value = self.critic(features)
        return torch.distributions.Categorical(logits=action_logits), value

    def act(self, state):
        dist, value = self.forward(state)
        action = dist.sample()
        return action.item(), dist.log_prob(action), value
```

### 3.4 多 Agent RL 的三种模式

| 模式 | 特点 | 示例 |
|------|------|------|
| 合作型（Cooperative） | 所有 Agent 共享同一个奖励 | 三个 Agent 一起优化城市整体指标 |
| 竞争型（Competitive） | Agent 之间零和博弈 | 拍卖系统中的竞价 Agent |
| 混合型（Mixed） | 既有合作又有竞争 | 本项目：总体合作，局部有冲突 |

smart-city-agent 是混合型的：三个 Agent 总体目标一致（让城市运行更好），但在资源分配上有竞争（比如路口通行权和电力配额）。

---

## 四、Agent 角色详解

### 4.1 交通 Agent（Traffic Agent）

最核心的 Agent，负责路口信号灯控制。

```python
class TrafficAgent:
    """交通信号控制 Agent"""

    def __init__(self, intersection_id: str):
        self.intersection_id = intersection_id
        # 动作空间: 4个相位, 每个相位3种时长选择
        # 相位: 南北直行、南北左转、东西直行、东西左转
        self.n_actions = 4 * 3  # 12 种组合

        self.state_dim = 8  # 4个方向的车流量 + 排队长度
        self.network = PPOActorCritic(self.state_dim, self.n_actions)
        self.optimizer = torch.optim.Adam(self.network.parameters(), lr=3e-4)

    def observe(self, city_state: dict) -> torch.Tensor:
        """从共享状态中提取交通相关信息"""
        intersection = city_state["intersections"][self.intersection_id]
        state = [
            intersection["north"]["flow"],
            intersection["north"]["queue"],
            intersection["south"]["flow"],
            intersection["south"]["queue"],
            intersection["east"]["flow"],
            intersection["east"]["queue"],
            intersection["west"]["flow"],
            intersection["west"]["queue"],
        ]
        return torch.tensor(state, dtype=torch.float32)

    def compute_reward(self, city_state: dict) -> float:
        """计算交通奖励: 车流越顺畅分越高"""
        intersection = city_state["intersections"][self.intersection_id]
        total_queue = sum(
            intersection[direction]["queue"]
            for direction in ["north", "south", "east", "west"]
        )
        # 排队越长，奖励越低
        reward = -total_queue * 0.1

        # 有应急车辆通过时，额外给正奖励
        if intersection.get("emergency_passing"):
            reward += 5.0

        return reward
```

### 4.2 能源 Agent（Energy Agent）

管理城市电力分配，在满足交通需求的前提下尽量节能。

```python
class EnergyAgent:
    """能源管理 Agent"""

    def __init__(self):
        self.state_dim = 6  # 总负荷、时间、温度、预测需求等
        self.n_actions = 5  # 全功率、80%、60%、40%、省电模式
        self.network = PPOActorCritic(self.state_dim, self.n_actions)
        self.optimizer = torch.optim.Adam(self.network.parameters(), lr=3e-4)

    def observe(self, city_state: dict) -> torch.Tensor:
        """提取能源相关状态"""
        energy = city_state["energy"]
        state = [
            energy["total_load"],
            energy["capacity"],
            city_state["time_of_day"] / 24.0,  # 归一化时间
            city_state["temperature"] / 50.0,   # 归一化温度
            energy["predicted_demand"],
            energy["renewable_ratio"],  # 可再生能源占比
        ]
        return torch.tensor(state, dtype=torch.float32)

    def compute_reward(self, city_state: dict) -> float:
        """节能奖励"""
        energy = city_state["energy"]
        load_ratio = energy["total_load"] / energy["capacity"]

        # 负荷在合理范围内，给正奖励
        if load_ratio < 0.7:
            reward = 1.0
        elif load_ratio < 0.9:
            reward = 0.0
        else:
            reward = -2.0  # 过载惩罚

        # 使用可再生能源越多，奖励越高
        reward += energy["renewable_ratio"] * 0.5

        return reward
```

### 4.3 应急 Agent（Emergency Agent）

响应突发事件，确保救护车、消防车等优先通行。

```python
class EmergencyAgent:
    """应急管理 Agent"""

    def __init__(self):
        self.state_dim = 5  # 事件类型、位置、紧急程度、影响范围、资源
        self.n_actions = 4  # 无操作、插队优先、封路改道、全面管控
        self.network = PPOActorCritic(self.state_dim, self.n_actions)
        self.optimizer = torch.optim.Adam(self.network.parameters(), lr=3e-4)

    def observe(self, city_state: dict) -> torch.Tensor:
        """提取应急相关状态"""
        emergency = city_state["emergency"]
        state = [
            emergency["event_type"],        # 0: 无, 1: 事故, 2: 医疗, 3: 火灾
            emergency["location_x"],
            emergency["severity"],          # 0-1
            emergency["affected_radius"],
            emergency["available_units"],
        ]
        return torch.tensor(state, dtype=torch.float32)

    def compute_reward(self, city_state: dict) -> float:
        """应急响应奖励"""
        emergency = city_state["emergency"]

        if emergency["event_type"] == 0:
            return 0.1  # 无事件，小正奖励

        # 响应时间越短，奖励越高
        response_time = emergency.get("response_time", 0)
        reward = max(0, 10 - response_time * 0.5)

        # 路径是否畅通
        if emergency.get("route_clear"):
            reward += 5.0

        return reward
```

---

## 五、环境模拟

### 5.1 设计一个类 Gym 环境

我们参考 OpenAI Gym 的接口设计环境模拟器：

```python
import numpy as np
from typing import Dict, Any, Tuple

class SmartCityEnv:
    """智慧城市模拟环境"""

    def __init__(self, n_intersections: int = 4):
        self.n_intersections = n_intersections
        self.step_count = 0
        self.max_steps = 3600  # 模拟1小时，每秒一步

        # 初始化路网
        self.intersections = self._init_intersections()
        self.energy_grid = self._init_energy_grid()
        self.emergency_system = self._init_emergency()

    def _init_intersections(self) -> dict:
        """初始化路口状态"""
        intersections = {}
        for i in range(self.n_intersections):
            intersections[f"intersection_{i}"] = {
                direction: {
                    "flow": np.random.randint(10, 100),
                    "queue": np.random.randint(0, 30),
                    "signal": "red",
                }
                for direction in ["north", "south", "east", "west"]
            }
        return intersections

    def _init_energy_grid(self) -> dict:
        """初始化电网状态"""
        return {
            "total_load": 500.0,
            "capacity": 1000.0,
            "predicted_demand": 600.0,
            "renewable_ratio": 0.3,
        }

    def _init_emergency(self) -> dict:
        """初始化应急系统"""
        return {
            "event_type": 0,
            "location_x": 0.0,
            "location_y": 0.0,
            "severity": 0.0,
            "affected_radius": 0.0,
            "available_units": 5,
            "response_time": 0.0,
            "route_clear": True,
        }

    def reset(self) -> Dict[str, Any]:
        """重置环境"""
        self.step_count = 0
        self.intersections = self._init_intersections()
        self.energy_grid = self._init_energy_grid()
        self.emergency_system = self._init_emergency()
        return self._get_state()

    def step(self, actions: Dict[str, int]) -> Tuple[Dict, Dict[str, float], bool, dict]:
        """
        执行一步
        actions: {agent_name: action_id}
        返回: (next_state, rewards, done, info)
        """
        self.step_count += 1

        # 1. 应用动作
        self._apply_traffic_action(actions.get("traffic", 0))
        self._apply_energy_action(actions.get("energy", 0))
        self._apply_emergency_action(actions.get("emergency", 0))

        # 2. 更新环境
        self._update_traffic_flow()
        self._update_energy_consumption()
        self._maybe_spawn_emergency()

        # 3. 计算奖励
        rewards = {
            "traffic": self._compute_traffic_reward(),
            "energy": self._compute_energy_reward(),
            "emergency": self._compute_emergency_reward(),
        }

        # 4. 判断是否结束
        done = self.step_count >= self.max_steps

        return self._get_state(), rewards, done, {"step": self.step_count}

    def _apply_traffic_action(self, action: int):
        """应用交通动作: 调整信号灯"""
        phase = action // 3      # 选择相位 (0-3)
        duration = (action % 3 + 1) * 15  # 时长: 15s, 30s, 45s
        for inter in self.intersections.values():
            for i, direction in enumerate(["north", "south", "east", "west"]):
                inter[direction]["signal"] = "green" if i == phase else "red"
                inter[direction]["green_duration"] = duration

    def _apply_energy_action(self, action: int):
        """应用能源动作: 调整功率模式"""
        power_levels = [1.0, 0.8, 0.6, 0.4, 0.3]
        self.energy_grid["current_power"] = power_levels[action]

    def _apply_emergency_action(self, action: int):
        """应用应急动作"""
        # action 0: 无操作
        # action 1: 为应急车辆清空路径
        # action 2: 封锁受影响区域
        # action 3: 全面应急模式
        if action == 1 and self.emergency_system["event_type"] > 0:
            self.emergency_system["route_clear"] = True
        elif action == 2:
            self._close_affected_roads()
        elif action == 3:
            self._full_emergency_mode()

    def _update_traffic_flow(self):
        """更新车流量（随机模拟）"""
        for inter in self.intersections.values():
            for direction in ["north", "south", "east", "west"]:
                # 随机产生新车
                new_cars = np.random.poisson(5)
                inter[direction]["flow"] += new_cars

                # 绿灯放行
                if inter[direction]["signal"] == "green":
                    released = min(10, inter[direction]["flow"])
                    inter[direction]["flow"] -= released
                    inter[direction]["queue"] = max(
                        0, inter[direction]["queue"] - released
                    )
                else:
                    # 红灯排队
                    inter[direction]["queue"] += new_cars

    def _update_energy_consumption(self):
        """更新电力消耗"""
        power = self.energy_grid.get("current_power", 1.0)
        base_load = 400 + self.step_count * 0.05
        self.energy_grid["total_load"] = base_load * power
        self.energy_grid["renewable_ratio"] = min(
            1.0, self.energy_grid["renewable_ratio"] + 0.001
        )

    def _maybe_spawn_emergency(self):
        """随机产生应急事件"""
        if self.emergency_system["event_type"] == 0:
            if np.random.random() < 0.005:  # 0.5% 概率
                self.emergency_system["event_type"] = np.random.choice([1, 2, 3])
                self.emergency_system["severity"] = np.random.uniform(0.3, 1.0)
                self.emergency_system["response_time"] = 0.0
        else:
            self.emergency_system["response_time"] += 1.0

    def _get_state(self) -> Dict[str, Any]:
        """获取完整城市状态"""
        return {
            "intersections": self.intersections,
            "energy": self.energy_grid,
            "emergency": self.emergency_system,
            "time_of_day": self.step_count % 24,
            "temperature": 25 + 10 * np.sin(self.step_count / 24 * np.pi),
            "step": self.step_count,
        }

    def _compute_traffic_reward(self) -> float:
        total_queue = sum(
            inter[d]["queue"]
            for inter in self.intersections.values()
            for d in ["north", "south", "east", "west"]
        )
        return -total_queue * 0.01

    def _compute_energy_reward(self) -> float:
        load_ratio = self.energy_grid["total_load"] / self.energy_grid["capacity"]
        if load_ratio < 0.7:
            return 1.0
        elif load_ratio < 0.9:
            return 0.0
        return -2.0

    def _compute_emergency_reward(self) -> float:
        if self.emergency_system["event_type"] == 0:
            return 0.1
        return max(0, 10 - self.emergency_system["response_time"] * 0.5)

    def _close_affected_roads(self):
        pass  # 实现封锁受影响路段的逻辑

    def _full_emergency_mode(self):
        pass  # 实现全面应急模式
```

---

## 六、Agent 通信协议

### 6.1 为什么需要通信？

三个 Agent 如果各自为政，就会出现冲突：

- 交通 Agent 让南北方向全绿，但路口总功率超过了能源 Agent 的限制
- 能源 Agent 进入省电模式，把信号灯功率调到最低，导致交通 Agent 的策略失效
- 应急 Agent 要插队，但交通 Agent 不知道，还在正常放行

所以需要一个通信机制。

### 6.2 消息传递机制

```
┌──────────────────────────────────────────────────────────┐
│                  Agent 通信流程                           │
├──────────────────────────────────────────────────────────┤
│                                                          │
│  Step 1: 各 Agent 独立观察环境                             │
│                                                          │
│  Traffic Agent     Energy Agent     Emergency Agent      │
│       │                │                  │              │
│       ↓                ↓                  ↓              │
│  观察交通流         观察电力负荷        观察应急事件         │
│                                                          │
│  Step 2: 发布意图（Intent Broadcasting）                  │
│                                                          │
│  Traffic Agent     Energy Agent     Emergency Agent      │
│       │                │                  │              │
│       │  "我要给南北   │  "当前负荷 80%,   │  "有救护车    │
│       │   开45秒绿灯"  │   最多再加10%"    │   要过路口"   │
│       │                │                  │              │
│       └────────────────┼──────────────────┘              │
│                        ↓                                 │
│               ┌────────────────┐                         │
│               │   协调器       │                         │
│               │  裁决冲突      │                         │
│               └────────┬───────┘                         │
│                        ↓                                 │
│  Step 3: 下发协调后的动作                                 │
│                                                          │
│  Traffic Agent     Energy Agent     Emergency Agent      │
│       │                │                  │              │
│  "南北25秒绿灯"   "功率限制70%"      "路径已清空"          │
│                                                          │
└──────────────────────────────────────────────────────────┘
```

### 6.3 协调器实现

```python
class Coordinator:
    """多 Agent 协调器"""

    def __init__(self):
        self.message_queue = []

    def collect_intents(self, agents: dict, city_state: dict) -> dict:
        """收集各 Agent 的意图"""
        intents = {}
        for name, agent in agents.items():
            state_tensor = agent.observe(city_state)
            dist, _ = agent.network(state_tensor)
            action = dist.sample().item()
            intents[name] = action
        return intents

    def resolve_conflicts(self, intents: dict, city_state: dict) -> dict:
        """冲突裁决: 应急优先, 然后平衡交通和能源"""
        resolved = intents.copy()

        # 规则1: 应急 Agent 有最高优先级
        if intents.get("emergency", 0) > 0:
            # 应急事件存在时，交通 Agent 必须配合
            resolved["traffic"] = self._adapt_for_emergency(
                intents["traffic"], city_state
            )

        # 规则2: 能源限制
        energy_action = intents.get("energy", 0)
        if energy_action >= 3:  # 省电模式
            # 限制交通信号灯功率
            resolved["traffic"] = self._limit_traffic_power(
                intents["traffic"]
            )

        # 规则3: 全局奖励加权
        return resolved

    def compute_global_reward(self, rewards: dict) -> float:
        """计算全局奖励: 加权平均"""
        weights = {"traffic": 0.4, "energy": 0.3, "emergency": 0.3}
        global_reward = sum(
            rewards[key] * weights[key] for key in weights
        )
        return global_reward

    def _adapt_for_emergency(self, traffic_action: int, state: dict) -> int:
        """为应急事件调整交通动作"""
        emergency = state["emergency"]
        if emergency["event_type"] >= 2:
            # 严重事件: 强制切换到应急方向绿灯
            return 0  # 南北直行相位
        return traffic_action

    def _limit_traffic_power(self, traffic_action: int) -> int:
        """限制交通信号灯功率"""
        # 缩短绿灯时长
        phase = traffic_action // 3
        return phase * 3 + 0  # 强制使用最短时长
```

### 6.4 共享状态 vs 消息传递

在实际实现中，我们同时使用了两种方式：

| 方式 | 优点 | 缺点 | 适用场景 |
|------|------|------|---------|
| 共享状态 | 简单直接 | Agent 可能忽略全局信息 | 环境信息同步 |
| 消息传递 | 灵活、可扩展 | 需要设计协议 | 意图协商 |

我们的做法是：环境信息通过共享状态同步，Agent 之间的意图通过消息传递协商。

---

## 七、训练流程

### 7.1 整体流程

```
┌──────────────────────────────────────────────────────┐
│              训练流程总览                              │
├──────────────────────────────────────────────────────┤
│                                                      │
│  ┌─────────────────────────────────────────────┐    │
│  │  1. 数据收集阶段（Rollout）                    │    │
│  │                                              │    │
│  │  for step in range(rollout_length):          │    │
│  │      state = env.get_state()                 │    │
│  │      actions = collect_actions(agents, state)│    │
│  │      next_state, rewards, done = env.step()  │    │
│  │      store_transition(state, actions, rewards)│    │
│  └──────────────────────┬──────────────────────┘    │
│                         ↓                            │
│  ┌─────────────────────────────────────────────┐    │
│  │  2. 策略更新阶段（PPO Update）                 │    │
│  │                                              │    │
│  │  for agent in agents:                        │    │
│  │      advantages = compute_advantages(rewards)│    │
│  │      for epoch in range(n_epochs):           │    │
│  │          loss = ppo_loss(agent, advantages)  │    │
│  │          loss.backward()                     │    │
│  │          optimizer.step()                    │    │
│  └──────────────────────┬──────────────────────┘    │
│                         ↓                            │
│  ┌─────────────────────────────────────────────┐    │
│  │  3. 评估阶段                                  │    │
│  │                                              │    │
│  │  run evaluation episodes (no exploration)    │    │
│  │  record metrics: reward, efficiency, etc.    │    │
│  └──────────────────────┬──────────────────────┘    │
│                         ↓                            │
│              Repeat until convergence                │
│                                                      │
└──────────────────────────────────────────────────────┘
```

### 7.2 训练代码

```python
class MultiAgentTrainer:
    """多 Agent 训练器"""

    def __init__(self, env: SmartCityEnv):
        self.env = env
        self.coordinator = Coordinator()

        # 初始化三个 Agent
        self.agents = {
            "traffic": TrafficAgent("intersection_0"),
            "energy": EnergyAgent(),
            "emergency": EmergencyAgent(),
        }

        # 超参数
        self.rollout_length = 2048
        self.n_epochs = 10
        self.gamma = 0.99
        self.gae_lambda = 0.95
        self.clip_epsilon = 0.2

    def train(self, n_episodes: int = 1000):
        """主训练循环"""
        global_rewards_history = []

        for episode in range(n_episodes):
            state = self.env.reset()
            episode_rewards = {"traffic": 0, "energy": 0, "emergency": 0}
            trajectories = {name: [] for name in self.agents}

            for step in range(self.rollout_length):
                # 1. 收集各 Agent 的动作
                actions = {}
                for name, agent in self.agents.items():
                    state_tensor = agent.observe(state)
                    action, log_prob, value = agent.network.act(state_tensor)
                    actions[name] = action
                    trajectories[name].append({
                        "state": state_tensor,
                        "action": action,
                        "log_prob": log_prob,
                        "value": value,
                    })

                # 2. 协调器裁决
                resolved_actions = self.coordinator.resolve_conflicts(
                    actions, state
                )

                # 3. 环境执行
                next_state, rewards, done, info = self.env.step(resolved_actions)

                # 4. 记录奖励
                for name in rewards:
                    trajectories[name][-1]["reward"] = rewards[name]
                    episode_rewards[name] += rewards[name]

                state = next_state
                if done:
                    break

            # 5. 策略更新
            for name, agent in self.agents.items():
                self._update_agent(agent, trajectories[name])

            # 6. 记录全局奖励
            global_reward = self.coordinator.compute_global_reward(episode_rewards)
            global_rewards_history.append(global_reward)

            if episode % 50 == 0:
                avg = np.mean(global_rewards_history[-50:])
                print(f"Episode {episode}, Avg Global Reward: {avg:.2f}")

        return global_rewards_history

    def _update_agent(self, agent, trajectory):
        """PPO 策略更新"""
        if len(trajectory) < 2:
            return

        # 计算 GAE 优势
        states = torch.stack([t["state"] for t in trajectory])
        actions = torch.tensor([t["action"] for t in trajectory])
        old_log_probs = torch.stack([t["log_prob"] for t in trajectory]).detach()
        rewards = [t["reward"] for t in trajectory]
        values = [t["value"].item() for t in trajectory]

        advantages = self._compute_gae(rewards, values)
        returns = [adv + val for adv, val in zip(advantages, values)]

        advantages = torch.tensor(advantages, dtype=torch.float32)
        returns = torch.tensor(returns, dtype=torch.float32)

        # 标准化优势
        advantages = (advantages - advantages.mean()) / (advantages.std() + 1e-8)

        # PPO 更新
        for _ in range(self.n_epochs):
            dist, new_values = agent.network(states)
            new_log_probs = dist.log_prob(actions)
            entropy = dist.entropy().mean()

            # Ratio
            ratio = torch.exp(new_log_probs - old_log_probs)

            # Clipped objective
            surr1 = ratio * advantages
            surr2 = torch.clamp(
                ratio, 1 - self.clip_epsilon, 1 + self.clip_epsilon
            ) * advantages
            actor_loss = -torch.min(surr1, surr2).mean()

            # Critic loss
            critic_loss = nn.MSELoss()(new_values.squeeze(), returns)

            # Total loss
            loss = actor_loss + 0.5 * critic_loss - 0.01 * entropy

            agent.optimizer.zero_grad()
            loss.backward()
            nn.utils.clip_grad_norm_(agent.network.parameters(), 0.5)
            agent.optimizer.step()

    def _compute_gae(self, rewards, values, last_value=0):
        """计算 Generalized Advantage Estimation"""
        advantages = []
        gae = 0
        values = values + [last_value]

        for t in reversed(range(len(rewards))):
            delta = rewards[t] + self.gamma * values[t + 1] - values[t]
            gae = delta + self.gamma * self.gae_lambda * gae
            advantages.insert(0, gae)

        return advantages
```

### 7.3 训练过程中的关键观察

训练这个系统的过程中，我发现了几个有意思的现象：

**1. 奖励设计决定一切**

最开始我把三个 Agent 的奖励独立设计，结果它们互相"拉扯"。交通 Agent 让路口全绿，能源 Agent 又把功率压下来，两个 Agent 的奖励都在震荡，始终不收敛。

后来我加了全局奖励权重：交通 0.4、能源 0.3、应急 0.3。三个 Agent 才开始学会"妥协"。

**2. 应急 Agent 的冷启动问题**

应急事件是随机产生的，大部分时间没有事件。应急 Agent 几乎没有训练信号，学到的策略就是"什么都不做"。

解决办法：人为增加应急事件的出现频率，从 0.5% 提升到 5%，等策略稳定后再降低。

**3. 探索与利用的平衡**

三个 Agent 同时探索，环境变化太剧烈，很难学到有意义的策略。

解决办法：采用"轮流探索"策略——每个训练步只有一个 Agent 在探索，其他 Agent 用当前最优策略。

---

## 八、评估指标

### 8.1 核心指标

我们定义了四个核心评估指标：

```python
class Evaluator:
    """多 Agent 系统评估器"""

    def __init__(self, env: SmartCityEnv, agents: dict):
        self.env = env
        self.agents = agents

    def evaluate(self, n_episodes: int = 100) -> dict:
        """运行评估并计算指标"""
        metrics = {
            "avg_reward": [],
            "traffic_efficiency": [],
            "energy_consumption": [],
            "emergency_response_time": [],
            "coordination_score": [],
        }

        for _ in range(n_episodes):
            state = self.env.reset()
            episode_metrics = self._run_episode(state)
            for key in metrics:
                metrics[key].append(episode_metrics[key])

        # 汇总
        return {key: np.mean(vals) for key, vals in metrics.items()}

    def _run_episode(self, state) -> dict:
        """运行一个完整 episode"""
        total_reward = 0
        total_queue = 0
        total_energy = 0
        emergency_times = []
        coordination_events = 0

        for step in range(3600):
            actions = {}
            for name, agent in self.agents.items():
                state_tensor = agent.observe(state)
                dist, _ = agent.network(state_tensor)
                actions[name] = dist.sample().item()

            # 评估协调质量
            if self._check_coordination(actions):
                coordination_events += 1

            next_state, rewards, done, info = self.env.step(actions)

            total_reward += sum(rewards.values())
            total_queue += sum(
                inter[d]["queue"]
                for inter in state["intersections"].values()
                for d in ["north", "south", "east", "west"]
            )
            total_energy += state["energy"]["total_load"]

            if state["emergency"]["event_type"] > 0:
                emergency_times.append(state["emergency"]["response_time"])

            state = next_state
            if done:
                break

        return {
            "avg_reward": total_reward / 3600,
            "traffic_efficiency": 1.0 / (1.0 + total_queue / 3600),
            "energy_consumption": total_energy / 3600,
            "emergency_response_time": (
                np.mean(emergency_times) if emergency_times else 0
            ),
            "coordination_score": coordination_events / 3600,
        }

    def _check_coordination(self, actions: dict) -> bool:
        """检查 Agent 之间是否协调"""
        # 简单检查: 应急 Agent 激活时, 交通 Agent 是否配合
        if actions.get("emergency", 0) > 0:
            if actions.get("traffic", 0) in [0, 3]:  # 应急方向相位
                return True
            return False
        return True
```

### 8.2 关键评估维度

| 指标 | 计算方式 | 目标 |
|------|---------|------|
| 平均全局奖励 | 三 Agent 奖励加权平均 | 趋势上升 |
| 交通效率 | 1 / (1 + 平均排队长度) | 大于 0.8 |
| 能源消耗 | 平均电力负荷 / 总容量 | 小于 0.7 |
| 应急响应时间 | 从事件发生到处理的平均时间 | 小于 60 步 |
| 协调分数 | 协调事件 / 总步数 | 大于 0.9 |

---

## 九、常见陷阱

### 陷阱一：奖励尺度不统一

三个 Agent 的奖励量级差太大：交通奖励在 -100 到 0 之间，能源奖励在 -2 到 1.5 之间，应急奖励在 0 到 15 之间。

全局奖励被交通 Agent 主导，能源和应急 Agent 几乎学不到东西。

**解决**：对每个 Agent 的奖励做归一化，让它们在同一量级上。

```python
class RewardNormalizer:
    """奖励归一化器"""

    def __init__(self, clip: float = 5.0):
        self.mean = 0.0
        self.std = 1.0
        self.count = 0
        self.clip = clip

    def update(self, reward: float):
        self.count += 1
        self.mean += (reward - self.mean) / self.count
        self.std = max(
            0.01,
            np.sqrt(
                ((self.count - 1) * self.std**2 + (reward - self.mean) ** 2)
                / self.count
            ),
        )

    def normalize(self, reward: float) -> float:
        normalized = (reward - self.mean) / self.std
        return np.clip(normalized, -self.clip, self.clip)
```

### 陷阱二：非平稳环境

三个 Agent 同时学习，对每个 Agent 来说，其他 Agent 的行为在不断变化。这就导致环境是非平稳的——同样的状态，之前给正奖励，现在可能给负奖励。

**解决**：
1. 用全局奖励引导方向，减少 Agent 之间的互相干扰
2. 定期冻结部分 Agent 的参数，降低环境变化速度
3. 使用中心化训练、去中心化执行（CTDE）的框架

### 陷阱三：信用分配问题

全局奖励是好的，但每个 Agent 不知道自己贡献了多少。交通 Agent 做了一个好的决策，但能源 Agent 的错误导致全局奖励很低，交通 Agent 会以为自己的策略不好。

**解决**：
1. 给每个 Agent 保留独立的局部奖励
2. 全局奖励作为额外的辅助信号，而不是唯一的训练信号

### 陷阱四：维度灾难

4 个路口、4 个方向、多个状态变量——状态空间是指数级增长的。Q-Learning 的 Q 表根本存不下。

**解决**：
1. 用神经网络近似 Q 函数（DQN 或 PPO）
2. 状态空间分解：每个 Agent 只观察自己负责的部分
3. 使用参数共享：不同路口的 Agent 共用同一个网络

### 陷阱五：训练不稳定

三个 Agent 同时更新策略，梯度方向可能互相冲突，导致训练震荡甚至发散。

**解决**：
1. 降低学习率（从 1e-3 降到 3e-4）
2. 梯度裁剪（clip_grad_norm）
3. 异步更新：一个 Agent 更新时，其他 Agent 冻结
4. 增加 GAE lambda 的平滑系数

---

## 十、参考资料

1. Schulman, J., et al. "Proximal Policy Optimization Algorithms." arXiv:1707.06347, 2017.
2. Lowe, R., et al. "Multi-Agent Actor-Critic for Mixed Cooperative-Competitive Environments." NeurIPS, 2017.
3. Rashid, T., et al. "QMIX: Monotonic Value Function Factorisation for Deep Multi-Agent Reinforcement Learning." ICML, 2018.
4. Foerster, J., et al. "Stabilising Experience Replay for Deep Multi-Agent Reinforcement Learning." ICML, 2017.
5. OpenAI, "Spinning Up in Deep Reinforcement Learning." https://spinningup.openai.com/
6. Petrik, M., et al. "A Decomposition Approach to Multi-Agent Reinforcement Learning." JAIR, 2020.

---

写完这篇文章，回头看这个项目，最大的收获不是技术细节，而是对"协作"的理解。

单个 Agent 再强，如果不会跟其他 Agent 协作，系统整体效果也不会好。这跟团队开发是一样的——一个人写代码写得再快，如果不能跟团队配合，项目照样延期。

多 Agent 强化学习是一个快速发展的领域，MARL（Multi-Agent RL）的论文每年都在增加。如果你也在做类似的项目，欢迎交流。
