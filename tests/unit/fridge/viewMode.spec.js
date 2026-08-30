import { describe, it, expect } from 'vitest'
import { resolveViewMode, modeForWidth, WALL_MIN_WIDTH } from '../../../src/utils/fridge/viewMode'

const fakeStorage = (initial = {}) => {
  const map = { ...initial }
  return {
    getItem: (k) => (k in map ? map[k] : null),
    setItem: (k, v) => { map[k] = v },
    map
  }
}

const ctx = ({ search = '', pinned = null, width = 400 } = {}) => ({
  location: { search },
  storage: fakeStorage(pinned ? { 'perishable.viewMode': pinned } : {}),
  width
})

describe('modeForWidth', () => {
  it('a phone is a capture surface, the wall tablet is a display', () => {
    expect(modeForWidth(390)).toBe('phone') // iPhone portrait
    expect(modeForWidth(834)).toBe('phone')
    expect(modeForWidth(WALL_MIN_WIDTH)).toBe('wall')
    expect(modeForWidth(1280)).toBe('wall') // the Galaxy tab in kiosk
  })
})

describe('resolveViewMode', () => {
  it('defaults to the width', () => {
    expect(resolveViewMode(ctx({ width: 390 }))).toBe('phone')
    expect(resolveViewMode(ctx({ width: 1280 }))).toBe('wall')
  })

  it('?view= pins the mode and is remembered', () => {
    const context = ctx({ search: '?view=wall', width: 390 })
    expect(resolveViewMode(context)).toBe('wall')
    expect(context.storage.map['perishable.viewMode']).toBe('wall')
  })

  // The whole point of the override: a wall tablet that fell below the width
  // cutoff would show a capture screen and the kitchen display would be gone.
  it('a pinned wall survives a narrow viewport', () => {
    expect(resolveViewMode(ctx({ pinned: 'wall', width: 320 }))).toBe('wall')
  })

  it('a pinned phone survives a wide one', () => {
    expect(resolveViewMode(ctx({ pinned: 'phone', width: 1600 }))).toBe('phone')
  })

  it('ignores a junk mode rather than blanking the screen', () => {
    expect(resolveViewMode(ctx({ search: '?view=kitchen', width: 1280 }))).toBe('wall')
    expect(resolveViewMode(ctx({ pinned: 'nonsense', width: 1280 }))).toBe('wall')
  })

  it('still resolves when storage is blocked', () => {
    const context = ctx({ search: '?view=phone', width: 1600 })
    context.storage.getItem = () => { throw new Error('blocked') }
    context.storage.setItem = () => { throw new Error('blocked') }
    expect(resolveViewMode(context)).toBe('phone')
  })
})
