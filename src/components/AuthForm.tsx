'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';

type Mode = 'code' | 'password';

const LAST_PHONE = 'ms:last-phone';
const LAST_MODE = 'ms:last-mode';

export default function AuthForm({ next = '/app' }: { next?: string }) {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>('code');
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [nickname, setNickname] = useState('');
  const [codeSent, setCodeSent] = useState(false);
  const [countdown, setCountdown] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // 记住上次的手机号和登录方式，回访时少填一步
  useEffect(() => {
    const lastPhone = localStorage.getItem(LAST_PHONE);
    const lastMode = localStorage.getItem(LAST_MODE);
    if (lastPhone && /^1[3-9]\d{9}$/.test(lastPhone)) setPhone(lastPhone);
    if (lastMode === 'password' || lastMode === 'code') setMode(lastMode);
  }, []);

  useEffect(() => {
    if (countdown <= 0) return;
    timer.current = setTimeout(() => setCountdown((c) => c - 1), 1000);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [countdown]);

  function switchMode(next: Mode) {
    setMode(next);
    setError('');
    setNotice('');
  }

  function remember() {
    localStorage.setItem(LAST_PHONE, phone);
    localStorage.setItem(LAST_MODE, mode);
  }

  function done() {
    remember();
    router.replace(next || '/app');
    router.refresh();
  }

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
      setCodeSent(true);
      setCountdown(60);
      setNotice(data.sent === false ? '短信通道暂不可用，当前为验收模式：验证码见服务端配置' : '验证码已发送，10 分钟内有效');
    } catch (err) {
      setError(err instanceof Error ? err.message : '发送失败');
    } finally {
      setBusy(false);
    }
  }

  async function loginWithCode() {
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
        body: JSON.stringify({ phone, code, nickname, password: newPassword || undefined }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || '登录失败');
      if (data.passwordSet) localStorage.setItem(LAST_MODE, 'password');
      done();
    } catch (err) {
      setError(err instanceof Error ? err.message : '登录失败');
      setBusy(false);
    }
  }

  async function loginWithPassword() {
    setError('');
    if (!/^1[3-9]\d{9}$/.test(phone)) {
      setError('请输入 11 位手机号');
      return;
    }
    if (!password) {
      setError('请输入密码');
      return;
    }
    setBusy(true);
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone, password }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || '登录失败');
      done();
    } catch (err) {
      setError(err instanceof Error ? err.message : '登录失败');
      setBusy(false);
    }
  }

  return (
    <>
      <div className="auth-tabs" role="tablist">
        <button role="tab" aria-selected={mode === 'code'} className={mode === 'code' ? 'on' : ''} onClick={() => switchMode('code')}>
          验证码登录
        </button>
        <button
          role="tab"
          aria-selected={mode === 'password'}
          className={mode === 'password' ? 'on' : ''}
          onClick={() => switchMode('password')}
        >
          密码登录
        </button>
      </div>

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
          if (e.key !== 'Enter') return;
          if (mode === 'code' && !codeSent) void sendCode();
        }}
      />

      {mode === 'password' ? (
        <>
          <div style={{ marginTop: 12 }}>
            <label className="field-label" htmlFor="password">
              密码
            </label>
            <input
              id="password"
              type="password"
              className="input"
              autoComplete="current-password"
              placeholder="登录密码"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void loginWithPassword();
              }}
            />
          </div>
          <div className="auth-actions">
            <button className="btn btn-primary" onClick={loginWithPassword} disabled={busy}>
              {busy ? '登录中…' : '登录'}
            </button>
            <button className="btn btn-ghost btn-sm" onClick={() => switchMode('code')}>
              没设过密码 / 忘记密码？用验证码登录
            </button>
          </div>
        </>
      ) : !codeSent ? (
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
                if (e.key === 'Enter') void loginWithCode();
              }}
              autoFocus
            />
            <button className="btn" onClick={sendCode} disabled={countdown > 0 || busy}>
              {countdown > 0 ? `${countdown}s` : '重发'}
            </button>
          </div>

          <div style={{ marginTop: 12 }}>
            <label className="field-label" htmlFor="new-password">
              设置 / 重置密码（可选，下次可直接用密码登录）
            </label>
            <input
              id="new-password"
              type="password"
              className="input"
              autoComplete="new-password"
              placeholder="8 位以上，含字母和数字"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
            />
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
            <button className="btn btn-primary" onClick={loginWithCode} disabled={busy}>
              {busy ? '登录中…' : '进入 Mindspace'}
            </button>
          </div>
        </>
      )}

      {error && <div className="auth-error">{error}</div>}
      {notice && !error && <div className="auth-ok">{notice}</div>}
      <div className="auth-note" style={{ marginTop: 14 }}>
        登录一次后本设备保持 90 天，活跃使用会自动续期。
      </div>
    </>
  );
}
