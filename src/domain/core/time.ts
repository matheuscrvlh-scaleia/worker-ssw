import { diaDaSemana, diferencaEmDias, hojeNoFuso, somarDias } from "@erp/shared/dates";

/**
 * Dia de negócio como texto `AAAA-MM-DD` (coluna `date`). Todo "dia" do núcleo é o de Brasília
 * (Q11 do dono): nada usa o fuso UTC da sessão do banco.
 */
export type DataIso = string;

export const FUSO_DO_NEGOCIO = "America/Sao_Paulo";

/** Brasília não tem horário de verão desde 2019: o deslocamento é fixo. */
const DESLOCAMENTO_SP = "-03:00";
const MS_POR_HORA = 3_600_000;
const MS_POR_DIA = 24 * MS_POR_HORA;

/** origem: (instante AT TIME ZONE 'America/Sao_Paulo')::date (sistema atual) */
export function diaSp(instante: Date): DataIso {
  return hojeNoFuso(FUSO_DO_NEGOCIO, instante);
}

/** "Hoje" do negócio. `agora` vem sempre do relógio injetado. */
export function hojeSp(agora: Date): DataIso {
  return diaSp(agora);
}

/** `a - b` em dias, como `date - date` do Postgres. */
export function difDias(a: DataIso, b: DataIso): number {
  return diferencaEmDias(b, a);
}

/** `date + int` do Postgres. */
export function somarDiasCorridos(dia: DataIso, dias: number): DataIso {
  return somarDias(dia, dias);
}

/**
 * Relógio de parede do instante no fuso, gravado como se fosse UTC (`getUTCHours()` = hora no
 * fuso). É assim que o Excel guarda data e hora sem fuso.
 */
export function relogioNoFuso(instante: Date, fuso: string): Date {
  const partes = new Intl.DateTimeFormat("en-US", {
    timeZone: fuso,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(instante);
  const parte = (tipo: Intl.DateTimeFormatPartTypes) =>
    Number(partes.find((p) => p.type === tipo)?.value ?? 0);
  return new Date(
    Date.UTC(
      parte("year"),
      parte("month") - 1,
      parte("day"),
      parte("hour"),
      parte("minute"),
      parte("second"),
    ),
  );
}

/** Instante em que o relógio do fuso marca `dia hora` (`hora` = "HH:MM:SS"). */
export function instanteNoFuso(dia: DataIso, hora: string, fuso: string): Date {
  const comoUtc = new Date(`${dia}T${hora}Z`);
  const deslocamento = relogioNoFuso(comoUtc, fuso).getTime() - comoUtc.getTime();
  return new Date(comoUtc.getTime() - deslocamento);
}

/** Hora (0–23) do instante em Brasília. */
export function horaSp(instante: Date): number {
  return new Date(instante.getTime() - 3 * MS_POR_HORA).getUTCHours();
}

/** Meia-noite de Brasília do dia (Q11: substitui o `data::timestamptz` da sessão UTC). */
export function inicioDoDiaSp(dia: DataIso): Date {
  return new Date(`${dia}T00:00:00${DESLOCAMENTO_SP}`);
}

/** `instante - interval 'N days'` (dias de 24 h). */
export function menosDias(instante: Date, dias: number): Date {
  return new Date(instante.getTime() - dias * MS_POR_DIA);
}

/** `instante + interval 'N hours'`. */
export function somarHoras(instante: Date, horas: number): Date {
  return new Date(instante.getTime() + horas * MS_POR_HORA);
}

/** Segunda a sexta. */
export function ehDiaDeSemana(dia: DataIso): boolean {
  const semana = diaDaSemana(dia);
  return semana >= 1 && semana <= 5;
}

/** Menor instante; vazio dá `null`. */
export function menorInstante(instantes: readonly Date[]): Date | null {
  let menor: Date | null = null;
  for (const i of instantes) if (menor === null || i < menor) menor = i;
  return menor;
}
