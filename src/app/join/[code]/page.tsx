import { redirect } from 'next/navigation';
import JoinClient from '@/components/JoinClient';
import { getSessionUser } from '@/lib/auth';
import { one } from '@/lib/db';

export const dynamic = 'force-dynamic';

export default async function JoinPage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  const space = await one<{ title: string; slug: string }>(
    'select title, slug from spaces where invite_code = $1 and archived = false',
    [code],
  );
  if (!space) {
    return (
      <div className="auth-wrap">
        <div className="auth-card" style={{ textAlign: 'center' }}>
          <h1>邀请链接已失效</h1>
          <p className="auth-sub">请找收集者重新生成一个邀请链接。</p>
        </div>
      </div>
    );
  }
  const user = await getSessionUser();
  if (!user) {
    // 未登录也展示空间名，登录后自动加入
    return <JoinClient code={code} title={space.title} loggedIn={false} />;
  }
  return <JoinClient code={code} title={space.title} loggedIn />;
}
