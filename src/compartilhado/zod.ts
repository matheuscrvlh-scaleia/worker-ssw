import { z } from "zod";

// Mensagens de validação em português para todo o sistema (web, api e worker importam daqui).
z.config(z.locales.ptBR());

export { z };
