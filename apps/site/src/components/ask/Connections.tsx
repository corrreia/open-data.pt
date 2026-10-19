import { Banner, Button, LinkButton, Popover } from "@cloudflare/kumo";
import { CloudIcon, GithubLogoIcon, PlugsConnectedIcon, WarningIcon } from "@phosphor-icons/react";
import { useState } from "react";
import { signInHref, signOut, type AskSession, type Provider } from "../../lib/ask";
import { CONTROL_SIZE, LINK } from "./Answer";

// Who runs the agent's model: the visitor's own Cloudflare Workers AI or GitHub Copilot. Neither is
// ours, so the visitor signs in to one, sees which they are signed in to, and can sign out of each.

const TOUCH = window.matchMedia("(pointer: coarse)").matches;
const ICON_SIZE = TOUCH ? "lg" : "sm";

/** Each provider as the visitor meets it: what it is, who pays and how much they get. */
const PROVIDERS = {
  cloudflare: {
    name: "Cloudflare Workers AI",
    short: "Cloudflare",
    icon: <CloudIcon />,
    signIn: "Sign in with Cloudflare",
    terms: "Runs on your Cloudflare account and is billed to it. The Workers Free plan's 10,000 neurons a day cover about ten questions; Workers Paid unlocks a stronger model.",
  },
  github: {
    name: "GitHub Copilot",
    short: "GitHub",
    icon: <GithubLogoIcon />,
    signIn: "Sign in with GitHub",
    terms: "Runs on your Copilot plan, Copilot Free included, and uses its AI credits. It goes through an API GitHub has not documented for other sites, so it may stop working.",
  },
} as const;

const ORDER: Provider[] = ["cloudflare", "github"];

/** Why sign-in came back without a session, as the callbacks name it: Cloudflare's bare, GitHub's with `github-` in front. */
const SIGNIN_FAILURES = new Map([
  ["denied", "You did not allow Workers AI, so nothing was connected."],
  ["expired", "The sign-in took too long or was started in another tab. Try again."],
  ["failed", "Cloudflare did not complete the sign-in. Try again."],
  ["github-denied", "You did not allow open-data.pt on GitHub, so nothing was connected."],
  ["github-expired", "The sign-in took too long or was started in another tab. Try again."],
  ["github-failed", "GitHub did not complete the sign-in. Try again."],
]);

export const signInFailure = (failure: string | undefined) => (failure ? (SIGNIN_FAILURES.get(failure) ?? SIGNIN_FAILURES.get("failed")) : undefined);

/** The providers this deployment offers. */
export const offered = (session: AskSession) => ORDER.filter((provider) => session.providers[provider].enabled);

export const providerName = (provider: Provider) => PROVIDERS[provider].name;

/** Signed out of everything: what the agent is, and a way in through each provider. */
export function SignIn({ session, failure }: { session: AskSession; failure: string | undefined }) {
  return (
    <div className="grid content-start gap-4 overflow-y-auto p-4">
      {failure ? <Banner variant="alert" icon={<WarningIcon weight="fill" />} title="Not signed in" description={failure} /> : null}
      <p className="text-sm leading-relaxed text-kumo-default">
        Ask about Portuguese public data in your own words. The agent reads open-data.pt, answers with the datasets it used, and draws charts and maps when they help.
      </p>
      <p className="text-sm leading-relaxed text-kumo-subtle">The model runs on your own account, so you choose whose, and it is billed to you:</p>
      <div className="grid gap-3">
        {offered(session).map((provider) => (
          <section key={provider} className="grid gap-2 rounded-xl border border-kumo-line p-3">
            <h3 className="flex items-center gap-2 text-sm font-medium text-kumo-strong">
              <span aria-hidden="true" className="text-kumo-subtle">
                {PROVIDERS[provider].icon}
              </span>
              {PROVIDERS[provider].name}
            </h3>
            <p className="text-xs leading-relaxed text-kumo-subtle">{PROVIDERS[provider].terms}</p>
            <div>
              <LinkButton href={signInHref(provider)} variant={provider === "cloudflare" ? "primary" : "secondary"} size={CONTROL_SIZE} icon={PROVIDERS[provider].icon}>
                {PROVIDERS[provider].signIn}
              </LinkButton>
            </div>
          </section>
        ))}
      </div>
      <p className="text-xs leading-relaxed text-kumo-subtle">
        We keep no conversation and no account details: your sign-in is a cookie in this browser, and signing out revokes it. Claude, ChatGPT and other assistants can read the same
        data through our{" "}
        <a className={LINK} href="/start/#mcp">
          MCP server
        </a>
        , on your own subscription.
      </p>
    </div>
  );
}

/**
 * The providers in one menu: which the visitor is signed in to, a way in to the others, and a way out
 * of each. Signing out revokes open-data.pt's access and clears the conversation, so it asks first.
 */
export function ConnectionsMenu({ session, onSignedOut }: { session: AskSession; onSignedOut: (provider: Provider) => void }) {
  const [leaving, setLeaving] = useState<Provider | undefined>();
  const [failure, setFailure] = useState<string | undefined>();
  const leave = async (provider: Provider) => {
    setFailure(undefined);
    try {
      await signOut(provider);
    } catch (error) {
      setFailure(`You are still signed in: ${error instanceof Error ? error.message : String(error)}`);
      return;
    }
    setLeaving(undefined);
    onSignedOut(provider);
  };
  return (
    <Popover onOpenChange={() => setLeaving(undefined)}>
      <Popover.Trigger render={<Button variant="ghost" size={ICON_SIZE} icon={<PlugsConnectedIcon />} aria-label="Accounts" title="Accounts" />} />
      <Popover.Content className="grid w-80 max-w-[90vw] gap-3 p-3 text-sm">
        <p className="text-xs text-kumo-subtle">Whose account the model runs on.</p>
        {offered(session).map((provider) => {
          const signedIn = session.providers[provider].signedIn;
          return (
            <div key={provider} className="grid gap-2 border-t border-kumo-line pt-3 first-of-type:border-t-0 first-of-type:pt-0">
              <div className="flex items-center gap-2">
                <span aria-hidden="true" className="text-kumo-subtle">
                  {PROVIDERS[provider].icon}
                </span>
                <span className="min-w-0 flex-1 text-kumo-strong">{PROVIDERS[provider].name}</span>
                {signedIn ? (
                  <Button variant="ghost" size="sm" onClick={() => setLeaving(provider)}>
                    Sign out
                  </Button>
                ) : (
                  <LinkButton href={signInHref(provider)} variant="secondary" size="sm">
                    Sign in
                  </LinkButton>
                )}
              </div>
              {leaving === provider ? (
                <div className="grid gap-2 rounded-lg bg-kumo-recessed p-2.5">
                  <p className="text-xs text-kumo-default">
                    Sign out of {PROVIDERS[provider].short}? This clears the conversation and revokes open-data.pt's access to your account.
                  </p>
                  <Button variant="destructive" size="sm" onClick={() => void leave(provider)}>
                    Sign out and clear
                  </Button>
                </div>
              ) : null}
              {!signedIn ? <p className="text-xs leading-relaxed text-kumo-subtle">{PROVIDERS[provider].terms}</p> : null}
            </div>
          );
        })}
        {failure ? (
          <p role="alert" className="text-xs text-kumo-danger">
            {failure}
          </p>
        ) : null}
      </Popover.Content>
    </Popover>
  );
}
