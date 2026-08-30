import { describe, it, expect } from 'vitest'
import {
  fridgeRoot,
  timersPath,
  templatesPath,
  historyPath,
  fridgeKeyPointer,
  templateKey
} from '../../../src/store/fridge/paths'

const KEY = 'aB3xK9mQ2rT7wY4zC8vN1pL6sD0fG5hJ'

describe('fridge paths', () => {
  it('puts a fridge at the top level, not under the hat', () => {
    // The path IS the credential. Under `<hat>/fridge` the secret would sit
    // behind a guessable key — hat names are emails with the punctuation
    // swapped — and RTDB rules have nowhere to receive a key as a parameter.
    expect(fridgeRoot(KEY)).toBe(`fridge/${KEY}`)
    expect(timersPath(KEY)).toBe(`fridge/${KEY}/timers`)
    expect(templatesPath(KEY)).toBe(`fridge/${KEY}/templates`)
    expect(historyPath(KEY)).toBe(`fridge/${KEY}/history`)
  })

  it('keeps the hat pointer inside the hat, where only members can read it', () => {
    expect(fridgeKeyPointer('mattgrosso-gmail-com')).toBe('mattgrosso-gmail-com/fridgeKey')
  })
})

describe('templateKey', () => {
  // Firebase forbids . $ # [ ] / in a key. Both of these are ordinary things
  // to buy, and both used to make the write throw inside a try/catch that only
  // logged — so the food simply never got learned and nobody found out.
  it('survives the characters Firebase refuses', () => {
    expect(templateKey('Dr. Pepper')).toBe('Dr_ Pepper')
    expect(templateKey('1/2 gallon milk')).toBe('1_2 gallon milk')
    expect(templateKey('Ben & Jerry\'s #1')).toBe("Ben & Jerry's _1")
    expect(templateKey('a.b$c#d[e]f/g')).toBe('a_b_c_d_e_f_g')
  })

  it('contains no forbidden character whatever it is given', () => {
    const nasty = 'Milk. $2 #aisle [3]/gal'
    expect(templateKey(nasty)).not.toMatch(/[.$#[\]/]/)
  })

  it('trims, and treats nothing as an empty key rather than throwing', () => {
    expect(templateKey('  Eggs  ')).toBe('Eggs')
    expect(templateKey(null)).toBe('')
    expect(templateKey(undefined)).toBe('')
  })
})
