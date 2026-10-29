import { test } from 'node:test'
import assert from 'node:assert/strict'
import { accountUsable, WALLET_CHAIN } from './wallet.ts'
import { walletBrowseLinks } from './deeplinks.ts'

test('accountUsable refuses a non devnet account', () => {
  assert.deepEqual(accountUsable({ chains: ['solana:mainnet'], features: ['solana:signTransaction'] }), { ok: false, reason: 'not_devnet' })
})

test('accountUsable refuses a devnet account that cannot sign transactions', () => {
  assert.deepEqual(accountUsable({ chains: [WALLET_CHAIN], features: ['solana:signMessage'] }), { ok: false, reason: 'no_sign_transaction' })
})

test('accountUsable accepts devnet with signTransaction', () => {
  assert.deepEqual(accountUsable({ chains: ['solana:devnet'], features: ['solana:signTransaction'] }), { ok: true })
})

test('walletBrowseLinks builds the three deeplinks', () => {
  const url = 'https://try.example.org/try'
  const u = encodeURIComponent(url)
  const ref = encodeURIComponent('https://try.example.org')
  assert.deepEqual(walletBrowseLinks(url), [
    { name: 'Phantom', href: `https://phantom.com/ul/browse/${u}?ref=${ref}` },
    { name: 'Solflare', href: `https://solflare.com/ul/v1/browse/${u}?ref=${ref}` },
    { name: 'Backpack', href: `https://backpack.app/ul/v1/browse/${u}?ref=${ref}` },
  ])
})
