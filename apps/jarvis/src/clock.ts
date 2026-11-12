/** Heure locale (dans le fuseau de l'utilisateur) sous forme de champs simples. */
export function localParts(date: Date, timeZone: string): { day: string; hour: number; minute: number } {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    })
      .formatToParts(date)
      .map((p) => [p.type, p.value]),
  );
  return { day: `${parts.year}-${parts.month}-${parts.day}`, hour: Number(parts.hour), minute: Number(parts.minute) };
}

/** Vrai si le briefing du jour est dû : l'heure est passée et il n'a pas encore été envoyé aujourd'hui. */
export function briefingDue(now: Date, timeZone: string, hour: number, minute: number, lastSentDay: string | undefined): boolean {
  const local = localParts(now, timeZone);
  if (local.day === lastSentDay) return false;
  return local.hour > hour || (local.hour === hour && local.minute >= minute);
}
