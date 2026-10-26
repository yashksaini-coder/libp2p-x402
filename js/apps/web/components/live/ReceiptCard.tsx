'use client'

import { motion } from 'motion/react'
import { ArrowRight, ArrowUpRight } from '@phosphor-icons/react/ssr'
import type { LiveState } from '@/lib/reduce'
import { explorerTx } from '@/lib/config'
import { Eyebrow, Mono, Panel, short } from '@/components/ui'

const item = {
  hidden: { opacity: 0, y: 10, filter: 'blur(4px)' },
  show: { opacity: 1, y: 0, filter: 'blur(0px)' },
}

export function ReceiptCard({ state, linkable }: { state: LiveState, linkable: boolean }) {
  const r = state.receipt
  return (
    <Panel className="col-span-4 flex min-h-0 flex-col gap-4 overflow-hidden p-6" aria-label="Latest receipt">
      <Eyebrow data-load>Latest receipt · dag json in Helia</Eyebrow>
      {!r ? (
        <div className="grid flex-1 place-items-center text-center text-xl text-muted" data-load>
          No receipt yet. A paid pin returns one that names the content and the transaction.
        </div>
      ) : (
        <motion.dl
          key={r.receiptCid}
          className="flex flex-col gap-3 text-xl"
          initial="hidden"
          animate="show"
          transition={{ staggerChildren: 0.12 }}
          data-load
        >
          <motion.div variants={item} className="flex flex-wrap items-center gap-2">
            <dt className="sr-only">Content</dt>
            <dd><Mono className="text-white">{short(r.cid, 10, 4)}</Mono></dd>
            <ArrowRight size={20} className="text-muted" aria-hidden />
            <dt className="sr-only">Transaction</dt>
            <dd>
              {linkable ? (
                <a href={explorerTx(r.tx)} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 rounded-md font-mono text-white underline-offset-4 hover:underline">
                  {short(r.tx, 8, 4)} <ArrowUpRight size={20} aria-hidden /><span className="sr-only">(opens Solana Explorer)</span>
                </a>
              ) : (
                <Mono className="text-white">{short(r.tx, 8, 4)}</Mono>
              )}
            </dd>
          </motion.div>
          {([
            ['Receipt', short(r.receiptCid, 10, 4)],
            ['Payer', short(r.payer, 6, 4)],
            ['Payee', short(r.payee, 6, 4)],
            ['Bytes', r.bytes.toLocaleString('en-US')],
            ['Expires', r.expiresAt.slice(0, 10)],
          ] as const).map(([k, v]) => (
            <motion.div key={k} variants={item} className="flex justify-between gap-4">
              <dt className="text-muted">{k}</dt>
              <dd><Mono>{v}</Mono></dd>
            </motion.div>
          ))}
        </motion.dl>
      )}
    </Panel>
  )
}
