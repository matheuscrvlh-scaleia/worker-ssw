/**
 * Sessão real no SSW web: Chromium (Playwright) seguindo as telas como um operador. Os seletores,
 * as esperas e as repetições são os do script que rodou em produção; cada um responde a um
 * comportamento medido do SSW (comentado onde está). Sem teste automático: depende do SSW de
 * verdade. A ordem e o tratamento de falha ficam em `rodada.ts`, que é testada com falso.
 * origem: ssw_download.py do ssw-download (login, abrir_opcao, rel_*, disparar_*, *_fila)
 */
import { readFile } from "node:fs/promises";

import { type Logger } from "pino";
import { type BrowserContext, chromium, type Download, type Page } from "playwright-core";

import { type ConfiguracaoSswWeb } from "./parametros";
import { type NavegadorSswWeb, type SessaoSswWeb } from "./rodada";

const ESPERA_DOWNLOAD_MS = 90_000;
/** Espera máxima pelos relatórios na fila da 156 e o intervalo entre as olhadas. */
const PRAZO_DA_FILA_MS = 300_000;
const INTERVALO_DA_FILA_MS = 5_000;
/** 455 em Excel (128 colunas) com os complementares B (ocorrências) e C (comprovantes). */
const TIPO_455 = "E";
const COMPLEMENTARES_455 = ["B", "C"];

async function bytesDo(download: Download): Promise<Uint8Array> {
  return new Uint8Array(await readFile(await download.path()));
}

/** Clica e espera o download que o clique dispara. */
async function baixarAoClicar(page: Page, seletor: string): Promise<Uint8Array> {
  const [download] = await Promise.all([
    page.waitForEvent("download", { timeout: ESPERA_DOWNLOAD_MS }),
    page.click(seletor),
  ]);
  return bytesDo(download);
}

/**
 * Digita, confere se colou certo e tenta de novo. `instantaneo` cola de uma vez: campo que enche
 * até o maxlength (Unidade, 3 letras) dispara o auto-avanço de foco do SSW no último caractere e
 * embaralha a digitação ("MTZ" vira "ZMT").
 */
async function preencher(
  page: Page,
  seletor: string,
  valor: string,
  opcoes: { sensivel?: boolean; instantaneo?: boolean } = {},
): Promise<void> {
  const campo = page.locator(seletor);
  for (let tentativa = 1; tentativa <= 3; tentativa++) {
    await campo.click();
    await campo.fill("");
    if (opcoes.instantaneo) await campo.fill(valor);
    else await campo.pressSequentially(valor, { delay: 120 });
    if ((await campo.inputValue()) === valor) return;
  }
  throw new Error(
    opcoes.sensivel
      ? `não consegui preencher ${seletor} (valor oculto)`
      : `não consegui preencher ${seletor} com '${valor}'`,
  );
}

/**
 * O #errorpanel do SSW é um overlay que às vezes reaparece por cima da tela e engole os cliques:
 * uma opção que falha derruba as seguintes. Some com ele se estiver no meio.
 */
async function afastarErrorpanel(page: Page): Promise<void> {
  // Texto e não função: o tsconfig não carrega os tipos do DOM (o código roda no navegador).
  const script = `(() => {
    const el = document.getElementById("errorpanel");
    if (el && getComputedStyle(el).visibility !== "hidden") {
      el.style.visibility = "hidden";
      el.style.pointerEvents = "none";
    }
  })()`;
  await page.evaluate(script).catch(() => undefined);
}

class SessaoChromium implements SessaoSswWeb {
  constructor(
    private readonly context: BrowserContext,
    private readonly menu: Page,
    private readonly config: ConfiguracaoSswWeb,
    private readonly log: Logger,
    private readonly encerrar: () => Promise<void>,
  ) {}

