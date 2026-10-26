'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { Brand } from './Brand';
import type { IssueTree } from '@/lib/types';

type Meta = {
  id: string;
  model: string;
  stats: { branches?: number; questions?: number; existing?: number; gaps?: number; considered?: number; ms?: number };
  created_at: string;
};

export default function TreeView({ slug }: { slug: string }) {
  const [space, setSpace] = useState<{ title: string; direction: string } | null>(null);
  const [canManage, setCanManage] = useState(false);
  const [tree, setTree] = useState<IssueTree | null>(null);
  const [meta, setMeta] = useState<Meta | null>(null);
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    const [spaceRes, treeRes] = await Promise.all([
      fetch(`/api/spaces/${slug}`),
      fetch(`/api/spaces/${slug}/tree`),
    ]);
    if (spaceRes.ok) {
      const data = await spaceRes.json();
      setSpace(data.space);
      setCanManage(Boolean(data.canManage));
    }
    if (treeRes.ok) {
      const data = await treeRes.json();
      setTree(data.tree);
      setMeta(data.meta);
    }
    setLoading(false);
  }, [slug]);

  useEffect(() => {
    void load();
  }, [load]);

  async function synthesize() {
    setWorking(true);
    setError('');
    try {
      const res = await fetch(`/api/spaces/${slug}/tree`, { method: 'POST' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || '收束失败');
      setTree(data.tree);
      setMeta({ id: data.id, model: data.stats.model, stats: data.stats, created_at: data.created_at });
    } catch (err) {
      setError(err instanceof Error ? err.message : '收束失败');
    } finally {
      setWorking(false);
    }
  }

  return (
    <div className="shell">
      <nav className="topnav">
        <Brand href="/app" />
        <div className="nav-links">
          <Link href={`/s/${slug}`} className="btn btn-sm">
            网络视图
          </Link>
          <Link href={`/s/${slug}/list`} className="btn btn-sm">
            问题集
          </Link>
          {canManage && (
            <Link href={`/s/${slug}/admin`} className="btn btn-sm">
              后台
            </Link>
          )}
        </div>
      </nav>

      <div className="page-head">
        <div>
          <h1>{space?.title ?? '…'} · 问题树</h1>
          <p>{space?.direction || '把发散的问题，收束成一条能回答命题的路径。'}</p>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {tree && (
            <a className="btn btn-sm" href={`/api/spaces/${slug}/tree?format=md`}>
              导出 Markdown
            </a>
          )}
          {canManage && (
            <button className="btn btn-sm btn-primary" onClick={synthesize} disabled={working}>
              {working ? '收束中…（约 10–30 秒）' : tree ? '重新收束' : '收束成问题树'}
            </button>
          )}
        </div>
      </div>

      {error && <div className="auth-error" style={{ marginBottom: 16 }}>{error}</div>}

      {meta && (
        <div className="tree-meta mono">
          {meta.stats.branches ?? 0} 个分支 · {meta.stats.questions ?? 0} 个代表问题 ·{' '}
          {meta.stats.gaps ?? 0} 个缺口 · 参考 {meta.stats.considered ?? 0} 个节点 · {String(meta.model).split('/').pop()} ·{' '}
          {new Date(meta.created_at).toLocaleString('zh-CN')}
        </div>
      )}

      {loading ? (
        <div className="empty">读取中…</div>
      ) : !tree ? (
        <div className="empty">
          <p>这个空间还没有收束过。</p>
          <p style={{ marginTop: 8, fontSize: 13 }}>
            {canManage ? '点右上角「收束成问题树」，把现在的问题集压成一棵能指导行动的树。' : '等收集者收束后，这里会出现一棵问题树。'}
          </p>
        </div>
      ) : (
        <>
          <section className="tree-root">
            <div className="eyebrow" style={{ marginBottom: 10 }}>
              命题 · ROOT QUESTION
            </div>
            <h2>{tree.root.question}</h2>
            {tree.root.summary && <p>{tree.root.summary}</p>}
          </section>

          <div className="tree-branches">
            {tree.branches.map((branch, index) => (
              <section className="branch" key={branch.id}>
                <div className="branch-head">
                  <div className="branch-idx">BRANCH {String(index + 1).padStart(2, '0')}</div>
                  <h3>{branch.title}</h3>
                  <p className="branch-q">{branch.question}</p>
                  {branch.why && <p className="branch-why">{branch.why}</p>}
                </div>
                <div className="branch-body">
                  {branch.children.map((child) =>
                    child.nodeId ? (
                      <Link key={child.id} href={`/s/${slug}?node=${child.nodeId}`} className="q-card">
                        <div className="q">{child.question}</div>
                        {child.solve && <div className="solve">{child.solve}</div>}
                        <div className="q-link mono">来自空间 →</div>
                      </Link>
                    ) : (
                      <div key={child.id} className="q-card gap">
                        <div className="q">
                          <span className="q-badge">缺口</span>
                          {child.question}
                        </div>
                        {child.solve && <div className="solve">{child.solve}</div>}
                      </div>
                    ),
                  )}
                </div>
              </section>
            ))}
          </div>

          {tree.nextActions.length > 0 && (
            <section className="next-actions">
              <div className="section-head">
                <h3>下一步</h3>
                <span className="badge">按顺序执行</span>
              </div>
              <ol>
                {tree.nextActions.map((action, i) => (
                  <li key={i}>{action}</li>
                ))}
              </ol>
            </section>
          )}
        </>
      )}
      <div style={{ height: 60 }} />
    </div>
  );
}
