import "@fontsource-variable/space-grotesk";
import "@fontsource-variable/jetbrains-mono";

/**
 * The credits page's list of sources. What each product is called, who it is attributed to and under
 * what licence are read from open-data.pt as the page opens, so they are never out of step with it.
 */

const API = "https://open-data.pt/api/products";

/** Every product the site draws from, with what it is used for. One the catalog does not carry yet is left out. */
const USES: [product: string, use: string][] = [
  ["dgt-caop-trocos", "A linha de costa, a fronteira e os limites de distrito."],
  ["dgt-rgn-vertices-geodesicos", "Altitudes para o relevo."],
  ["dgt-serras-cumes-principais", "Altitudes dos cumes para o relevo."],
  ["ipma-stations-latest", "Temperatura, humidade, chuva e vento em cada estação."],
  ["ipma-warnings", "Os avisos meteorológicos em vigor em cada distrito."],
  ["dgt-caop-distritos", "O centro de cada distrito, onde os avisos são desenhados."],
  ["ipma-lightning-discharges", "As descargas elétricas das últimas 24 horas."],
  ["ipma-earthquakes", "Os sismos dos últimos sete dias."],
  ["anepc-active-occurrences", "As ocorrências que a proteção civil tem em curso, com os meios empenhados."],
  ["nasa-firms-mainland-thermal-anomalies", "Os focos de calor vistos por satélite nas últimas 24 horas."],
  ["eumetsat-mtg-active-fires", "Os fogos ativos detetados pelo satélite geoestacionário."],
  ["infoagua-flood-alerts", "As estações com alerta de cheia."],
  ["infoagua-reservoirs", "Onde fica cada albufeira e quanto pode guardar."],
  ["snirh-reservoir-storage", "O volume guardado em cada albufeira na última leitura."],
  ["apa-river-water-bodies", "O traçado dos rios."],
  ["apa-public-lagoons", "O contorno das lagoas."],
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
