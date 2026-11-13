import {
  type ChaveCte,
  chaveDoCte,
  type LinhasDoCte,
  type ProjecaoDoCte,
  type ProjecoesGravadas,
  type RepositorioProjecoesRomaneio,
} from "@erp/domain/manifest/projections";

/** Projeções em memória: linhas dadas pelo teste; o que é gravado vira o estado lido depois. */
export class ProjecoesFalsas implements RepositorioProjecoesRomaneio {
  linhas = new Map<string, LinhasDoCte>();
  chaves: ChaveCte[] = [];
  gravadasAgora: ProjecaoDoCte[] = [];
  private estado = new Map<string, ProjecaoDoCte>();

  linhasDosCtes = () => Promise.resolve(this.linhas);

  gravadas = (chaves: readonly ChaveCte[]): Promise<ProjecoesGravadas> => {
    const doEstado = chaves.flatMap((c) => {
      const p = this.estado.get(chaveDoCte(c));
      return p ? [[chaveDoCte(c), p] as const] : [];
    });
    return Promise.resolve({
      viagens: new Map(doEstado.map(([k, p]) => [k, p.viagens])),
      saidas: new Map(doEstado.map(([k, p]) => [k, p.saidas])),
      atuais: new Map(doEstado.flatMap(([k, p]) => (p.atual ? [[k, p.atual]] : []))),
      dados: new Map(doEstado.flatMap(([k, p]) => (p.dados ? [[k, p.dados]] : []))),
      conferentes: new Map(doEstado.flatMap(([k, p]) => (p.conferente ? [[k, p.conferente]] : []))),
    });
  };

  gravar = (projecoes: readonly ProjecaoDoCte[]) => {
    for (const p of projecoes) this.estado.set(chaveDoCte(p.chave), p);
    this.gravadasAgora.push(...projecoes);
    return Promise.resolve();
  };

  chavesComLinhas = (apos: ChaveCte | null, limite: number) => {
    const inicio = apos ? this.chaves.findIndex((c) => chaveDoCte(c) === chaveDoCte(apos)) + 1 : 0;
    return Promise.resolve(this.chaves.slice(inicio, inicio + limite));
  };
}
