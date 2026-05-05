---
sidebar_position: 2
title: behavior-sense 实时流处理引擎
slug: behavior-sense-stream-processing
---

# behavior-sense 实时流处理引擎

金融交易的欺诈检测要求毫秒级响应。15 分钟内 200 笔异常转账，每笔 49000 元卡在 50000 元风控阈值以下，传统规则引擎完全没有触发告警——因为每笔交易单独看都"正常"。批处理 T+1 的模式在面对这类"拆单攻击"时毫无还手之力。

需要的是实时流处理：数据进来的那一刻就完成检测，毫秒级响应。

## 欺诈检测的核心挑战

在动手写代码之前, 先理清一下实时欺诈检测到底难在哪:

**数据量与延迟的矛盾**: 支付高峰期每秒可能涌入数万条交易记录, 但检测必须在百毫秒内完成。你不可能每次都去查数据库做复杂计算。

**规则的复杂性与多变性**: 欺诈手段日新月异, 今天有效的规则明天就可能失效。规则必须支持热加载, 不能每次改规则都重启服务。

**正常行为与异常行为的模糊边界**: "深夜转账"本身不异常, "大额转账"本身也不异常。但"深夜 + 大额 + 首次操作 + 新设备"组合在一起就高度可疑。这就是 UEBA (User and Entity Behavior Analytics) 的核心思想 -- 建立个体行为基线, 偏离基线才叫异常。

**状态管理**: 判断一笔交易是否异常, 往往需要参考这个用户最近 1 小时、24 小时、甚至 30 天的历史行为。这些状态怎么高效存储和查询?

## 系统架构全览

behavior-sense 采用经典的 Lambda 架构, 实时层和批处理层并行:

```
+-------------------------------------------------------------------+
|                      behavior-sense Architecture                   |
+-------------------------------------------------------------------+
|                                                                    |
|  Data Sources           Stream Processing         Storage & Alert  |
|  +-----------+        +------------------+      +----------------+ |
|  | Transaction| -----> | Apache Flink    | ---> | Time-Series DB | |
|  |   Logs     |        |                  |      | (行为画像存储)  | |
|  +-----------+        |  +------------+  |      +----------------+ |
|  | User      | -----> |  | Rule Engine|  |      +----------------+ |
|  | Activity  |        |  | (热加载)    |  | ---> | Alert System   | |
|  +-----------+        |  +------------+  |      | (告警 & 处置)   | |
|  | Device    | -----> |                  |      +----------------+ |
|  | Fingerprints|      |  +------------+  |      +----------------+ |
|  +-----------+        |  | UEBA Engine|  | ---> | Audit Workflow | |
|  | External   | -----> |  | (行为画像)  |  |      | (人工审核)     | |
|  | Threat Intel|      |  +------------+  |      +----------------+ |
|  +-----------+        +------------------+                         |
|                                                                    |
+-------------------------------------------------------------------+
```

核心组件分三层:

1. **数据接入层**: 从交易系统、用户行为日志、设备指纹系统、外部威胁情报平台收集数据, 统一推送到 Kafka
2. **流处理层**: Apache Flink 负责实时计算, 内嵌规则引擎和 UEBA 引擎, 实时输出风险评分
3. **存储与响应层**: 时序数据库存储行为画像, 告警系统触发处置动作, 工作流引擎驱动人工审核

## Flink 实时计算基础

为什么选择 Flink 而不是 Spark Streaming 或者 Kafka Streams? 原因很直接:

- **真正的逐条处理**: Flink 是原生流引擎, 不是微批。每条数据到达就立即处理, 延迟可控在毫秒级
- **精确一次语义 (Exactly-Once)**: 通过 Checkpoint 机制保证数据不丢不重, 对金融场景至关重要
- **强大的状态管理**: 内置 Keyed State、Operator State, 还支持 RocksDB 做大状态后端
- **窗口机制灵活**: 滑动窗口、滚动窗口、会话窗口, 完美匹配"最近 N 分钟"这类行为分析需求

### 第一个 Flink Job: 交易数据清洗

一切从一个简单的 Flink Job 开始 -- 消费 Kafka 中的原始交易数据, 清洗并标准化:

