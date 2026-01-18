/**
 * Converts a Float32Array audio buffer to a WAV file Blob
 * @param float32Array - Audio data as Float32Array (values between -1 and 1)
 * @param sampleRate - Sample rate in Hz (default: 16000 for speech recognition)
 * @returns Blob containing WAV file data
 */
export function float32ToWav(float32Array: Float32Array, sampleRate: number = 16000): Blob {
    // Validate input
    if (!float32Array || float32Array.length === 0) {
        throw new Error('Invalid audio data: empty or null array');
    }

    const numChannels = 1; // Mono
    const bitsPerSample = 16;
    const bytesPerSample = bitsPerSample / 8;
    const blockAlign = numChannels * bytesPerSample;
    const byteRate = sampleRate * blockAlign;
    const dataSize = float32Array.length * bytesPerSample;
    const bufferSize = 44 + dataSize;

    const buffer = new ArrayBuffer(bufferSize);
    const view = new DataView(buffer);
  
    // RIFF chunk descriptor
    writeString(view, 0, 'RIFF');
    view.setUint32(4, bufferSize - 8, true); // File size minus RIFF header
    writeString(view, 8, 'WAVE');
    
    // fmt sub-chunk
    writeString(view, 12, 'fmt ');
    view.setUint32(16, 16, true); // Subchunk1 size (16 for PCM)
    view.setUint16(20, 1, true); // Audio format (1 = PCM)
    view.setUint16(22, numChannels, true); // Number of channels
    view.setUint32(24, sampleRate, true); // Sample rate
    view.setUint32(28, byteRate, true); // Byte rate
    view.setUint16(32, blockAlign, true); // Block align
    view.setUint16(34, bitsPerSample, true); // Bits per sample
    
    // data sub-chunk
    writeString(view, 36, 'data');
    view.setUint32(40, dataSize, true);
  
    // Write PCM samples
    let offset = 44;
    for (let i = 0; i < float32Array.length; i++, offset += 2) {
      // Clamp values to [-1, 1] range
      const sample = Math.max(-1, Math.min(1, float32Array[i]));
      
      // Convert to 16-bit PCM
      const int16Sample = sample < 0 ? sample * 0x8000 : sample * 0x7FFF;
      view.setInt16(offset, int16Sample, true);
    }
  
    return new Blob([buffer], { type: 'audio/wav' });
}

/**
 * Writes a string to a DataView at the specified offset
 * @param view - DataView to write to
 * @param offset - Byte offset to start writing
 * @param string - String to write
 */
function writeString(view: DataView, offset: number, string: string): void {
    for (let i = 0; i < string.length; i++) {
      view.setUint8(offset + i, string.charCodeAt(i));
    }
}

/**
 * Gets the duration of audio in seconds
 * @param float32Array - Audio data
 * @param sampleRate - Sample rate in Hz
 * @returns Duration in seconds
 */
export function getAudioDuration(float32Array: Float32Array, sampleRate: number = 16000): number {
    return float32Array.length / sampleRate;
}
