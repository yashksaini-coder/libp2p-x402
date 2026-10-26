import { x402Client } from '@x402/core/client'
import { x402Facilitator } from '@x402/core/facilitator'
import { x402ResourceServer, type FacilitatorClient } from '@x402/core/server'
import type { Network, SchemeNetworkClient } from '@x402/core/types'
import { USDC_DEVNET_ADDRESS, toFacilitatorSvmSigner, type FacilitatorSvmSigner } from '@x402/svm'
import { ExactSvmScheme as ExactSvmClient } from '@x402/svm/exact/client'
import { registerExactSvmScheme as registerFacilitatorScheme } from '@x402/svm/exact/facilitator'
import { registerExactSvmScheme as registerServerScheme } from '@x402/svm/exact/server'
import { createKeyPairSignerFromBytes } from '@solana/kit'
import type { Pricing } from 'ipfs-x402'
import { mockSchemeServer, priceFor } from './shared.ts'
import type { Mode } from './events.ts'
import type { KeyRole, RoleKey } from './keys.ts'

export const DEVNET: Network = 'solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1'
export const DEVNET_RPC = process.env.SOLANA_RPC_URL ?? 'https://api.devnet.solana.com'
export const DEVNET_WS = process.env.SOLANA_WS_URL ?? 'wss://api.devnet.solana.com'

/** Called with each transaction signature at the moment the facilitator submits it. */
export type OnSubmit = (signature: string, submittedAt: number) => void

export interface Payments {
  mode: Mode
  network: Network
  asset: string
  scheme: string
  /** A resource server for a provider/seller whose own payee is `payTo`. */
  server: () => Promise<x402ResourceServer>
  /** The agent's paying client. */
  client: x402Client
  pricing: (payTo: string) => Pricing
  /** The in-process facilitator. Browser sellers reach it over loopback HTTP; its fee-payer key never leaves this process. */
  facilitator: FacilitatorClient
  /** Public RPC a browser seller's `exact` scheme may use to embed a blockhash. */
  rpcUrl?: string
}

/**
 * Devnet: real `exact` SVM payments. The facilitator runs in-process with our
 * own devnet fee payer, so we see the exact moment each transaction is
 * submitted (the dashboard's timers start there, not at an inferred time).
 */
export async function devnetPayments (keys: Record<KeyRole, RoleKey>, onSubmit: OnSubmit): Promise<Payments> {
  const feePayer = await createKeyPairSignerFromBytes(keys.feepayer.secret)
  const base = toFacilitatorSvmSigner(feePayer, { defaultRpcUrl: DEVNET_RPC } as any)
  const watched: FacilitatorSvmSigner = {
    ...base,
    sendTransaction: async (tx, network) => {
      const signature = await base.sendTransaction(tx, network)
      onSubmit(signature, Date.now())
      return signature
    }
  }
  const facilitator = registerFacilitatorScheme(new x402Facilitator(), { signer: watched, networks: DEVNET })
  const facilitatorClient: FacilitatorClient = {
    verify: async (p, r) => await facilitator.verify(p, r),
    settle: async (p, r) => await facilitator.settle(p, r),
    getSupported: async () => facilitator.getSupported() as any
  }

  const agent = await createKeyPairSignerFromBytes(keys.agent.secret)
  const client = new x402Client().register(DEVNET, new ExactSvmClient(agent, { rpcUrl: DEVNET_RPC }))

  return {
    mode: 'devnet',
    network: DEVNET,
    asset: USDC_DEVNET_ADDRESS,
    scheme: 'exact',
    client,
    server: async () => {
      const server = registerServerScheme(new x402ResourceServer(facilitatorClient), { networks: [DEVNET], rpcUrl: DEVNET_RPC })
      await server.initialize()
      return server
    },
    pricing: priceFor('exact', DEVNET, USDC_DEVNET_ADDRESS),
    facilitator: facilitatorClient,
    rpcUrl: DEVNET_RPC
  }
}

/**
 * Mock: the x402 wire flow is real, the chain is not. Settlement "submits" a
 * fake signature so the dashboard pipeline runs end to end; the UI labels it MOCK.
 */
export async function mockPayments (onSubmit: OnSubmit): Promise<Payments> {
  let n = 0
  const facilitator: FacilitatorClient = {
    verify: async () => ({ isValid: true, payer: 'mockAgent' }),
    settle: async (_p, r) => {
      const signature = `mock${(++n).toString().padStart(4, '0')}${Date.now().toString(36)}`
      onSubmit(signature, Date.now())
      return { success: true, transaction: signature, network: r.network, payer: 'mockAgent' }
    },
    getSupported: async () => ({ kinds: [{ x402Version: 2, scheme: 'mock', network: DEVNET }], extensions: [], signers: {} })
  }
  const schemeClient: SchemeNetworkClient = { scheme: 'mock', createPaymentPayload: async () => ({ x402Version: 2, payload: { sig: 'mock' } }) }
  return {
    mode: 'mock',
    network: DEVNET,
    asset: 'USDC',
    scheme: 'mock',
    client: new x402Client().register(DEVNET, schemeClient).setSpendControls(false),
    server: async () => {
      const server = new x402ResourceServer(facilitator).register(DEVNET, mockSchemeServer)
      await server.initialize()
      return server
    },
    pricing: priceFor('mock', DEVNET, 'USDC'),
    facilitator
  }
}