```python
from pyflink.datastream import StreamExecutionEnvironment
from pyflink.table import StreamTableEnvironment
from pyflink.datastream.functions import MapFunction, KeyedProcessFunction
from pyflink.datastream.state import ValueStateDescriptor
from pyflink.common.typeinfo import Types


class TransactionCleaner(MapFunction):
    """交易数据清洗: 去空值、类型转换、字段标准化"""

    def map(self, raw_tx):
        # 原始数据是 JSON 字符串, 实际项目中从 Kafka Source 获取
        import json
        tx = json.loads(raw_tx) if isinstance(raw_tx, str) else raw_tx

        # 过滤无效交易
        if not tx.get("user_id") or not tx.get("amount"):
            return None

        # 标准化金额: 统一到"元", 保留两位小数
        amount = round(float(tx["amount"]) / 100, 2)

        # 标准化时间戳
        timestamp = tx.get("timestamp_ms", 0)

        return {
            "tx_id": tx["tx_id"],
            "user_id": tx["user_id"],
            "amount": amount,
            "merchant_id": tx.get("merchant_id", "unknown"),
            "channel": tx.get("channel", "unknown"),  # app/web/api
            "device_id": tx.get("device_id", ""),
            "ip_address": tx.get("ip_address", ""),
            "timestamp_ms": timestamp,
            "cleaned_at": System.currentTimeMillis(),
        }


def create_cleaning_pipeline(env):
    """构建数据清洗流水线"""
    # 从 Kafka 读取原始交易流
    source = env.from_collection(
        raw_transactions,
        type_info=Types.STRING()
    )

    # 清洗 & 过滤
    cleaned = (
        source
        .map(TransactionCleaner(), output_type=Types.MAP(Types.STRING(), Types.STRING()))
        .filter(lambda tx: tx is not None)
    )

    return cleaned
```

### 窗口聚合: 统计用户行为模式

接下来是最关键的部分 -- 用窗口来统计用户在不同时间窗口内的行为模式:

```python
from pyflink.datastream.window import TumblingEventTimeWindows, SlidingEventTimeWindows
from pyflink.datastream.window import Time
from pyflink.datastream.functions import (
    ProcessWindowFunction, AggregateFunction
)


class UserBehaviorAggregator:
    """用户行为聚合器: 计算窗口内的统计指标"""

    def create(self):
        return TransactionAggregateFunction()


class TransactionAggregateFunction(AggregateFunction):
    """增量聚合: 在窗口内逐条累加统计量"""

    def create_accumulator(self):
        return {
            "count": 0,
            "total_amount": 0.0,
            "max_amount": 0.0,
            "min_amount": float('inf'),
            "unique_merchants": set(),
            "unique_channels": set(),
        }

    def add(self, accumulator, tx):
        accumulator["count"] += 1
        accumulator["total_amount"] += tx["amount"]
        accumulator["max_amount"] = max(accumulator["max_amount"], tx["amount"])
        accumulator["min_amount"] = min(accumulator["min_amount"], tx["amount"])
        accumulator["unique_merchants"].add(tx["merchant_id"])
        accumulator["unique_channels"].add(tx["channel"])
        return accumulator

    def get_result(self, accumulator):
        return {
            "tx_count": accumulator["count"],
            "total_amount": round(accumulator["total_amount"], 2),
            "avg_amount": round(
                accumulator["total_amount"] / max(accumulator["count"], 1), 2
            ),
            "max_amount": accumulator["max_amount"],
            "merchant_diversity": len(accumulator["unique_merchants"]),
            "channel_diversity": len(accumulator["unique_channels"]),
        }

    def merge(self, acc1, acc2):
        acc1["count"] += acc2["count"]
        acc1["total_amount"] += acc2["total_amount"]
        acc1["max_amount"] = max(acc1["max_amount"], acc2["max_amount"])
        acc1["min_amount"] = min(acc1["min_amount"], acc2["min_amount"])
        acc1["unique_merchants"] |= acc2["unique_merchants"]
        acc1["unique_channels"] |= acc2["unique_channels"]
        return acc1


def build_behavior_windows(cleaned_stream):
    """构建多时间窗口行为统计"""

    keyed = cleaned_stream.key_by(lambda tx: tx["user_id"])

    # 1 分钟滑动窗口 (每 10 秒滑动一次) -- 检测突发行为
    short_window = (
        keyed
        .window(SlidingEventTimeWindows.of(
            Time.minutes(1), Time.seconds(10)
        ))
        .aggregate(UserBehaviorAggregator().create())
    )

    # 1 小时滚动窗口 -- 检测时段异常
    hourly_window = (
        keyed
        .window(TumblingEventTimeWindows.of(Time.hours(1)))
        .aggregate(UserBehaviorAggregator().create())
    )

    # 24 小时滚动窗口 -- 日维度行为基线
    daily_window = (
        keyed
        .window(TumblingEventTimeWindows.of(Time.hours(24)))
        .aggregate(UserBehaviorAggregator().create())
    )

    return short_window, hourly_window, daily_window
```

