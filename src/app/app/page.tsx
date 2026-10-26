import { redirect } from 'next/navigation';
import SpacesClient from '@/components/SpacesClient';
import { getSessionUser } from '@/lib/auth';

export const dynamic = 'force-dynamic';

export default async function AppPage() {
  const user = await getSessionUser();
  if (!user) redirect('/login?next=/app');
  return <SpacesClient user={{ id: user.id, nickname: user.nickname, color: user.color, phone: user.phone }} />;
}
