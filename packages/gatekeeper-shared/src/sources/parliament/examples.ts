import type { ExampleFeed } from "../../index";
import { parliamentDocument, type ParliamentFeed } from "./parliament";

export const PARLIAMENT_EXAMPLES: ExampleFeed[] = [
  example(
    "members",
    "parliament-members-xvii-feed",
    "Parliament XVII: published mandates and reference",
    "All mandates published in the XVII legislature file, including renounced and other source statuses, with constituencies, parliamentary groups and sessions. Not a list restricted to currently active MPs.",
    86_400,
  ),
  example(
    "careers",
    "parliament-professional-profiles-xvii-feed",
    "Parliament XVII: professional profiles",
    "Published professional qualifications, roles and works associated with the XVII legislature's biographical register. Excludes birth dates, sex, private contacts and identity-only profiles; not restricted to currently active MPs.",
    604_800,
  ),
  example(
    "petitions",
    "parliament-petitions-xvii-feed",
    "Parliament XVII: petitions",
    "Petition headlines, processing status, signature counts, source dates and committee metadata. Does not republish petition authors' personal submissions or nested documents.",
    86_400,
  ),
  example(
    "diplomas",
    "parliament-diplomas-xvii-feed",
    "Parliament XVII: approved legislation",
    "Approved legislation with official identifiers, titles, types, publication metadata and official text links. Publication dates are source dates, not collection times.",
    86_400,
  ),
  example(
    "activities",
    "parliament-activities-xvii-feed",
    "Parliament XVII: activities",
    "Hearings, audiences, debates, visits and events published for the XVII legislature, as separate nonduplicated tables from one document. Source dates are preserved; activity documents and personal submissions are not copied.",
    86_400,
  ),
  example(
    "committees",
    "parliament-committees-xvii-feed",
    "Parliament XVII: committees, membership and meetings",
    "Reference, membership histories and meeting metadata from the XVII legislature's Comissoes section. Other parliamentary bodies are outside this scope. Membership histories are not claims that every listed member currently holds the role.",
    86_400,
  ),
];

function example(feed: ParliamentFeed, slug: string, title: string, description: string, cadenceSeconds: number): ExampleFeed {
  const config = { source: "parliament", feed, legislature: "XVII" };
  const document = parliamentDocument({ feed, legislature: "XVII" });
  return {
    slug,
    title,
    description,
    config,
    publisher: "Assembleia da República",
    topics: ["government", "parliament"],
    policy: {
      name: `Parliament ${feed}: ${cadenceSeconds === 604_800 ? "weekly professional reference" : "daily public record updates"}`,
      version: 1,
      collection: { cadenceSeconds, timeoutSeconds: 180, maxBytes: document.sourceBytes, maxOutputBytes: 8 * 1024 * 1024, maxRecords: 50_000, historyMode: "changes" },
      serving: { licence: "Parliament source reuse terms apply", attribution: "Assembleia da República — Dados Abertos" },
    },
    staleAfterSeconds: cadenceSeconds * 3,
  };
}