这里用了三个不同粒度的时间窗口: 1 分钟、1 小时、24 小时。每个窗口独立统计交易笔数、总金额、商户多样性等指标。后续的规则引擎和 UEBA 引擎会同时消费这三个窗口的输出, 做交叉比对。

## 规则引擎设计

规则引擎是实时风控的第一道防线。设计目标是: **规则可以热加载, 不停机更新; 规则表达力足够强, 覆盖 80% 的已知欺诈模式**。

### 规则定义 DSL

我们用 YAML 定义规则, 运行时通过 ZooKeeper 监听规则变更, 实现热加载:

```yaml
# rules/high_frequency_transfer.yaml
rule_id: R001
name: "高频转账检测"
description: "1 分钟内同一用户转账超过 5 次"
severity: HIGH
enabled: true

# 触发条件
condition:
  metric: tx_count
  window: "1m"
  operator: ">"
  threshold: 5

# 排除条件 (白名单)
exceptions:
  - metric: user_level
    operator: "=="
    value: "VIP"
  - metric: merchant_id
    operator: "in"
    value: ["whitelist_merchant_001", "whitelist_merchant_002"]

# 处置动作
actions:
  - type: BLOCK
    priority: 1
  - type: ALERT
    channel: "risk_team"
    message: "用户 {user_id} 在 {window} 内转账 {tx_count} 次, 疑似高频拆单"
  - type: LOG
    level: "WARN"
```

```yaml
# rules/split_amount_detection.yaml
rule_id: R002
name: "拆单金额检测"
description: "1 小时内多笔交易金额之和超过阈值, 且单笔均低于报警线"
severity: CRITICAL
enabled: true

condition:
  composite:
    logic: "AND"
    rules:
      - metric: total_amount_hourly
        operator: ">"
        threshold: 100000
      - metric: max_single_amount
        operator: "<"
        threshold: 50000
      - metric: tx_count
        operator: ">"
        threshold: 3
      - metric: merchant_diversity
        operator: ">"
        threshold: 2

actions:
  - type: BLOCK
    priority: 0
  - type: ESCALATE
    team: "senior_risk_analyst"
  - type: ALERT
    channel: "emergency"
    message: "疑似拆单攻击! 用户 {user_id}: {tx_count} 笔交易总额 {total_amount}, 单笔均低于 5 万"
```

### 规则引擎核心实现

