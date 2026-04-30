import React from 'react';
import clsx from 'clsx';
import Link from '@docusaurus/Link';
import useDocusaurusContext from '@docusaurus/useDocusaurusContext';
import Layout from '@theme/Layout';
import ArticleList, { categories } from '@site/src/components/ArticleList';
import styles from './index.module.css';

function HomepageHeader() {
  const { siteConfig } = useDocusaurusContext();
  return (
    <header className={clsx('hero hero--primary', styles.heroBanner)}>
      <div className="container">
        <div className={styles.heroContent}>
          <div className={styles.heroText}>
            <h1 className="hero__title">{siteConfig.title}</h1>
            <p className="hero__subtitle">{siteConfig.tagline}</p>
            <p className={styles.heroDescription}>
              专注于 AI Agent 架构设计、LangGraph 工程实践，分享从原型到生产的全链路经验。
            </p>
            <div className={styles.buttons}>
              <Link
                className="button button--secondary button--lg"
                to="/docs/intro">
                浏览文章 ↓
              </Link>
              <Link
                className="button button--outline button--lg"
                href="https://github.com/afine907"
                style={{ color: 'white', borderColor: 'rgba(255,255,255,0.5)' }}>
                GitHub
              </Link>
            </div>
          </div>
          <div className={styles.heroStats}>
            <div className={styles.statItem}>
              <span className={styles.statNumber}>26+</span>
              <span className={styles.statLabel}>篇文章</span>
            </div>
            <div className={styles.statItem}>
              <span className={styles.statNumber}>8</span>
              <span className={styles.statLabel}>个分类</span>
            </div>
            <div className={styles.statItem}>
              <span className={styles.statNumber}>AI</span>
              <span className={styles.statLabel}>Agent</span>
            </div>
          </div>
        </div>
      </div>
    </header>
  );
}

function FeaturedArticles() {
  const featured = [
    {
      title: '🚀 AI Native Pipeline 设计实践',
      description: '从需求到代码的全自动开发流水线',
      docId: 'ai-native-pipeline/AI-Native-Pipeline-设计实践',
    },
    {
      title: '🛡️ Agent 安全威胁与防御策略',
      description: 'jojo-code 安全模块源码级剖析',
      docId: 'agent-architecture-level/Agent-安全威胁与防御策略',
    },
    {
      title: '📊 主流 Agent 框架对比评测',
      description: 'LangGraph、LangChain、AutoGen、CrewAI 深度评测',
      docId: 'agent-framework/主流-Agent-框架对比评测',
    },
  ];

  return (
    <section className={styles.featuredSection}>
      <div className="container">
        <h2 className={styles.sectionTitle}>✨ 精选文章</h2>
        <div className={styles.featuredGrid}>
          {featured.map((article, idx) => (
            <Link
              key={idx}
              to={`/docs/${article.docId}`}
              className={styles.featuredCard}>
              <h3 className={styles.featuredTitle}>{article.title}</h3>
              <p className={styles.featuredDescription}>{article.description}</p>
              <span className={styles.readMore}>阅读文章 →</span>
            </Link>
          ))}
        </div>
      </div>
    </section>
  );
}

export default function Home() {
  const { siteConfig } = useDocusaurusContext();
  return (
    <Layout
      title="首页"
      description="jojo 的技术空间 - AI Agent 开发者 · 技术探索者">
      <HomepageHeader />
      <main>
        <FeaturedArticles />
        <section className={styles.allArticlesSection}>
          <div className="container">
            <h2 className={styles.sectionTitle}>📚 全部文章</h2>
          </div>
          <ArticleList />
        </section>
      </main>
    </Layout>
  );
}
