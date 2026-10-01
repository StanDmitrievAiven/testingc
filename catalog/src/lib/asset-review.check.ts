// Self-check for the review questions: should this still exist, what does it cost, and would a
// smaller plan do. Run: node --experimental-strip-types src/lib/asset-review.check.ts
//
// One failure mode dominates all the others here, and both halves of this file are written against
// it: saying "nothing uses this" when the truth is "nothing we looked at uses this". A wrong
// deletion does not roll back, and a wrong downsize is a migration plus an outage. So the
// assertions are mostly about what happens when the evidence is missing.
import assert from 'node:assert/strict'
import { catalog } from '../data/catalog.ts'
import { planLadder, statementCoverage } from '../data/operations.ts'
import { agentPolicies } from '../data/agent.ts'
import { assessDownsize, downsizeFor, policyFor } from './agent-context.ts'
import { costOf, deadWorkflows, deletionReview, reviewCoverage } from './asset-review.ts'

// The capture has to be complete for any of this to mean anything: "no statement names this table"
// is only a fact if every statement was read.
for (const coverage of statementCoverage) {
  assert.ok(coverage.statements > 50, `${coverage.serviceId}: ${coverage.statements} statements looks like a sample`)
  assert.ok(coverage.tablesSeen.length > 0, `${coverage.serviceId}: a service with statements names some tables`)
}

// A table something reads is unsafe, and says what reads it.
const orders = deletionReview('pg.public.orders')!
assert.equal(orders.verdict, 'unsafe')
assert.ok(orders.because.includes('recorded calls') && orders.because.includes('downstream'))

// A foreign key blocks the drop from the referencing side, not the referenced one. Getting this
// backwards was the original bug: api_keys points at users, which is no reason to keep api_keys.
const users = deletionReview('marmot.users')!
assert.equal(users.verdict, 'unsafe')
assert.ok(
  users.evidence.some((item) => item.what === 'Foreign keys pointing at it'),
  'a referenced table is blocked by its referencing tables',
)
assert.ok(
  !deletionReview('marmot.api_keys')!.evidence.some((item) => item.what === 'Foreign keys pointing at it'),
  'holding a reference to another table is not a reason to keep this one',
)

// The real find, and the reason the full capture was worth reading: tables no statement names.
const dead = deadWorkflows()
assert.ok(dead.length > 10, `${dead.length} unused tables, expected the marmot set`)
assert.ok(
  dead.every((row) => statementCoverage.some((c) => c.serviceId === row.asset.serviceId)),
  'nothing is called unused on a service whose statements were never read',
)
assert.ok(
  dead.some((row) => row.asset.id === 'marmot.service_account_api_keys'),
  'an unused table holding credentials is exactly the thing this is for',
)
assert.ok(
  dead.every((row) => row.review.because.includes('not for deleting it') || row.review.because.includes('asking whoever owns it')),
  'the strongest verdict still points at a person rather than at an action',
)

// The verdict scale never reaches "safe", and absent evidence never reads as permission. This is
// the assertion that would have caught ClickHouse tables and applications — kinds with no usage
// telemetry at all — falling past every branch into the most permissive answer available.
const verdicts = new Set(catalog.assets.map((asset) => deletionReview(asset.id)!.verdict))
assert.ok(!verdicts.has('safe' as never), 'nothing is ever declared safe to delete')
for (const asset of catalog.assets) {
  const review = deletionReview(asset.id)!
  if (review.verdict !== 'no sign of use') continue
  assert.ok(
    asset.kind === 'table' || asset.kind === 'topic',
    `${asset.id} is a ${asset.kind}, which nothing here can see reads of, so it cannot reach this verdict`,
  )
}
const clickhouse = catalog.assets.find((a) => a.kind === 'clickhouse_table')!
assert.equal(deletionReview(clickhouse.id)!.verdict, 'cannot tell')
assert.ok(
  deletionReview(clickhouse.id)!.because.includes('not evidence of absence'),
  'the blind spot is named rather than rounded down to a verdict',
)

// Every review admits the one gap that would settle most of these questions.
assert.ok(
  catalog.assets.every((asset) =>
    deletionReview(asset.id)!.evidence.some((item) => item.what === 'Last write' && item.found.startsWith('Not captured')),
  ),
  'no last-write time exists, and every review says so rather than omitting the row',
)

