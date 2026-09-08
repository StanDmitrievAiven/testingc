// What an agent is allowed to do here, and what to do about each finding. Unlike operations.ts and
// catalog.ts, none of this is captured from Aiven: it is authored, and the UI and the emitted
// context both label it as such. An agent that cannot tell a measurement from a judgement will
// eventually quote one as the other.
//
// The shape is deliberately dull. A policy is three lists and a sentence; a runbook is steps plus
// the four things wiki runbooks leave out — what breaks while it runs, how long it takes, whether
// it can be undone, and the check that proves it worked.
import type { AgentPolicy, ChangeFreeze, Runbook } from '../types.ts'

/**
 * Nothing changes during the summit. This outranks every finding: an agent that has found a real
 * problem still waits, and says why it waited.
 */
export const changeFreeze: ChangeFreeze = {
  from: '2026-09-08T00:00:00Z',
  to: '2026-09-12T23:59:59Z',
  reason: 'Data Innovation Summit. The project is on stage, so nothing changes unattended, however good the reason.',
}

/**
 * Read is allowed everywhere in this project; the interesting column is what needs a human. Any
 * service without an entry is read-only — see `policyFor`, which fails closed rather than open.
 */
export const agentPolicies: AgentPolicy[] = [
  {
    serviceId: 'pg-37c7de3b',
    allowed: ['read metadata', 'read metrics', 'read query statistics'],
    needsApproval: ['restart', 'change plan', 'change ip filter', 'terminate a session'],
    forbidden: ['delete the service', 'drop the replication slot', 'disable backups'],
    because:
      'Single node holding the webshop source of truth, and the CDC connector reads its replication slot: dropping that slot loses changes that no downstream copy can reconstruct.',
  },
  {
    serviceId: 'kafka-1b5cb1e7',
    allowed: ['read metadata', 'read metrics', 'read topic configuration', 'read consumer lag'],
    needsApproval: ['raise retention', 'restart a broker', 'add partitions'],
    forbidden: ['delete a topic', 'lower retention', 'reduce replication factor'],
    because:
      'Three brokers make a rolling restart survivable, but lowering retention deletes records a lagging consumer has not read yet, and no amount of purpose makes that recoverable.',
  },
  {
    serviceId: 'clickhouse-2a6274d2',
    allowed: ['read metadata', 'read metrics'],
    needsApproval: ['apply pending maintenance', 'restart', 'change plan'],
    forbidden: ['delete the service', 'drop a table'],
    because:
      'Single node with three platform updates already queued against deadlines, so a restart here competes with maintenance Aiven will run anyway.',
  },
  {
    serviceId: 'crm-pg',
    allowed: ['read metadata', 'read metrics'],
    needsApproval: ['change plan', 'restart', 'add disk'],
    forbidden: ['delete the service', 'downgrade the plan'],
    because:
      'Single node whose disk is trending up. Growing the plan is reversible only while the data still fits the smaller one, so a downgrade is a door that closes behind you.',
  },
  {
    serviceId: 'kafkaconnect-30e121dd',
    allowed: ['read connector status', 'read metrics'],
    needsApproval: ['restart a connector', 'resume a connector', 'pause a connector'],
    forbidden: ['delete a connector', 'edit connector configuration'],
    because:
      'The only path from the webshop database to every downstream copy. A deleted connector loses its offsets, and the rebuild replays from whatever the slot still holds.',
  },
]

/** Read-only everywhere else, because an unlisted service is one nobody has thought about yet. */
export const defaultPolicy: Omit<AgentPolicy, 'serviceId'> = {
  allowed: ['read metadata'],
  needsApproval: [],
  forbidden: ['everything else'],
  because: 'No policy has been written for this service, so it is read-only until somebody writes one.',
}

/**
 * One play per finding kind. Two of these answer findings nothing currently triggers — a dead
 * connector and a consumer about to pass retention — which is the point: the play has to exist
 * before the incident, not be written during it.
 */
