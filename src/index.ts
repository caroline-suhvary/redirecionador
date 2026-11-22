import express, { Request, Response } from "express";
import path from "path";
import fs from "fs";
import { createClient } from "@supabase/supabase-js";

const app = express();
const PORT = process.env.PORT || 3000;

// Inicialização do Supabase para o Data Lake
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_KEY;
const supabase =
  supabaseUrl && supabaseKey ? createClient(supabaseUrl, supabaseKey) : null;

// Servir arquivos estáticos (imagens em public/)
app.use(express.static(path.join(__dirname, "../public")));

// Carregar links configurados
const linksPath = path.join(__dirname, "../links.json");
let links: Record<
  string,
  { targetUrl: string; title: string; description: string; imageUrl?: string }
> = {};

if (fs.existsSync(linksPath)) {
  links = JSON.parse(fs.readFileSync(linksPath, "utf-8"));
}

// Arquivo local para stats rápidos em memória/disco
const dataDir = path.join(__dirname, "../data");
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}
const statsFile = path.join(dataDir, "clicks.json");

interface ClickEvent {
  id: string;
  slug: string;
  targetUrl: string;
  timestamp: string;
  ip: string;
  referrer: string;
  utmSource: string;
  userAgent: string;
  isBot: boolean;
}

interface StatsData {
  totalClicksHumanos: number;
  totalCrawlers: number;
  detalhesPorLink: Record<
    string,
    { total: number; sources: Record<string, number> }
  >;
  ultimosCliques: ClickEvent[];
}

let stats: StatsData = {
  totalClicksHumanos: 0,
  totalCrawlers: 0,
  detalhesPorLink: {},
  ultimosCliques: [],
};

if (fs.existsSync(statsFile)) {
  try {
    stats = JSON.parse(fs.readFileSync(statsFile, "utf-8"));
  } catch (e) {
    console.error("Erro ao ler clicks.json local:", e);
  }
}

function salvarStatsLocal() {
  try {
    fs.writeFileSync(statsFile, JSON.stringify(stats, null, 2));
  } catch (e) {
    console.error("Erro ao salvar stats local:", e);
  }
}

// Grava o evento bruto no Data Lake (Supabase Storage)
async function salvarNoDataLake(evento: ClickEvent) {
  if (!supabase) {
    console.log(
      "[DataLake] Supabase não configurado nas variáveis de ambiente.",
    );
    return;
  }

  try {
    const data = new Date(evento.timestamp);
    const ano = data.getUTCFullYear();
    const mes = String(data.getUTCMonth() + 1).padStart(2, "0");
    const dia = String(data.getUTCDate()).padStart(2, "0");

    // Particionamento clássico de Data Lake
    const filePath = `raw/ano=${ano}/mes=${mes}/dia=${dia}/clique_${evento.id}.json`;
    const jsonString = JSON.stringify(evento, null, 2);

    const { error } = await supabase.storage
      .from("datalake-cliques")
      .upload(filePath, jsonString, {
        contentType: "application/json",
        upsert: true,
      });

    if (error) {
      console.error(
        `[DataLake Error] Falha ao gravar ${filePath}:`,
        error.message,
      );
    } else {
      console.log(`[DataLake] Evento salvo com sucesso em: ${filePath}`);
    }
  } catch (err) {
    console.error("[DataLake Error]:", err);
  }
}

function isCrawler(userAgent: string = ""): boolean {
  const bots = [
    "linkedinbot",
    "facebookexternalhit",
    "twitterbot",
    "whatsapp",
    "telegrambot",
    "slackbot",
    "skypeuripreview",
    "discordbot",
    "googlebot",
    "bingbot",
    "applebot",
  ];
  const ua = userAgent.toLowerCase();
  return bots.some((bot) => ua.includes(bot));
}

// Rota raiz
app.get("/", (_req: Request, res: Response) => {
  res.send("Smart Redirector está online.");
});

// Endpoint de métricas rápidas
app.get("/admin/stats", (_req: Request, res: Response) => {
  res.json(stats);
});

// Redirecionador por slug
app.get("/:slug", (req: Request, res: Response) => {
  const { slug } = req.params;
  const linkConfig = links[slug];

  if (!linkConfig) {
    res.status(404).send("Link não encontrado.");
    return;
  }

  const userAgent = req.headers["user-agent"] || "";
  const isBot = isCrawler(userAgent);
  const utmSource =
    (req.query.utm_source as string) || (req.query.src as string) || "direto";

  const evento: ClickEvent = {
    id: Math.random().toString(36).substring(2, 9),
    slug,
    targetUrl: linkConfig.targetUrl,
    timestamp: new Date().toISOString(),
    ip:
      (req.headers["x-forwarded-for"] as string) ||
      req.socket.remoteAddress ||
      "",
    referrer: (req.headers["referer"] as string) || "",
    utmSource,
    userAgent,
    isBot,
  };

  // Se for crawler de rede social
  if (isBot) {
    stats.totalCrawlers++;
    salvarStatsLocal();

    const host = req.headers["host"];
    const protocol = req.headers["x-forwarded-proto"] || "https";
    let fullImageUrl = linkConfig.imageUrl || "";
    if (fullImageUrl && fullImageUrl.startsWith("/")) {
      fullImageUrl = `${protocol}://${host}${fullImageUrl}`;
    }

    res.send(`<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8">
  <title>${linkConfig.title}</title>
  <meta property="og:title" content="${linkConfig.title}" />
  <meta property="og:description" content="${linkConfig.description}" />
  <meta property="og:image" content="${fullImageUrl}" />
  <meta property="og:url" content="${protocol}://${host}/${slug}" />
  <meta property="og:type" content="website" />
</head>
<body>
  <h1>${linkConfig.title}</h1>
  <p>${linkConfig.description}</p>
</body>
</html>`);
    return;
  }

  // Se for humano
  stats.totalClicksHumanos++;
  if (!stats.detalhesPorLink[slug]) {
    stats.detalhesPorLink[slug] = { total: 0, sources: {} };
  }
  stats.detalhesPorLink[slug].total++;
  stats.detalhesPorLink[slug].sources[utmSource] =
    (stats.detalhesPorLink[slug].sources[utmSource] || 0) + 1;
  stats.ultimosCliques.unshift(evento);
  if (stats.ultimosCliques.length > 50) {
    stats.ultimosCliques.pop();
  }
  salvarStatsLocal();

  // Envia assincronamente para o Data Lake no Supabase (não trava o redirecionamento!)
  salvarNoDataLake(evento);

  // Redireciona o visitante
  res.redirect(302, linkConfig.targetUrl);
});

app.listen(PORT, () => {
  console.log(`Servidor rodando na porta ${PORT}`);
});
