export function digitsOnly(value: string): string {
  return value.replace(/\D/g, '');
}

function normalizeUaeForWaMe(value: string): string | undefined {
  const digits = digitsOnly(value);
  if (!digits) {
    return undefined;
  }

  if (digits.startsWith('971') && digits.length >= 11) {
    return digits;
  }

  if (digits.startsWith('05') && digits.length === 10) {
    return `971${digits.slice(1)}`;
  }

  return undefined;
}

export function buildWhatsAppLink(phone: string): string | undefined {
  const waDigits = normalizeUaeForWaMe(phone);
  if (!waDigits) {
    return undefined;
  }

  return `https://wa.me/${waDigits}`;
}

export function normalizeWhatsAppDisplay(value: string | null | undefined, fallbackPhone?: string | null): string | null {
  const raw = value?.trim();
  if (raw) {
    const waSource = raw.replace(/^https?:\/\/wa\.me\//i, '');
    const waLink = buildWhatsAppLink(waSource);
    return waLink ?? raw;
  }

  const fallback = fallbackPhone?.trim();
  if (!fallback) {
    return null;
  }

  return buildWhatsAppLink(fallback) ?? fallback;
}
