'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { Brand } from './Brand';

export default function JoinClient({ code, title, loggedIn }: { code: string; title: string; loggedIn: boolean }) {
  const router = useRouter();
  const [state, setState] = useState<'idle' | 'busy' | 'error'>('idle');
  const [message, setMessage] = useState('');

  async function join() {
    setState('busy');
    try {
      const res = await fetch(`/api/join/${code}`, { method: 'POST' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || '加入失败');
      router.push(`/s/${data.space.slug}`);
    } catch (err) {
      setMessage(err instanceof Error ? err.message : '加入失败');
      setState('error');
    }
  }

  useEffect(() => {
    if (loggedIn) void join();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loggedIn]);

  return (
    <div className="auth-wrap">
      <div className="auth-card" style={{ textAlign: 'center' }}>
        <Brand />
        <h1 style={{ marginTop: 24 }}>加入「{title}」</h1>
        <p className="auth-sub">你会成为这个思维空间的脑暴者：可以提问、看全网的形状、按标签找问题。</p>
        {!loggedIn ? (
          <Link href={`/login?next=/join/${code}`} className="btn btn-primary" style={{ marginTop: 8 }}>
            用手机号登录并加入
          </Link>
        ) : state === 'error' ? (
          <>
            <div className="auth-error">{message}</div>
            <button className="btn btn-primary" onClick={join} style={{ marginTop: 12 }}>
              重试
            </button>
          </>
        ) : (
          <p className="mono dim" style={{ fontSize: 12 }}>
            正在加入…
          </p>
        )}
        <div className="auth-note">
          <Link href="/app">← 先看看我的空间</Link>
        </div>
      </div>
    </div>
  );
}
