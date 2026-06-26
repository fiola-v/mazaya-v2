export function digitsOnly(value: string): string {
  return value.replace(/\D/g, '');
}

export function buildWhatsAppLink(phone: string): string | undefined {
  const digits = digitsOnly(phone);

  if (!digits) {
    return undefined;
  }

  return `https://wa.me/${digits}`;
}
