import Link from 'next/link'
import { ArrowRight, ArrowUpRight } from '@phosphor-icons/react/ssr'
import { Button, Eyebrow } from '@/components/ui'
import { Reveal } from '@/components/landing/Reveal'
import { HeroMockup } from '@/components/landing/HeroMockup'
import { Bento } from '@/components/landing/Bento'
import { Tagline } from '@/components/landing/Tagline'
import { COMPARE, FAQ, STEPS } from '@/components/landing/content'
import { FaqSection } from '@/components/landing/FaqSection'
import { REPO_URL, SPEC_URL } from '@/lib/config'

const PROOF = 'Settled on Solana devnet · open spec for x402 v2'

function Cta() {
  return (
    <div className="flex flex-col items-center gap-4">
      <Button href="/live">
        Watch it live <ArrowRight size={18} weight="bold" aria-hidden />
      </Button>
      <p className="text-balance font-mono text-xs text-muted">{PROOF}</p>
    </div>
  )
}

function Nav() {
  return (
    <nav aria-label="Main" className="fixed inset-x-0 top-0 z-20 flex justify-center px-4">
      <div className="mt-6 flex w-max items-center gap-6 rounded-full border border-line bg-black/60 py-2 pl-6 pr-2 backdrop-blur-xl">
        <Link href="/" aria-current="page" className="rounded-md font-mono text-sm font-semibold">libp2p x402</Link>
        <ul className="hidden items-center gap-6 text-sm text-muted md:flex">
          <li><a href="#how" className="rounded-md transition-colors duration-300 ease-out hover:text-white">How it works</a></li>
          <li><a href="#spec" className="rounded-md transition-colors duration-300 ease-out hover:text-white">Spec</a></li>
          <li><a href="#faq" className="rounded-md transition-colors duration-300 ease-out hover:text-white">FAQ</a></li>
        </ul>
        <Link href="/live" className="rounded-full bg-white px-3 py-2 text-sm font-semibold text-black transition-all duration-300 ease-out hover:bg-white/85 active:scale-[0.98]">
          Watch it live
        </Link>
      </div>
    </nav>
  )
}

const faqJsonLd = {
  '@context': 'https://schema.org',
  '@type': 'FAQPage',
  mainEntity: FAQ.map(([q, a]) => ({ '@type': 'Question', name: q, acceptedAnswer: { '@type': 'Answer', text: a } })),
}

