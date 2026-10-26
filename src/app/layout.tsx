import type { Metadata, Viewport } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Mindspace · 思维空间',
  description: '把问题扔进来，它们会自己长成一张网。集体脑暴的空间关系网络，支持 Jev 实时判关系、ds4.1 定时审校、Agent 协作。',
  applicationName: 'Mindspace',
  openGraph: {
    title: 'Mindspace · 思维空间',
    description: '问题不是列表，是一张会生长的网。',
    type: 'website',
  },
};

export const viewport: Viewport = {
  themeColor: '#04060c',
  width: 'device-width',
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
