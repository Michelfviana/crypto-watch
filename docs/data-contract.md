# Contrato dos dados

Fontes consultadas em 30/10/2026:

- [Binance: URLs exclusivas para dados públicos](https://github.com/binance/binance-spot-api-docs/blob/master/faqs/market_data_only.md).
- [Binance: API REST Spot](https://github.com/binance/binance-spot-api-docs/blob/master/rest-api.md).
- [Binance: streams WebSocket](https://github.com/binance/binance-spot-api-docs/blob/master/web-socket-streams.md).

A implementação usa `https://data-api.binance.vision/api/v3` e `wss://data-stream.binance.vision:443/stream`. São fontes de dados públicos sem autenticação. Nenhum endpoint de conta ou negociação é utilizado.

| Operação | Parâmetros | Campos utilizados |
| --- | --- | --- |
| `GET /ticker/24hr` | `symbols`: array JSON codificado na query | `symbol`, `lastPrice`, `priceChangePercent`, `quoteVolume`, `highPrice`, `lowPrice`, `priceChange` |
| `GET /ticker/price` | `symbol=USDTBRL` | `price` |
| `GET /depth` | `symbol=BTCUSDT`, `limit=5` | `asks` e `bids`: pares `[preço, quantidade]` |
| `GET /klines` | `symbol`, `interval`, `limit` | timestamp de abertura no índice 0 e fechamento no índice 4 |
| Stream combinado `@ticker` | símbolos em minúsculas separados por `/` | objeto `data`: `s`, `c`, `P`, `q`, `h`, `l`, `p` |

O histórico usa 24 barras de 1h, 42 barras de 4h ou 30 barras de 1d. A última barra pode ainda estar aberta. A interface mostra fechamentos em USDT e datas no fuso do navegador. Os minigráficos são amostras da sessão e não têm espaçamento temporal fixo.

## Falhas e concorrência

- Cada requisição tem timeout de 10 segundos e valida os campos utilizados antes de atualizar o estado.
- HTTP não exitoso e JSON inválido são tratados como falha; não geram dados fictícios.
- HTTP 429/418 bloqueia novas chamadas REST até o prazo de `Retry-After` em segundos, ou 60 segundos quando ausente.
- Há no máximo uma consulta simultânea por rotina de snapshot, câmbio ou livro de ofertas.
- Respostas antigas de histórico são canceladas e ignoradas por identificador de requisição. Cache por moeda/período de até 60 segundos.
- Uma resposta REST não substitui uma cotação que já está sendo atualizada por um stream ativo.
- Cada reconexão encerra a conexão anterior e ignora eventos dela. A espera cresce até 30 segundos, com pequena variação aleatória apenas no tempo de reconexão.
- Ao perder internet, o selo de dados ao vivo é retirado. Ao voltar, conexão e snapshots são retomados.
- O livro de ofertas é um snapshot periódico, não uma reconstrução incremental em tempo real.

## Evidência e limites

O catálogo Orbit confirmou os contratos de preço, klines e ofertas. Seu resultado não cobriu o ticker de 24 horas; esse contrato foi conferido na documentação oficial da Binance. Não foi necessário fornecer credenciais.

Os testes automatizados usam um servidor HTTP local e fixtures baseadas nesses formatos. Exercitam o cliente e os estados de interface reais; o transporte WebSocket é controlado pelo teste. Também foram realizadas consultas HTTP de leitura aos quatro endpoints públicos reais: ticker de 24 horas com array JSON compacto, cotação USDT/BRL, ofertas BTCUSDT e klines. Todos responderam HTTP 200 com os campos esperados. Isso não valida a acessibilidade regional, a política CORS no navegador ou a disponibilidade contínua dos serviços externos. O executável `postman` disponível neste ambiente corresponde ao aplicativo desktop, sem os comandos CLI de simulation; a verificação reproduzível utiliza Node.js e Chromium.
