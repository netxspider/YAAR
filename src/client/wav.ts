/** Downsamples captured audio to 16 kHz mono and wraps it as a WAV file for Prisma. */
export function encodeWav(frames: Float32Array[], inputRate: number, outputRate = 16000): Blob {
  const total = frames.reduce((sum, frame) => sum + frame.length, 0);
  const input = new Float32Array(total);
  let offset = 0;
  for (const frame of frames) {
    input.set(frame, offset);
    offset += frame.length;
  }

  const ratio = inputRate / outputRate;
  const length = Math.floor(total / ratio);
  const pcm = new Int16Array(length);
  for (let i = 0; i < length; i++) {
    // Average across the source window: a cheap low-pass that avoids aliasing.
    const start = Math.floor(i * ratio);
    const end = Math.min(total, Math.floor((i + 1) * ratio));
    let sum = 0;
    for (let j = start; j < end; j++) sum += input[j];
    const sample = Math.max(-1, Math.min(1, sum / Math.max(1, end - start)));
    pcm[i] = sample < 0 ? sample * 0x8000 : sample * 0x7fff;
  }

  const header = new DataView(new ArrayBuffer(44));
  const writeString = (at: number, value: string) => {
    for (let i = 0; i < value.length; i++) header.setUint8(at + i, value.charCodeAt(i));
  };
  writeString(0, "RIFF");
  header.setUint32(4, 36 + pcm.byteLength, true);
  writeString(8, "WAVE");
  writeString(12, "fmt ");
  header.setUint32(16, 16, true);
  header.setUint16(20, 1, true);
  header.setUint16(22, 1, true);
  header.setUint32(24, outputRate, true);
  header.setUint32(28, outputRate * 2, true);
  header.setUint16(32, 2, true);
  header.setUint16(34, 16, true);
  writeString(36, "data");
  header.setUint32(40, pcm.byteLength, true);
  return new Blob([header, pcm], { type: "audio/wav" });
}

export function rms(frame: Float32Array): number {
  let sum = 0;
  for (let i = 0; i < frame.length; i++) sum += frame[i] * frame[i];
  return Math.sqrt(sum / frame.length);
}