  /**
   * Unidade + opção no menu: o último dígito da opção dispara a janela nova (o onchange só roda
   * quando o SSW tira o foco ao encher o maxlength). Quando o auto-avanço não roda (página
   * assentando, overlay no caminho), nada abre: recarrega o menu, que preserva a sessão.
   */
  private async abrirOpcao(unidade: string, opcao: string): Promise<Page> {
    for (let tentativa = 1; ; tentativa++) {
      try {
        await afastarErrorpanel(this.menu);
        await preencher(this.menu, '[name="f2"]', unidade, { instantaneo: true });
        const campo = this.menu.locator('[name="f3"]');
        await campo.click();
        await campo.fill(opcao.slice(0, -1));
        const atual = await campo.inputValue();
        if (atual !== opcao.slice(0, -1)) {
          throw new Error(`campo opção ficou '${atual}', esperado '${opcao.slice(0, -1)}'`);
        }
        const [page] = await Promise.all([
          this.context.waitForEvent("page", { timeout: 30_000 }),
          campo.press(opcao.slice(-1)),
        ]);
        await page.waitForLoadState();
        await page.waitForTimeout(800); // scripts de foco/onload do SSW assentarem
        return page;
      } catch (erro) {
        if (tentativa === 3) throw erro;
        this.log.warn({ opcao, tentativa }, "opção do SSW não abriu, recarregando o menu");
        await this.menu.reload({ waitUntil: "load" });
        await this.menu.waitForTimeout(1_500);
      }
    }
  }

  private async naOpcao<T>(unidade: string, opcao: string, fn: (p: Page) => Promise<T>) {
    const page = await this.abrirOpcao(unidade, opcao);
    try {
      return await fn(page);
    } finally {
      if (!page.isClosed()) await page.close().catch(() => undefined);
    }
  }

  async marcaDaFila(): Promise<number> {
    return this.naOpcao(this.config.matriz, "156", async (page) => {
      const linhas = await page.locator("tr[seq]").all();
      const seqs = await Promise.all(
        linhas.map(async (tr) => Number(await tr.getAttribute("seq"))),
      );
      return seqs.length > 0 ? Math.max(...seqs) : 0;
    });
  }

  async dispararNaFila(opcao: "455" | "930", dia: string): Promise<void> {
    await this.naOpcao(this.config.matriz, opcao, async (page) => {
      if (opcao === "455") {
        await preencher(page, '[name="f11"]', dia); // período de autorização
        await preencher(page, '[name="f12"]', dia);
        await preencher(page, '[name="f35"]', TIPO_455);
        // f38/f39 só ficam editáveis depois que o campo anterior recebe a letra
        for (const [i, letra] of COMPLEMENTARES_455.entries()) {
          await preencher(page, `[name="f${37 + i}"]`, letra, { instantaneo: true });
        }
        await page.click('a[id="40"]');
      } else {
        await preencher(page, '[name="f1"]', dia); // data de ocorrência
        await preencher(page, '[name="f2"]', dia);
        await page.click('a[id="10"]');
      }
      await page.waitForSelector("text=processamento", { timeout: 60_000 });
    });
  }

  async coletarDaFila(marca: number, opcoes: readonly string[]): Promise<Map<string, Uint8Array>> {
    return this.naOpcao(this.config.matriz, "156", async (page) => {
      const prontos = new Map<string, Uint8Array>();
      const limite = Date.now() + PRAZO_DA_FILA_MS;
      while (prontos.size < opcoes.length && Date.now() < limite) {
        let baixou = false;
        for (const tr of await page.locator("tr[seq]").all()) {
          if (Number(await tr.getAttribute("seq")) <= marca) continue;
          const tds = tr.locator("td");
          if ((await tds.count()) < 8) continue;
          const opcao = (await tds.nth(1).innerText()).trim();
          const usuario = (await tds.nth(3).innerText()).trim();
          const situacao = (await tds.nth(6).innerText()).trim().toLowerCase();
          const link = tr.locator("td:last-child a");
          if (usuario.toLowerCase() !== this.config.usuario.toLowerCase()) continue;
          if (!situacao.startsWith("conclu") || (await link.count()) === 0) continue;
          const codigo = opcoes.find((o) => opcao.startsWith(o) && !prontos.has(o));
          if (codigo === undefined) continue;
          const [download] = await Promise.all([
            page.waitForEvent("download", { timeout: ESPERA_DOWNLOAD_MS }),
            link.first().click(),
          ]);
          prontos.set(codigo, await bytesDo(download));
          baixou = true;
          break; // as linhas mudam depois do clique: relê a tabela
        }
        if (!baixou && prontos.size < opcoes.length) {
          await page.waitForTimeout(INTERVALO_DA_FILA_MS);
          await page.reload();
        }
      }
      return prontos;
    });
  }

