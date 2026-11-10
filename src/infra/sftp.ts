/** Cliente SFTP (ssh2-sftp-client) atrás da porta `ClienteSftp`. */
import { createHash } from "node:crypto";

import SftpClient from "ssh2-sftp-client";

import { type ClienteSftp, type ConexaoSftp } from "../aplicacao/casos-de-uso/portas";

const TEMPO_DE_CONEXAO_MS = 15_000;

/** `SHA256:<base64 sem =>` da chave pública do servidor, igual ao `ssh-keygen -lf`. */
export function impressaoDigitalDaChave(chave: Buffer): string {
  return `SHA256:${createHash("sha256").update(chave).digest("base64").replace(/=+$/, "")}`;
}

/** Aceita com ou sem o prefixo `SHA256:` e com o `=` final do base64. */
export function normalizarImpressaoDigital(texto: string): string {
  const corpo = texto
    .trim()
    .replace(/^SHA256:/i, "")
    .replace(/=+$/, "");
  return `SHA256:${corpo}`;
}

const semImpressao = () =>
  new Error(
    'Impressão digital do servidor SFTP não cadastrada: em Plataforma → Empresa → Integrações → SFTP, preencha "Impressão digital do servidor" (SHA256:…) antes de conectar.',
  );

export function criarClienteSftp(): ClienteSftp {
  return {
    async conectar(c): Promise<ConexaoSftp> {
      // Falha fechada: sem impressão cadastrada não se conecta (nem se manda a senha).
      if (!c.impressaoDigital) throw semImpressao();
      const esperada = normalizarImpressaoDigital(c.impressaoDigital);
      // Preenchida pelo hostVerifier durante o handshake.
      const visto: { chave: string | null } = { chave: null };
      const sftp = new SftpClient();
      try {
        await sftp.connect({
          host: c.host,
          port: c.porta,
          username: c.usuario,
          password: c.senha,
          readyTimeout: TEMPO_DE_CONEXAO_MS,
          hostVerifier: (chave: Buffer) => {
            visto.chave = impressaoDigitalDaChave(chave);
            return visto.chave === esperada;
          },
        });
      } catch (erro) {
        if (visto.chave !== null && visto.chave !== esperada) {
          throw new Error(
            `A chave do servidor SFTP (${visto.chave}) não confere com a impressão digital cadastrada. Se o provedor trocou a chave, confira com ele e cadastre a nova.`,
          );
        }
        throw erro;
      }
      return {
        existe: async (caminho) => (await sftp.exists(caminho)) !== false,
        async listar(pasta) {
          return (await sftp.list(pasta)).map((e) => ({
            nome: e.name,
            tamanho: e.size,
            mtime: e.modifyTime,
            tipo: e.type === "-" ? "arquivo" : e.type === "d" ? "pasta" : "outro",
          }));
        },
        async baixar(caminho) {
          const dados = await sftp.get(caminho);
          if (!Buffer.isBuffer(dados)) throw new Error(`Download inesperado de ${caminho}`);
          return new Uint8Array(dados);
        },
        async enviar(bytes, caminho) {
          await sftp.put(Buffer.from(bytes), caminho);
        },
        async renomear(de, para) {
          await sftp.rename(de, para);
        },
        async apagar(caminho) {
          await sftp.delete(caminho);
        },
        async criarPasta(caminho) {
          await sftp.mkdir(caminho, true);
        },
        async apagarPasta(caminho) {
          await sftp.rmdir(caminho, true);
        },
        async encerrar() {
          await sftp.end();
        },
      };
    },
  };
}
