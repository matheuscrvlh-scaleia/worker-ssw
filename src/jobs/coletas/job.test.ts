import { pino } from "pino";
import { describe, expect, it } from "vitest";

import { BancoFalso, EMPRESA } from "../../testes/banco-falso";
import { criarProcessador } from "../processador";
import { importarColetas050 } from "./job";

// Amostra anonimizada no layout do CSV do 050 que chega pelo FTP.
const CABECALHO =
  "UNIDADE;COLETA;TIPO;DATA_LIMITE_INICIAL;REME_CNPJ;REME_NOME;REME_ENDERECO;REME_BAIRRO;REME_CEP;REME_CIDADE;REME_FONE;SETOR;DEST_CNPJ;DEST_NOME;DEST_ENDERECO;DEST_BAIRRO;DEST_CEP;DEST_CIDADE;DEST_FONE;DATA_HORA_LIMITE;SOLICITANTE;MOTORISTA;SITUACAO_ATUAL;DATA_SITUACAO_ATUAL;VALOR_MERCADORIA;QTDE_VOLUMES;PESO_KG;VEICULO;MERCADORIA;TIPO_FRETE;NOTAS_FISCAIS;CADASTRADA_EM;CADASTRADA_POR;COMANDADA_EM;COMANDADA_POR;COLETADA_EM;COLETADA_POR;CANCELADA_EM;CANCELADA_POR;OBS1;OBS2;OBS3;HISTORICO";
const COLETA =
  "CAP;012600;REVERS;05/11/2026;33333333000133;OUTRO REMETENTE SA;RUA C, 3;CENTRO;24000000;NITEROI;;240;44444444000144;OUTRO DESTINATARIO;RUA D, 4;;20000000;RIO DE JANEIRO-RJ;;06/11/2026 18:00;PARCEIRO Y;;COMANDADA;05/11/2026 08:00;10,50;2;1,500;;001 - DIVERSOS;FOB;123;04/11/2026 17:00;usuario4;05/11/2026 08:00;usuario4;;;;;;;;FRT CAP usuario4 05/11 08:00 COLETA COMANDADA PARA VEICULO BBB2B22";

function montar() {
  const banco = new BancoFalso();
  const processar = criarProcessador({
    jobs: [importarColetas050],
    executar: banco.executar,
    log: pino({ level: "silent" }),
    agora: () => new Date("2026-11-05T16:30:00Z"),
  });
  return { banco, processar };
}

describe("050 de coletas pelo FTP", () => {
  it("grava as coletas no contexto da empresa com o caso de uso da tela", async () => {
    const { banco, processar } = montar();
    const r = await processar({
      name: "importar-coletas-050",
      data: {
        empresaId: EMPRESA,
        nome: "050_coletas_2026-11-05_1330.csv",
        conteudo: [CABECALHO, COLETA].join("\r\n"),
      },
    });
    expect(r).toEqual({
      arquivo: "050_coletas_2026-11-05_1330.csv",
      lidas: 1,
      gravadas: 1,
      ignoradas: 0,
    });
    expect(banco.contextos).toEqual([{ empresaId: EMPRESA, usuarioId: null, plataforma: false }]);
    expect(banco.coletas.get("CAP|12600")).toMatchObject({
      tipo: "REVERSA",
      situacao: "COMANDADA",
      arquivoOrigem: "050_coletas_2026-11-05_1330.csv",
    });
  });

  it("arquivo que não é o 050 não é repetido", async () => {
    const { processar } = montar();
    await expect(
      processar({
        name: "importar-coletas-050",
        data: { empresaId: EMPRESA, nome: "x.csv", conteudo: "UNIDADE;COLETA;TIPO\nCAP;1;NORMAL" },
      }),
    ).rejects.toThrow(/x\.csv/);
  });
});
