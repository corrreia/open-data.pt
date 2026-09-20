import { LayerCard } from "@cloudflare/kumo";
import type { ReactNode } from "react";
import { PageHead, SectionHead } from "../components/common";
import { mountPage } from "../components/mount";
import { Shell } from "../components/Shell";
import { CONTACT_EMAIL, REPOSITORY, newIssue } from "../lib/project";

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

function Aup() {
  return (
    <Shell section="aup">
      <PageHead eyebrow="Acceptable use" title="What you may do with this data, and what we ask of you">
        open-data.pt republishes data other people made. It is free to read, needs no key and no account, and it comes with no warranty. These are the terms that come with it.
      </PageHead>

      <section>
        <SectionHead eyebrow="The short version" title="We do not own this data" id="not-ours">
          Every dataset here belongs to the institution or operator that produced it, and travels under that publisher's terms — not ours. We cannot grant you rights we were never
          given, so we pass on exactly what each publisher states and nothing more.
        </SectionHead>
        <div className="grid gap-4 sm:grid-cols-2">
          <Rule title="Check the licence on the dataset">
            Every product page names its licence and its attribution. Some are CC BY or CC0 and let you do as you like. Some are the publisher's own terms. Some say{" "}
            <em>no licence stated</em>, which means the publisher never said — not that there are no limits.
          </Rule>
          <Rule title="Some datasets are non-commercial">
            A few publishers allow reuse only where no commercial purpose follows from it. Those datasets say so on their own page, in their own words. If you are building
            something commercial, read the licence before you depend on it.
          </Rule>
          <Rule title="Credit the publisher, not us">
            Each dataset carries the attribution its publisher asks for. Use that. Crediting open-data.pt instead of the institution that did the work is the one thing we would
            rather you never did.
          </Rule>
          <Rule title="The data may be wrong, late, or gone">
            We copy what a source served at the moment we read it. Sources change shape, go down, and correct themselves. Nothing here is authoritative: for anything that matters,
            go to the publisher. For an emergency, call 112.
          </Rule>
        </div>
      </section>

      <section>
        <SectionHead eyebrow="Using the API" title="Read as much as you need, within reason" id="api">
          There is no key, no quota and no account. That works because almost nobody abuses it, so the only rule is the obvious one.
        </SectionHead>
        <div className="grid gap-4 sm:grid-cols-2">
          <Rule title="Do not hammer it">
            Feeds update on their own schedule — most daily, the fastest every three minutes. Polling faster than a dataset changes costs us money and gets you the same bytes. Each
            response tells you how fresh it is; use that.
          </Rule>
          <Rule title="Cache what you fetch">
            Responses carry ETags. Send them back and you will get a cheap 304 instead of a full body. If you are serving many users, cache on your side rather than passing every
            one of them through to us.
          </Rule>
          <Rule title="Go to the source for bulk">
            If you want an entire history rather than a window of it, the publisher usually offers a bulk download and will serve you better than scraping this API page by page.
          </Rule>
          <Rule title="No warranty, no uptime promise">
            This is a free service run by one person. It can break, change, or stop. Do not put it under anything where failure hurts, and if you do, that is your call, not ours.
          </Rule>
        </div>
      </section>

      <section>
        <SectionHead eyebrow="Publishers" title="If this is your data and you want it changed or gone" id="publishers">
          We read only what a source serves publicly, and we take a publisher's own words about reuse as the limit. If we have got that wrong for your data, we would rather hear it
          from you than guess.
        </SectionHead>
        <div className="grid gap-4 sm:grid-cols-2">
          <Rule title="Ask us to stop, and we will">
            If you publish one of these datasets and you do not want it republished here, write to us and we will remove it. We will not ask you to justify it and we will not argue
            about whether we were entitled to it.
          </Rule>
          <Rule title="Tell us the right licence">
            If a dataset shows <em>no licence stated</em> and you do have terms, or the licence we show is the wrong one, tell us which it is and we will correct it. Getting this
            right is the whole point of the page you are reading.
          </Rule>
          <Rule title="Tell us we are polling too hard">
            If our collection is a burden on your service, say so and we will slow it down or stop. We would rather hold a stale copy than be a problem for the people producing the
            data.
          </Rule>
          <Rule title="Contact">
            <a className={LINK} href={`mailto:${CONTACT_EMAIL}`}>
              {CONTACT_EMAIL}
            </a>{" "}
            reaches a person. For anything public — a broken dataset, a source worth adding — an{" "}
            <a className={LINK} href={newIssue("broken-source")}>
              issue
            </a>{" "}
            on{" "}
            <a className={LINK} href={REPOSITORY}>
              the repository
            </a>{" "}
            is faster and leaves a trail others can read.
          </Rule>
        </div>
      </section>
    </Shell>
  );
}

mountPage(<Aup />);
