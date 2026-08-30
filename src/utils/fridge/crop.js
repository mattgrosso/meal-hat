// Cutting one game's box out of the photo you took.
//
// Matt, on the first real run: "I don't know which game from the photo it's
// talking about (I mean, I can guess but it's not a great UI)." He was right.
// The review card described the box in words — "black box with white dice
// pips, left side middle" — which is a riddle, not a picture. Showing the
// actual box out of his own photo is the answer.
//
// The scan returns a box per game as fractions of the image, verified against
// a real shelf: 20 of 20 crops landed on the right game. The one thing that
// can break it is an orientation mismatch — a first test cropped the raw
// landscape pixel array while the model had seen the EXIF-rotated portrait
// image, and every crop came back as ceiling and window. preparePhoto bakes
// the orientation in before upload precisely so both sides agree.

// A little air around the box, so it reads as "this one, here" rather than a
// texture swatch. Tight crops of a game spine are unrecognisable.
export const PADDING = 0.12;

// Wider than tall, because a card shows it in a letterbox and a shelf spine
// cropped to its own aspect would be a sliver.
export const MIN_ASPECT = 0.55;

/**
 * Box fractions -> pixel rectangle, padded, clamped, and never zero-sized.
 *
 * Pure so the arithmetic can be tested without a canvas — which matters,
 * because every bug this has had was arithmetic.
 */
export const cropRect = (box, width, height, { padding = PADDING } = {}) => {
  if (!box || !(width > 0) || !(height > 0)) return null;

  const x = Number(box.x);
  const y = Number(box.y);
  const w = Number(box.width);
  const h = Number(box.height);
  if (![x, y, w, h].every(Number.isFinite) || w <= 0 || h <= 0) return null;

  const padX = w * padding;
  const padY = h * padding;
  let left = (x - padX) * width;
  let top = (y - padY) * height;
  let right = (x + w + padX) * width;
  let bottom = (y + h + padY) * height;

  // A tall narrow spine gets widened toward the letterbox the card renders in,
  // so the neighbours either side give it context.
  const cropW = right - left;
  const cropH = bottom - top;
  if (cropH > 0 && cropW / cropH < MIN_ASPECT) {
    const wanted = cropH * MIN_ASPECT;
    const grow = (wanted - cropW) / 2;
    left -= grow;
    right += grow;
  }

  left = Math.max(0, Math.round(left));
  top = Math.max(0, Math.round(top));
  right = Math.min(width, Math.round(right));
  bottom = Math.min(height, Math.round(bottom));

  if (right <= left || bottom <= top) return null;
  return { left, top, width: right - left, height: bottom - top };
};

/**
 * Crop a data URL to a smaller data URL. Browser-only; the geometry above is
 * where the logic lives.
 */
export const cropToDataUrl = async (dataUrl, box, {
  maxEdge = 480,
  quality = 0.82,
  loadImage = (src) => new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = reject;
    image.src = src;
  }),
  makeCanvas = (width, height) => {
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    return canvas;
  },
} = {}) => {
  if (!dataUrl) return null;
  const image = await loadImage(dataUrl);
  const rect = cropRect(box, image.naturalWidth || image.width, image.naturalHeight || image.height);
  if (!rect) return null;

  const scale = Math.min(1, maxEdge / Math.max(rect.width, rect.height));
  const outW = Math.max(1, Math.round(rect.width * scale));
  const outH = Math.max(1, Math.round(rect.height * scale));

  const canvas = makeCanvas(outW, outH);
  canvas.getContext('2d').drawImage(
    image, rect.left, rect.top, rect.width, rect.height, 0, 0, outW, outH,
  );
  return canvas.toDataURL('image/jpeg', quality);
};
