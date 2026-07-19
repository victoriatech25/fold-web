export function normalizeEmail(email: string): string {
  return email.trim().normalize("NFKC").toLocaleLowerCase("en-US");
}