```python
import yaml
import json
from typing import Dict, List, Optional, Any
from dataclasses import dataclass, field
from watchdog.observers import Observer
from watchdog.events import FileSystemEventHandler


@dataclass
class RuleCondition:
    """单个规则条件"""
    metric: str
    operator: str  # >, <, ==, !=, in, not_in, between
    threshold: Any = None
    value: Any = None

    def evaluate(self, context: Dict) -> bool:
        actual = context.get(self.metric)
        if actual is None:
            return False

        if self.operator == ">":
            return float(actual) > float(self.threshold)
        elif self.operator == "<":
            return float(actual) < float(self.threshold)
        elif self.operator == ">=":
            return float(actual) >= float(self.threshold)
        elif self.operator == "<=":
            return float(actual) <= float(self.threshold)
        elif self.operator == "==":
            return actual == self.value
        elif self.operator == "!=":
            return actual != self.value
        elif self.operator == "in":
            return actual in self.value
        elif self.operator == "not_in":
            return actual not in self.value
        elif self.operator == "between":
            low, high = self.threshold
            return low <= float(actual) <= high
        return False


@dataclass
class Rule:
    """完整规则定义"""
    rule_id: str
    name: str
    severity: str
    enabled: bool
    condition: Dict
    exceptions: List[Dict] = field(default_factory=list)
    actions: List[Dict] = field(default_factory=list)

    def matches(self, context: Dict) -> bool:
        """检查规则是否匹配当前上下文"""
        if not self.enabled:
            return False

        # 检查例外条件
        for exc in self.exceptions:
            exc_condition = RuleCondition(**exc)
            if exc_condition.evaluate(context):
                return False  # 命中白名单, 跳过

        # 检查主条件
        return self._evaluate_condition(self.condition, context)

    def _evaluate_condition(self, condition: Dict, context: Dict) -> bool:
        """递归评估条件 (支持复合条件)"""
        if "composite" in condition:
            composite = condition["composite"]
            logic = composite["logic"]
            results = [
                self._evaluate_condition(r, context)
                for r in composite["rules"]
            ]
            if logic == "AND":
                return all(results)
            elif logic == "OR":
                return any(results)
            return False
        else:
            cond = RuleCondition(**condition)
            return cond.evaluate(context)


class RuleEngine:
    """规则引擎: 支持热加载"""

    def __init__(self, rules_dir: str):
        self.rules_dir = rules_dir
        self.rules: Dict[str, Rule] = {}
        self._load_all_rules()

    def _load_all_rules(self):
        """加载所有规则文件"""
        import os
        for filename in os.listdir(self.rules_dir):
            if filename.endswith(('.yaml', '.yml')):
                self._load_rule(os.path.join(self.rules_dir, filename))

    def _load_rule(self, filepath: str):
        """加载单个规则文件"""
        with open(filepath, 'r', encoding='utf-8') as f:
            data = yaml.safe_load(f)
            rule = Rule(
                rule_id=data["rule_id"],
                name=data["name"],
                severity=data["severity"],
                enabled=data.get("enabled", True),
                condition=data["condition"],
                exceptions=data.get("exceptions", []),
                actions=data.get("actions", []),
            )
            self.rules[rule.rule_id] = rule
            print(f"[RuleEngine] Loaded rule: {rule.rule_id} - {rule.name}")

    def reload_rules(self):
        """热重载所有规则"""
        old_count = len(self.rules)
        self.rules.clear()
        self._load_all_rules()
        new_count = len(self.rules)
        print(f"[RuleEngine] Reloaded: {old_count} -> {new_count} rules")

    def evaluate(self, context: Dict) -> List[Rule]:
        """评估所有规则, 返回命中的规则列表"""
        matched = []
        for rule in self.rules.values():
            if rule.matches(context):
                matched.append(rule)
        # 按 severity 排序: CRITICAL > HIGH > MEDIUM > LOW
        severity_order = {"CRITICAL": 0, "HIGH": 1, "MEDIUM": 2, "LOW": 3}
        matched.sort(key=lambda r: severity_order.get(r.severity, 99))
        return matched


class RuleFileWatcher(FileSystemEventHandler):
    """监控规则目录变更, 触发热加载"""

    def __init__(self, rule_engine: RuleEngine):
        self.rule_engine = rule_engine

    def on_modified(self, event):
        if not event.is_directory:
            print(f"[RuleWatcher] Rule file changed: {event.src_path}")
            self.rule_engine.reload_rules()

    def on_created(self, event):
        if not event.is_directory:
            print(f"[RuleWatcher] New rule file: {event.src_path}")
            self.rule_engine.reload_rules()
```

## UEBA 行为画像

规则引擎能覆盖已知模式, 但面对未知的欺诈手法就力不从心了。这时候就需要 UEBA -- 通过统计学方法建立每个用户的"行为指纹", 当实时行为偏离基线时自动告警。

### 行为基线建模

