// Types for the design system's zero-dependency icons.js, which ships as plain JS.
export type ServiceIconRecord = {
  id: string
  name: string
  category: string
  aliases: string[]
  viewBox: string
  description: string
  doNotUseFor: string
  svg: string
}

export const AIVEN_SERVICE_ICONS: Record<string, ServiceIconRecord>
export const SERVICE_IDS: string[]
export const ICON_SIZES: { tableRow: 28; card: 40; detailHeader: 48; marketing: 64 }
/** Returns null when there is no first-party mark — never substitute a look-alike. */
export function getServiceIcon(query: string): ServiceIconRecord | null
export function getServiceIconSvg(query: string): string | null
export function serviceIconHtml(query: string, size?: number): string
