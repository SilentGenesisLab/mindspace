import Link from 'next/link';

export function BrandMark({ size = 28 }: { size?: number }) {
  return (
    <svg className="brand-mark" width={size} height={size} viewBox="0 0 32 32" fill="none" aria-hidden>
      <defs>
        <linearGradient id="ms-g" x1="2" y1="30" x2="30" y2="2" gradientUnits="userSpaceOnUse">
          <stop stopColor="#3ef0b0" />
          <stop offset="0.55" stopColor="#57d4ff" />
          <stop offset="1" stopColor="#b58cff" />
        </linearGradient>
      </defs>
      <circle cx="16" cy="16" r="13" stroke="url(#ms-g)" strokeOpacity="0.28" />
      <path d="M16 16 8.5 9.5M16 16l7.5-6M16 16l-6 8M16 16l7 7.5M16 16l-7.5 3" stroke="url(#ms-g)" strokeOpacity="0.55" strokeWidth="1" />
      <circle cx="16" cy="16" r="3" fill="url(#ms-g)" />
      <circle cx="8.5" cy="9.5" r="1.7" fill="#57d4ff" />
      <circle cx="23.5" cy="10" r="1.4" fill="#b58cff" />
      <circle cx="10" cy="24" r="1.5" fill="#3ef0b0" />
      <circle cx="23" cy="23.5" r="1.2" fill="#ffb547" />
      <circle cx="8.5" cy="19" r="1.1" fill="#57d4ff" opacity="0.8" />
    </svg>
  );
}

export function Brand({ href = '/', compact = false }: { href?: string; compact?: boolean }) {
  return (
    <Link href={href} className="brand">
      <BrandMark />
      {!compact && (
        <span>
          Mindspace
          <span style={{ color: 'var(--dim)', fontWeight: 400, fontSize: 12, marginLeft: 8, letterSpacing: '0.14em' }}>
            思维空间
          </span>
        </span>
      )}
    </Link>
  );
}

export function Avatar({ name, color, size = 26 }: { name: string; color: string; size?: number }) {
  const initial = (name || '?').trim().slice(0, 1).toUpperCase();
  return (
    <span
      className="avatar"
      style={{ background: color, width: size, height: size, fontSize: size * 0.42 }}
      title={name}
    >
      {initial}
    </span>
  );
}