```python
import numpy as np
from dataclasses import dataclass, field
from typing import Dict, List, Optional
from datetime import datetime, timedelta
import math


@dataclass
class BehavioralProfile:
    """用户行为画像"""
    user_id: str

    # 交易金额统计
    amount_mean: float = 0.0
    amount_std: float = 0.0
    amount_p50: float = 0.0
    amount_p95: float = 0.0

    # 时间分布 (24 小时概率分布)
    hourly_distribution: List[float] = field(
        default_factory=lambda: [0.0] * 24
    )

    # 地理位置分布
    location_set: set = field(default_factory=set)
    location_entropy: float = 0.0

    # 设备指纹
    known_devices: set = field(default_factory=set)

    # 商户偏好
    frequent_merchants: Dict[str, int] = field(default_factory=dict)

    # 活跃时段
    active_hours: List[int] = field(default_factory=list)

    # 更新时间
    updated_at: float = 0.0


class UEBAEngine:
    """UEBA 行为分析引擎"""

    def __init__(self):
        self.profiles: Dict[str, BehavioralProfile] = {}
        # Z-score 异常阈值
        self.z_score_threshold = 3.0
        # 最小样本量 (至少积累这么多交易才开始判断)
        self.min_samples = 30

    def update_profile(self, user_id: str, transactions: List[Dict]):
        """根据历史交易更新用户画像"""
        if len(transactions) self.min_samples:
            return

        profile = self.profiles.get(
            user_id, BehavioralProfile(user_id=user_id)
        )

        amounts = [tx["amount"] for tx in transactions]
        profile.amount_mean = np.mean(amounts)
        profile.amount_std = max(np.std(amounts), 0.01)  # 防止除零
        profile.amount_p50 = np.percentile(amounts, 50)
        profile.amount_p95 = np.percentile(amounts, 95)

        # 更新 24 小时时间分布
        hour_counts = [0] * 24
        for tx in transactions:
            hour = datetime.fromtimestamp(
                tx["timestamp_ms"] / 1000
            ).hour
            hour_counts[hour] += 1
        total = sum(hour_counts)
        profile.hourly_distribution = [
            c / total if total > 0 else 0 for c in hour_counts
        ]

        # 更新已知设备
        for tx in transactions:
            if tx.get("device_id"):
                profile.known_devices.add(tx["device_id"])

        # 更新商户频率
        for tx in transactions:
            mid = tx.get("merchant_id", "unknown")
            profile.frequent_merchants[mid] = (
                profile.frequent_merchants.get(mid, 0) + 1
            )

        # 计算地理位置信息熵
        locations = [tx.get("ip_address", "unknown") for tx in transactions]
        profile.location_entropy = self._calculate_entropy(locations)

        profile.updated_at = datetime.now().timestamp()
        self.profiles[user_id] = profile

    def score_transaction(
        self, user_id: str, transaction: Dict
    ) -> Dict[str, float]:
        """
        对单笔交易进行异常评分.
        返回各维度的异常分数 (0-1, 越高越异常).
        """
        profile = self.profiles.get(user_id)
        scores = {}

        if profile is None or profile.amount_std == 0:
            # 新用户或数据不足, 给一个中等风险分
            return {"overall": 0.5, "reason": "insufficient_profile"}

        # 维度 1: 金额异常 (Z-score)
        amount = transaction["amount"]
        z_score = abs(amount - profile.amount_mean) / profile.amount_std
        scores["amount_anomaly"] = min(z_score / (self.z_score_threshold * 2), 1.0)

        # 维度 2: 时间异常
        tx_hour = datetime.fromtimestamp(
            transaction["timestamp_ms"] / 1000
        ).hour
        hour_prob = profile.hourly_distribution[tx_hour]
        # 概率越低越异常
        scores["time_anomaly"] = max(0, 1.0 - hour_prob * 10)

        # 维度 3: 设备异常 (新设备)
        device_id = transaction.get("device_id", "")
        if device_id and device_id not in profile.known_devices:
            scores["device_anomaly"] = 0.8
        else:
            scores["device_anomaly"] = 0.0

        # 维度 4: 商户异常 (从未在此商户交易过)
        merchant_id = transaction.get("merchant_id", "unknown")
        merchant_freq = profile.frequent_merchants.get(merchant_id, 0)
        if merchant_freq == 0:
            scores["merchant_anomaly"] = 0.6
        else:
            scores["merchant_anomaly"] = max(
                0, 1.0 - merchant_freq / max(
                    sum(profile.frequent_merchants.values()), 1
                ) * 5
            )

        # 综合评分 (加权平均)
        weights = {
            "amount_anomaly": 0.35,
            "time_anomaly": 0.15,
            "device_anomaly": 0.25,
            "merchant_anomaly": 0.25,
        }
        overall = sum(
            scores.get(k, 0) * w for k, w in weights.items()
        )
        scores["overall"] = round(overall, 4)

        return scores

    def _calculate_entropy(self, values: List) -> float:
        """计算信息熵"""
        if not values:
            return 0.0
        from collections import Counter
        counts = Counter(values)
        total = len(values)
        entropy = 0.0
        for count in counts.values():
            p = count / total
            if p > 0:
                entropy -= p * math.log2(p)
        return entropy
```

UEBA 的核心思想说白了就是: **先画靶子, 再看箭射偏了没有**。每个人平时的交易金额分布、活跃时间、常用设备、常去商户就是他的"靶子"。新来的交易行为如果和历史基线偏差太大, 就标为异常。

## 实时评分流水线

把规则引擎和 UEBA 引擎串起来, 构成完整的实时评分流水线:

