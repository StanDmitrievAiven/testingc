// Self-check for hash routing. Run: node src/lib/routes.check.ts
import assert from 'node:assert/strict'
import { hashToRoute, routeToHash, type Route } from './routes.ts'

const roundtrips: Route[] = [
  { page: 'overview' },
  { page: 'services' },
  { page: 'service', id: 'pg-37c7de3b' },
  { page: 'service', id: 'pg-37c7de3b', tab: 'datasets' },
  { page: 'catalog' },
  { page: 'catalog', assetId: 'pg.public.customers' },
  { page: 'lineage', assetId: 'pg.public.customers', column: 'email' },
]

for (const route of roundtrips) {
  assert.deepEqual(hashToRoute(routeToHash(route)), route, `roundtrip failed for ${route.page}`)
}

// Asset ids contain dots and can contain anything a name allows: they must survive encoding.
assert.equal(routeToHash({ page: 'catalog', assetId: 'a b&c' }), '#/catalog?assetId=a+b%26c')
assert.deepEqual(hashToRoute('#/catalog?assetId=a+b%26c'), { page: 'catalog', assetId: 'a b&c' })

// Empty and junk hashes land on overview rather than a blank screen.
assert.deepEqual(hashToRoute(''), { page: 'overview' })
assert.deepEqual(hashToRoute('#/'), { page: 'overview' })
assert.deepEqual(hashToRoute('#/nope'), { page: 'overview' })
assert.deepEqual(hashToRoute('#/../etc/passwd'), { page: 'overview' })

// Detail pages without an id would render nothing, so they fall back too.
assert.deepEqual(hashToRoute('#/service'), { page: 'overview' })
assert.deepEqual(hashToRoute('#/stack?id='), { page: 'overview' })

console.log('routes: ok')