  /**
   * Excel = S abre um popup de unidades: clica fora para fechar antes de mexer no período (um
   * Escape às vezes fecha a janela inteira). Três tentativas, como no script.
   */
  async baixar036(dia: string): Promise<Uint8Array> {
    for (let tentativa = 1; ; tentativa++) {
      try {
        return await this.naOpcao(this.config.matriz, "036", async (page) => {
          await preencher(page, "#t_excel", "S");
          await page.waitForTimeout(400);
          await page.locator("body").click({ position: { x: 5, y: 5 } });
          await page.waitForTimeout(200);
          await preencher(page, "#t_dt_ini", dia);
          await preencher(page, "#t_dt_fin", dia);
          return baixarAoClicar(page, "#btn_env_periodo");
        });
      } catch (erro) {
        if (tentativa === 3) throw erro;
        this.log.warn({ tentativa }, "036 falhou, tentando de novo");
      }
    }
  }

  async baixar306(dia: string): Promise<Uint8Array> {
    return this.naOpcao(this.config.matriz, "306", async (page) => {
      await preencher(page, "#t_data_busca", dia);
      await preencher(page, "#t_data_busca2", dia);
      return baixarAoClicar(page, 'a[id="4"]'); // link "Excel"
    });
  }

  async baixar038(unidade: string): Promise<Uint8Array> {
    return this.naOpcao(unidade, "038", (page) => baixarAoClicar(page, 'a[id="17"]')); // "Excel"
  }

  /**
   * Coleta é cadastrada por filial (em MTZ volta vazio): o f2 da tela é que filtra. Cadastradas no
   * dia = f4..f5; coletadas no dia = também f6..f7 (com o período de coleta preenchido o SSW
   * ignora o de cadastramento). Sem movimento, o SSW não baixa nada: a mensagem encerra a espera.
   */
  async texto050(
    unidade: string,
    dia: string,
    busca: "cadastradas" | "coletadas",
  ): Promise<string> {
    return this.naOpcao(this.config.matriz, "050", async (page) => {
      const vindos: Download[] = [];
      page.on("download", (d) => vindos.push(d));
      const campos = busca === "cadastradas" ? ["f4", "f5"] : ["f4", "f5", "f6", "f7"];
      for (const campo of campos) await preencher(page, `[name="${campo}"]`, dia);
      await preencher(page, '[name="f2"]', unidade, { instantaneo: true });
      await page.click('a[id="21"]');
      const limite = Date.now() + ESPERA_DOWNLOAD_MS;
      while (Date.now() < limite) {
        const [download] = vindos;
        if (download) return new TextDecoder("iso-8859-1").decode(await bytesDo(download));
        if ((await page.getByText("Sem movimento de coletas").count()) > 0) return "";
        await page.waitForTimeout(500);
      }
      throw new Error(`050/${unidade}: nem download nem "Sem movimento" em 90 s`);
    });
  }

  fechar(): Promise<void> {
    return this.encerrar();
  }
}

/**
 * `endereco`: base do SSW web, sem barra no fim (`SSW_WEB_URL`). `proxy`: saída do Chromium por
 * outro IP (`SSW_WEB_PROXY`), ou `null` para conexão direta.
 */
export function criarNavegadorSswWeb(
  log: Logger,
  endereco: string,
  proxy: string | null,
): NavegadorSswWeb {
  return {
    async entrar(config) {
      const navegador = await chromium.launch({
        headless: true,
        ...(proxy ? { proxy: { server: proxy } } : {}),
      });
      const encerrar = () => navegador.close();
      try {
        // O endereço provisório do SSW (tms) responde 403 a "HeadlessChrome" no user-agent.
        const userAgent = `Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${navegador.version()} Safari/537.36`;
        const context = await navegador.newContext({ acceptDownloads: true, userAgent });
        const menu = await context.newPage();
        await menu.goto(`${endereco}/bin/ssw0422`, { waitUntil: "networkidle" });
        await preencher(menu, '[name="f1"]', config.dominio);
        await preencher(menu, '[name="f2"]', config.cpf, { sensivel: true });
        await preencher(menu, '[name="f3"]', config.usuario);
        await preencher(menu, '[name="f4"]', config.senha, { sensivel: true });
        await menu.click('a[id="5"]');
        await menu
          .waitForSelector('[name="menu01"]', { state: "attached", timeout: 30_000 })
          .catch(() => {
            throw new Error("login no SSW web recusado ou sem resposta");
          });
        // O menu chega em "interactive": o JS que move o foco (e abre as opções) ainda não ligou.
        await menu.waitForLoadState("load");
        return new SessaoChromium(context, menu, config, log, encerrar);
      } catch (erro) {
        await encerrar().catch(() => undefined);
        throw erro;
      }
    },
  };
}
