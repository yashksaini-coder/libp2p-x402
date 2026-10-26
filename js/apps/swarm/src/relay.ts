import { createLibp2p, type Libp2p } from 'libp2p'
import { webSockets } from '@libp2p/websockets'
import { circuitRelayServer } from '@libp2p/circuit-relay-v2'
import { noise } from '@libp2p/noise'
import { yamux } from '@libp2p/yamux'
import { identify, identifyPush } from '@libp2p/identify'
import type { PeerId } from '@libp2p/interface'
import { FETCH_PROTOCOL } from 'ipfs-x402'

export interface Relay {
  libp2p: Libp2p
  /** The WebSockets address browsers dial, with /p2p/<relay>. */
  addr: string
  /** The browser seller currently holding a connection to us, if any. */
  tab: () => PeerId | undefined
  /** Accept this PeerId as a tab. Called only after it proved the control token (POST /sell/register). */
  allow: (peer: PeerId) => Promise<void>
}

/**
 * Circuit relay v2 on loopback WebSockets: the only way a browser tab can be dialled.
 * A connected peer that serves the paid fetch protocol is a browser seller ("tab"), but only if it
 * registered with the control token first: any web page can open ws://127.0.0.1, and the agent pays the tab.
 */
export async function startRelay (port: number, onTab: (tab: PeerId, up: boolean) => void): Promise<Relay> {
  const libp2p = await createLibp2p({
    addresses: { listen: [`/ip4/127.0.0.1/tcp/${port}/ws`] },
    transports: [webSockets()],
    connectionEncrypters: [noise()],
    streamMuxers: [yamux()],
    services: { identify: identify(), identifyPush: identifyPush(), relay: circuitRelayServer() }
  } as any)
  // ponytail: one tab at a time; the newest seller wins. Track a set if the demo ever shows several.
  let tab: PeerId | undefined
  const allowed = new Set<string>()
  const seen = (peer: PeerId, protocols: string[]): void => {
    if (!allowed.has(peer.toString()) || tab?.equals(peer) === true || !protocols.includes(FETCH_PROTOCOL) || libp2p.getConnections(peer).length === 0) return
    tab = peer
    onTab(peer, true)
  }
  // A tab registers its handler after connecting, so it arrives by identify-push (peer:update); a reload repeats identify.
  libp2p.addEventListener('peer:identify', ({ detail }) => { seen(detail.peerId, detail.protocols) })
  libp2p.addEventListener('peer:update', ({ detail: { peer } }) => { seen(peer.id, peer.protocols) })
  libp2p.addEventListener('peer:disconnect', ({ detail: peer }) => {
    if (tab?.equals(peer) !== true) return
    tab = undefined
    onTab(peer, false)
  })
  const allow = async (peer: PeerId): Promise<void> => {
    allowed.add(peer.toString())
    // It may have connected and identified already.
    const known = await libp2p.peerStore.get(peer).catch(() => undefined)
    if (known != null) seen(peer, known.protocols)
  }
  return { libp2p, addr: libp2p.getMultiaddrs()[0].toString(), tab: () => tab, allow }
}
