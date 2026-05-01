import React from 'react';
import Link from '@docusaurus/Link';
import styles from './styles.module.css';

export default function ArticleCard({ title, description, category, docId }) {
  return (
    <Link to={`/${docId}`} className={styles.cardLink}>
      <div className={styles.card}>
        {category && <span className={styles.category}>{category}</span>}
        <h3 className={styles.title}>{title}</h3>
        {description && <p className={styles.description}>{description}</p>}
        <span className={styles.readMore}>阅读文章 →</span>
      </div>
    </Link>
  );
}
