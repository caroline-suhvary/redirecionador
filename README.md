# Smart Redirector (TypeScript + Express)

Encurtador de links e redirecionador com suporte a tags Open Graph personalizadas e métricas de origem.

## Como rodar o projeto

1. Instale as dependências:
   ```bash
   npm install
   ```

2. Inicie em modo de desenvolvimento:
   ```bash
   npm run dev
   ```

3. Teste o redirecionador no navegador:
   - `http://localhost:3000/grafana`
   - `http://localhost:3000/excel`
   - `http://localhost:3000/admin/stats` (para ver os cliques)

## Como testar fontes diferentes (UTM):
- No LinkedIn: `http://seusite.com/grafana?utm_source=linkedin`
- No Currículo PDF: `http://seusite.com/grafana?utm_source=curriculo_pdf`
- No site de vagas: `http://seusite.com/grafana?utm_source=gupy`

## Configurando novos links:
Basta editar o arquivo `links.json`.
