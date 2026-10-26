import Link from 'next/link';
import { redirect } from 'next/navigation';
import AdminDashboard from '@/components/AdminDashboard';
import { canManage, findSpace, getSessionUser, roleFor } from '@/lib/auth';

export const dynamic = 'force-dynamic';

export default async function AdminPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const user = await getSessionUser();
  if (!user) redirect(`/login?next=/s/${slug}/admin`);
  const space = await findSpace(slug);
  if (!space) redirect('/app');
  const role = await roleFor({ kind: 'user', user }, space.id);
  if (!canManage(role)) {
    return (
      <div className="auth-wrap">
        <div className="auth-card" style={{ textAlign: 'center' }}>
          <h1>这里只有收集者能进</h1>
          <p className="auth-sub">数据面板、任务派发、Agent Key 和导出都归收集者管理。</p>
          <Link href={`/s/${slug}`} className="btn btn-primary">
            回到空间
          </Link>
        </div>
      </div>
    );
  }
  return <AdminDashboard slug={slug} />;
}
