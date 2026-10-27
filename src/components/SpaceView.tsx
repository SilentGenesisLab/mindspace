'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import SpaceCanvas from './SpaceCanvas';
import { Avatar, BrandMark } from './Brand';
import type { AnalysisDTO, ClusterDTO, GraphDTO, GraphNodeDTO } from '@/lib/types';

type SpaceInfo = {
  id: string;
  slug: string;
  title: string;
  direction: string;
  invite_code?: string;
  role: string;
  canManage: boolean;
  counts: { nodes: number; edges: number; members: number };
  members: Array<{ id: string; nickname: string; color: string; role: string; nodes: string }>;
};

type Facets = {
  tags: Array<{ tag: string; count: number }>;
  authors: Array<{ id: string; nickname: string; color: string; count: number }>;
  domains: Array<{ value: string; count: number }>;
  types: Array<{ value: string; count: number }>;
};

type Detail = { node: GraphNodeDTO & { analysis: Record<string, unknown> }; neighbors: Array<GraphNodeDTO & { strength: number; relation: string }> };

const KINDS = [
  { key: 'question', label: '问题' },
  { key: 'idea', label: '想法' },
  { key: 'concern', label: '顾虑' },
];

function timeAgo(iso: string): string {
  const diff = (Date.now() - new Date(iso).getTime()) / 1000;
  if (diff < 60) return '刚刚';
  if (diff < 3600) return `${Math.floor(diff / 60)} 分钟前`;
  if (diff < 86400) return `${Math.floor(diff / 3600)} 小时前`;
  return `${Math.floor(diff / 86400)} 天前`;
}

