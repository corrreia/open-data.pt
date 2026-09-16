import { LayerCard, LinkButton } from "@cloudflare/kumo";
import { BugIcon, LightbulbIcon, PlusCircleIcon, StackIcon } from "@phosphor-icons/react";
import type { ReactNode } from "react";
import { PageHead, SectionHead } from "../components/common";
import { mountPage } from "../components/mount";
import { Shell } from "../components/Shell";
import { CONTRIBUTING, REPOSITORY, newIssue } from "../lib/project";

const LINK = "font-medium text-kumo-link hover:underline";

interface Way {
  id: string;
  icon: ReactNode;
  title: string;
  /** What it takes, in a few words. */
  needs: string;
  body: string;
  action: string;
  href: string;
}

const WAYS: Way[] = [
  {
    id: "suggest",
    icon: <LightbulbIcon size={22} />,
    title: "Suggest a source",
    needs: "No code",
    body: "A Portuguese institution or operator publishes data we do not collect yet. Say where it is and who publishes it.",
    action: "Suggest a source",
    href: newIssue("suggest-source"),
  },
  {
    id: "report",
    icon: <BugIcon size={22} />,
    title: "Report a broken source",
    needs: "No code",
    body: "A dataset stopped updating, came back empty, or disagrees with what its publisher shows. Every product page links here with its address filled in.",
    action: "Report a broken source",
    href: newIssue("broken-source"),
  },
  {
    id: "dataset",
    icon: <PlusCircleIcon size={22} />,
    title: "Add a dataset",
    needs: "One entry of TypeScript",
    body: "A dataset from a source we already read is one example entry: its slug, title, where it lives, how often to collect it, its licence and publisher. The platform installs it, collects it and gives it a page.",
    action: "How to add a dataset",
    href: `${CONTRIBUTING}#a-new-dataset-from-a-source-we-already-read`,
  },
  {
    id: "source",
    icon: <StackIcon size={22} />,
    title: "Add a source or a format",
    needs: "TypeScript, with tests",
    body: "A publisher with its own API gets a library under sources/; a standard we do not read yet gets one under formats/. Each comes with fixture tests built from saved responses.",
    action: "How to add a source",
    href: `${CONTRIBUTING}#a-new-bespoke-source`,
  },
];

function Contribute() {
  return (
    <Shell section="contribute">
      <PageHead eyebrow="Contribute" title="Help collect Portugal's public data">
        open-data.pt is open source. Anyone can suggest a source or report one that broke, and a new dataset from a source we already read is often a single entry of code.
      </PageHead>

      <section aria-labelledby="ways-title">
        <SectionHead eyebrow="Ways to help" title="Pick what fits" id="ways-title" />
        {/* Two by two: four cards never leave one alone on a row. */}
        <div className="grid grid-cols-[minmax(0,1fr)] gap-3 md:grid-cols-2">
          {WAYS.map((way) => (
            <LayerCard key={way.id} className="flex h-full flex-col">
              <LayerCard.Secondary className="flex flex-wrap items-center justify-between gap-2">
                <span className="flex items-center gap-2">
                  <span aria-hidden="true" className="text-kumo-brand">
                    {way.icon}
                  </span>
                  <span className="font-medium text-kumo-strong">{way.title}</span>
                </span>
                <span className="text-xs text-kumo-subtle">{way.needs}</span>
              </LayerCard.Secondary>
              <LayerCard.Primary className="grid flex-1 content-between gap-4">
                <p className="text-sm leading-relaxed text-kumo-default">{way.body}</p>
                <div>
                  <LinkButton href={way.href} variant="secondary">
                    {way.action}
                  </LinkButton>
                </div>
              </LayerCard.Primary>
            </LayerCard>
          ))}
        </div>
      </section>

      <section aria-labelledby="landing-title">
        <SectionHead eyebrow="Before a pull request" title="How changes land" id="landing-title" />
        <ol className="grid max-w-3xl list-decimal gap-3 pl-5 text-sm leading-relaxed text-kumo-default marker:text-kumo-subtle">
          <li>
            Read{" "}
            <a className={LINK} href={CONTRIBUTING}>
              CONTRIBUTING.md
            </a>
            : where code lives, and what a Worker may send.
          </li>
          <li>Run a new example against the real source, as CONTRIBUTING.md shows, so the pull request is known to collect.</li>
          <li>Run the checks: lint, types and tests. Unit tests use saved responses, never the network.</li>
          <li>The maintainer reviews and deploys. A pull request never needs secrets or access to Cloudflare.</li>
        </ol>
      </section>

      <section aria-labelledby="code-title">
        <SectionHead eyebrow="The code" title="One repository" id="code-title" />
        <p className="max-w-3xl text-sm leading-relaxed text-kumo-default">
          The topic Workers that collect, the kernel that stores and serves, and this site all live in{" "}
          <a className={LINK} href={REPOSITORY}>
            github.com/corrreia/open-data.pt
          </a>
          , under the{" "}
          <a className={LINK} href={`${REPOSITORY}/blob/main/LICENSE`}>
            MIT licence
          </a>
          . The data is not: it belongs to its publishers, under their licences, and open-data.pt republishes it.
        </p>
      </section>
    </Shell>
  );
}

mountPage(<Contribute />);
