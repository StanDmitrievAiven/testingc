import { getServiceIcon, type ServiceIconRecord } from './icons.js'

// Our catalog's service `type` values mapped onto canonical Aiven mark ids.
// `kafka_connect` is deliberately absent: Aiven ships no Kafka Connect mark, and the design
// system forbids substituting a look-alike. Resolution goes through this allow-list rather
// than getServiceIcon() alone, because that helper falls back to substring matching and
// would happily hand back the Apache Kafka mark for "kafka_connect".
const markFor: Record<string, string> = {
  pg: 'postgresql',
  kafka: 'apache-kafka',
  clickhouse: 'clickhouse',
  opensearch: 'opensearch',
  datahub: 'datahub',
  application: 'apps',
}

/** The canonical mark for a service type, or null when none exists — never a look-alike. */
export function serviceMark(type: string): ServiceIconRecord | null {
  const id = markFor[type]
  return id ? getServiceIcon(id) : null
}