export default function Home() {
  return (
    <>
      <Nav />
      <main id="main" className="mx-auto flex max-w-6xl flex-col gap-24 px-4 pb-24 pt-24 md:px-8">
        {/* 1. Hero */}
        <section className="flex flex-col items-center gap-16 pt-16 text-center">
          <Reveal className="flex flex-col items-center gap-6">
            <h1 className="max-w-[680px] bg-linear-to-r from-white to-[#9B9B9B] bg-clip-text text-4xl font-semibold tracking-tight text-transparent md:text-5xl">
              Agents that get paid <br className="hidden sm:block" />without running a server
            </h1>
            <p className="max-w-[680px] text-lg text-muted md:text-xl">
              x402 payments over libp2p. One Ed25519 key is the peer and the wallet, so every USDC transfer on Solana goes to the peer that served the bytes.
            </p>
            <Cta />
          </Reveal>
          <div className="w-full text-left">
            <HeroMockup />
          </div>
        </section>

        {/* 2. Problem to solution */}
        <section aria-labelledby="problem" className="flex flex-col gap-12">
          <Reveal className="flex max-w-[680px] flex-col gap-4">
            <Eyebrow>The problem</Eyebrow>
            <h2 id="problem" className="text-4xl font-semibold tracking-tight">x402 assumes a server. Agents do not have one.</h2>
            <p className="text-lg text-muted">
              HTTP x402 works when the seller has a domain, a certificate and an open port. An agent on a laptop, in a browser tab or behind a home router has none of those. It does have a libp2p identity, and that is enough.
            </p>
          </Reveal>
          <Reveal delay={90} className="overflow-hidden rounded-2xl border border-line">
            <table className="w-full text-left text-base">
              <caption className="sr-only">HTTP x402 compared with libp2p x402</caption>
              <thead className="bg-panel">
                <tr>
                  <th scope="col" className="hidden p-4 md:p-6 font-mono text-xs font-normal uppercase tracking-widest text-muted md:table-cell"><span className="sr-only">Aspect</span></th>
                  <th scope="col" className="p-4 md:p-6 font-mono text-xs font-normal uppercase tracking-widest text-muted">HTTP x402</th>
                  <th scope="col" className="p-4 md:p-6 font-mono text-xs font-normal uppercase tracking-widest text-white">libp2p x402</th>
                </tr>
              </thead>
              <tbody>
                {COMPARE.map(([k, http, p2p]) => (
                  <tr key={k} className="border-t border-line align-top">
                    <th scope="row" className="hidden p-4 md:p-6 font-normal text-muted md:table-cell">{k}</th>
                    <td className="p-4 md:p-6 text-muted"><span className="mb-1 block text-xs text-muted md:hidden">{k}</span>{http}</td>
                    <td className="bg-raised p-4 md:p-6 text-white"><span className="mb-1 block text-xs text-muted md:hidden">{k}</span>{p2p}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Reveal>
        </section>

        {/* 3. Bento */}
        <section aria-labelledby="proves" className="flex flex-col gap-12">
          <Reveal className="flex max-w-[680px] flex-col gap-4">
            <Eyebrow>What the payment proves</Eyebrow>
            <h2 id="proves" className="text-4xl font-semibold tracking-tight">Identity, content and integrity in one transfer</h2>
          </Reveal>
          <Bento />
        </section>

        {/* 4. Tagline reveal */}
        <section aria-label="Tagline" className="flex min-h-[50vh] items-center justify-center">
          <Tagline />
        </section>

        {/* 5. How it works */}
        <section id="how" aria-labelledby="how-title" className="flex scroll-mt-24 flex-col gap-12">
          <Reveal className="flex max-w-[680px] flex-col gap-4">
            <Eyebrow>How it works</Eyebrow>
            <h2 id="how-title" className="text-4xl font-semibold tracking-tight">Three steps on one stream</h2>
          </Reveal>
          <ol className="grid gap-6 md:grid-cols-3">
            {STEPS.map((s, i) => (
              <Reveal as="li" key={s.title} delay={i * 90} className="flex flex-col gap-4 rounded-2xl border border-line bg-panel p-6">
                <span className="font-mono text-3xl text-muted">0{i + 1}</span>
                <h3 className="text-xl font-semibold">{s.title}</h3>
                <p className="text-base text-muted">{s.body}</p>
              </Reveal>
            ))}
          </ol>
          <p className="font-mono text-xs text-muted">Fig 2.1 x402 frames on a libp2p stream: rate card, request, invoice, payment, settlement</p>
        </section>

        {/* 6. Spec and open source */}
        <section id="spec" aria-labelledby="spec-title" className="grid scroll-mt-24 gap-12 md:grid-cols-2">
          <Reveal className="flex flex-col gap-4">
            <Eyebrow>Spec and open source</Eyebrow>
            <h2 id="spec-title" className="text-4xl font-semibold tracking-tight">An open transport spec for x402 v2</h2>
            <p className="text-lg text-muted">
              <code className="font-mono text-white">spec/libp2p.md</code> defines the frames, the invoice step and the payee identity rule. Any libp2p implementation can follow it; the demo is one of them.
            </p>
            {SPEC_URL ? (
              <div className="flex flex-wrap gap-3">
                <Button href={SPEC_URL} variant="quiet" target="_blank" rel="noreferrer">
                  Read the spec <ArrowUpRight size={18} aria-hidden />
                </Button>
                <Button href={REPO_URL} variant="quiet" target="_blank" rel="noreferrer">
                  Source on GitHub <ArrowUpRight size={18} aria-hidden />
                </Button>
              </div>
            ) : (
              <p className="text-base text-muted">The repository is not public yet. The spec and both packages publish with it.</p>
            )}
          </Reveal>
          <Reveal delay={90} as="ul" className="flex flex-col gap-4">
            {[
              ['x402-libp2p', 'The payment gate for any libp2p protocol: paid() on the server, payAndOpen() on the client, invoices and manual settlement.'],
              ['ipfs-x402', 'Paid fetch and pin on Helia, with every CAR block hashed against its CID and dag json receipts.'],
            ].map(([name, body]) => (
              <li key={name} className="flex flex-col gap-2 rounded-2xl border border-line bg-panel p-6">
                <code className="font-mono text-base text-white">{name}</code>
                <p className="text-base text-muted">{body}</p>
              </li>
            ))}
          </Reveal>
        </section>

        {/* 7. FAQ */}
        <section id="faq" aria-labelledby="faq-title" className="flex scroll-mt-24 flex-col gap-12">
          <div className="flex max-w-[680px] flex-col gap-4">
            <Eyebrow>FAQ</Eyebrow>
            <h2 id="faq-title" className="text-4xl font-semibold tracking-tight">Questions from the room</h2>
          </div>
          <FaqSection items={FAQ} />
          <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(faqJsonLd).replace(/</g, '\\u003c') }} />
        </section>

        {/* 8. Final CTA */}
        <section aria-labelledby="cta-title" className="flex flex-col items-center gap-6 text-center">
          <h2 id="cta-title" className="max-w-[680px] text-4xl font-semibold tracking-tight md:text-5xl">See a payment settle while the bytes arrive</h2>
          <Cta />
        </section>
      </main>
      <footer className="border-t border-line">
        <div className="mx-auto flex max-w-6xl flex-col gap-4 px-4 py-12 text-sm text-muted md:flex-row md:items-center md:justify-between md:px-8">
          <p><span className="font-mono text-white">libp2p x402</span> · Built for Devcon 8, Mumbai. Solana devnet only.</p>
          <ul className="flex gap-6">
            <li><Link href="/live" className="rounded-md hover:text-white">Live dashboard</Link></li>
            <li><Link href="/live?demo=fixture" className="rounded-md hover:text-white">Recorded replay</Link></li>
            {REPO_URL && <li><a href={REPO_URL} className="rounded-md hover:text-white">GitHub</a></li>}
          </ul>
        </div>
      </footer>
    </>
  )
}
