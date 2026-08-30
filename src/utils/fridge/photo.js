// Getting a phone photo small enough to send, without making it unreadable.
//
// A modern phone shoots 6048x8064 at 9-12MB (the test shelves were exactly
// that). Sending it raw would be slow on the way up and gain nothing at the
// other end: the API resizes anything longer than 1568px on its long edge
// before the model ever sees it, so pixels beyond that cost upload time and
// buy no accuracy.
//
// Going SMALLER than 1568, though, costs real accuracy. These photos are read
// for the text printed on box spines, some of it a few pixels tall in the
// original. This is not a thumbnail.

export const MAX_EDGE = 1568;

// JPEG at 0.85 — the boxes are photographs, and PNG on a 1568px photo is
// several megabytes for no visible gain. Below about 0.8, JPEG artefacts start
// eating exactly the thing being read: small high-contrast lettering.
export const QUALITY = 0.85;

/**
 * The size to draw at, preserving aspect ratio, never scaling UP.
 *
 * A photo already smaller than the cap is left alone — enlarging it would
 * invent pixels and inflate the upload for a strictly worse image.
 */
export const fitWithin = (width, height, max = MAX_EDGE) => {
  if (!(width > 0) || !(height > 0)) return { width: 0, height: 0 };
  const longest = Math.max(width, height);
  if (longest <= max) return { width: Math.round(width), height: Math.round(height) };
  const scale = max / longest;
  return { width: Math.round(width * scale), height: Math.round(height * scale) };
};

// A data URL is "data:image/jpeg;base64,XXXX" and the API wants only the XXXX.
export const base64FromDataUrl = (dataUrl) => {
  const comma = String(dataUrl || '').indexOf(',');
  return comma === -1 ? '' : dataUrl.slice(comma + 1);
};

/**
 * A File from the camera or photo library -> { image, mediaType } ready to post.
 *
 * createImageBitmap rather than an <img> with an object URL: it decodes off
 * the main thread, and it applies the EXIF orientation flag, which an <img>
 * drawn to a canvas does not. Without that, a photo taken in portrait arrives
 * at the model rotated 90 degrees — every spine sideways.
 */
/**
 * Re-render the ORIGINAL file at a chosen long edge, orientation baked in.
 *
 * The photo sent to the API is capped at MAX_EDGE, because the model resizes
 * to that anyway — but a person zooming in wants the detail the phone
 * actually captured. Same createImageBitmap path as preparePhoto, so the
 * EXIF orientation matches and the scan's fractional boxes still land on the
 * right thing.
 */
export const renderAtEdge = async (file, maxEdge, {
  quality = 0.92,
  createBitmap = (blob) => createImageBitmap(blob, { imageOrientation: 'from-image' }),
  makeCanvas = (width, height) => {
    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    return canvas
  }
} = {}) => {
  const bitmap = await createBitmap(file)
  const { width, height } = fitWithin(bitmap.width, bitmap.height, maxEdge)
  const canvas = makeCanvas(width, height)
  canvas.getContext('2d').drawImage(bitmap, 0, 0, width, height)
  bitmap.close?.()
  return canvas.toDataURL('image/jpeg', quality)
}

export const preparePhoto = async (file, {
  maxEdge = MAX_EDGE,
  quality = QUALITY,
  createBitmap = (blob) => createImageBitmap(blob, { imageOrientation: 'from-image' }),
  makeCanvas = (width, height) => {
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    return canvas;
  },
} = {}) => {
  const bitmap = await createBitmap(file);
  const { width, height } = fitWithin(bitmap.width, bitmap.height, maxEdge);
  const canvas = makeCanvas(width, height);
  canvas.getContext('2d').drawImage(bitmap, 0, 0, width, height);
  bitmap.close?.();

  const dataUrl = canvas.toDataURL('image/jpeg', quality);
  return {
    image: base64FromDataUrl(dataUrl),
    mediaType: 'image/jpeg',
    // Kept so a review card can cut the actual box out of the photo later.
    // The orientation is already baked in at this point, which is what makes
    // the scan's coordinates and this image agree.
    dataUrl,
    width,
    height,
    // Kept so "look closer" can re-render from the original at a resolution
    // the upload deliberately threw away. A reference, not a copy.
    file,
  };
};
