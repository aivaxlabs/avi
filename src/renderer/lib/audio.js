import lamejs from 'lamejs';

export async function createMp3Attachment(chunks) {
  const sourceBlob = new Blob(chunks);
  const arrayBuffer = await sourceBlob.arrayBuffer();
  const context = new AudioContext();
  const audioBuffer = await context.decodeAudioData(arrayBuffer);
  const samples = toMonoSamples(audioBuffer);
  const encoder = new lamejs.Mp3Encoder(1, audioBuffer.sampleRate, 128);
  const parts = [];

  for (let i = 0; i < samples.length; i += 1152) {
    const chunk = samples.subarray(i, i + 1152);
    const encoded = encoder.encodeBuffer(chunk);
    if (encoded.length) parts.push(encoded);
  }

  const tail = encoder.flush();
  if (tail.length) parts.push(tail);
  await context.close();

  const mp3Blob = new Blob(parts, { type: 'audio/mpeg' });
  const base64 = await blobToBase64(mp3Blob);
  return {
    id: crypto.randomUUID(),
    name: `recording-${Date.now()}.mp3`,
    mime: 'audio/mpeg',
    size: mp3Blob.size,
    kind: 'input_audio',
    base64,
    format: 'mp3',
  };
}

function toMonoSamples(audioBuffer) {
  const channel = audioBuffer.getChannelData(0);
  const samples = new Int16Array(channel.length);
  for (let i = 0; i < channel.length; i += 1) {
    const clamped = Math.max(-1, Math.min(1, channel[i]));
    samples[i] = clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff;
  }
  return samples;
}

function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener('load', () => resolve(String(reader.result).split(',')[1] ?? ''));
    reader.addEventListener('error', () => reject(reader.error));
    reader.readAsDataURL(blob);
  });
}
