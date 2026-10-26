import { ArrowLeft } from '@phosphor-icons/react/ssr'
import { Button, Eyebrow } from '@/components/ui'

export const metadata = { title: 'Not found' }

export default function NotFound() {
  return (
    <main id="main" className="grid min-h-dvh place-items-center px-4">
      <div className="flex max-w-[680px] flex-col items-center gap-6 text-center">
        <Eyebrow>404 · no provider for this path</Eyebrow>
        <h1 className="text-5xl font-semibold tracking-tight">Nothing is pinned here</h1>
        <p className="text-lg text-muted">This page does not exist. No payment was taken.</p>
        <div className="flex flex-wrap justify-center gap-3">
          <Button href="/"><ArrowLeft size={18} weight="bold" aria-hidden /> Back to the start</Button>
          <Button href="/live" variant="quiet">Watch it live</Button>
        </div>
      </div>
    </main>
  )
}
