import "@fontsource-variable/archivo/wdth.css";

/**
 * The credits page's list of sources. What each product is called, who it is attributed to and under
 * what licence are read from open-data.pt as the page opens, so they are never out of step with it.
 */

const API = "https://open-data.pt/api/products";

/** Every product the site draws from, with what it is used for. One the catalog does not carry yet is left out. */
const USES: [product: string, use: string][] = [
  ["ipma-forecast-daily", "A previsão para três dias nas capitais de distrito e nas ilhas."],
  ["ipma-warnings", "Os avisos meteorológicos."],
  ["ipma-stations-latest", "A última leitura de cada estação."],
  ["ipma-observations", "O último dia de cada estação, hora a hora."],
  ["ipma-sea-forecast", "A previsão do estado do mar."],
  ["ipma-shellfish-restrictions", "As zonas de apanha de bivalves e as espécies interditas."],
  ["ipma-uv-index", "A previsão do índice ultravioleta."],
  ["ipma-fire-risk", "O perigo de incêndio rural por concelho."],
  ["ipma-earthquakes", "Os sismos dos últimos trinta dias."],
  ["ipma-lightning-discharges", "As descargas elétricas localizadas."],
  ["ipma-lightning-hourly", "As descargas por hora."],
  ["ipma-municipal-temperature", "A temperatura diária por concelho."],
  ["ipma-municipal-precipitation", "A chuva diária por concelho."],
  ["dgt-caop-trocos", "A linha de costa, a fronteira e os limites de distrito do mapa."],
  ["dgt-rgn-vertices-geodesicos", "Altitudes para o relevo do mapa."],
  ["dgt-serras-cumes-principais", "Altitudes dos cumes para o relevo do mapa."],
  ["dgt-caop-distritos", "O centro de cada distrito, onde os avisos são marcados."],
  ["dgt-caop-municipios", "O nome e o centro de cada concelho."],
  ["apa-river-water-bodies", "O traçado dos rios no mapa."],
  ["apa-public-lagoons", "O contorno das lagoas no mapa."],
];

interface Product {
  slug: string;
  title: string;
  attribution: string;
  licence: { name: string; url?: string };
}

function link(href: string, text: string): HTMLAnchorElement {
  return Object.assign(document.createElement("a"), { href, textContent: text });
}

function line(...parts: (string | Node)[]): HTMLSpanElement {
  const span = document.createElement("span");
  span.append(...parts);
  return span;
}

async function list(): Promise<void> {
  const target = document.getElementById("sources");
  if (target === null) return;
  const items = await Promise.all(
    USES.map(async ([slug, use]) => {
      const answer = await fetch(`${API}/${slug}`);
      if (!answer.ok) return undefined;
      // SAFETY: open-data.pt's product answer, of which these are the fields read.
      const product = (await answer.json()) as Product;
      const item = document.createElement("li");
      const name = document.createElement("b");
      name.append(link(`https://open-data.pt/product/?slug=${product.slug}`, product.title));
      const licence = product.licence.url === undefined ? product.licence.name : link(product.licence.url, product.licence.name);
      item.append(name, line(product.attribution), line("Licença: ", licence), line(use));
      return item;
    }),
  );
  target.replaceChildren(...items.filter((item) => item !== undefined));
}

list().catch(() => {
  const target = document.getElementById("sources");
  if (target !== null) target.textContent = "Não foi possível ler as fontes em open-data.pt. A lista está em open-data.pt/catalog/.";
});
