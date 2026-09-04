export type Route =
  | { page: 'overview' }
  | { page: 'services' }
  | { page: 'service'; id: string; tab?: string }
  | { page: 'applications' }
  | { page: 'application'; id: string; tab?: string }
  | { page: 'stacks' }
  | { page: 'stack'; id: string; tab?: string }
  | { page: 'catalog'; assetId?: string }
  | { page: 'lineage'; stackId?: string; assetId?: string; column?: string }

export type Navigate = (route: Route) => void

const pages = [
  'overview',
  'services',
  'service',
  'applications',
  'application',
  'stacks',
  'stack',
  'catalog',
  'lineage',
]

const pagesNeedingId = ['service', 'application', 'stack']

export function routeToHash(route: Route): string {
  const { page, ...params } = route as { page: string } & Record<string, string | undefined>
  const query = new URLSearchParams(
    Object.entries(params).filter((entry): entry is [string, string] => Boolean(entry[1])),
  ).toString()
  return `#/${page}${query ? `?${query}` : ''}`
}

export function hashToRoute(hash: string): Route {
  const [path, query] = hash.replace(/^#\/?/, '').split('?')
  const page = path || 'overview'
  const params = Object.fromEntries(new URLSearchParams(query))
  if (!pages.includes(page)) return { page: 'overview' }
  if (pagesNeedingId.includes(page) && !params.id) return { page: 'overview' }
  return { page, ...params } as Route
}
