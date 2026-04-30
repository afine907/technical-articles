import React from 'react';
import ArticleCard from '../ArticleCard';
import styles from './styles.module.css';

const categories = [
  {
    label: '🚀 AI Native Pipeline 系列',
    description: '从需求到代码的全自动开发流水线',
    items: [
      { docId: 'ai-native-pipeline/AI-Native-Pipeline-设计实践', title: 'AI Native Pipeline 设计实践', description: '从需求到代码的全自动开发流水线' },
      { docId: 'ai-native-pipeline/AI-Native-Pipeline-踩坑实录', title: 'AI Native Pipeline 踩坑实录', description: 'Agent 开发的那些坑与解决方案' },
      { docId: 'ai-native-pipeline/Agent-效果评估实战', title: 'Agent 效果评估实战', description: '如何量化验证 Agent 改进效果' },
    ],
  },
  {
    label: '🏗️ Agent 架构设计',
    description: 'Agent 核心架构与设计模式',
    items: [
      { docId: 'agent-architecture/AI-Agent-长期记忆管理实现', title: 'AI Agent 长期记忆管理实现', description: 'Agent 长期记忆的完整实现方案' },
      { docId: 'agent-architecture/Agent-Tool-Permission-Design', title: 'Agent 工具权限管理设计', description: 'Agent 工具权限管理设计' },
      { docId: 'agent-architecture/jojo-code-核心架构解析', title: 'jojo-code 核心架构解析', description: 'jojo-code 核心架构源码级解析' },
      { docId: 'agent-architecture/Agent-多Agent协作指南', title: 'Agent 多 Agent 协作指南', description: '多 Agent 协作架构与实现' },
      { docId: 'agent-architecture/Agent-记忆系统设计', title: 'Agent 记忆系统设计', description: 'Agent 记忆系统完整设计' },
    ],
  },
  {
    label: '⚙️ 工程实践',
    description: 'Agent 开发工程实践',
    items: [
      { docId: 'agent-engineering/LangGraph-Agent-编排实战', title: 'LangGraph Agent 编排实战', description: 'LangGraph Agent 编排实战指南' },
      { docId: 'agent-engineering/Agent-状态管理设计', title: 'Agent 状态管理设计', description: 'Agent 状态管理的完整方案' },
      { docId: 'agent-engineering/llm-context-window-management', title: 'LLM 上下文窗口管理策略', description: 'LLM 上下文窗口管理策略' },
      { docId: 'agent-engineering/Agent-MCP实战指南', title: 'Agent MCP 实战指南', description: 'Model Context Protocol 实战' },
      { docId: 'agent-engineering/Agent-Prompt设计指南', title: 'Agent Prompt 设计指南', description: 'Agent Prompt 工程最佳实践' },
      { docId: 'agent-engineering/Agent-工具开发指南', title: 'Agent 工具开发指南', description: 'Agent 工具开发完整指南' },
      { docId: 'agent-engineering/Agent-测试指南', title: 'Agent 测试指南', description: 'Agent 测试策略与实践' },
    ],
  },
  {
    label: '⚡ 进阶能力',
    description: 'Agent 进阶开发能力',
    items: [
      { docId: 'agent-advanced/Agent-流式响应实现', title: 'Agent 流式响应实现', description: 'Agent 流式响应完整实现' },
      { docId: 'agent-advanced/Agent-错误处理与重试机制', title: 'Agent 错误处理与重试机制', description: 'Agent 错误处理最佳实践' },
      { docId: 'agent-advanced/Agent-性能监控与调优', title: 'Agent 性能监控与调优', description: 'Agent 性能监控与调优方案' },
      { docId: 'agent-advanced/Agent-自我进化机制', title: 'Agent 自我进化机制', description: 'Agent 自我进化机制设计' },
    ],
  },
  {
    label: '🏛️ 架构师视角',
    description: 'Agent 架构师级别的技术深度',
    items: [
      { docId: 'agent-architecture-level/Agent-安全威胁与防御策略', title: 'Agent 安全威胁与防御策略', description: 'jojo-code 安全模块源码级剖析' },
      { docId: 'agent-architecture-level/Agent-多模型降级策略', title: 'Agent 多模型降级策略', description: '多模型架构与降级算法实战' },
      { docId: 'agent-architecture-level/typescript-python-architecture-practice', title: 'TypeScript + Python 双语言架构实践', description: '跨语言架构设计与实现' },
    ],
  },
  {
    label: '🎯 实战项目',
    description: 'Agent 实战项目开发',
    items: [
      { docId: 'agent-projects/Agent-实战项目开发', title: 'Agent 实战项目开发', description: 'Agent 实战项目完整开发流程' },
    ],
  },
  {
    label: '🚢 运维部署',
    description: 'Agent 部署与运维',
    items: [
      { docId: 'agent-ops/Agent-部署上线指南', title: 'Agent 部署上线指南', description: 'Agent 部署与运维完整指南' },
    ],
  },
  {
    label: '📊 框架对比',
    description: '主流 Agent 框架对比评测',
    items: [
      { docId: 'agent-framework/主流-Agent-框架对比评测', title: '主流 Agent 框架对比评测', description: 'LangGraph、LangChain、AutoGen、CrewAI 深度评测' },
    ],
  },
];

export { categories };

export default function ArticleList() {
  return (
    <div className={styles.container}>
      {categories.map((category, idx) => (
        <section key={idx} className={styles.categorySection}>
          <h2 className={styles.categoryTitle}>{category.label}</h2>
          <p className={styles.categoryDescription}>{category.description}</p>
          <div className={styles.grid}>
            {category.items.map((item, itemIdx) => (
              <ArticleCard
                key={itemIdx}
                title={item.title}
                description={item.description}
                category={category.label.replace(/^[^\s]+\s/, '')}
                docId={item.docId}
              />
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
