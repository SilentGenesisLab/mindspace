import Link from 'next/link';
import { redirect } from 'next/navigation';
import AuthForm from '@/components/AuthForm';
import { Brand } from '@/components/Brand';
import { getSessionUser } from '@/lib/auth';

export const dynamic = 'force-dynamic';

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const user = await getSessionUser();
  const params = await searchParams;
  const next = params.next && params.next.startsWith('/') ? params.next : '/app';
  if (user) redirect(next);

  return (
    <div className="auth-wrap">
      <div className="auth-card">
        <Brand />
        <h1>进入思维空间</h1>
        <p className="auth-sub">用手机号登录。第一次登录会自动创建账号。</p>
        <AuthForm next={next} />
        <div className="auth-note">
          登录即表示你同意：你在空间里提交的问题和标签会被同一空间的成员看到，并用于关系计算。
          <br />
          <Link href="/">← 回到首页</Link>
        </div>
      </div>
    </div>
  );
}