export default function SpaceView({ slug }: { slug: string }) {
  const [space, setSpace] = useState<SpaceInfo | null>(null);
  const [graph, setGraph] = useState<GraphDTO | null>(null);
  const [facets, setFacets] = useState<Facets | null>(null);
  const [error, setError] = useState('');

  const [query, setQuery] = useState('');
  const [activeTags, setActiveTags] = useState<Set<string>>(new Set());
  const [activePeople, setActivePeople] = useState<Set<string>>(new Set());
  const [domain, setDomain] = useState('');
  const [type, setType] = useState('');
  const [clusterId, setClusterId] = useState('');

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<Detail | null>(null);

  const [text, setText] = useState('');
  const [kind, setKind] = useState('question');
  const [sending, setSending] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [toast, setToast] = useState<{ text: string; tone: 'ok' | 'warn' } | null>(null);

  const [invite, setInvite] = useState<{ url: string } | null>(null);
  const [inviteBusy, setInviteBusy] = useState(false);
  const [taskFor, setTaskFor] = useState<GraphNodeDTO | null>(null);
  const [taskTitle, setTaskTitle] = useState('');
  const [taskPrompt, setTaskPrompt] = useState('');
  const [taskBusy, setTaskBusy] = useState(false);
  const [railOpen, setRailOpen] = useState(false);

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const showToast = useCallback((text: string, tone: 'ok' | 'warn' = 'ok') => {
    setToast({ text, tone });
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 5200);
  }, []);

  const loadGraph = useCallback(async () => {
    const res = await fetch(`/api/spaces/${slug}/graph`);
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError(data.error || '读取空间失败');
      return;
    }
    setGraph(await res.json());
  }, [slug]);

  const loadFacets = useCallback(async () => {
    const res = await fetch(`/api/spaces/${slug}/facets`);
    if (res.ok) setFacets(await res.json());
  }, [slug]);

  const loadSpace = useCallback(async () => {
    const res = await fetch(`/api/spaces/${slug}`);
    const data = await res.json();
    if (!res.ok) {
      setError(data.error || '无法进入空间');
      return;
    }
    setSpace({
      ...data.space,
      role: data.role,
      canManage: data.canManage,
      counts: data.counts,
      members: data.members,
    });
  }, [slug]);

  useEffect(() => {
    void Promise.all([loadSpace(), loadGraph(), loadFacets()]);
  }, [loadSpace, loadGraph, loadFacets]);

  // 从问题树/列表点进来时，直接选中对应节点
  useEffect(() => {
    const id = new URLSearchParams(window.location.search).get('node');
    if (id) setSelectedId(id);
  }, []);

  // 实时：其它人的问题、审校结果
  useEffect(() => {
    const source = new EventSource(`/api/spaces/${slug}/stream`);
    source.addEventListener('node.created', () => {
      void loadGraph();
      void loadFacets();
    });
    source.addEventListener('audit.completed', (event) => {      const payload = JSON.parse((event as MessageEvent).data) as { stats?: Record<string, number> };
      const stats = payload.stats ?? {};
      showToast(
        `ds4.1 审校完成 · 检查 ${stats.checked ?? 0} 条 · 新增 ${stats.edgesAdded ?? 0} 边 · 删除 ${stats.edgesRemoved ?? 0} 边`,
        'ok',
      );
      void loadGraph();
    });
    source.addEventListener('graph.relayout', () => {
      void loadGraph();
    });
    source.onerror = () => {
      /* EventSource 自己会重连 */
    };
    return () => source.close();
  }, [slug, loadGraph, loadFacets, showToast]);

  // 选中节点后拉详情
  useEffect(() => {
    if (!selectedId) {
      setDetail(null);
      return;
    }
    let cancelled = false;
    (async () => {
      const res = await fetch(`/api/spaces/${slug}/nodes/${selectedId}`);
      if (!res.ok) return;
      const data = await res.json();
      if (!cancelled) setDetail(data);
    })();
    return () => {
      cancelled = true;
    };
  }, [selectedId, slug]);

  useEffect(() => {
    if (!sending) return;
    setElapsed(0);
    const timer = setInterval(() => setElapsed((v) => v + 0.1), 100);
    return () => clearInterval(timer);
  }, [sending]);

  const nodes = graph?.nodes ?? [];
  const edges = graph?.edges ?? [];
  const clusters = graph?.clusters ?? [];

  const focusIds = useMemo(() => {
    const hasFilter =
      query.trim().length > 0 || activeTags.size > 0 || activePeople.size > 0 || Boolean(domain) || Boolean(type) || Boolean(clusterId);
    if (!hasFilter) return null;
    const q = query.trim().toLowerCase();
    const set = new Set<string>();
    for (const node of nodes) {
      if (q && !(node.content.toLowerCase().includes(q) || node.tags.some((t) => t.toLowerCase().includes(q)))) continue;
      if (activeTags.size && !node.tags.some((t) => activeTags.has(t))) continue;
      if (activePeople.size && !activePeople.has(node.author.id)) continue;
      if (domain && node.attributes.domain !== domain) continue;
      if (type && node.attributes.type !== type) continue;
      if (clusterId && node.cluster_id !== clusterId) continue;
      set.add(node.id);
    }
    return set;
  }, [nodes, query, activeTags, activePeople, domain, type, clusterId]);

  const clusterMap = useMemo(() => new Map(clusters.map((c) => [c.id, c])), [clusters]);

  async function submit() {
    const content = text.trim();
    if (content.length < 2 || sending) return;
    setSending(true);
    setText('');
    try {
      const res = await fetch(`/api/spaces/${slug}/nodes`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content, kind }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || '提交失败');
      const analysis = data.analysis as AnalysisDTO;
      if (analysis.degraded) {
        showToast('模型暂时不可用，已按字面相似度落位，稍后会由审校修正', 'warn');
      } else if (analysis.relations.length === 0) {
        showToast(`暂未找到强关联 · 作为一个新岛落位 · ${analysis.ms}ms`, 'ok');
      } else {
        showToast(
          `连上 ${analysis.relations.length} 条关系 · 最强 ${analysis.relations[0].strength}% · ${analysis.model.split('/').pop()} ${analysis.ms}ms`,
          'ok',
        );
      }
      await Promise.all([loadGraph(), loadFacets()]);
      setSelectedId(data.node.id);
    } catch (err) {
      setText(content);
      showToast(err instanceof Error ? err.message : '提交失败', 'warn');
    } finally {
      setSending(false);
    }
  }

  async function openInvite() {
    if (!space) return;
    setInviteBusy(true);
    try {
      let code = space.invite_code;
      if (!code) {
        const res = await fetch(`/api/spaces/${slug}/invite`, { method: 'POST' });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || '生成邀请失败');
        code = data.invite_code;
        setSpace({ ...space, invite_code: code });
      }
      setInvite({ url: `${window.location.origin}/join/${code}` });
    } catch (err) {
      showToast(err instanceof Error ? err.message : '生成邀请失败', 'warn');
    } finally {
      setInviteBusy(false);
    }
  }

  async function rotateInvite() {
    setInviteBusy(true);
    try {
      const res = await fetch(`/api/spaces/${slug}/invite`, { method: 'POST' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || '生成失败');
      setSpace((prev) => (prev ? { ...prev, invite_code: data.invite_code } : prev));
      setInvite({ url: data.url });
    } catch (err) {
      showToast(err instanceof Error ? err.message : '生成失败', 'warn');
    } finally {
      setInviteBusy(false);
    }
  }

  async function copy(textValue: string) {
    try {
      await navigator.clipboard.writeText(textValue);
      showToast('已复制');
    } catch {
      showToast('复制失败，请手动选择', 'warn');
    }
  }

  function openTask(node: GraphNodeDTO) {
    setTaskFor(node);
    setTaskTitle(node.content.slice(0, 80));
    setTaskPrompt(
      `问题：${node.content}\n\n请给出你的判断和可执行方案。如果需要更多信息，先在任务里报告缺少什么。`,
    );
  }

  async function createTask() {
    if (!taskFor) return;
    setTaskBusy(true);
    try {
      const res = await fetch(`/api/spaces/${slug}/tasks`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: taskTitle, prompt: taskPrompt, nodeId: taskFor.id }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || '创建任务失败');
      showToast('任务已派发，Agent 可以通过 CLI 领取');
      setTaskFor(null);
    } catch (err) {
      showToast(err instanceof Error ? err.message : '创建任务失败', 'warn');
    } finally {
      setTaskBusy(false);
    }
  }

  function toggle(set: Set<string>, value: string, apply: (next: Set<string>) => void) {
    const next = new Set(set);
    if (next.has(value)) next.delete(value);
    else next.add(value);
    apply(next);
  }

  const selectedNode = selectedId ? nodes.find((n) => n.id === selectedId) ?? detail?.node ?? null : null;

  if (error) {
    return (
      <div className="auth-wrap">
        <div className="auth-card" style={{ textAlign: 'center' }}>
          <h1>{error}</h1>
          <p className="auth-sub">你可能需要重新登录，或者请收集者重新发一次邀请。</p>
          <Link href="/app" className="btn btn-primary">
            回到我的空间
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="stage">
      <SpaceCanvas
        nodes={nodes}
        edges={edges}
        clusters={clusters}
        focusIds={focusIds}
        selectedId={selectedId}
        onSelect={setSelectedId}
      />

      <div className="topbar">
        <div className="topbar-main">
          <Link href="/app" aria-label="返回空间列表" style={{ display: 'inline-flex' }}>
            <BrandMark size={24} />
          </Link>
          <div style={{ minWidth: 0 }}>
            <div className="title">{space?.title ?? '读取中…'}</div>
            <div className="dir">{space?.direction || '还没有发布方向'}</div>
          </div>
          <span className="badge mono" style={{ marginLeft: 4 }}>
            {nodes.length} 问题 · {edges.length} 关系
          </span>
        </div>

        <div className="topbar-actions">
          <div className="member-stack">
            {(space?.members ?? []).slice(0, 5).map((m) => (
              <Avatar key={m.id} name={m.nickname} color={m.color} size={26} />
            ))}
          </div>
          <button className="btn btn-sm mobile-toggle" onClick={() => setRailOpen((v) => !v)}>
            筛选
          </button>
          <Link href={`/s/${slug}/tree`} className="btn btn-sm">
            收束
          </Link>
          <Link href={`/s/${slug}/list`} className="btn btn-sm hide-mobile">
            列表
          </Link>
          <Link href={`/s/${slug}/board`} className="btn btn-sm">
            表单
          </Link>
          {space?.canManage && (
            <Link href={`/s/${slug}/admin`} className="btn btn-sm">
              后台
            </Link>
          )}
          {space?.canManage && (
            <button className="btn btn-sm btn-primary" onClick={openInvite} disabled={inviteBusy}>
              邀请
            </button>
          )}
        </div>
      </div>

      <aside className={`rail ${railOpen ? 'open' : ''}`}>
        <div className="panel">
          <div className="panel-title">
            <span>检索</span>
            <span>{focusIds ? `${focusIds.size} 命中` : '全部'}</span>
          </div>
          <input
            className="input filter-input"
            placeholder="搜问题或标签…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          {focusIds && (
            <button
              className="btn btn-ghost btn-sm"
              style={{ marginTop: 8, paddingLeft: 0 }}
              onClick={() => {
                setQuery('');
                setActiveTags(new Set());
                setActivePeople(new Set());
                setDomain('');
                setType('');
                setClusterId('');
              }}
            >
              × 清除筛选
            </button>
          )}
        </div>

        <div className="panel">
          <div className="panel-title">
            <span>标签</span>
            <span>{facets?.tags.length ?? 0}</span>
          </div>
          <div className="chip-list">
            {(facets?.tags ?? []).slice(0, 18).map((tag) => (
              <button
                key={tag.tag}
                className={`chip ${activeTags.has(tag.tag) ? 'on' : ''}`}
                onClick={() => toggle(activeTags, tag.tag, setActiveTags)}
              >
                {tag.tag}
                <span className="count">{tag.count}</span>
              </button>
            ))}
            {(facets?.tags.length ?? 0) === 0 && <span className="dim" style={{ fontSize: 12 }}>还没有标签</span>}
          </div>
        </div>

        <div className="panel">
          <div className="panel-title">
            <span>聚类</span>
            <span>{clusters.length}</span>
          </div>
          {clusters.map((cluster: ClusterDTO) => (
            <div
              key={cluster.id}
              className={`legend-row ${clusterId === cluster.id ? 'on' : ''}`}
              onClick={() => setClusterId(clusterId === cluster.id ? '' : cluster.id)}
            >
              <span className="legend-dot" style={{ background: cluster.color, color: cluster.color }} />
              <span className="label">{cluster.label}</span>
              <span className="n">{cluster.node_count}</span>
            </div>
          ))}
          {clusters.length === 0 && <span className="dim" style={{ fontSize: 12 }}>问题还太少，暂未成簇</span>}
        </div>

        <div className="panel">
          <div className="panel-title">
            <span>成员</span>
            <span>{space?.counts.members ?? 0}</span>
          </div>
          <div className="chip-list">
            {(facets?.authors ?? []).map((author) => (
              <button
                key={author.id}
                className={`chip ${activePeople.has(author.id) ? 'on' : ''}`}
                onClick={() => toggle(activePeople, author.id, setActivePeople)}
              >
                <span
                  className="legend-dot"
                  style={{ background: author.color, color: author.color, width: 6, height: 6 }}
                />
                {author.nickname}
                <span className="count">{author.count}</span>
              </button>
            ))}
          </div>
        </div>

        <div className="panel">
          <div className="panel-title">
            <span>属性</span>
            <span>domain / type</span>
          </div>
          <div className="chip-list">
            {(facets?.domains ?? []).map((item) => (
              <button
                key={`d-${item.value}`}
                className={`chip ${domain === item.value ? 'on' : ''}`}
                onClick={() => setDomain(domain === item.value ? '' : item.value)}
              >
                {item.value}
              </button>
            ))}
          </div>
          <div className="chip-list" style={{ marginTop: 6 }}>
            {(facets?.types ?? []).map((item) => (
              <button
                key={`t-${item.value}`}
                className={`chip ${type === item.value ? 'on' : ''}`}
                onClick={() => setType(type === item.value ? '' : item.value)}
              >
                {item.value}
              </button>
            ))}
          </div>
        </div>
      </aside>

      {toast && (
        <div
          className="thinking"
          style={{
            position: 'absolute',
            left: '50%',
            transform: 'translateX(-50%)',
            bottom: 128,
            zIndex: 20,
            ...(toast.tone === 'warn'
              ? { background: 'rgba(255,181,71,.09)', borderColor: 'rgba(255,181,71,.3)', color: 'var(--amber)' }
              : {}),
          }}
        >
          {toast.text}
        </div>
      )}

      <div className="composer">
        {sending && (
          <div className="thinking">
            <span className="dot" />
            <span className="dot" />
            <span className="dot" />
            <span>
              Jev 正在判断它和已有问题的关系…
              <span className="mono dim" style={{ marginLeft: 8 }}>
                {elapsed.toFixed(1)}s
              </span>
            </span>
          </div>
        )}
        <div className="composer-inner">
          <textarea
            ref={textareaRef}
            rows={1}
            placeholder={space?.direction ? `关于「${space.direction.slice(0, 24)}」…写下一个问题` : '写下一个问题…'}
            value={text}
            onChange={(e) => {
              setText(e.target.value.slice(0, 500));
              const el = e.target;
              el.style.height = 'auto';
              el.style.height = `${Math.min(el.scrollHeight, 140)}px`;
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                void submit();
              }
            }}
            disabled={sending}
          />
          <button className="composer-send" onClick={() => void submit()} disabled={sending || text.trim().length < 2} aria-label="发送">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M4 12h14M13 6l6 6-6 6" />
            </svg>
          </button>
        </div>
        <div className="composer-meta">
          <div className="composer-kind">
            {KINDS.map((item) => (
              <button key={item.key} className={kind === item.key ? 'on' : ''} onClick={() => setKind(item.key)}>
                {item.label}
              </button>
            ))}
          </div>
          <div className="composer-hint">
            <span>Enter 发送 · Shift+Enter 换行</span>
            <span>{text.length}/500</span>
          </div>
        </div>
      </div>

      <div className="canvas-hint">
        拖拽旋转 · 滚轮缩放
        <br />
        点击节点看它与谁相连
      </div>

      {selectedNode && detail && (
        <div className="detail">
          <div className="detail-head">
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
              <Avatar name={detail.node.author.nickname} color={detail.node.author.color} size={24} />
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: 12.5 }}>{detail.node.author.nickname}</div>
                <div className="mono dim" style={{ fontSize: 10 }}>
                  {timeAgo(detail.node.created_at)}
                </div>
              </div>
            </div>
            <button className="btn btn-icon btn-ghost" onClick={() => setSelectedId(null)} aria-label="关闭">
              ×
            </button>
          </div>
          <div className="detail-body">
            <div className="detail-content">{detail.node.content}</div>

            {typeof detail.node.analysis?.summary === 'string' && detail.node.analysis.summary && (
              <div className="detail-summary">{String(detail.node.analysis.summary)}</div>
            )}

            <div className="tag-row">
              {detail.node.tags.map((tag) => (
                <span key={tag} className="tag">
                  {tag}
                </span>
              ))}
            </div>

            <div className="detail-meta">
              {detail.node.cluster_id && clusterMap.get(detail.node.cluster_id) && (
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
                  <span
                    className="legend-dot"
                    style={{
                      background: clusterMap.get(detail.node.cluster_id)!.color,
                      color: clusterMap.get(detail.node.cluster_id)!.color,
                    }}
                  />
                  {clusterMap.get(detail.node.cluster_id)!.label}
                </span>
              )}
              {Object.entries(detail.node.attributes).map(([key, value]) => (
                <span key={key} className="badge">
                  {key}:{value}
                </span>
              ))}
              {detail.node.status === 'duplicate' && <span className="badge badge-amber">疑似重复</span>}
            </div>

            <div className="detail-meta" style={{ marginTop: 10 }}>
              <span className="mono">
                {typeof detail.node.analysis?.model === 'string' ? String(detail.node.analysis.model).split('/').pop() : '—'}
              </span>
              <span className="mono">
                {typeof detail.node.analysis?.ms === 'number' ? `${detail.node.analysis.ms}ms` : ''}
              </span>
              <span>{detail.node.degree} 条关系</span>
            </div>

            <div className="panel-title" style={{ marginTop: 18, marginBottom: 4 }}>
              <span>相连的问题</span>
              <span>{detail.neighbors.length}</span>
            </div>
            {detail.neighbors.length === 0 && (
              <p className="dim" style={{ fontSize: 12.5, padding: '10px 0' }}>
                暂时是一座孤岛。也许下一个问题会连上它。
              </p>
            )}
            {detail.neighbors.map((neighbor) => (
              <div key={neighbor.id} className="neighbor" onClick={() => setSelectedId(neighbor.id)}>
                <span className="strength mono">{neighbor.strength}</span>
                <div>
                  <div className="txt">{neighbor.content}</div>
                  <div className="mono dim" style={{ fontSize: 10, marginTop: 3 }}>
                    {neighbor.relation} · {neighbor.author.nickname}
                  </div>
                </div>
              </div>
            ))}
          </div>
          {space?.canManage && (
            <div className="detail-actions">
              <button className="btn btn-sm" onClick={() => openTask(detail.node)}>
                派给 Agent 解决
              </button>
              <button className="btn btn-sm btn-ghost" onClick={() => void copy(detail.node.content)}>
                复制
              </button>
            </div>
          )}
        </div>
      )}

      {invite && (
        <div className="modal-backdrop" onClick={() => setInvite(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h2>邀请加入这个思维空间</h2>
            <p className="sub">对方打开链接、用手机号登录后，就会成为这个空间的脑暴者。</p>
            <div className="copy-row">
              <input className="input" readOnly value={invite.url} onFocus={(e) => e.target.select()} />
              <button className="btn btn-primary" onClick={() => void copy(invite.url)}>
                复制
              </button>
            </div>
            <div className="modal-actions">
              <button className="btn btn-ghost" onClick={rotateInvite} disabled={inviteBusy}>
                重置链接
              </button>
              <button className="btn" onClick={() => setInvite(null)}>
                关闭
              </button>
            </div>
          </div>
        </div>
      )}

      {taskFor && (
        <div className="modal-backdrop" onClick={() => setTaskFor(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h2>把这个活派出去</h2>
            <p className="sub">任务会进入队列，任何持有 API Key 的 Agent 都可以领取、报进度、交结果。</p>
            <div style={{ marginTop: 14 }}>
              <label className="field-label">任务标题</label>
              <input className="input" value={taskTitle} onChange={(e) => setTaskTitle(e.target.value)} maxLength={200} />
            </div>
            <div style={{ marginTop: 14 }}>
              <label className="field-label">给 Agent 的说明</label>
              <textarea
                className="input"
                rows={6}
                value={taskPrompt}
                onChange={(e) => setTaskPrompt(e.target.value)}
              />
            </div>
            <div className="modal-actions">
              <button className="btn btn-ghost" onClick={() => setTaskFor(null)}>
                取消
              </button>
              <button className="btn btn-primary" onClick={createTask} disabled={taskBusy || taskTitle.trim().length < 2}>
                {taskBusy ? '派发中…' : '派发任务'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
