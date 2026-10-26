import Link from 'next/link'
import { PlugsConnected } from '@phosphor-icons/react/ssr'
import type { Link as SwarmLink } from '@/lib/useSwarm'
import { SWARM_URL } from '@/lib/config'
import { Mono } from '@/components/ui'

export function OfflineState({ link }: { link: SwarmLink }) {
  return (
    <div role="alert" className="absolute inset-0 z-10 grid place-items-center bg-black/80">
      <div className="flex max-w-xl flex-col items-center gap-4 rounded-2xl border border-line bg-panel p-8 text-center">
        <PlugsConnected size={40} className="text-muted" aria-hidden />
        <h2 className="text-3xl font-semibold">Engine offline</h2>
        <p className="text-xl text-muted">
          The dashboard cannot reach the swarm at <Mono className="text-white">{SWARM_URL}</Mono>.{' '}
          {link.retryIn != null ? `Retrying in ${link.retryIn} s.` : 'Retrying.'}
        </p>
        <p className="text-xl text-muted">
          Start it with <Mono className="text-white">node src/main.ts --mode devnet</Mono>
        </p>
        <Link href="/live?demo=fixture" className="rounded-lg border border-line px-3 py-2 text-base font-semibold transition-all duration-300 ease-out hover:bg-hover active:scale-[0.98]">
          Play the recorded replay instead
        </Link>
      </div>
    </div>
  )
}
