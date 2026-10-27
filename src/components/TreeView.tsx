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

type TreeTask = {
  id: string;
  status: 'open' | 'claimed' | 'submitted' | 'approved' | 'rejected';
  assignee: string | null;
  executor: string | null;
  title: string;
  updated_at: string;
};

type TaskDetail = {
  task: TreeTask & { prompt: string; result: string | null; result_meta: Record<string, unknown>; created_at: string };
  events: Array<{ id: number; actor_type: string; actor_name: string; type: string; message: string; created_at: string }>;
};

const STATUS: Record<string, { label: string; color: string }> = {
  open: { label: '待领取', color: 'var(--cyan)' },
  claimed: { label: '执行中', color: 'var(--amber)' },
  submitted: { label: '待验收', color: 'var(--violet)' },
  approved: { label: '已验收', color: 'var(--act)' },
  rejected: { label: '已退回', color: 'var(--red)' },
};

export default function TreeView({ slug }: { slug: string }) {
  const [space, setSpace] = useState<{ title: string; direction: string } | null>(null);
  const [canManage, setCanManage] = useState(false);
  const [tree, setTree] = useState<IssueTree | null>(null);
  const [meta, setMeta] = useState<Meta | null>(null);
  const [tasks, setTasks] = useState<Record<string, TreeTask>>({});
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState(false);
  const [busyItem, setBusyItem] = useState<string | null>(null);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [openTask, setOpenTask] = useState<string | null>(null);
  const [openTaskItem, setOpenTaskItem] = useState<string | null>(null);
  const [taskDetail, setTaskDetail] = useState<TaskDetail | null>(null);

  const load = useCallback(async () => {
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
      setTasks(data.tasks ?? {});
    }
    setLoading(false);
  }, [slug]);

  useEffect(() => {
    void load();
  }, [load]);

  function flash(text: string) {
    setNotice(text);
    setTimeout(() => setNotice(''), 4200);
  }

  async function openTaskDetail(taskId: string, itemId: string) {
    setOpenTask(taskId);
    setOpenTaskItem(itemId);
    setTaskDetail(null);
    const res = await fetch(`/api/spaces/${slug}/tasks/${taskId}`);
    if (res.ok) setTaskDetail(await res.json());
  }

  async function synthesize() {
    setWorking(true);
    setError('');
    try {
      const res = await fetch(`/api/spaces/${slug}/tree`, { method: 'POST' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || '收束失败');
      setTree(data.tree);
      setMeta({ id: data.id, model: data.stats.model, stats: data.stats, created_at: data.created_at });
      setTasks({});
    } catch (err) {
      setError(err instanceof Error ? err.message : '收束失败');
    } finally {
      setWorking(false);
    }
  }

  async function dispatchGaps() {
    if (!meta) return;
    setWorking(true);
    setError('');
    try {
      const res = await fetch(`/api/spaces/${slug}/tree/dispatch`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ treeId: meta.id, mode: 'gaps' }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || '派发失败');
      flash(data.created ? `已把 ${data.created} 个缺口派成任务` : '缺口都已经有任务了');
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : '派发失败');
    } finally {
      setWorking(false);
    }
  }

  async function deliver(itemId: string) {
    if (!meta) return;
    setBusyItem(itemId);
    setError('');
    try {
      let task = tasks[itemId];
      if (!task || !['open', 'claimed', 'rejected'].includes(task.status)) {
        const res = await fetch(`/api/spaces/${slug}/tree/dispatch`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ treeId: meta.id, mode: 'selected', itemIds: [itemId] }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || '派发失败');
        if (!data.tasks[0]) throw new Error('这个条目已经有任务在流程里了');
        task = { ...data.tasks[0], status: 'open', assignee: null, executor: null, updated_at: new Date().toISOString() };
      }

      const res = await fetch(`/api/spaces/${slug}/tasks/${task.id}/run`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{}',
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || '执行失败');
      flash('Claude 已交付，等待验收');
      await load();
      if (openTask) {
        const detailRes = await fetch(`/api/spaces/${slug}/tasks/${openTask}`);
        if (detailRes.ok) setTaskDetail(await detailRes.json());
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : '执行失败');
    } finally {
      setBusyItem(null);
    }
  }

  async function autoReview(itemId: string) {
    const task = tasks[itemId];
    if (!task) return;
    setBusyItem(itemId);
    setError('');
    try {
      const res = await fetch(`/api/spaces/${slug}/tasks/${task.id}/auto-review`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ apply: true, threshold: 70 }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || '验收失败');
      flash(
        data.applied
          ? `AI 验收通过 · ${data.score} 分`
          : `AI 验收 ${data.score} 分，建议退回${data.missing?.length ? `：${data.missing[0]}` : ''}`,
      );
      await load();
      if (openTask) {
        const detailRes = await fetch(`/api/spaces/${slug}/tasks/${openTask}`);
        if (detailRes.ok) setTaskDetail(await detailRes.json());
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : '验收失败');
    } finally {
      setBusyItem(null);
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
          <Link href={`/s/${slug}/board`} className="btn btn-sm">
            表单
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
          {canManage && tree && (
            <button className="btn btn-sm" onClick={dispatchGaps} disabled={working}>
              把缺口派出去
            </button>
          )}
          {canManage && (
            <button className="btn btn-sm btn-primary" onClick={synthesize} disabled={working}>
              {working ? '处理中…' : tree ? '重新收束' : '收束成问题树'}
            </button>
          )}
        </div>
      </div>

      <div className="step-strip">
        <span className="on">① 收束</span>
        <span>② 派发</span>
        <span>③ 执行</span>
        <span>④ 验收</span>
        <span>⑤ 再收束</span>
      </div>

      {error && <div className="auth-error" style={{ marginBottom: 16 }}>{error}</div>}
      {notice && (
        <div className="thinking" style={{ marginBottom: 16 }}>
          {notice}
        </div>
      )}

      {meta && (
        <div className="tree-meta mono">
          {meta.stats.branches ?? 0} 个分支 · {meta.stats.questions ?? 0} 个问题 · {meta.stats.gaps ?? 0} 个缺口 · 参考{' '}
          {meta.stats.considered ?? 0} 个节点 · {String(meta.model).split('/').pop()} ·{' '}
          {new Date(meta.created_at).toLocaleString('zh-CN')} · 已派 {Object.keys(tasks).length} · 已验收{' '}
          {Object.values(tasks).filter((t) => t.status === 'approved').length}
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
                  {branch.children.map((child) => {
                    const task = tasks[child.id];
                    const statusMeta = task ? STATUS[task.status] : null;
                    const busy = busyItem === child.id;
                    return (
                      <div key={child.id} className={`q-card ${child.kind === 'gap' ? 'gap' : ''}`}>
                        <div className="q">
                          {child.kind === 'gap' && <span className="q-badge">缺口</span>}
                          {child.question}
                        </div>
                        {child.solve && <div className="solve">{child.solve}</div>}
                        <div className="q-foot">
                          {child.nodeId ? (
                            <Link href={`/s/${slug}?node=${child.nodeId}`} className="q-link">
                              来自空间 →
                            </Link>
                          ) : (
                            <span className="q-link">模型补的盲区</span>
                          )}
                          {statusMeta && task && (
                            <button
                              className="pill pill-btn"
                              style={{ color: statusMeta.color, borderColor: statusMeta.color }}
                              onClick={() => void openTaskDetail(task.id, child.id)}
                            >
                              {statusMeta.label}
                              {task.assignee ? ` · ${task.assignee}` : ''}
                            </button>
                          )}
                          {canManage && (
                            <span className="q-actions">
                              {task?.status === 'submitted' ? (
                                <button className="btn btn-sm" onClick={() => autoReview(child.id)} disabled={busy}>
                                  {busy ? '验收中…' : 'AI 验收'}
                                </button>
                              ) : !task || ['open', 'rejected', 'claimed'].includes(task.status) ? (
                                <button className="btn btn-sm" onClick={() => deliver(child.id)} disabled={busy}>
                                  {busy ? '执行中…' : task ? (task.status === 'open' ? '执行' : '重新执行') : '交给 AI 执行'}
                                </button>
                              ) : null}
                            </span>
                          )}
                        </div>
                      </div>
                    );
                  })}
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

      {openTask && (
        <div
          className="modal-backdrop"
          onClick={() => {
            setOpenTask(null);
            setOpenTaskItem(null);
            setTaskDetail(null);
          }}
        >
          <div className="modal task-modal" onClick={(e) => e.stopPropagation()}>
            {!taskDetail ? (
              <p className="dim">读取任务…</p>
            ) : (
              <>
                <h2>{taskDetail.task.title}</h2>
                <p className="sub">
                  {STATUS[taskDetail.task.status]?.label ?? taskDetail.task.status}
                  {taskDetail.task.assignee ? ` · ${taskDetail.task.assignee}` : ''}
                  {taskDetail.task.executor ? ` · ${taskDetail.task.executor}` : ''}
                </p>
                <div className="task-result">{taskDetail.task.result || '还没有结果。执行后这里会显示交付内容。'}</div>
                <div className="panel-title" style={{ marginTop: 16, marginBottom: 2 }}>
                  <span>反馈链路</span>
                  <span>{taskDetail.events.length}</span>
                </div>
                <div className="timeline">
                  {taskDetail.events.map((event) => (
                    <div key={event.id} className={`timeline-item ${event.actor_type === 'agent' ? 'agent' : ''} ${event.type === 'result' ? 'result' : ''}`}>
                      <span className="who">
                        {event.actor_name || event.actor_type} · {event.type}
                      </span>
                      <span className="when">{new Date(event.created_at).toLocaleTimeString('zh-CN')}</span>
                      <div className="msg">{event.message}</div>
                    </div>
                  ))}
                </div>
                <div className="modal-actions">
                  {canManage && taskDetail.task.status === 'submitted' && (
                    <button className="btn btn-primary" onClick={() => openTaskItem && void autoReview(openTaskItem)} disabled={Boolean(busyItem)}>
                      {busyItem ? '验收中…' : 'AI 验收'}
                    </button>
                  )}
                  {canManage && ['open', 'claimed', 'rejected'].includes(taskDetail.task.status) && (
                    <button className="btn btn-primary" onClick={() => openTaskItem && void deliver(openTaskItem)} disabled={Boolean(busyItem)}>
                      {busyItem ? '执行中…' : 'AI 执行'}
                    </button>
                  )}
                  <button className="btn" onClick={() => setOpenTask(null)}>
                    关闭
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      <div style={{ height: 60 }} />
    </div>
  );
}
