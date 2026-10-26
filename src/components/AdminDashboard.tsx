'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { Avatar, Brand } from './Brand';
import type { TaskDTO, TaskEventDTO } from '@/lib/types';

type Stats = {
  nodes: number;
  edges: number;
  clusters: number;
  members: number;
  duplicates: number;
  authors: number;
  tasks: Record<string, number>;
  daily: Array<{ day: string; count: number }>;
  topTags: Array<{ tag: string; count: number }>;
  contributors: Array<{ id: string; nickname: string; color: string; count: number }>;
  audits: Array<{ id: string; model: string; status: string; stats: Record<string, number>; notes: string; started_at: string; finished_at: string | null }>;
  activity: Array<{ type: string; payload: Record<string, unknown>; created_at: string }>;
};

type Member = { id: string; nickname: string; color: string; role: string; joined_at: string; nodes: string };
type SpaceInfo = { title: string; direction: string; invite_code?: string; slug: string; created_at: string };
type ApiKey = { id: string; name: string; prefix: string; created_at: string; last_used_at: string | null; revoked_at: string | null };

type Ops = {
  counts: Record<string, number>;
  agents: Array<{ assignee: string; count: number; last_at: string }>;
  active: Array<{ id: string; title: string; status: string; assignee: string | null; minutes: number }>;
  stale: Array<{ id: string; title: string; assignee: string | null; minutes: number }>;
  tree: { id: string; created_at: string; dispatched: number; approved: number; stale: boolean } | null;
  last_audit: { started_at: string } | null;
  nodes: number;
};

const STATUS_META: Record<string, { label: string; color: string }> = {
  open: { label: '待领取', color: '#57d4ff' },
  claimed: { label: '进行中', color: '#ffb547' },
  submitted: { label: '待验收', color: '#b58cff' },
  approved: { label: '已通过', color: '#3ef0b0' },
  rejected: { label: '已退回', color: '#ff5b6e' },
};

