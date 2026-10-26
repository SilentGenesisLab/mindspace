const STOPWORDS = new Set([
  '什么', '怎么', '如何', '为什么', '这个', '那个', '我们', '你们', '他们', '可以', '一个', '没有', '是不', '不是',
  '的时', '时候', '如果', '因为', '所以', '但是', '就是', '还是', '以及', '并且', '或者', '然后', '这样', '那样',
  'the', 'and', 'for', 'that', 'this', 'with', 'what', 'how', 'why', 'are', 'is', 'to', 'of', 'in', 'on', 'it',
]);

export function normalize(text: string): string {
  return text
    .toLowerCase()
    .replace(/[\s　]+/g, ' ')
    .replace(/[，。！？、；：""''（）《》【】.,!?;:"'()<>[\]{}\-_/\\|~`@#$%^&*+=]/g, ' ')
    .trim();
}

export function tokens(text: string): Set<string> {
  const out = new Set<string>();
  const norm = normalize(text);
  for (const word of norm.split(' ')) {
    if (!word) continue;
    if (/^[a-z0-9]+$/.test(word)) {
      if (word.length > 1 && !STOPWORDS.has(word)) out.add(word);
      continue;
    }
    const chars = Array.from(word.replace(/[^\p{Script=Han}a-z0-9]/gu, ''));
    for (let i = 0; i < chars.length - 1; i++) {
      const bg = chars[i] + chars[i + 1];
      if (!STOPWORDS.has(bg)) out.add(bg);
    }
  }
  return out;
}

/** 字面相似度：交集 / 较短集合大小，短句对长句更友好。 */
export function similarity(a: string, b: string): number {
  const A = tokens(a);
  const B = tokens(b);
  if (!A.size || !B.size) return 0;
  let hit = 0;
  for (const t of A) if (B.has(t)) hit++;
  return hit / Math.min(A.size, B.size);
}

export function keywords(text: string, n = 3): string[] {
  const scored = new Map<string, number>();
  for (const word of normalize(text).split(' ')) {
    if (!word) continue;
    if (/^[a-z0-9]+$/.test(word)) {
      if (word.length > 2 && !STOPWORDS.has(word)) scored.set(word, (scored.get(word) ?? 0) + 2.5);
      continue;
    }
    const chars = Array.from(word.replace(/[^\p{Script=Han}a-z0-9]/gu, ''));
    for (const size of [4, 3, 2]) {
      for (let i = 0; i + size <= chars.length; i++) {
        const gram = chars.slice(i, i + size).join('');
        if (STOPWORDS.has(gram)) continue;
        scored.set(gram, Math.max(scored.get(gram) ?? 0, size));
      }
    }
  }
  const sorted = [...scored.entries()].sort((a, b) => b[1] - a[1] || b[0].length - a[0].length);
  const picked: string[] = [];
  for (const [gram] of sorted) {
    if (picked.some((p) => p.includes(gram) || gram.includes(p))) continue;
    picked.push(gram);
    if (picked.length >= n) break;
  }
  return picked;
}

function fnv1a(seed: string, salt: number): number {
  let h = (0x811c9dc5 ^ salt) >>> 0;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

/** 稳定的 uuid 形态 id，用于让聚类 id 不随每次重算漂移（无需 crypto，客户端也能算）。 */
export function stableUuid(seed: string): string {
  const parts = [0x9e3779b9, 0x85ebca6b, 0xc2b2ae35, 0x27d4eb2f].map((salt) =>
    fnv1a(seed, salt).toString(16).padStart(8, '0'),
  );
  const hex = parts.join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function slugify(input: string): string {
  const base = input
    .toLowerCase()
    .replace(/[\s_]+/g, '-')
    .replace(/[^a-z0-9一-龥-]/g, '')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
  const ascii = base.replace(/[^a-z0-9-]/g, '');
  return (ascii || 'space').slice(0, 24);
}

export function shortCode(len = 10): string {
  const alphabet = 'abcdefghijkmnpqrstuvwxyz23456789';
  const bytes = new Uint8Array(len);
  globalThis.crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => alphabet[b % alphabet.length]).join('');
}