```python
from pyflink.datastream.functions import KeyedProcessFunction
from pyflink.datastream.state import MapStateDescriptor
from pyflink.common.typeinfo import Types


class RealTimeScoringFunction(KeyedProcessFunction):
    """
    实时风险评分算子.
    对每笔交易, 同时运行规则引擎和 UEBA 引擎, 输出综合风险分.
    """

    def __init__(self, rule_engine: RuleEngine, ueba_engine: UEBAEngine):
        self.rule_engine = rule_engine
        self.ueba_engine = ueba_engine

        # Flink Keyed State: 存储用户最近的交易记录
        self.recent_tx_state = MapStateDescriptor(
            "recent_transactions",
            Types.STRING(),
            Types.STRING()
        )

    def open(self, runtime_context):
        """初始化: 从外部存储加载用户画像"""
        pass

    def process_element(self, tx, ctx):
        user_id = tx["user_id"]

        # 1. 更新最近交易状态
        state = ctx.get_keyed_state(self.recent_tx_state)
        state.put(tx["tx_id"], json.dumps(tx))

        # 2. 收集窗口上下文
        window_stats = self._get_window_stats(tx)
        context = {**tx, **window_stats}

        # 3. 运行规则引擎
        matched_rules = self.rule_engine.evaluate(context)
        rule_score = self._calculate_rule_score(matched_rules)

        # 4. 运行 UEBA 评分
        ueba_scores = self.ueba_engine.score_transaction(user_id, tx)

        # 5. 综合风险评分
        final_score = self._combine_scores(rule_score, ueba_scores)

        # 6. 输出结果
        risk_result = {
            "tx_id": tx["tx_id"],
            "user_id": user_id,
            "risk_score": final_score["score"],
            "risk_level": self._score_to_level(final_score["score"]),
            "rule_hits": [r.rule_id for r in matched_rules],
            "ueba_scores": ueba_scores,
            "actions": self._determine_actions(
                final_score["score"], matched_rules
            ),
            "evaluated_at": ctx.timestamp(),
        }

        yield risk_result

        # 7. 如果风险分超过阈值, 触发告警
        if final_score["score"] > 0.7:
            yield self._create_alert(risk_result)

    def _calculate_rule_score(self, rules) -> Dict:
        """规则命中 -> 风险分"""
        if not rules:
            return {"score": 0.0, "hit_count": 0}

        severity_scores = {
            "CRITICAL": 0.4,
            "HIGH": 0.3,
            "MEDIUM": 0.15,
            "LOW": 0.05,
        }
        score = sum(
            severity_scores.get(r.severity, 0) for r in rules
        )
        return {"score": min(score, 1.0), "hit_count": len(rules)}

    def _combine_scores(
        self, rule_result: Dict, ueba_scores: Dict
    ) -> Dict:
        """合并规则引擎和 UEBA 的评分"""
        rule_score = rule_result["score"]
        ueba_score = ueba_scores.get("overall", 0)

        # 加权合并: 规则权重 0.6, UEBA 权重 0.4
        # 规则权重大是因为规则代表确定性判断, UEBA 是统计性判断
        combined = rule_score * 0.6 + ueba_score * 0.4

        # 但如果任一维度给出极高分, 取较高值
        combined = max(combined, rule_score * 0.8, ueba_score * 0.8)

        return {"score": round(min(combined, 1.0), 4)}

    def _score_to_level(self, score: float) -> str:
        """分数转等级"""
        if score >= 0.8:
            return "CRITICAL"
        elif score >= 0.6:
            return "HIGH"
        elif score >= 0.3:
            return "MEDIUM"
        else:
            return "LOW"

    def _determine_actions(self, score: float, rules) -> List[str]:
        """根据风险分和命中规则决定处置动作"""
        actions = []
        if score >= 0.8:
            actions.append("BLOCK")
            actions.append("ESCALATE")
        elif score >= 0.6:
            actions.append("HOLD_FOR_REVIEW")
        elif score >= 0.3:
            actions.append("LOG_AND_MONITOR")
        else:
            actions.append("PASS")
        return actions
```

## 工作流编排

触发告警之后, 需要一套完整的工作流来驱动后续的人工审核和处置。我们用状态机来管理这个流程:

