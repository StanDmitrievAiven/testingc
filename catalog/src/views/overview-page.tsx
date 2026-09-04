import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { PageHeader } from '@/components/page-header'
import { ResourceTable } from '@/components/resource-table'
import { StackCard } from '@/components/stack-card'
import { Button } from '@/components/ui/button'
import { catalog } from '@/data/catalog'
import { managedServices, runtimes, stats } from '@/lib/catalog'
import type { Navigate } from '@/lib/routes'

export function OverviewPage({ navigate }: { navigate: Navigate }) {
  return (
    <>
      <PageHeader crumbs={[{ label: catalog.project }, { label: 'Overview' }]} />
      <div className="flex min-h-0 flex-1 flex-col gap-6 overflow-auto p-6 [&>*]:shrink-0">
        <div>
          <h1 className="text-2xl font-semibold">{catalog.project}</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {catalog.organization} · {catalog.cloud}. Resources start as a service or an application runtime, then group
            into a stack when they form a product.
          </p>
        </div>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {[
            { title: 'Services', value: stats.services, hint: 'Managed data services', go: () => navigate({ page: 'services' }) },
            { title: 'Applications', value: stats.runtimes, hint: 'Runtimes', go: () => navigate({ page: 'applications' }) },
            { title: 'Stacks', value: stats.stacks, hint: 'Product groupings', go: () => navigate({ page: 'stacks' }) },
            { title: 'Lineage hops', value: stats.lineage, hint: `${stats.integrations} active integrations`, go: () => navigate({ page: 'lineage' }) },
          ].map((item) => (
            <button key={item.title} type="button" onClick={item.go} className="text-left">
              <Card>
                <CardHeader>
                  <CardDescription>{item.title}</CardDescription>
                  <CardTitle className="text-3xl">{item.value}</CardTitle>
                </CardHeader>
                <CardContent className="text-xs text-muted-foreground">{item.hint}</CardContent>
              </Card>
            </button>
          ))}
        </div>

        <div className="flex flex-col gap-3">
          <div>
            <h2 className="text-lg font-semibold">Stacks</h2>
            <p className="text-sm text-muted-foreground">
              Products assembled from runtimes and services. Hover a mark for the member it opens.
            </p>
          </div>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {catalog.stacks.map((stack) => (
              <StackCard key={stack.id} stack={stack} navigate={navigate} />
            ))}
          </div>
        </div>

        <div className="grid gap-6 xl:grid-cols-2">
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between gap-2">
                <div>
                  <CardTitle>Services</CardTitle>
                  <CardDescription>Managed data plane.</CardDescription>
                </div>
                <Button variant="outline" size="sm" onClick={() => navigate({ page: 'services' })}>
                  View all
                </Button>
              </div>
            </CardHeader>
            <CardContent>
              <ResourceTable
                items={managedServices().slice(0, 6)}
                onOpen={(id) => navigate({ page: 'service', id })}
              />
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between gap-2">
                <div>
                  <CardTitle>Applications</CardTitle>
                  <CardDescription>Runtimes in this project.</CardDescription>
                </div>
                <Button variant="outline" size="sm" onClick={() => navigate({ page: 'applications' })}>
                  View all
                </Button>
              </div>
            </CardHeader>
            <CardContent>
              <ResourceTable
                items={runtimes().slice(0, 6)}
                onOpen={(id) => navigate({ page: 'application', id })}
              />
            </CardContent>
          </Card>
        </div>
      </div>
    </>
  )
}
