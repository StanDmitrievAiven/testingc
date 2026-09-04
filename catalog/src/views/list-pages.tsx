import { PageHeader } from '@/components/page-header'
import { ResourceList } from '@/components/resource-list'
import { StackCard } from '@/components/stack-card'
import { catalog } from '@/data/catalog'
import { managedServices, runtimes } from '@/lib/catalog'
import type { Navigate } from '@/lib/routes'

export function ServicesPage({ navigate }: { navigate: Navigate }) {
  return (
    <>
      <PageHeader
        crumbs={[
          { label: catalog.project, onClick: () => navigate({ page: 'overview' }) },
          { label: 'Services' },
        ]}
      />
      <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-auto p-6 [&>*]:shrink-0">
        <div>
          <h1 className="text-2xl font-semibold">Services</h1>
          <p className="text-sm text-muted-foreground">Managed data services in the project.</p>
        </div>
        <ResourceList items={managedServices()} showTypeFilter onOpen={(id) => navigate({ page: 'service', id })} />
      </div>
    </>
  )
}

export function ApplicationsPage({ navigate }: { navigate: Navigate }) {
  return (
    <>
      <PageHeader
        crumbs={[
          { label: catalog.project, onClick: () => navigate({ page: 'overview' }) },
          { label: 'Applications' },
        ]}
      />
      <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-auto p-6 [&>*]:shrink-0">
        <div>
          <h1 className="text-2xl font-semibold">Applications</h1>
          <p className="text-sm text-muted-foreground">Runtimes deployed in the project.</p>
        </div>
        <ResourceList items={runtimes()} onOpen={(id) => navigate({ page: 'application', id })} />
      </div>
    </>
  )
}

export function StacksPage({ navigate }: { navigate: Navigate }) {
  return (
    <>
      <PageHeader
        crumbs={[
          { label: catalog.project, onClick: () => navigate({ page: 'overview' }) },
          { label: 'Stacks' },
        ]}
      />
      <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-auto p-6 [&>*]:shrink-0">
        <div>
          <h1 className="text-2xl font-semibold">Stacks</h1>
          <p className="text-sm text-muted-foreground">
            Product groupings of runtimes and services — for example a CRM that is an application plus PostgreSQL.
          </p>
        </div>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {catalog.stacks.map((stack) => (
            <StackCard key={stack.id} stack={stack} navigate={navigate} />
          ))}
        </div>
      </div>
    </>
  )
}
