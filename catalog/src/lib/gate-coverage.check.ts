// Self-check for gate classification. Run: node src/lib/gate-coverage.check.ts
import assert from 'node:assert/strict'
import { illustrativeEvents, serviceEvents } from '../data/operations.ts'
import { gateStart, gateStatus } from './gate-coverage.ts'

const by = (id: string) => serviceEvents.find((e) => e.id === id)!

assert.equal(gateStart, '2026-09-04T08:42:19.837Z')
// Aiven stamps 08:42:20, the proxy recorded intent at 08:42:19.837: same service, same moment.
assert.equal(gateStatus(by('pe5db30a64827')).status, 'gated')
assert.equal(gateStatus(by('pe5db30a64827')).change?.version, 1)
assert.equal(gateStatus(by('pe5db313edba8')).status, 'gated', 'crm-app deploy')
assert.equal(gateStatus(by('pe5db30d2d1d3')).status, 'platform', 'failover has no purpose to find')
assert.equal(gateStatus(by('pe5d9cf22a7d8')).status, 'before-gate', 'a migration days before the proxy existed')
// The same person acting on the same service minutes after the gate, with no purpose, is the gap.
assert.equal(gateStatus(illustrativeEvents[0]).status, 'outside-gate')
// The nearest purpose must belong to the same service, and must have succeeded.
assert.equal(gateStatus({ ...by('pe5db30a64827'), serviceId: 'crm-app' }).status, 'outside-gate')
const refused = { ...gateStatus(by('pe5db30a64827')).change!, status: 'error' as const }
assert.equal(gateStatus(by('pe5db30a64827'), [refused]).status, 'outside-gate')
console.log('gate-coverage ok')
