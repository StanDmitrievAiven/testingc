import type { ReactNode } from 'react'
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from '@/components/ui/breadcrumb'
import { Separator } from '@/components/ui/separator'
import { SidebarTrigger } from '@/components/ui/sidebar'

export function PageHeader({
  crumbs,
  actions,
}: {
  crumbs: Array<{ label: string; onClick?: () => void }>
  actions?: ReactNode
}) {
  return (
    <header className="flex h-12 items-center gap-2 border-b px-3">
      <SidebarTrigger />
      <Separator orientation="vertical" className="h-4" />
      <Breadcrumb>
        <BreadcrumbList>
          {crumbs.flatMap((crumb, i) => {
            const item = (
              <BreadcrumbItem key={`item-${crumb.label}-${i}`}>
                {crumb.onClick && i < crumbs.length - 1 ? (
                  <BreadcrumbLink
                    href="#"
                    onClick={(e) => {
                      e.preventDefault()
                      crumb.onClick?.()
                    }}
                  >
                    {crumb.label}
                  </BreadcrumbLink>
                ) : (
                  <BreadcrumbPage>{crumb.label}</BreadcrumbPage>
                )}
              </BreadcrumbItem>
            )
            return i === 0
              ? [item]
              : [<BreadcrumbSeparator key={`sep-${i}`} />, item]
          })}
        </BreadcrumbList>
      </Breadcrumb>
      <div className="ml-auto flex items-center gap-2">{actions}</div>
    </header>
  )
}
