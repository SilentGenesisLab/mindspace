'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';

export default function AuthForm({ next = '/app' }: { next?: string }) {
  const router = useRouter();
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [nickname, setNickname] = useState('');
  const [stage, setStage] = useState<'phone' | 'code'>('phone');
  const [countdown, setCountdown] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (countdown <= 0) return;
    timer.current = setTimeout(() => setCountdown((c) => c - 1), 1000);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [countdown]);

  async function sendCode() {
    setError('');
    setNotice('');
    if (!/^1[3-9]\d{9}$/.test(phone)) {
      setError('请输入 11 位手机号');
      return;
    }
    setBusy(true);
    try {
      const res = await fetch('/api/auth/send-code', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || '发送失败');
      setStage('code');
      setCountdown(60);
      setNotice(data.sent === false ? '短信通道暂不可用，当前为验收模式：验证码见服务端配置' : '验证码已发送，10 分钟内有效');
    } catch (err) {
      setError(err instanceof Error ? err.message : '发送失败');
    } finally {
      setBusy(false);
    }
  }

  async function verify() {
    setError('');
    if (!/^\d{6}$/.test(code)) {
      setError('请输入 6 位验证码');
      return;
    }
    setBusy(true);
    try {
      const res = await fetch('/api/auth/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone, code, nickname }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || '登录失败');
      router.replace(next || '/app');
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : '登录失败');
      setBusy(false);
    }
  }

  return (
    <>
      <label className="field-label" htmlFor="phone">
        手机号
      </label>
      <input
        id="phone"
        className="input"
        inputMode="numeric"
        autoComplete="tel"
        placeholder="11 位手机号"
        value={phone}
        maxLength={11}
        onChange={(e) => setPhone(e.target.value.replace(/\D/g, ''))}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && stage === 'phone') sendCode();
        }}
      />

      {stage === 'phone' ? (
        <div className="auth-actions">
          <button className="btn btn-primary" onClick={sendCode} disabled={busy}>
            {busy ? '发送中…' : '获取验证码'}
          </button>
        </div>
      ) : (
        <>
          <div className="auth-row">
            <input
              className="input"
              inputMode="numeric"
              autoComplete="one-time-code"
              placeholder="6 位验证码"
              value={code}
              maxLength={6}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
              onKeyDown={(e) => {
                if (e.key === 'Enter') verify();
              }}
              autoFocus
            />
            <button className="btn" onClick={sendCode} disabled={countdown > 0 || busy}>
              {countdown > 0 ? `${countdown}s` : '重发'}
            </button>
          </div>

          <div style={{ marginTop: 12 }}>
            <label className="field-label" htmlFor="nickname">
              昵称（可选，仅首次创建时使用）
            </label>
            <input
              id="nickname"
              className="input"
              placeholder="你在空间里显示的名字"
              value={nickname}
              maxLength={16}
              onChange={(e) => setNickname(e.target.value)}
            />
          </div>

          <div className="auth-actions">
            <button className="btn btn-primary" onClick={verify} disabled={busy}>
              {busy ? '登录中…' : '进入 Mindspace'}
            </button>
          </div>
        </>
      )}

      {error && <div className="auth-error">{error}</div>}
      {notice && !error && <div className="auth-ok">{notice}</div>}
    </>
  );
}
