import express, { Request, Response } from "express";
import fs from "fs";
import path from "path";
import dotenv from "dotenv";
import { LinkConfig, ClickRecord } from "./types";

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;
const DATA_DIR = path.join(__dirname, "..", "data");
const CLICKS_FILE = path.join(DATA_DIR, "clicks.json");
const LINKS_FILE = path.join(__dirname, "..", "links.json");
const PUBLIC_DIR = path.join(__dirname, "..", "public");

// Confia no proxy reverso do Render para pegar HTTPS correto
app.set("trust proxy", 1);

// Serve arquivos estáticos da pasta public (ex: /images/grafana.png)
app.use(express.static(PUBLIC_DIR));

// Garante que a pasta de dados exista
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}
if (!fs.existsSync(CLICKS_FILE)) {
  fs.writeFileSync(CLICKS_FILE, JSON.stringify([], null, 2), "utf-8");
}

// Carrega os links cadastrados
function loadLinks(): Record<string, LinkConfig> {
  try {
    const raw = fs.readFileSync(LINKS_FILE, "utf-8");
    return JSON.parse(raw);
  } catch (error) {
    console.error("Erro ao ler links.json:", error);
    return {};
  }
}

// Salva registro de clique para métricas
function logClick(record: ClickRecord): void {
  try {
    const data = JSON.parse(fs.readFileSync(CLICKS_FILE, "utf-8"));
    data.push(record);
    fs.writeFileSync(CLICKS_FILE, JSON.stringify(data, null, 2), "utf-8");
  } catch (error) {
    console.error("Erro ao registrar clique:", error);
  }
}

// Identifica se a requisição veio de um crawler de rede social
function isSocialBot(userAgent: string): boolean {
  const botsPattern =
    /linkedinbot|facebookexternalhit|facebot|twitterbot|slackbot|whatsapp|telegrambot|discordbot|embedly|quora link preview|pinterest/i;
  return botsPattern.test(userAgent);
}

// Converte caminho local de imagem (/images/...) em URL pública completa para o LinkedIn
function resolveImageUrl(
  imageUrl: string | undefined,
  baseUrl: string,
): string | null {
  if (!imageUrl) return null;
  if (imageUrl.startsWith("http://") || imageUrl.startsWith("https://")) {
    return imageUrl;
  }
  const cleanPath = imageUrl.startsWith("/") ? imageUrl : `/${imageUrl}`;
  return `${baseUrl}${cleanPath}`;
}

// Gera o HTML com Open Graph para crawlers
function generateOgHtml(
  link: LinkConfig,
  currentUrl: string,
  baseUrl: string,
): string {
  const absoluteImageUrl = resolveImageUrl(link.imageUrl, baseUrl);
  const imageTags = absoluteImageUrl
    ? `
  <meta property="og:image" content="${absoluteImageUrl}">
  <meta property="og:image:alt" content="${link.title}">
  <meta name="twitter:image" content="${absoluteImageUrl}">`
    : "";

  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="utf-8">
  <title>${link.title}</title>
  <meta name="description" content="${link.description}">
  
  <!-- Open Graph / LinkedIn -->
  <meta property="og:type" content="website">
  <meta property="og:url" content="${currentUrl}">
  <meta property="og:title" content="${link.title}">
  <meta property="og:description" content="${link.description}">
  ${imageTags}

  <!-- Twitter Card -->
  <meta name="twitter:card" content="summary_large_image">
  <meta name="twitter:url" content="${currentUrl}">
  <meta name="twitter:title" content="${link.title}">
  <meta name="twitter:description" content="${link.description}">

  <!-- Redirecionamento reserva -->
  <meta http-equiv="refresh" content="0;url=${link.targetUrl}">
</head>
<body>
  <p>Redirecionando para <a href="${link.targetUrl}">${link.title}</a>...</p>
</body>
</html>`;
}

// Rota raiz: status simples
app.get("/", (_req: Request, res: Response) => {
  res.type("text/plain").send("Smart Redirector está online.");
});

// Rota de métricas
app.get("/admin/stats", (_req: Request, res: Response) => {
  try {
    const clicks: ClickRecord[] = JSON.parse(
      fs.readFileSync(CLICKS_FILE, "utf-8"),
    );
    const summary: Record<
      string,
      { total: number; sources: Record<string, number> }
    > = {};

    clicks.forEach((c) => {
      if (c.isBot) return;
      if (!summary[c.slug]) {
        summary[c.slug] = { total: 0, sources: {} };
      }
      summary[c.slug].total += 1;

      const source =
        c.utmSource ||
        (c.referrer ? new URL(c.referrer).hostname : "direto/desconhecido");
      summary[c.slug].sources[source] =
        (summary[c.slug].sources[source] || 0) + 1;
    });

    res.json({
      totalClicksHumanos: clicks.filter((c) => !c.isBot).length,
      totalCrawlers: clicks.filter((c) => c.isBot).length,
      detalhesPorLink: summary,
      ultimosCliques: clicks.slice(-20).reverse(),
    });
  } catch (err) {
    res.status(500).json({ error: "Erro ao compilar estatísticas" });
  }
});

// Rota de redirecionamento dinâmico
app.get("/:slug", (req: Request, res: Response) => {
  const { slug } = req.params;
  const links = loadLinks();
  const link = links[slug];

  if (!link) {
    return res
      .status(404)
      .type("text/plain")
      .send(`Link "${slug}" não encontrado.`);
  }

  const userAgent = req.headers["user-agent"] || "";
  const isBot = isSocialBot(userAgent);
  const referrer = (req.headers["referer"] ||
    req.headers["referrer"] ||
    "") as string;
  const utmSource = (req.query.utm_source as string) || undefined;
  const utmMedium = (req.query.utm_medium as string) || undefined;
  const utmCampaign = (req.query.utm_campaign as string) || undefined;

  const protocol = req.headers["x-forwarded-proto"] || req.protocol;
  const baseUrl = `${protocol}://${req.get("host")}`;
  const currentUrl = `${baseUrl}${req.originalUrl}`;

  // Grava métrica
  logClick({
    id: Math.random().toString(36).substring(2, 9),
    slug,
    targetUrl: link.targetUrl,
    timestamp: new Date().toISOString(),
    ip:
      (req.headers["x-forwarded-for"] as string) ||
      req.socket.remoteAddress ||
      "",
    referrer,
    utmSource,
    utmMedium,
    utmCampaign,
    userAgent,
    isBot,
  });

  // Robôs de redes sociais recebem as tags Open Graph
  if (isBot) {
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    return res.send(generateOgHtml(link, currentUrl, baseUrl));
  }

  // Visitantes reais são redirecionados direto
  return res.redirect(302, link.targetUrl);
});

app.listen(PORT, () => {
  console.log(`[Smart Redirector] Rodando em http://localhost:${PORT}`);
  console.log(`[Estatísticas] Acesse http://localhost:${PORT}/admin/stats`);
});
