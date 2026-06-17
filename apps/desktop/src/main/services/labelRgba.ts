/** Nearest-neighbor downsample — preserves crisp edges when HiDPI capture must be scaled. */
export function nearestDownsampleRgba(
  src: Buffer,
  srcW: number,
  srcH: number,
  dstW: number,
  dstH: number,
): Buffer {
  const dst = Buffer.alloc(dstW * dstH * 4, 255);
  for (let dy = 0; dy < dstH; dy++) {
    const sy = Math.min(srcH - 1, Math.floor(((dy + 0.5) * srcH) / dstH));
    for (let dx = 0; dx < dstW; dx++) {
      const sx = Math.min(srcW - 1, Math.floor(((dx + 0.5) * srcW) / dstW));
      const si = (sy * srcW + sx) * 4;
      const di = (dy * dstW + dx) * 4;
      dst[di] = src[si] ?? 255;
      dst[di + 1] = src[si + 1] ?? 255;
      dst[di + 2] = src[si + 2] ?? 255;
      dst[di + 3] = src[si + 3] ?? 255;
    }
  }
  return dst;
}

/** Box-filter downsample — preserves text layout better than nearest-neighbor at HiDPI ratios. */
export function boxDownsampleRgba(
  src: Buffer,
  srcW: number,
  srcH: number,
  dstW: number,
  dstH: number,
): Buffer {
  const dst = Buffer.alloc(dstW * dstH * 4, 255);
  for (let dy = 0; dy < dstH; dy++) {
    const sy0 = Math.floor((dy * srcH) / dstH);
    const sy1 = Math.max(sy0 + 1, Math.ceil(((dy + 1) * srcH) / dstH));
    for (let dx = 0; dx < dstW; dx++) {
      const sx0 = Math.floor((dx * srcW) / dstW);
      const sx1 = Math.max(sx0 + 1, Math.ceil(((dx + 1) * srcW) / dstW));
      let b = 0;
      let g = 0;
      let r = 0;
      let count = 0;
      for (let sy = sy0; sy < sy1 && sy < srcH; sy++) {
        for (let sx = sx0; sx < sx1 && sx < srcW; sx++) {
          const si = (sy * srcW + sx) * 4;
          b += src[si] ?? 255;
          g += src[si + 1] ?? 255;
          r += src[si + 2] ?? 255;
          count++;
        }
      }
      const di = (dy * dstW + dx) * 4;
      if (count > 0) {
        dst[di] = Math.round(b / count);
        dst[di + 1] = Math.round(g / count);
        dst[di + 2] = Math.round(r / count);
      }
      dst[di + 3] = 255;
    }
  }
  return dst;
}

export function downsampleRgbaToPrintSize(
  src: Buffer,
  srcW: number,
  srcH: number,
  dstW: number,
  dstH: number,
): Buffer {
  if (srcW === dstW && srcH === dstH) return src;
  return boxDownsampleRgba(src, srcW, srcH, dstW, dstH);
}

export function blitRgba(
  dest: Buffer,
  destW: number,
  destH: number,
  src: Buffer,
  srcW: number,
  srcH: number,
  atX: number,
  atY: number,
  clip?: { x: number; y: number; w: number; h: number },
): void {
  const clipX0 = clip?.x ?? 0;
  const clipY0 = clip?.y ?? 0;
  const clipX1 = clip ? clip.x + clip.w : destW;
  const clipY1 = clip ? clip.y + clip.h : destH;

  for (let y = 0; y < srcH; y++) {
    const dy = atY + y;
    if (dy < clipY0 || dy >= clipY1) continue;
    for (let x = 0; x < srcW; x++) {
      const dx = atX + x;
      if (dx < clipX0 || dx >= clipX1) continue;
      const si = (y * srcW + x) * 4;
      const di = (dy * destW + dx) * 4;
      dest[di] = src[si] ?? 255;
      dest[di + 1] = src[si + 1] ?? 255;
      dest[di + 2] = src[si + 2] ?? 255;
      dest[di + 3] = src[si + 3] ?? 255;
    }
  }
}

/** Blit only dark pixels — preserves underlying text in barcode quiet zones. */
export function blitDarkRgba(
  dest: Buffer,
  destW: number,
  destH: number,
  src: Buffer,
  srcW: number,
  srcH: number,
  atX: number,
  atY: number,
  clip?: { x: number; y: number; w: number; h: number },
): void {
  const clipX0 = clip?.x ?? 0;
  const clipY0 = clip?.y ?? 0;
  const clipX1 = clip ? clip.x + clip.w : destW;
  const clipY1 = clip ? clip.y + clip.h : destH;

  for (let y = 0; y < srcH; y++) {
    const dy = atY + y;
    if (dy < clipY0 || dy >= clipY1) continue;
    for (let x = 0; x < srcW; x++) {
      const dx = atX + x;
      if (dx < clipX0 || dx >= clipX1) continue;
      const si = (y * srcW + x) * 4;
      const b = src[si] ?? 255;
      const g = src[si + 1] ?? 255;
      const r = src[si + 2] ?? 255;
      const lum = 0.299 * r + 0.587 * g + 0.114 * b;
      if (lum >= 128) continue;
      const di = (dy * destW + dx) * 4;
      dest[di] = b;
      dest[di + 1] = g;
      dest[di + 2] = r;
      dest[di + 3] = 255;
    }
  }
}