export const runbooks: Runbook[] = [
  {
    forFinding: 'disk-filling',
    title: 'Give the service more disk before it fills',
    steps: [
      'Check the change freeze and the maintenance window before anything else.',
      'Confirm the trend on a fresh reading: aiven_service_metrics_fetch with period=week, metric disk_usage.',
      'Find the current plan with aiven_service_get, then look it up in the plan ladder.',
      'If the plan can buy disk on its own, add disk with aiven_service_update and stop there.',
      'If it cannot, the fix is the next plan up, also aiven_service_update, which restarts the service.',
      'Tell whoever depends on it before the restart, not after.',
    ],
    whileItRuns:
      'A plan change restarts the service. On a single node that is an outage, not a failover, and every open connection drops.',
    takes: 'Usually under ten minutes for a small plan, longer as the data grows.',
    rollback:
      'One way, in practice. You can only move back down while the data still fits the smaller plan, and the data is what grew.',
    verify:
      'Service state RUNNING, disk_usage below where it started on a fresh metrics read, and the application reconnects.',
  },
  {
    forFinding: 'open-to-internet',
    title: 'Close the service to the open internet',
    steps: [
      'List what actually connects: the integrations in this catalog plus any application using a service credential.',
      'Collect the egress ranges those clients come from. A guess here locks out production.',
      'Replace the ip_filter with that list using aiven_service_update, leaving 0.0.0.0/0 out.',
      'Keep your own access in the list, or you lock yourself out along with everyone else.',
    ],
    whileItRuns:
      'Established connections survive. New connections from anything outside the list are refused immediately, which is the whole point and also the risk.',
    takes: 'Seconds to apply.',
    rollback: 'Reversible: put the previous filter back with the same call.',
    verify:
      'Connect from an allowed address, then from one that is not. The second attempt must fail, or the filter did not take.',
  },
  {
    forFinding: 'single-node',
    title: 'Restart a service that has no second node',
    steps: [
      'Treat this as planned downtime and announce it, because that is what it is.',
      'Check no platform maintenance is already in flight for the same service.',
      'Prefer the existing maintenance window over a restart of your own.',
      'Restart, then watch the dependents rather than the service: it comes back before they do.',
    ],
    whileItRuns:
      'A total outage for the length of the restart. Change data capture stops and resumes from its replication slot; consumers downstream fall behind rather than lose data.',
    takes: 'A few minutes, most of it the service coming back up.',
    rollback: 'None. A restart cannot be undone, only waited out.',
    verify:
      'Service state RUNNING, the CDC connector back to RUNNING, and consumer lag falling across two readings rather than one.',
  },
  {
    forFinding: 'pending-maintenance',
    title: 'Apply platform maintenance before its deadline',
    steps: [
      'Read the deadlines from aiven_service_get: after them, Aiven applies the update whether or not it suits you.',
      'Pick a window before the earliest deadline and inside the service maintenance window.',
      'Apply the updates there, oldest deadline first.',
    ],
    whileItRuns:
      'Rolling on a multi-node service, downtime on a single node. Either way it is the same interruption you would get by leaving it to the deadline, but at a time you chose.',
    takes: 'Minutes per update, longer for a version upgrade.',
    rollback: 'A version upgrade is one way. Plan for going forward, not back.',
    verify: 'The pending update list is empty and the service reports the new version.',
  },
  {
    forFinding: 'connector-down',
    title: 'Bring a stopped change data capture connector back',
    steps: [
      'Read the trace with aiven_kafka_connect_get_connector_status before restarting anything.',
      'If the trace names authentication or a missing replication slot, fix that first: a restart will only fail again.',
      'Restart with aiven_kafka_connect_restart_connector.',
      'If the task fails a second time, pause it and escalate. Do not loop restarts.',
    ],
    whileItRuns:
      'Nothing further breaks: the flow has already stopped. Restarting resumes from the stored offset and loses nothing, unless the replication slot was dropped while it was down.',
    takes: 'Seconds to restart, then minutes to catch up on the backlog.',
    rollback: 'Pause the connector, which leaves the offsets where they are.',
    verify: 'State RUNNING with every task RUNNING, and lag falling across two readings.',
  },
  {
    forFinding: 'lag-against-retention',
    title: 'Stop a lagging consumer from losing records',
    steps: [
      'Compare how far behind the consumer is with how long the topic keeps records. That gap is the deadline.',
      'Raise retention first with aiven_kafka_topic_update. It is cheap, reversible, and buys time to fix the cause.',
      'Only then deal with the consumer itself.',
    ],
    whileItRuns: 'Nothing is interrupted. More retention simply uses more disk on the brokers.',
    takes: 'Seconds to apply, and it takes effect immediately.',
    rollback: 'Lower retention again once the consumer has caught up, not before.',
    verify:
      'Lag falling, and the oldest offset still behind the consumer position. If retention passes the consumer, records are already gone.',
  },
  {
    forFinding: 'stale-context',
    title: 'Refuse to act on a stale reading',
    steps: [
      'Do not act on a capacity finding whose evidence is older than the thing it claims to measure.',
      'Re-read with aiven_service_metrics_fetch and compare the window end against now.',
      'If the window is still short or still ends early, check the service is running at all before assuming the metric is wrong.',
    ],
    whileItRuns: 'Nothing. This play exists to stop an action, not to take one.',
    takes: 'One call.',
    rollback: 'Not applicable.',
    verify: 'The window ends within the last hour. Until it does, the finding stays unactionable.',
  },
  {
    forFinding: 'no-termination-protection',
    title: 'Turn on termination protection',
    steps: ['Set termination protection with aiven_service_update.'],
    whileItRuns: 'Nothing. It is a configuration flag, with no restart.',
    takes: 'Seconds.',
    rollback: 'Reversible with the same call, which is exactly why it is worth having on.',
    verify: 'Read the service back and confirm the flag is set.',
  },
]
