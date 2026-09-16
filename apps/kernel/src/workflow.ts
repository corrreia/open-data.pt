import { WorkflowEntrypoint, type WorkflowEvent, type WorkflowStep } from "cloudflare:workers";

import type { FeedRunner } from "./coordinators";
import { collectionStep, DELIVERY_STEP_BLOBS, drainOutbox, failureFrom, type EngineOutcome, type EnginePorts, type RunnerPort } from "./engine";
import { buildGatekeeperRegistry, getFeedGatekeeper } from "./gatekeeper-registry";
import { PipelinesLake, lakeStreams } from "./lake";
import { ObjectStore } from "./object-store";
import { R2SnapshotStore } from "./r2-snapshot-store";

export interface CollectionParams {
  feedId: string;
  acquisitionId: string;
  gatekeeperKind: string;
  timeoutSeconds: number;
}

/**
 * One collection per Workflow instance. Waiting on the source, the Gatekeeper,
 * R2 and Pipelines costs Workflow CPU and steps, not Durable Object duration;
 * the FeedRunner is invoked only for short state transitions. A collection
 * is one step, and delivers the history it committed itself; a second step
 * runs only for history it could not send.
 */
export class CollectionWorkflow extends WorkflowEntrypoint<Env, CollectionParams> {
  override async run(event: Readonly<WorkflowEvent<CollectionParams>>, step: WorkflowStep): Promise<void> {
    const { feedId, acquisitionId, gatekeeperKind, timeoutSeconds } = event.payload;
    const runner = runnerPort(this.env.FeedRunner.getByName(feedId));
    const streams = lakeStreams(this.env);
    const lake = PipelinesLake.available(streams) ? new PipelinesLake(streams) : undefined;
    let outcome: EngineOutcome;
    try {
      // A feed still naming a Gatekeeper this kernel no longer binds (its Worker was regrouped) is a passing failure:
      // the Registry re-configures it within minutes, so it is reported and retried, never left to the watchdog.
      const ports: EnginePorts = {
        runner,
        gatekeeper: getFeedGatekeeper(buildGatekeeperRegistry(this.env), gatekeeperKind),
        objects: new ObjectStore(new R2SnapshotStore(this.env.DATA_OBJECTS)),
      };
      // The collection delivers what it committed itself; a second step runs only for what it could not send.
      if (lake) ports.lake = (table, rows) => lake.send(table, rows);
      // A source or Gatekeeper failure comes back from the step as a value; only errors a step retry can cure are thrown.
      const result = await step.do("collect", { retries: { limit: 2, delay: "15 seconds", backoff: "exponential" }, timeout: `${timeoutSeconds + 180} seconds` }, async () =>
        collectionStep(acquisitionId, ports),
      );
      if ("failure" in result) {
        await runner.fail(acquisitionId, result.failure);
        return;
      }
      outcome = result.outcome;
    } catch (error) {
      // Retries ran out on an error the step threw. The runner ignores a repeated report; if this one is lost, its
      // watchdog asks the Workflow and records the failure.
      await runner.fail(acquisitionId, failureFrom(error instanceof Error ? error : new Error(String(error))));
      return;
    }
    if (!outcome.undelivered || !lake) return;
    await step.do("deliver history", { retries: { limit: 6, delay: "30 seconds", backoff: "exponential" }, timeout: "10 minutes" }, async () =>
      drainOutbox(runner, (table, rows) => lake.send(table, rows), DELIVERY_STEP_BLOBS),
    );
  }
}

function runnerPort(stub: DurableObjectStub<FeedRunner>): RunnerPort {
  return {
    begin: (id) => stub.begin(id),
    declare: (id, input) => stub.declare(id, input),
    promote: (productKey) => stub.promote(productKey),
    stageRecords: (id, productKey, rows) => stub.stageRecords(id, productKey, rows),
    sweepRecords: (id, productKey, seen, retract) => stub.sweepRecords(id, productKey, seen, retract),
    appendOutbox: (id, table, rowsJson, rows) => stub.appendOutbox(id, table, rowsJson, rows),
    commit: (id, input) => stub.commit(id, input),
    unchanged: (id, checkpoint) => stub.unchanged(id, checkpoint),
    historyExhausted: (id) => stub.historyExhausted(id),
    fail: (id, failure) => stub.fail(id, failure),
    pendingOutbox: (limit) => stub.pendingOutbox(limit),
    ackOutbox: (seqs, next) => stub.ackOutbox(seqs, next),
  };
}
