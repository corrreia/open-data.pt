import { LayerCard } from "@cloudflare/kumo";
import type { ReactNode } from "react";
import { PageHead, SectionHead } from "../components/common";
import { mountPage } from "../components/mount";
import { Shell } from "../components/Shell";
import { CONTACT_EMAIL, REPOSITORY, newIssue } from "../lib/project";
import { AUP } from "../text/aup";

const LINK = "font-medium text-kumo-link hover:underline";

function Rule({ title, children }: { title: string; children: ReactNode }) {
  return (
    <LayerCard>
      <LayerCard.Primary>
        <h3 className="font-display text-lg leading-tight text-kumo-strong">{title}</h3>
        <div className="mt-2 text-sm leading-relaxed text-kumo-subtle">{children}</div>
      </LayerCard.Primary>
    </LayerCard>
  );
}

function Rules({ section }: { section: { rules: { title: string; body: ReactNode }[] } }) {
  return section.rules.map((rule) => (
    <Rule key={rule.title} title={rule.title}>
      {rule.body}
    </Rule>
  ));
}

function Aup() {
  return (
    <Shell section="aup">
      <PageHead eyebrow={AUP.eyebrow} title={AUP.title}>
        {AUP.intro}
      </PageHead>

      <section>
        <SectionHead eyebrow={AUP.notOurs.eyebrow} title={AUP.notOurs.title} id="not-ours">
          {AUP.notOurs.intro}
        </SectionHead>
        <div className="grid gap-4 sm:grid-cols-2">
          <Rules section={AUP.notOurs} />
        </div>
      </section>

      <section>
        <SectionHead eyebrow={AUP.api.eyebrow} title={AUP.api.title} id="api">
          {AUP.api.intro}
        </SectionHead>
        <div className="grid gap-4 sm:grid-cols-2">
          <Rules section={AUP.api} />
        </div>
      </section>

      <section>
        <SectionHead eyebrow={AUP.publishers.eyebrow} title={AUP.publishers.title} id="publishers">
          {AUP.publishers.intro}
        </SectionHead>
        <div className="grid gap-4 sm:grid-cols-2">
          <Rules section={AUP.publishers} />
          <Rule title={AUP.contactTitle}>
            {AUP.contact(
              <a className={LINK} href={`mailto:${CONTACT_EMAIL}`}>
                {CONTACT_EMAIL}
              </a>,
              (text) => (
                <a className={LINK} href={newIssue("broken-source")}>
                  {text}
                </a>
              ),
              (text) => (
                <a className={LINK} href={REPOSITORY}>
                  {text}
                </a>
              ),
            )}
          </Rule>
        </div>
      </section>
    </Shell>
  );
}

mountPage(<Aup />);
