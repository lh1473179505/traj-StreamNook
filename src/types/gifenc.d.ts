// Minimal ambient typings for gifenc. The package ships no .d.ts as of 1.0.3.
// Only the surface we actually use is declared here. If we ever wire up more of
// the API (e.g. global palette mode, transparency), extend this rather than
// reaching for `any`.

declare module 'gifenc' {
  export type Palette = number[][];

  export interface WriteFrameOptions {
    palette?: Palette;
    delay?: number;
    transparent?: boolean;
    transparentIndex?: number;
    dispose?: number;
    repeat?: number;
    first?: boolean;
  }

  export interface GIFEncoderInstance {
    writeFrame(
      indexedPixels: Uint8Array | Uint8ClampedArray,
      width: number,
      height: number,
      options?: WriteFrameOptions,
    ): void;
    finish(): void;
    // Concrete ArrayBuffer (not ArrayBufferLike) so the result is assignable
    // to BlobPart in strict TS — the underlying gifenc impl backs the array
    // with a regular ArrayBuffer.
    bytes(): Uint8Array<ArrayBuffer>;
    bytesView(): Uint8Array<ArrayBuffer>;
    reset(): void;
    buffer: ArrayBuffer;
    stream: { writeByte(byte: number): void };
  }

  export interface GIFEncoderOptions {
    auto?: boolean;
    initialCapacity?: number;
  }

  export function GIFEncoder(options?: GIFEncoderOptions): GIFEncoderInstance;

  export function quantize(
    rgba: Uint8Array | Uint8ClampedArray,
    maxColors: number,
    options?: {
      format?: 'rgb565' | 'rgb444' | 'rgba4444';
      clearAlpha?: boolean;
      clearAlphaThreshold?: number;
      oneBitAlpha?: boolean | number;
    },
  ): Palette;

  export function applyPalette(
    rgba: Uint8Array | Uint8ClampedArray,
    palette: Palette,
    format?: 'rgb565' | 'rgb444' | 'rgba4444',
  ): Uint8Array<ArrayBuffer>;
}