// Cost is an estimate that states its method, and is absent rather than zero where nothing is known.
const ordersCost = costOf('pg.public.orders')!
assert.equal(ordersCost.basis, 'statement time')
assert.ok(ordersCost.usdPerMonth > 0 && ordersCost.share > 0 && ordersCost.share < 1)
assert.ok(ordersCost.method.includes('does not fall until the plan does'), 'it says what the number is not')
const topicCost = costOf('kafka.webshop.public.orders')!
assert.equal(topicCost.basis, 'retained bytes')
assert.ok(topicCost.method.includes('floor'), 'a share of disk is a floor on the cost, not the cost')
assert.equal(costOf('marmot.api_keys'), undefined, 'no evidence means no number, rather than a zero')

// Attribution is against the disk, not against the other captured topics: four topics out of a
// broker must never add up to the whole bill.
const topics = catalog.assets.filter((a) => a.kind === 'topic' && a.serviceId === 'kafka-1b5cb1e7')
const topicShare = topics.reduce((sum, topic) => sum + (costOf(topic.id)?.share ?? 0), 0)
assert.ok(topicShare < 0.1, `four captured topics claim ${(topicShare * 100).toFixed(1)}% of the broker, which is a sample read as a whole`)

// Right-sizing. The real project has no passing case — the one service with a rung below it would
// land at 92% full — so the recommending branch is exercised through the pure function, which is
// why it is a pure function.
const rungs = planLadder.filter((rung) => rung.serviceType === 'pg')
const base = { rungs, hasFacts: true, peaks: [], contradictions: [], diskTarget: 67, peakTarget: 60 }
const current = rungs.find((r) => r.plan === 'startup-4')

const fits = assessDownsize({ ...base, current, usedGb: 3 })
assert.equal(fits.verdict, 'fits')
assert.equal(fits.monthlyUsdSaved, 85.41)
assert.ok(fits.because.includes('restart'), 'even a good downsize is a plan change, and says so')

assert.equal(assessDownsize({ ...base, current, usedGb: 7.4 }).verdict, 'would not fit')
assert.equal(
  assessDownsize({ ...base, current, usedGb: 3, peaks: [{ name: 'Memory', percent: 80 }] }).verdict,
  'contradicted',
  'a peak inside the current plan is a peak the smaller one still has to survive',
)
assert.equal(
  assessDownsize({ ...base, current, usedGb: 3, contradictions: ['disk is filling'] }).verdict,
  'contradicted',
  'a service running out of disk is not a downsize candidate however idle it looks',
)

// Every way of not knowing refuses, and each refusal says something different, because each is a
// different thing to go and fix.
const refusals = [
  assessDownsize({ ...base, current, usedGb: undefined }),
  assessDownsize({ ...base, current: undefined }),
  assessDownsize({ ...base, current, hasFacts: false }),
  assessDownsize({ ...base, rungs: [], current }),
  assessDownsize({ ...base, current: rungs.find((r) => r.plan === 'hobbyist') }),
]
assert.ok(refusals.every((r) => r.verdict !== 'fits'), 'not knowing is never a yes')
assert.equal(new Set(refusals.map((r) => r.because)).size, refusals.length, 'each refusal explains itself differently')
assert.ok(
  refusals[0].because.includes('Unknown is not a yes') && refusals[0].monthlyUsdForgone === 85.41,
  'a refused saving still names its amount, since the amount is why somebody would override it',
)
assert.equal(refusals[4].verdict, 'already smallest')

// And against the real project.
assert.equal(downsizeFor('pg-37c7de3b').verdict, 'would not fit')
assert.equal(downsizeFor('crm-pg').verdict, 'already smallest')
assert.equal(downsizeFor('trino-hub-pg').verdict, 'cannot tell')
assert.ok(
  catalog.services.every((service) => downsizeFor(service.id).verdict !== 'fits'),
  'nothing in this project is currently a downsize candidate, and the document must not invent one',
)

// G7 requirement 4, which the policy layer already satisfies: deletion is refusable everywhere, and
// the refusal quotes a reason. An agent that concluded a table was dead still cannot act on it.
for (const service of catalog.services) {
  const policy = policyFor(service.id)
  assert.ok(
    !policy.allowed.some((operation) => /delete|drop|remove/i.test(operation)),
    `${service.id} allows a deletion unattended`,
  )
  assert.ok(policy.because.length > 20, `${service.id} refuses without saying why`)
}
assert.ok(
  agentPolicies.every((policy) => policy.forbidden.some((operation) => /delete/i.test(operation))),
  'every authored policy names deletion among the things it forbids',
)

const coverage = reviewCoverage()
console.log(
  `asset-review: ok (${coverage.canSee}/${coverage.assets} assets visible, ${dead.length} unused, ${catalog.assets.filter((a) => costOf(a.id)).length} costed)`,
)
