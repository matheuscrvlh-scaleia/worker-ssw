import { describe, expect, it, vi } from "vitest";

import { type ConfiguracaoSftp } from "../aplicacao/casos-de-uso/portas";

const conexoes = vi.hoisted(() => [] as { hostVerifier?: (chave: Buffer) => boolean }[]);
const chaveDoServidor = vi.hoisted(() => ({ atual: Buffer.from("chave-publica-do-servidor") }));

vi.mock("ssh2-sftp-client", () => ({
  default: class {
    connect(opcoes: { hostVerifier?: (chave: Buffer) => boolean }) {
      conexoes.push(opcoes);
      if (opcoes.hostVerifier && !opcoes.hostVerifier(chaveDoServidor.atual)) {
        return Promise.reject(new Error("Handshake failed: host key verification failed"));
      }
      return Promise.resolve();
    }
    end() {
      return Promise.resolve();
    }
  },
}));

const { criarClienteSftp, impressaoDigitalDaChave, normalizarImpressaoDigital } =
  await import("./sftp");

const config = (impressaoDigital: string | null): ConfiguracaoSftp => ({
  host: "sftp.exemplo",
  porta: 22,
  usuario: "u",
  senha: "s",
  impressaoDigital,
  relatoriosPath: "/arquivos_import",
  importadosPath: "/importados",
});

describe("cliente SFTP confere a chave do servidor", () => {
  it("sem impressão cadastrada recusa sem tentar conectar (falha fechada)", async () => {
    conexoes.length = 0;
    await expect(criarClienteSftp().conectar(config(null))).rejects.toThrow(
      /Impressão digital do servidor SFTP não cadastrada/,
    );
    expect(conexoes).toEqual([]);
  });

  it("conecta com a impressão certa (com ou sem prefixo e '=') e recusa outra chave", async () => {
    const certa = impressaoDigitalDaChave(chaveDoServidor.atual);
    expect(normalizarImpressaoDigital(`${certa.slice(7)}=`)).toBe(certa);
    await expect(criarClienteSftp().conectar(config(certa))).resolves.toBeDefined();
    expect(conexoes.at(-1)?.hostVerifier).toBeTypeOf("function");

    const errada = impressaoDigitalDaChave(Buffer.from("outra-chave"));
    await expect(criarClienteSftp().conectar(config(errada))).rejects.toThrow(
      `A chave do servidor SFTP (${certa}) não confere`,
    );
  });
});

describe("montarConfiguracaoSftp", () => {
  it("leva a impressão digital dos parâmetros (ou do ambiente só com usar_env)", async () => {
    const { montarConfiguracaoSftp } = await import("./credenciais");
    const p = { host: "h", usuario: "u", impressao_digital: "SHA256:abc" };
    expect(montarConfiguracaoSftp({ ativo: true, parametros: p }, "s", {})).toMatchObject({
      impressaoDigital: "SHA256:abc",
    });
    const semNada = montarConfiguracaoSftp(
      { ativo: true, parametros: { host: "h", usuario: "u" } },
      "s",
      { SFTP_IMPRESSAO_DIGITAL: "SHA256:env" },
    );
    expect(semNada?.impressaoDigital).toBeNull();
    const comEnv = montarConfiguracaoSftp(
      { ativo: true, parametros: { host: "h", usuario: "u", usar_env: true } },
      "s",
      { SFTP_IMPRESSAO_DIGITAL: "SHA256:env" },
    );
    expect(comEnv?.impressaoDigital).toBe("SHA256:env");
  });
});
