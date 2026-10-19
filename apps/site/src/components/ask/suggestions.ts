import { fetchFeeds, fetchProducts, topicLabel } from "../../lib/catalog";
import { useSiteLocation } from "../../lib/navigation";
import { useQuery } from "../../lib/query";

/** Questions anyone might start with, in both the languages the agent answers in. */
const GENERAL = [
  "Mapa dos postos de gasóleo mais baratos em Lisboa",
  "Was there an earthquake in Portugal this week?",
  "Chart Portugal's electricity consumption over the last week",
  "Há avisos meteorológicos do IPMA para o Porto?",
];

/** What the empty conversation offers: questions about the page that is open, when it shows one thing, then general ones. */
export interface Suggestions {
  /** What the page-specific questions are about, to say so above them. */
  about: string | undefined;
  questions: string[];
}

export function useSuggestions(): Suggestions {
  const { pathname, search } = useSiteLocation();
  const query = new URLSearchParams(search);
  const slug = pathname === "/product/" ? query.get("slug") : null;
  const publisher = pathname === "/publisher/" ? query.get("id") : null;
  const topic = pathname === "/catalog/" ? query.get("topic") : null;
  // The catalog is read only on a page that names something in it, and it is the one the pages share.
  const products = useQuery(slug ? "products" : null, fetchProducts);
  const feeds = useQuery(publisher ? "feeds" : null, fetchFeeds);

  if (slug) {
    const product = products.data?.find((each) => each.slug === slug);
    if (product) {
      const title = `“${product.title}”`;
      const located = product.schema.fields.some((field) => field.type === "geometry" || field.type === "latitude");
      const look =
        product.role === "time-series"
          ? `Chart ${title} over the last week`
          : product.role === "event-log"
            ? `What happened most recently in ${title}?`
            : located
              ? `Map the records of ${title}`
              : `Show the first rows of ${title} as a table`;
      return {
        about: product.title,
        questions: [`Summarise ${title}: what it holds, who publishes it and how fresh it is`, look, `What changed in ${title} lately?`, ...GENERAL.slice(1, 2)],
      };
    }
  }
  if (publisher) {
    const name = feeds.data?.find((feed) => feed.publisher.id === publisher)?.publisher.name;
    if (name) return { about: name, questions: [`What does ${name} publish, and how often is it updated?`, `Draw a chart from ${name}'s data`, ...GENERAL.slice(0, 2)] };
  }
  if (topic) {
    const label = topicLabel(topic);
    return {
      about: label,
      questions: [`Which ${label.toLocaleLowerCase()} datasets change most often?`, `Draw a map from a ${label.toLocaleLowerCase()} dataset`, ...GENERAL.slice(0, 2)],
    };
  }
  return { about: undefined, questions: GENERAL };
}