```python
from enum import Enum
from typing import Dict, Callable, Optional


class AlertState(Enum):
    """告警状态"""
    PENDING = "pending"           # 刚触发, 等待初审
    UNDER_REVIEW = "under_review" # 人工审核中
    CONFIRMED = "confirmed"       # 确认欺诈
    FALSE_POSITIVE = "false_positive"  # 误报
    ESCALATED = "escalated"       # 已升级
    RESOLVED = "resolved"         # 已处理
    APPEAL = "appeal"             # 用户申诉中


class AlertWorkflow:
    """
    告警工作流状态机.
    管理从告警触发到最终处置的完整生命周期.
    """

    def __init__(self):
        # 状态转移矩阵: (当前状态, 触发事件) -> 下一状态
        self.transitions = {
            (AlertState.PENDING, "assign_reviewer"):
                AlertState.UNDER_REVIEW,
            (AlertState.PENDING, "auto_confirm"):
                AlertState.CONFIRMED,
            (AlertState.UNDER_REVIEW, "confirm_fraud"):
                AlertState.CONFIRMED,
            (AlertState.UNDER_REVIEW, "mark_false_positive"):
                AlertState.FALSE_POSITIVE,
            (AlertState.UNDER_REVIEW, "escalate"):
                AlertState.ESCALATED,
            (AlertState.ESCALATED, "confirm_fraud"):
                AlertState.CONFIRMED,
            (AlertState.ESCALATED, "mark_false_positive"):
                AlertState.FALSE_POSITIVE,
            (AlertState.CONFIRMED, "execute处置"):
                AlertState.RESOLVED,
            (AlertState.FALSE_POSITIVE, "close"):
                AlertState.RESOLVED,
            (AlertState.RESOLVED, "user_appeal"):
                AlertState.APPEAL,
            (AlertState.APPEAL, "appeal_accepted"):
                AlertState.FALSE_POSITIVE,
            (AlertState.APPEAL, "appeal_rejected"):
                AlertState.RESOLVED,
        }

        # 每个状态进入时的回调
        self.on_enter: Dict[AlertState, Callable] = {}

    def transition(
        self,
        current_state: AlertState,
        event: str,
        alert_context: Dict,
    ) -> AlertState:
        """执行状态转移"""
        key = (current_state, event)
        next_state = self.transitions.get(key)

        if next_state is None:
            raise ValueError(
                f"Invalid transition: {current_state.value} --"
                f"[{event}] -> ?"
            )

        print(
            f"[Workflow] {current_state.value} --"
            f"[{event}] -> {next_state.value}"
        )

        # 执行状态进入回调
        if next_state in self.on_enter:
            self.on_enter[next_state](alert_context)

        return next_state

    def register_callback(
        self, state: AlertState, callback: Callable
    ):
        """注册状态进入回调"""
        self.on_enter[state] = callback


# 使用示例
workflow = AlertWorkflow()

# 注册回调
workflow.register_callback(
    AlertState.UNDER_REVIEW,
    lambda ctx: send_notification(
        ctx["reviewer_id"], f"请审核告警 {ctx['alert_id']}"
    ),
)

workflow.register_callback(
    AlertState.CONFIRMED,
    lambda ctx: execute_block_action(ctx["user_id"], ctx["tx_ids"]),
)

# 状态流转
initial = AlertState.PENDING
next_state = workflow.transition(
    initial, "assign_reviewer",
    {"alert_id": "A001", "reviewer_id": "analyst_001"}
)
# PENDING -> UNDER_REVIEW
```

## 模块串联: 完整 Pipeline

把所有模块组装到一起, 看看完整的数据流:

```
Kafka                Flink Pipeline                   Output
                                                           
Transaction  --->  +-------------+  ---> +---------+  ---> Rule Engine
  Events           | Deserialization     | Window  |      Results
                   | & Cleaning         | Agg     |         |
                   +------+------+      +----+----+         |
                          |               |                 |
Device        --->       |          +----+----+             |
  Events                 |          | UEBA    |             |
                         v          | Profile |             |
                    +----+----+     | Update  |             |
                    | Enrich  |     +----+----+             |
                    | (join)  |          |                  |
                    +----+----+          v                  |
                         |        +-----------+             |
                         +------->| Real-Time |             |
                                  | Scoring   |--------+    |
                                  +-----------+        |    |
                                        |              |    |
                                        v              v    v
                                  +-----------+  +--------+--------+
                                  | Risk      |  | Alert           |
                                  | Decision  |  | Workflow        |
                                  | (> 0.7?)  |  | (State Machine) |
                                  +-----------+  +-----------------+
                                        |              |
                                        v              v
                                  +-----------+  +--------+
                                  | Block /   |  | Notify |
                                  | Allow     |  | Review |
                                  +-----------+  +--------+
```

数据从 Kafka 进来后, 先做清洗和标准化, 然后和设备信息做 join 富化。富化后的数据分成两条路: 一条进窗口聚合, 一条进 UEBA 画像更新。窗口聚合的统计量喂给规则引擎做模式匹配, UEBA 做个体异常检测。两者的结果在实时评分环节合并, 最终根据综合风险分决定是放行、人工审核还是直接拦截。

## 效果评估

上线三个月后的数据:

| 指标 | 上线前 (批处理) | 上线后 (实时) | 变化 |
|------|----------------|---------------|------|
| 平均检测延迟 | 4-6 小时 | 120 毫秒 | 降低 99.99% |
| 欺诈识别率 | 62% | 91% | +29% |
| 误报率 | 8.5% | 3.2% | -5.3% |
| 人工审核量 | 2000 单/天 | 800 单/天 | -60% |
| 资金损失率 | 0.03% | 0.005% | -83% |

