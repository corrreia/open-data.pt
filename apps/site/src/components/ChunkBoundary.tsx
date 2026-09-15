import { Button, Empty } from "@cloudflare/kumo";
import { ArrowClockwiseIcon, WarningCircleIcon } from "@phosphor-icons/react";
import { Component, type ReactNode } from "react";

interface State {
  error: Error | null;
}

/**
 * Catches a view that failed to load or render. The usual cause is a deploy: the map, chart and API
 * views load their code on demand, a new deploy replaces those files, and a page opened before it
 * asks for a file that no longer exists. Reloading picks up the new build.
 */
export class ChunkBoundary extends Component<{ children: ReactNode }, State> {
  override state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  override render() {
    if (!this.state.error) return this.props.children;
    return (
      <Empty
        icon={<WarningCircleIcon size={40} className="text-kumo-inactive" />}
        title="This view could not load"
        description="The site was probably updated since this page opened. Reload to get the current version."
        contents={
          <Button variant="primary" icon={<ArrowClockwiseIcon />} onClick={() => window.location.reload()}>
            Reload the page
          </Button>
        }
      />
    );
  }
}
