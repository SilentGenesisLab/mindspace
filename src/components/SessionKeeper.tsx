'use client';

import { useEffect } from 'react';

/** 每个标签页打开时碰一下 /api/auth/me：会话超过 7 天就续成新的 90 天。 */
export default function SessionKeeper() {
  useEffect(() => {
    if (sessionStorage.getItem('ms:session-touched')) return;
    sessionStorage.setItem('ms:session-touched', '1');
    fetch('/api/auth/me', { cache: 'no-store' }).catch(() => {});
  }, []);
  return null;
}