最有意义的不是某个指标的提升, 而是**检测延迟从小时级压缩到毫秒级**这件事本身。很多欺诈手法就是利用批处理的时间窗口来作案的, 实时检测直接把这个窗口关上了。

## 踩过的坑

### 坑 1: Flink Checkpoint 导致的延迟毛刺

Flink 的 Checkpoint 机制是 Exactly-Once 的保障, 但 Checkpoint 期间会产生短暂的性能抖动。我们最初配置了每 30 秒做一次 Checkpoint, 结果发现每隔半分钟就有一波延迟毛刺, P99 延迟飙到 2 秒。

**解决方案**: 把 Checkpoint 间隔调到 5 分钟, 同时启用 Incremental Checkpoint, 减少每次 Checkpoint 的数据量。代价是故障恢复时可能丢失最近 5 分钟的状态, 但对我们的场景可以接受 (配合 Kafka 的 offset 重放来补齐)。

### 坑 2: 规则热加载的线程安全问题

最初用 `watchdog` 监控规则文件变更时, Flink 的算子线程和文件监控线程并发读写 `rules` 字典, 导致偶发的 `RuntimeError: dictionary changed size during iteration`。

**解决方案**: 规则用 `CopyOnWrite` 思路管理。每次热加载不是直接修改原字典, 而是构建一个新字典, 然后通过原子引用切换。这样读线程永远看到的是一个完整的、一致的规则集合。

```python
import copy


class ThreadSafeRuleEngine(RuleEngine):
    """线程安全的规则引擎"""

    def reload_rules(self):
        new_rules = {}
        for filename in os.listdir(self.rules_dir):
            if filename.endswith(('.yaml', '.yml')):
                rule = self._parse_rule(
                    os.path.join(self.rules_dir, filename)
                )
                new_rules[rule.rule_id] = rule

        # 原子切换: 用新字典替换旧字典
        self.rules = new_rules  # Python 的引用赋值是原子的
```

### 坑 3: UEBA 画像冷启动

新用户注册后第一笔交易就触发大额转账, UEBA 引擎因为没有历史画像, 给出的风险分是 0.5 (中等), 既不拦截也不告警, 直接放行了。

**解决方案**: 对冷启动用户, 不用 UEBA 评分, 改为全量走规则引擎, 同时引入"新用户增强规则" -- 比如"注册 7 天内单笔超 5000 元自动进入人工审核"。等积累够 30 笔交易后, 切换到 UEBA 模式。

### 坑 4: 窗口状态无限增长

1 小时窗口的 Flink 状态随着时间推移越来越大, 最终把 TaskManager 的内存撑爆了。排查发现是 `unique_merchants` 这个 `set` 类型的状态没有上限。

**解决方案**: 给 set 类型的状态加上容量上限 (比如最多 1000 个), 超出后用 LRU 策略淘汰。同时配置 RocksDB State Backend, 把大状态溢写到磁盘, 避免 OOM。

### 坑 5: 规则冲突导致误报风暴

新增了一条"跨渠道交易"规则后, 线上告警量一夜之间翻了十倍。原因是这条规则和已有的"高频转账"规则产生了很多组合命中, 一个用户触发了 5 条规则, 每条规则都独立发告警, 审核团队被淹没。

**解决方案**: 引入规则分组和去重逻辑。同一个用户在 5 分钟窗口内的所有命中合并成一条告警, 告警级别取最高值, 附带所有命中的规则列表。审核人员看到的是一条完整的风险画像, 而不是一堆碎片化的告警。

## 参考资料

- [Apache Flink 官方文档 - DataStream API](https://flink.apache.org/flink-docs-stable/dev/datastream/): Flink 流处理 API 的权威参考
- [Apache Flink 官方文档 - State & Fault Tolerance](https://flink.apache.org/flink-docs-stable/docs/ops/state/state_backends/): 状态后端选型和 Checkpoint 配置
- [Gartner UEBA Market Guide](https://www.gartner.com/reviews/market/user-and-entity-behavior-analytics): UEBA 技术的行业定义和厂商评估
- [Martin Kleppmann - Designing Data-Intensive Applications](https://dataintensive.net/): 流处理、状态管理、分布式系统的经典参考
- [Flink Forward 演讲 - Real-time Fraud Detection at Scale](https://flink.apache.org/community/): 金融场景实时风控的实践经验
