'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Avatar, Brand } from './Brand';
import type { ClusterDTO, GraphNodeDTO } from '@/lib/types';

type Facets = {
  tags: Array<{ tag: string; count: number }>;
  authors: Array<{ id: string; nickname: string; color: string; count: number }>;
  domains: Array<{ value: string; count: number }>;
  types: Array<{ value: string; count: number }>;
};

export default function ListClient({ slug, title }: { slug: string; title: string }) {
  const [nodes, setNodes] = useState<GraphNodeDTO[]>([]);
  const [total, setTotal] = useState(0);
  const [facets, setFacets] = useState<Facets | null>(null);
  const [clusters, setClusters] = useState<ClusterDTO[]>([]);
  const [loading, setLoading] = useState(true);

  const [q, setQ] = useState('');
  const [tag, setTag] = useState('');
  const [author, setAuthor] = useState('');
  const [domain, setDomain] = useState('');
  const [type, setType] = useState('');
  const [cluster, setCluster] = useState('');

  useEffect(() => {
    void (async () => {
      const [facetRes, graphRes] = await Promise.all([
        fetch(`/api/spaces/${slug}/facets`),
        fetch(`/api/spaces/${slug}/graph`),
      ]);
      if (facetRes.ok) setFacets(await facetRes.json());
      if (graphRes.ok) {
        const graph = (await graphRes.json()) as { clusters: ClusterDTO[] };
        setClusters(graph.clusters ?? []);
      }
    })();
  }, [slug]);

  const load = useCallback(async () => {
    setLoading(true);
    const params = new URLSearchParams({ limit: '200' });
    if (q.trim()) params.set('q', q.trim());
    if (tag) params.set('tag', tag);
    if (author) params.set('author', author);
    if (domain) params.set('domain', domain);
    if (type) params.set('type', type);
    if (cluster) params.set('cluster', cluster);
    const res = await fetch(`/api/spaces/${slug}/nodes?${params.toString()}`);
    if (res.ok) {
      const data = await res.json();
      setNodes(data.nodes);
      setTotal(data.total);
    }
    setLoading(false);
  }, [slug, q, tag, author, domain, type, cluster]);

  useEffect(() => {
    const timer = setTimeout(() => void load(), 280);
    return () => clearTimeout(timer);
  }, [load]);

  const clusterMap = useMemo(() => new Map(clusters.map((c) => [c.id, c])), [clusters]);
  const hasFilter = Boolean(q || tag || author || domain || type || cluster);

  return (
    <div className="shell">
      <nav className="topnav">
        <Brand href="/app" />
        <div className="nav-links">
          <Link href={`/s/${slug}`} className="btn btn-sm">
            回到网络视图
          </Link>
        </div>
      </nav>

      <div className="page-head">
        <div>
          <h1>{title} · 问题集</h1>
          <p>按人、标签、属性和聚类筛。点任意一条回到空间里看它的位置。</p>
        </div>
        <span className="result-count">{loading ? '读取中…' : `${total} 条${hasFilter ? '（已筛选）' : ''}`}</span>
      </div>

      <div className="card" style={{ overflow: 'hidden' }}>
        <div style={{ padding: 16, borderBottom: '1px solid var(--line)' }}>
          <div className="list-toolbar" style={{ marginBottom: 0 }}>
            <input className="input" placeholder="搜问题或标签…" value={q} onChange={(e) => setQ(e.target.value)} />
            <select className="input" value={tag} onChange={(e) => setTag(e.target.value)}>
              <option value="">全部标签</option>
              {(facets?.tags ?? []).map((item) => (
                <option key={item.tag} value={item.tag}>
                  {item.tag}（{item.count}）
                </option>
              ))}
            </select>
            <select className="input" value={author} onChange={(e) => setAuthor(e.target.value)}>
              <option value="">全部成员</option>
              {(facets?.authors ?? []).map((item) => (
                <option key={item.id} value={item.id}>
                  {item.nickname}（{item.count}）
                </option>
              ))}
            </select>
            <select className="input" value={cluster} onChange={(e) => setCluster(e.target.value)}>
              <option value="">全部聚类</option>
              {clusters.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.label}（{item.node_count}）
                </option>
              ))}
            </select>
            <select className="input" value={domain} onChange={(e) => setDomain(e.target.value)}>
              <option value="">全部领域</option>
              {(facets?.domains ?? []).map((item) => (
                <option key={item.value} value={item.value}>
                  {item.value}（{item.count}）
                </option>
              ))}
            </select>
            <select className="input" value={type} onChange={(e) => setType(e.target.value)}>
              <option value="">全部类型</option>
              {(facets?.types ?? []).map((item) => (
                <option key={item.value} value={item.value}>
                  {item.value}（{item.count}）
                </option>
              ))}
            </select>
            {hasFilter && (
              <button
                className="btn btn-ghost btn-sm"
                onClick={() => {
                  setQ('');
                  setTag('');
                  setAuthor('');
                  setDomain('');
                  setType('');
                  setCluster('');
                }}
              >
                清除
              </button>
            )}
          </div>
        </div>

        {nodes.length === 0 && !loading ? (
          <div className="empty" style={{ border: 0, borderRadius: 0 }}>
            没有匹配的问题。
          </div>
        ) : (
          nodes.map((node) => (
            <Link key={node.id} href={`/s/${slug}?node=${node.id}`} className="q-row" style={{ color: 'inherit' }}>
              <div className="q-strength">{node.degree} 条关系</div>
              <div>
                <div className="q-content">{node.content}</div>
                <div className="q-meta">
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                    <Avatar name={node.author.nickname} color={node.author.color} size={18} />
                    {node.author.nickname}
                  </span>
                  <span>{new Date(node.created_at).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })}</span>
                  {node.cluster_id && clusterMap.get(node.cluster_id) && (
                    <span className="q-cluster">
                      <span
                        className="legend-dot"
                        style={{
                          background: clusterMap.get(node.cluster_id)!.color,
                          color: clusterMap.get(node.cluster_id)!.color,
                          width: 6,
                          height: 6,
                        }}
                      />
                      {clusterMap.get(node.cluster_id)!.label}
                    </span>
                  )}
                  {node.status === 'duplicate' && <span className="badge badge-amber">重复</span>}
                  <span className="q-tags">
                    {node.tags.map((t) => (
                      <span key={t} className="q-tag">
                        {t}
                      </span>
                    ))}
                  </span>
                </div>
              </div>
              <div className="q-side">
                {Object.entries(node.attributes)
                  .slice(0, 2)
                  .map(([k, v]) => `${v}`)
                  .join(' · ')}
              </div>
            </Link>
          ))
        )}
      </div>
      <div style={{ height: 60 }} />
    </div>
  );
}