export default function AdminDashboard({ slug }: { slug: string }) {
  const [space, setSpace] = useState<SpaceInfo | null>(null);
  const [role, setRole] = useState('');
  const [stats, setStats] = useState<Stats | null>(null);
  const [members, setMembers] = useState<Member[]>([]);
  const [tasks, setTasks] = useState<TaskDTO[]>([]);
  const [keys, setKeys] = useState<ApiKey[]>([]);
  const [ops, setOps] = useState<Ops | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState('');

  const [expanded, setExpanded] = useState<string | null>(null);
  const [detail, setDetail] = useState<{ task: TaskDTO & { node_content?: string | null }; events: TaskEventDTO[] } | null>(null);
  const [reviewNote, setReviewNote] = useState('');

  const [newKeyName, setNewKeyName] = useState('claude');
  const [freshKey, setFreshKey] = useState<string | null>(null);
  const [inviteUrl, setInviteUrl] = useState('');
  const [newTaskTitle, setNewTaskTitle] = useState('');
  const [toast, setToast] = useState('');

  const notify = useCallback((text: string) => {
    setToast(text);
    setTimeout(() => setToast(''), 4200);
  }, []);

  const load = useCallback(async () => {
    const [spaceRes, statsRes, membersRes, tasksRes, keysRes] = await Promise.all([
      fetch(`/api/spaces/${slug}`),
      fetch(`/api/spaces/${slug}/stats`),
      fetch(`/api/spaces/${slug}/members`),
      fetch(`/api/spaces/${slug}/tasks`),
      fetch(`/api/spaces/${slug}/keys`),
    ]);
    const opsRes = await fetch(`/api/spaces/${slug}/ops`);
    if (opsRes.ok) setOps(await opsRes.json());
    if (!spaceRes.ok) {
      const data = await spaceRes.json().catch(() => ({}));
      setError(data.error || '无法读取空间');
      return;
    }
    const spaceData = await spaceRes.json();
    setSpace(spaceData.space);
    setRole(spaceData.role);
    if (spaceData.space?.invite_code) {
      setInviteUrl(`${window.location.origin}/join/${spaceData.space.invite_code}`);
    }
    if (statsRes.ok) setStats(await statsRes.json());
    if (membersRes.ok) setMembers((await membersRes.json()).members);
    if (tasksRes.ok) setTasks((await tasksRes.json()).tasks);
    if (keysRes.ok) setKeys((await keysRes.json()).keys);
  }, [slug]);

  useEffect(() => {
    void load();
    const timer = setInterval(() => void load(), 30_000);
    return () => clearInterval(timer);
  }, [load]);

  async function openTask(id: string) {
    if (expanded === id) {
      setExpanded(null);
      setDetail(null);
      return;
    }
    setExpanded(id);
    setReviewNote('');
    const res = await fetch(`/api/spaces/${slug}/tasks/${id}`);
    if (res.ok) setDetail(await res.json());
  }

  async function review(id: string, decision: 'approve' | 'reject') {
    setBusy(`review-${id}`);
    try {
      const res = await fetch(`/api/spaces/${slug}/tasks/${id}/events`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: decision, message: reviewNote }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || '操作失败');
      setDetail(data);
      setReviewNote('');
      notify(decision === 'approve' ? '已通过' : '已退回');
      await load();
    } catch (err) {
      notify(err instanceof Error ? err.message : '操作失败');
    } finally {
      setBusy('');
    }
  }

  async function runAudit() {
    setBusy('audit');
    try {
      const res = await fetch(`/api/spaces/${slug}/audit`, { method: 'POST' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || '审校失败');
      notify(`审校完成：检查 ${data.stats?.checked ?? 0} 条，新增 ${data.stats?.edgesAdded ?? 0} 边`);
      await load();
    } catch (err) {
      notify(err instanceof Error ? err.message : '审校失败');
    } finally {
      setBusy('');
    }
  }

  async function relayout() {
    setBusy('relayout');
    try {
      const res = await fetch(`/api/spaces/${slug}/relayout`, { method: 'POST' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || '重排失败');
      notify(`已重排 ${data.nodes} 个节点 · ${data.clusters} 个聚类`);
    } catch (err) {
      notify(err instanceof Error ? err.message : '重排失败');
    } finally {
      setBusy('');
    }
  }

  async function runTask(id: string) {
    setBusy(`run-${id}`);
    try {
      const res = await fetch(`/api/spaces/${slug}/tasks/${id}/run`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{}',
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || '执行失败');
      notify('Claude 已交付，等待验收');
      await load();
    } catch (err) {
      notify(err instanceof Error ? err.message : '执行失败');
    } finally {
      setBusy('');
    }
  }

  async function autoReview(id: string) {
    setBusy(`ai-review-${id}`);
    try {
      const res = await fetch(`/api/spaces/${slug}/tasks/${id}/auto-review`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ apply: true, threshold: 70 }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || '验收失败');
      notify(data.applied ? `AI 验收通过 · ${data.score} 分` : `AI 验收 ${data.score} 分，建议退回`);
      await load();
    } catch (err) {
      notify(err instanceof Error ? err.message : '验收失败');
    } finally {
      setBusy('');
    }
  }

  async function createKey() {
    setBusy('key');
    try {
      const res = await fetch(`/api/spaces/${slug}/keys`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: newKeyName }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || '生成失败');
      setFreshKey(data.key);
      await load();
    } catch (err) {
      notify(err instanceof Error ? err.message : '生成失败');
    } finally {
      setBusy('');
    }
  }

  async function revokeKey(id: string) {
    await fetch(`/api/spaces/${slug}/keys?id=${id}`, { method: 'DELETE' });
    await load();
    notify('已撤销');
  }

  async function changeRole(userId: string, nextRole: string) {
    const res = await fetch(`/api/spaces/${slug}/members`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId, role: nextRole }),
    });
    if (res.ok) {
      await load();
      notify('已更新成员角色');
    } else {
      notify('更新失败');
    }
  }

  async function rotateInvite() {
    const res = await fetch(`/api/spaces/${slug}/invite`, { method: 'POST' });
    if (res.ok) {
      const data = await res.json();
      setInviteUrl(data.url);
      notify('邀请链接已重置');
    }
  }

  async function createTask() {
    if (newTaskTitle.trim().length < 2) return;
    setBusy('task');
    try {
      const res = await fetch(`/api/spaces/${slug}/tasks`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: newTaskTitle, prompt: newTaskTitle }),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || '创建失败');
      }
      setNewTaskTitle('');
      await load();
      notify('任务已创建');
    } catch (err) {
      notify(err instanceof Error ? err.message : '创建失败');
    } finally {
      setBusy('');
    }
  }

  async function copy(text: string) {
    try {
      await navigator.clipboard.writeText(text);
      notify('已复制');
    } catch {
      notify('复制失败');
    }
  }

  if (error) {
    return (
      <div className="auth-wrap">
        <div className="auth-card" style={{ textAlign: 'center' }}>
          <h1>{error}</h1>
          <Link href={`/s/${slug}`} className="btn btn-primary">
            回到空间
          </Link>
        </div>
      </div>
    );
  }

  const maxDaily = Math.max(1, ...(stats?.daily ?? []).map((d) => d.count));

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
          <Link href={`/s/${slug}/tree`} className="btn btn-sm">
            问题树
          </Link>
        </div>
      </nav>

      <div className="page-head">
        <div>
          <h1>{space?.title ?? '…'} · 收集者后台</h1>
          <p>{space?.direction || '还没有发布方向'}</p>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button className="btn btn-sm" onClick={runAudit} disabled={busy === 'audit'}>
            {busy === 'audit' ? '审校中…' : '立即用 ds4.1 审一遍'}
          </button>
          <button className="btn btn-sm" onClick={relayout} disabled={busy === 'relayout'}>
            {busy === 'relayout' ? '重排中…' : '重排节点'}
          </button>
          <a className="btn btn-sm" href={`/api/spaces/${slug}/export?format=md`}>
            导出 MD
          </a>
          <a className="btn btn-sm" href={`/api/spaces/${slug}/export?format=json`}>
            JSON
          </a>
          <a className="btn btn-sm" href={`/api/spaces/${slug}/export?format=csv`}>
            CSV
          </a>
        </div>
      </div>

      <div className="admin-grid">
        <div className="stat-card">
          <div className="k">QUESTIONS</div>
          <div className="v">{stats?.nodes ?? '—'}</div>
          <div className="sub">{stats?.authors ?? 0} 位贡献者 · {stats?.duplicates ?? 0} 条疑似重复</div>
        </div>
        <div className="stat-card">
          <div className="k">RELATIONS</div>
          <div className="v">{stats?.edges ?? '—'}</div>
          <div className="sub">{stats?.clusters ?? 0} 个聚类</div>
        </div>
        <div className="stat-card">
          <div className="k">MEMBERS</div>
          <div className="v">{stats?.members ?? '—'}</div>
          <div className="sub">共 {members.filter((m) => m.role !== 'brainstormer').length} 位收集者</div>
        </div>
        <div className="stat-card">
          <div className="k">TASKS</div>
          <div className="v">{(stats?.tasks.open ?? 0) + (stats?.tasks.claimed ?? 0) + (stats?.tasks.submitted ?? 0)}</div>
          <div className="sub">
            待验收 {stats?.tasks.submitted ?? 0} · 已通过 {stats?.tasks.approved ?? 0}
          </div>
        </div>
      </div>

      <div className="admin-cols">
        <div>
          <section className="section">
            <div className="section-head">
              <h3>执行与运维</h3>
              <span className="badge">30s 自动刷新</span>
            </div>
            <div className="section-body">
              <div className="ops-grid">
                <div>
                  <div className="k">执行中</div>
                  <b>{ops?.counts.claimed ?? 0}</b>
                </div>
                <div>
                  <div className="k">待验收</div>
                  <b>{ops?.counts.submitted ?? 0}</b>
                </div>
                <div>
                  <div className="k">已验收</div>
                  <b>{ops?.counts.approved ?? 0}</b>
                </div>
                <div>
                  <div className="k">停滞 &gt;15m</div>
                  <b className={ops?.stale.length ? 'warn' : ''}>{ops?.stale.length ?? 0}</b>
                </div>
              </div>

              {ops?.tree && (
                <div className="ops-line">
                  问题树：已派 {ops.tree.dispatched} · 已验收 {ops.tree.approved}
                  {ops.tree.stale && <span className="warn"> · 有新问题，建议重新收束</span>}
                </div>
              )}
              {!ops?.tree && <div className="ops-line dim">还没有问题树</div>}

              {ops?.agents.map((agent) => (
                <div key={agent.assignee} className="ops-row">
                  <span className="mono">{agent.assignee}</span>
                  <span className="dim">
                    {agent.count} 个任务 · 最近 {new Date(agent.last_at).toLocaleTimeString('zh-CN')}
                  </span>
                </div>
              ))}

              {ops?.active.slice(0, 6).map((task) => (
                <div key={task.id} className="ops-row">
                  <span className={`pill status-${task.status}`}>{task.status}</span>
                  <span className="ops-title">{task.title}</span>
                  <span className="mono dim">{task.minutes}m</span>
                </div>
              ))}

              {ops && ops.stale.length > 0 && (
                <div className="ops-alert">⚠ {ops.stale.length} 个任务超过 15 分钟没有动静</div>
              )}
            </div>
          </section>

          <section className="section">
            <div className="section-head">
              <h3>任务队列 · 反馈链路</h3>
              <span className="badge">{tasks.length}</span>
            </div>
            <div className="section-body tight">
              <div style={{ display: 'flex', gap: 8, padding: '12px 18px', borderBottom: '1px solid var(--line)' }}>
                <input
                  className="input"
                  style={{ height: 34 }}
                  placeholder="直接发布一个任务…"
                  value={newTaskTitle}
                  onChange={(e) => setNewTaskTitle(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') void createTask();
                  }}
                />
                <button className="btn btn-sm" onClick={createTask} disabled={busy === 'task'}>
                  发布
                </button>
              </div>

              {tasks.length === 0 && <div className="empty" style={{ border: 0 }}>还没有任务。从空间里点一个问题，选「派给 Agent 解决」。</div>}

              {tasks.map((task) => {
                const meta = STATUS_META[task.status] ?? STATUS_META.open;
                const isOpen = expanded === task.id;
                return (
                  <div key={task.id} className="task">
                    <div className="task-head">
                      <div style={{ minWidth: 0 }}>
                        <div className="task-title">{task.title}</div>
                        <div className="task-meta">
                          <span className="status-dot" style={{ color: meta.color }}>
                            <i style={{ background: meta.color }} />
                            {meta.label}
                          </span>
                          {task.assignee && <span className="mono">{task.assignee}</span>}
                          <span className="mono">{new Date(task.created_at).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })}</span>
                          <span>{task.event_count ?? 0} 条记录</span>
                        </div>
                      </div>
                      <button className="btn btn-sm btn-ghost" onClick={() => void openTask(task.id)}>
                        {isOpen ? '收起' : '链路'}
                      </button>
                    </div>

                    <div className="task-actions">
                      {['open', 'claimed', 'rejected'].includes(task.status) && (
                        <button className="btn btn-sm" onClick={() => void runTask(task.id)} disabled={busy === `run-${task.id}`}>
                          {busy === `run-${task.id}` ? '执行中…' : 'AI 执行'}
                        </button>
                      )}
                      {task.status === 'submitted' && (
                        <button className="btn btn-sm" onClick={() => void autoReview(task.id)} disabled={busy === `ai-review-${task.id}`}>
                          {busy === `ai-review-${task.id}` ? '验收中…' : 'AI 验收'}
                        </button>
                      )}
                    </div>

                    {isOpen && detail && detail.task.id === task.id && (
                      <div style={{ marginTop: 8 }}>
                        {detail.task.prompt && (
                          <div className="detail-summary" style={{ marginTop: 4, fontFamily: 'var(--mono)', fontSize: 11.5 }}>
                            {detail.task.prompt.slice(0, 400)}
                          </div>
                        )}
                        <div className="timeline">
                          {detail.events.map((event) => (
                            <div
                              key={event.id}
                              className={`timeline-item ${event.actor_type === 'agent' ? 'agent' : ''} ${event.type === 'result' ? 'result' : ''}`}
                            >
                              <span className="who">
                                {event.actor_name || event.actor_type} · {event.type}
                              </span>
                              <span className="when">{new Date(event.created_at).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })}</span>
                              <div className="msg">{event.message}</div>
                            </div>
                          ))}
                        </div>

                        {detail.task.result && (
                          <div className="detail-summary" style={{ marginTop: 8, whiteSpace: 'pre-wrap' }}>
                            {detail.task.result.slice(0, 1500)}
                          </div>
                        )}

                        {(task.status === 'submitted' || task.status === 'rejected') && (
                          <div style={{ marginTop: 10 }}>
                            <textarea
                              className="input"
                              rows={2}
                              placeholder="验收备注（可空）"
                              value={reviewNote}
                              onChange={(e) => setReviewNote(e.target.value)}
                            />
                            <div className="task-actions">
                              <button className="btn btn-sm btn-primary" onClick={() => void review(task.id, 'approve')} disabled={busy === `review-${task.id}`}>
                                通过
                              </button>
                              <button className="btn btn-sm" onClick={() => void review(task.id, 'reject')} disabled={busy === `review-${task.id}`}>
                                退回
                              </button>
                            </div>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </section>

          <section className="section">
            <div className="section-head">
              <h3>ds4.1 审校记录</h3>
              <span className="badge">{stats?.audits.length ?? 0}</span>
            </div>
            <div className="section-body tight">
              {(stats?.audits ?? []).map((run) => (
                <div key={run.id} className="task">
                  <div className="task-head">
                    <div>
                      <div className="task-title mono" style={{ fontSize: 12.5 }}>
                        {run.model.split('/').pop()}
                      </div>
                      <div className="task-meta">
                        <span>{new Date(run.started_at).toLocaleString('zh-CN')}</span>
                        <span>检查 {run.stats?.checked ?? 0}</span>
                        <span>合并 {run.stats?.duplicates ?? 0}</span>
                        <span>+{run.stats?.edgesAdded ?? 0} / -{run.stats?.edgesRemoved ?? 0} 边</span>
                        <span>改标签 {run.stats?.retagged ?? 0}</span>
                      </div>
                      {run.notes && <div className="dim" style={{ fontSize: 11.5, marginTop: 4 }}>{run.notes}</div>}
                    </div>
                    <span className="status-dot" style={{ color: run.status === 'ok' ? 'var(--act)' : 'var(--amber)' }}>
                      <i style={{ background: run.status === 'ok' ? 'var(--act)' : 'var(--amber)' }} />
                      {run.status}
                    </span>
                  </div>
                </div>
              ))}
              {(stats?.audits.length ?? 0) === 0 && <div className="empty" style={{ border: 0 }}>还没有审校记录。正式运行后每 30 分钟自动跑一次。</div>}
            </div>
          </section>

          <section className="section">
            <div className="section-head">
              <h3>最近活动</h3>
            </div>
            <div className="section-body tight">
              {(stats?.activity ?? []).slice(0, 12).map((event, i) => (
                <div key={i} className="task" style={{ padding: '9px 18px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, fontSize: 12.5 }}>
                    <span style={{ color: 'var(--muted)' }}>{event.type}</span>
                    <span className="mono dim" style={{ fontSize: 10.5 }}>
                      {new Date(event.created_at).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </section>
        </div>

        <div>
          <section className="section">
            <div className="section-head">
              <h3>空间与邀请</h3>
              <span className="badge badge-violet">{role}</span>
            </div>
            <div className="section-body">
              <label className="field-label">邀请链接（脑暴者加入）</label>
              <div className="copy-row">
                <input className="input" readOnly value={inviteUrl || '生成中…'} onFocus={(e) => e.target.select()} />
                <button className="btn" onClick={() => void copy(inviteUrl)}>
                  复制
                </button>
              </div>
              <div className="task-actions">
                <button className="btn btn-sm btn-ghost" onClick={rotateInvite}>
                  重置链接
                </button>
              </div>

              <hr className="divider" />
              <div className="panel-title" style={{ marginBottom: 8 }}>
                <span>近 14 天提问</span>
                <span>{stats?.daily.reduce((s, d) => s + d.count, 0) ?? 0}</span>
              </div>
              <div style={{ display: 'flex', alignItems: 'flex-end', gap: 3, height: 54 }}>
                {(stats?.daily ?? []).map((day) => (
                  <div key={day.day} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }} title={`${day.day}: ${day.count}`}>
                    <div
                      style={{
                        width: '100%',
                        height: Math.max(2, (day.count / maxDaily) * 40),
                        background: 'linear-gradient(180deg, var(--act), rgba(62,240,176,.15))',
                        borderRadius: 2,
                      }}
                    />
                  </div>
                ))}
              </div>

              <div className="chip-list" style={{ marginTop: 14 }}>
                {(stats?.topTags ?? []).map((tag) => (
                  <span key={tag.tag} className="q-tag">
                    {tag.tag} {tag.count}
                  </span>
                ))}
              </div>
            </div>
          </section>

          <section className="section">
            <div className="section-head">
              <h3>成员</h3>
              <span className="badge">{members.length}</span>
            </div>
            <div className="section-body tight">
              {members.map((member) => (
                <div key={member.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 18px', borderBottom: '1px solid var(--line)' }}>
                  <Avatar name={member.nickname} color={member.color} size={26} />
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div style={{ fontSize: 13 }}>{member.nickname}</div>
                    <div className="mono dim" style={{ fontSize: 10.5 }}>
                      {member.nodes} 个问题 · {new Date(member.joined_at).toLocaleDateString('zh-CN')}
                    </div>
                  </div>
                  {role === 'owner' && member.role !== 'owner' ? (
                    <select
                      className="input"
                      style={{ width: 96, height: 28, fontSize: 12 }}
                      value={member.role}
                      onChange={(e) => void changeRole(member.id, e.target.value)}
                    >
                      <option value="brainstormer">脑暴者</option>
                      <option value="collector">收集者</option>
                    </select>
                  ) : (
                    <span className="badge">{member.role === 'owner' ? '创建者' : member.role === 'collector' ? '收集者' : '脑暴者'}</span>
                  )}
                </div>
              ))}
            </div>
          </section>

          <section className="section">
            <div className="section-head">
              <h3>Agent Key</h3>
              <span className="badge">{keys.filter((k) => !k.revoked_at).length}</span>
            </div>
            <div className="section-body">
              <div style={{ display: 'flex', gap: 8 }}>
                <input className="input" style={{ height: 34 }} value={newKeyName} onChange={(e) => setNewKeyName(e.target.value)} placeholder="Key 名称，例如 claude-3" />
                <button className="btn btn-sm btn-primary" onClick={createKey} disabled={busy === 'key'}>
                  生成
                </button>
              </div>
              <p className="dim" style={{ fontSize: 11.5, marginTop: 8, lineHeight: 1.7 }}>
                这个 Key 拥有该空间的收集者权限，可以读写问题、派发与验收任务。只在服务端保存哈希，生成后只显示一次。
              </p>

              {keys.map((key) => (
                <div key={key.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 0', borderTop: '1px solid var(--line)', fontSize: 12 }}>
                  <span className="mono" style={{ flex: 1, color: key.revoked_at ? 'var(--dim)' : 'var(--fg)' }}>
                    {key.name}
                    <span className="dim" style={{ marginLeft: 8 }}>
                      {key.prefix}…
                    </span>
                  </span>
                  <span className="mono dim" style={{ fontSize: 10 }}>
                    {key.last_used_at ? `用 ${new Date(key.last_used_at).toLocaleDateString('zh-CN')}` : '未使用'}
                  </span>
                  {!key.revoked_at && (
                    <button className="btn btn-ghost btn-sm" style={{ height: 24, padding: '0 8px' }} onClick={() => void revokeKey(key.id)}>
                      撤销
                    </button>
                  )}
                </div>
              ))}
            </div>
          </section>
        </div>
      </div>
      <div style={{ height: 50 }} />

      {freshKey && (
        <div className="modal-backdrop" onClick={() => setFreshKey(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h2>这是新 Key，只显示一次</h2>
            <p className="sub">把它写进 Agent 的环境变量 MINDSPACE_KEY。关闭后无法再看。</p>
            <div className="key-box">{freshKey}</div>
            <div className="modal-actions">
              <button className="btn" onClick={() => void copy(freshKey)}>
                复制
              </button>
              <button className="btn btn-primary" onClick={() => setFreshKey(null)}>
                我已保存
              </button>
            </div>
          </div>
        </div>
      )}

      {toast && (
        <div className="thinking" style={{ position: 'fixed', left: '50%', transform: 'translateX(-50%)', bottom: 28, zIndex: 60 }}>
          {toast}
        </div>
      )}
    </div>
  );
}
