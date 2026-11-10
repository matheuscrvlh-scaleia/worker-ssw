/**
 * Datas de calendário como texto ISO (`AAAA-MM-DD`), sem fuso: um feriado é um dia, não um
 * instante. As contas usam UTC por dentro para não sofrer com horário de verão.
 */
const PADRAO_DATA_ISO = /^\d{4}-\d{2}-\d{2}$/;

export function ehDataIso(valor: string): boolean {
  if (!PADRAO_DATA_ISO.test(valor)) return false;
  const data = new Date(`${valor}T00:00:00Z`);
  return !Number.isNaN(data.getTime()) && data.toISOString().startsWith(valor);
}

function paraUtc(iso: string): Date {
  return new Date(`${iso}T00:00:00Z`);
}

function paraIso(data: Date): string {
  return data.toISOString().slice(0, 10);
}

/** Hoje no fuso da empresa (o servidor roda em UTC; às 22h em SP já é amanhã em UTC). */
export function hojeNoFuso(fuso: string, agora: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: fuso,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(agora);
}

/** Mesmo dia e mês `anos` depois; 29/02 cai em 01/03 em ano não bissexto. */
export function somarAnos(iso: string, anos: number): string {
  const data = paraUtc(iso);
  data.setUTCFullYear(data.getUTCFullYear() + anos);
  return paraIso(data);
}

export function somarDias(iso: string, dias: number): string {
  const data = paraUtc(iso);
  data.setUTCDate(data.getUTCDate() + dias);
  return paraIso(data);
}

/** Dias de `de` até `ate` (positivo se `ate` é depois). */
export function diferencaEmDias(de: string, ate: string): number {
  return Math.round((paraUtc(ate).getTime() - paraUtc(de).getTime()) / 86_400_000);
}

/** 0 = domingo … 6 = sábado. */
export function diaDaSemana(iso: string): number {
  return paraUtc(iso).getUTCDay();
}

export function montarDataIso(ano: number, mes: number, dia: number): string {
  return paraIso(new Date(Date.UTC(ano, mes - 1, dia)));
}
