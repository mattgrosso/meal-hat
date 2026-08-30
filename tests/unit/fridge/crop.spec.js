import { describe, it, expect, vi } from 'vitest'
import { cropRect, cropToDataUrl, PADDING, MIN_ASPECT } from '../../../src/utils/fridge/crop.js'

// The geometry is tested without a canvas because every bug this has had was
// arithmetic — most memorably cropping a landscape pixel array while the model
// had seen the EXIF-rotated portrait image, which turned twenty crops of game
// boxes into twenty crops of ceiling.

const IMAGE = { w: 1000, h: 2000 }

describe('cropRect', () => {
  it('turns fractions into pixels', () => {
    const rect = cropRect({ x: 0.5, y: 0.25, width: 0.2, height: 0.1 }, IMAGE.w, IMAGE.h, { padding: 0 })
    expect(rect).toEqual({ left: 500, top: 500, width: 200, height: 200 })
  })

  // A tight crop of a game spine is an unrecognisable texture swatch.
  it('leaves air around the box', () => {
    const rect = cropRect({ x: 0.5, y: 0.5, width: 0.1, height: 0.1 }, 1000, 1000)
    expect(rect.width).toBeGreaterThan(100)
    expect(rect.left).toBeLessThan(500)
  })

  // Real numbers off a real shelf: a spine is often under 5% of the width and
  // cropping it to its own aspect would give a sliver nobody can read.
  it('widens a tall narrow spine toward the letterbox it is shown in', () => {
    const rect = cropRect({ x: 0.5, y: 0.2, width: 0.02, height: 0.3 }, 1000, 1000)
    expect(rect.width / rect.height).toBeGreaterThanOrEqual(MIN_ASPECT - 0.01)
  })

  // Padding on a box at the edge of the photo must not produce a negative
  // origin, which canvas silently treats as transparent pixels.
  it('stays inside the photo at the edges', () => {
    const rect = cropRect({ x: 0, y: 0, width: 0.1, height: 0.1 }, 1000, 1000)
    expect(rect.left).toBe(0)
    expect(rect.top).toBe(0)

    const far = cropRect({ x: 0.95, y: 0.95, width: 0.05, height: 0.05 }, 1000, 1000)
    expect(far.left + far.width).toBeLessThanOrEqual(1000)
    expect(far.top + far.height).toBeLessThanOrEqual(1000)
  })

  it('refuses a box it cannot use', () => {
    expect(cropRect(null, 1000, 1000)).toBe(null)
    expect(cropRect({ x: 0, y: 0, width: 0, height: 0.1 }, 1000, 1000)).toBe(null)
    expect(cropRect({ x: 'a', y: 0, width: 0.1, height: 0.1 }, 1000, 1000)).toBe(null)
    expect(cropRect({ x: 0, y: 0, width: 0.1, height: 0.1 }, 0, 0)).toBe(null)
  })

  it('uses the padding constant by default', () => {
    const padded = cropRect({ x: 0.4, y: 0.4, width: 0.2, height: 0.2 }, 1000, 1000)
    const bare = cropRect({ x: 0.4, y: 0.4, width: 0.2, height: 0.2 }, 1000, 1000, { padding: 0 })
    expect(padded.width).toBeCloseTo(bare.width * (1 + PADDING * 2), 0)
  })
})

describe('cropToDataUrl', () => {
  const harness = () => {
    const drawImage = vi.fn()
    const canvas = {
      width: 0,
      height: 0,
      getContext: () => ({ drawImage }),
      toDataURL: vi.fn(() => 'data:image/jpeg;base64,CROPPED'),
    }
    return {
      drawImage,
      canvas,
      options: {
        loadImage: async () => ({ naturalWidth: 1000, naturalHeight: 1000 }),
        makeCanvas: (width, height) => Object.assign(canvas, { width, height }),
      },
    }
  }

  it('draws only the requested rectangle', async () => {
    const { drawImage, options } = harness()
    const out = await cropToDataUrl('data:image/jpeg;base64,FULL', { x: 0.5, y: 0.5, width: 0.2, height: 0.2 }, options)

    expect(out).toBe('data:image/jpeg;base64,CROPPED')
    const [, sx, sy, sw, sh] = drawImage.mock.calls[0]
    expect(sx).toBeGreaterThan(400)
    expect(sy).toBeGreaterThan(400)
    expect(sw).toBeLessThan(1000)
    expect(sh).toBeLessThan(1000)
  })

  // A card shows this at 150px tall; shipping a 1568px crop per review would
  // be megabytes of data URL for nothing.
  it('scales the crop down to something a card can use', async () => {
    const { canvas, options } = harness()
    await cropToDataUrl('data:image/jpeg;base64,FULL', { x: 0, y: 0, width: 1, height: 1 }, { ...options, maxEdge: 480 })
    expect(Math.max(canvas.width, canvas.height)).toBe(480)
  })

  it('returns nothing rather than throwing on a bad box', async () => {
    const { options } = harness()
    expect(await cropToDataUrl('data:image/jpeg;base64,FULL', null, options)).toBe(null)
    expect(await cropToDataUrl(null, { x: 0, y: 0, width: 1, height: 1 }, options)).toBe(null)
  })
})
