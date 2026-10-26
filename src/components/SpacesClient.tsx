'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { Avatar, Brand } from './Brand';

type Space = {
  id: string;
  slug: string;
  title: string;
  direction: string;
  role: string;
  created_at: string;
  node_count: number;
  member_count: number;
  recent_count: number;
};

type User = { id: string; nickname: string; color: string; phone: string };

const ROLE_LABEL: Record<string, string> = { owner: '创建者', collector: '收集者', brainstormer: '脑暴者' };

export default function SpacesClient({ user }: { user: User }) {
  const router = useRouter();
  const [spaces, setSpaces] = useState<Space[] | null>(null);
  const [creating, setCreating] = useState(false);
  const [title, setTitle] = useState('');
  const [direction, setDirection] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    const res = await fetch('/api/spaces');
    const data = await res.json();
    if (res.ok) setSpaces(data.spaces);
    else setSpaces([]);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function create() {
    setError('');
    if (title.trim().length < 2) {
      setError('空间名至少 2 个字');
      return;
    }
    setBusy(true);
    try {
      const res = await fetch('/api/spaces', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title, direction }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || '创建失败');
      router.push(`/s/${data.space.slug}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : '创建失败');
      setBusy(false);
    }
  }

  async function logout() {
    await fetch('/api/auth/logout', { method: 'POST' });
    router.push('/');
    router.refresh();
  }

  return (
    <div className="shell">
      <nav className="topnav">
        <Brand href="/app" />
        <div className="nav-links">
          <Link href="/docs" style={{ color: 'inherit' }}>
            Agent 接入
          </Link>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
            <Avatar name={user.nickname} color={user.color} size={24} />
            <span style={{ color: 'var(--fg)' }}>{user.nickname}</span>
          </span>
          <button className="btn btn-ghost btn-sm" onClick={logout}>
            退出
          </button>
        </div>
      </nav>

      <div className="page-head">
        <div>
          <h1>我的空间</h1>
          <p>每个空间是一个方向、一群人、一张会长大的关系网。</p>
        </div>
        <button className="btn btn-primary" onClick={() => setCreating((v) => !v)}>
          {creating ? '收起' : '+ 新建发展方向'}
        </button>
      </div>

      {creating && (
        <div className="card create-panel">
          <div className="row">
            <div>
              <label className="field-label">空间名</label>
              <input
                className="input"
                placeholder="例如：2027 产品方向"
                value={title}
                maxLength={40}
                onChange={(e) => setTitle(e.target.value)}
              />
            </div>
            <div>
              <label className="field-label">脑暴方向（收集者发布）</label>
              <input
                className="input"
                placeholder="这一轮想让大家一起想清楚什么？"
                value={direction}
                maxLength={300}
                onChange={(e) => setDirection(e.target.value)}
              />
            </div>
          </div>
          {error && <div className="auth-error" style={{ marginTop: 0 }}>{error}</div>}
          <div className="actions">
            <button className="btn btn-ghost" onClick={() => setCreating(false)}>
              取消
            </button>
            <button className="btn btn-primary" onClick={create} disabled={busy}>
              {busy ? '创建中…' : '创建并进入'}
            </button>
          </div>
        </div>
      )}

      {spaces === null ? (
        <div className="empty">读取中…</div>
      ) : spaces.length === 0 ? (
        <div className="empty">
          <p>还没有空间。</p>
          <p style={{ marginTop: 8, fontSize: 13 }}>点右上角「新建发展方向」，或者用收集者发来的邀请链接加入。</p>
        </div>
      ) : (
        <div className="space-grid">
          {spaces.map((space) => (
            <Link key={space.id} href={`/s/${space.slug}`} className="space-card">
              <span className="glow" />
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, alignItems: 'flex-start' }}>
                <h3>{space.title}</h3>
                <span className={`badge ${space.role === 'brainstormer' ? '' : 'badge-violet'}`}>{ROLE_LABEL[space.role] ?? space.role}</span>
              </div>
              <p className="dir">{space.direction || '还没有发布方向'}</p>
              <div className="stats">
                <span>
                  <b>{space.node_count}</b>问题
                </span>
                <span>
                  <b>{space.member_count}</b>成员
                </span>
                <span>
                  <b>{space.recent_count}</b>近 7 天
                </span>
              </div>
              <div className="foot">
                <span className="mono">{space.slug}</span>
                <span>{new Date(space.created_at).toLocaleDateString('zh-CN')}</span>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
