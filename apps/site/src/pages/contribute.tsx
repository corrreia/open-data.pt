import { LayerCard, LinkButton } from "@cloudflare/kumo";
import { BugIcon, LightbulbIcon, PlusCircleIcon, StackIcon } from "@phosphor-icons/react";
import type { ReactNode } from "react";
import { PageHead, SectionHead, bodyRows, cardRows } from "../components/common";
import { mountPage } from "../components/mount";
import { Shell } from "../components/Shell";
import { CONTRIBUTING, REPOSITORY, newIssue } from "../lib/project";
import { CONTRIBUTE, type WayText } from "../text/contribute";

const LINK = "font-medium text-kumo-link hover:underline";

interface Way {
  id: string;
  icon: ReactNode;
  text: WayText;
  href: string;
}

const WAYS: Way[] = [
  { id: "suggest", icon: <LightbulbIcon size={22} />, text: CONTRIBUTE.ways.suggest, href: newIssue("suggest-source") },
  { id: "report", icon: <BugIcon size={22} />, text: CONTRIBUTE.ways.report, href: newIssue("broken-source") },
  { id: "dataset", icon: <PlusCircleIcon size={22} />, text: CONTRIBUTE.ways.dataset, href: `${CONTRIBUTING}#a-new-feed-from-a-source-we-already-read` },
  { id: "source", icon: <StackIcon size={22} />, text: CONTRIBUTE.ways.source, href: `${CONTRIBUTING}#a-new-bespoke-source` },
];

function Contribute() {
  return (
    <Shell section="contribute">
      <PageHead eyebrow={CONTRIBUTE.eyebrow} title={CONTRIBUTE.title}>
        {CONTRIBUTE.intro}
      </PageHead>

      <section aria-labelledby="ways-title">
        <SectionHead eyebrow={CONTRIBUTE.waysEyebrow} title={CONTRIBUTE.waysTitle} id="ways-title" />
        {/* Two by two: four cards never leave one alone on a row. */}
        <div className="grid grid-cols-[minmax(0,1fr)] gap-3 md:grid-cols-2">
          {WAYS.map((way) => (
            <LayerCard key={way.id} className={cardRows(3)}>
              <LayerCard.Secondary className="flex flex-wrap items-center justify-between gap-2">
                <span className="flex items-center gap-2">
                  <span aria-hidden="true" className="text-kumo-brand">
                    {way.icon}
                  </span>
                  <span className="font-medium text-kumo-strong">{way.text.title}</span>
                </span>
                <span className="text-xs text-kumo-subtle">{way.text.needs}</span>
              </LayerCard.Secondary>
              <LayerCard.Primary className={`gap-4 ${bodyRows(2)}`}>
                <p className="text-sm leading-relaxed text-kumo-default">{way.text.body}</p>
                <div>
                  <LinkButton href={way.href} variant="secondary">
                    {way.text.action}
                  </LinkButton>
                </div>
              </LayerCard.Primary>
            </LayerCard>
          ))}
        </div>
      </section>

      <section aria-labelledby="landing-title">
        <SectionHead eyebrow={CONTRIBUTE.landingEyebrow} title={CONTRIBUTE.landingTitle} id="landing-title" />
        <ol className="grid max-w-[34rem] list-decimal gap-3 pl-5 text-sm leading-relaxed text-kumo-default marker:text-kumo-subtle">
          <li>
            {CONTRIBUTE.readContributing(
              <a className={LINK} href={CONTRIBUTING}>
                CONTRIBUTING.md
              </a>,
            )}
          </li>
          {CONTRIBUTE.steps.map((step) => (
            <li key={step}>{step}</li>
          ))}
        </ol>
      </section>

      <section aria-labelledby="code-title">
        <SectionHead eyebrow={CONTRIBUTE.codeEyebrow} title={CONTRIBUTE.codeTitle} id="code-title" />
        <p className="max-w-[34rem] text-sm leading-relaxed text-kumo-default">
          {CONTRIBUTE.code(
            <a className={LINK} href={REPOSITORY}>
              github.com/corrreia/open-data.pt
            </a>,
            (text) => (
              <a className={LINK} href={`${REPOSITORY}/blob/main/LICENSE`}>
                {text}
              </a>
            ),
          )}
        </p>
      </section>
    </Shell>
  );
}

mountPage(<Contribute />);
