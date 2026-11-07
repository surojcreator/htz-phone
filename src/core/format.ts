/** Shared input helpers — one validator so every screen agrees. */

export type PhoneCheck = { ok: boolean; value: string; error?: string };

/** Accepts 0XXXXXXXXX (9-10 digits) or +972XXXXXXXXX and normalises to local form. */
export function checkPhone(raw: string): PhoneCheck {
  const trimmed = (raw ?? '').trim();
  if (!trimmed) return { ok: false, value: '', error: 'phone is required' };
  const digits = trimmed.replace(/[^\d+]/g, '');
  const local = digits.startsWith('+972')
    ? '0' + digits.slice(4)
    : digits.startsWith('972')
    ? '0' + digits.slice(3)
    : digits;
  if (!/^0\d{8,9}$/.test(local)) {
    return { ok: false, value: local, error: 'use 0XXXXXXXXX or +972XXXXXXXXX' };
  }
  return { ok: true, value: local };
}

export function checkQty(raw: string, max = 20): { ok: boolean; value: number; error?: string } {
  const n = parseInt(raw, 10);
  if (!Number.isFinite(n) || n < 1) return { ok: false, value: 1, error: 'qty must be 1 or more' };
  if (n > max) return { ok: false, value: n, error: `max ${max} per order` };
  return { ok: true, value: n };
}

export function checkInt(raw: string, fallback: number, min = 0): number {
  const n = parseInt(raw, 10);
  return Number.isFinite(n) && n >= min ? n : fallback;
}
