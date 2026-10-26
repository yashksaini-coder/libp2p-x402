import { contentRoutingSymbol, type ContentRouting } from '@libp2p/interface'

/**
 * A content router for nodes that deliberately announce nowhere (loopback demos,
 * tests). Without any router, Helia's delete and unpin throw NoContentRoutersError
 * when they try to cancel re-announcement, so a provider could not clean up after a
 * declined payment. Real providers use a DHT or delegated routing instead.
 */
export function localOnlyRouting (): () => { [contentRoutingSymbol]: ContentRouting } {
  return () => ({
    [contentRoutingSymbol]: {
      provide: async () => {},
      cancelReprovide: async () => {},
      findProviders: async function * () {},
      put: async () => {},
      get: async () => { throw new Error('local-only routing has no records') }
    }
  })
}
