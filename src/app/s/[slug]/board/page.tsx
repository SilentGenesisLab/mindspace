import Link from 'next/link';
import { redirect } from 'next/navigation';
import BoardView from '@/components/BoardView';
import { findSpace, getSessionUser, roleFor } from '@/lib/auth';

export const dynamic = 'force-dynamic';

export default async function BoardPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const user = await getSessionUser();
  if (!user) redirect(`/login?next=/s/${slug}/board`);
  const space = await findSpace(slug);
  if (!space) redirect('/app');
  const role = await roleFor({ kind: 'user', user }, space.id);
  if (!role) {
    return (
      <div className="auth-wrap">
        <div className="auth-card" style={{ textAlign: 'center' }}>
          <h1>你不在这个空间里</h1>
          <p className="auth-sub">需要收集者发的邀请链接才能加入。</p>
          <Link href="/app" className="btn btn-primary">
            回到我的空间
          </Link>
        </div>
      </div>
    );
  }
  return <BoardView slug={slug} title={space.title} meId={user.id} />;
}
