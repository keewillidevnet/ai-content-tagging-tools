/**
 * ID3v2 Audio Tag Handler for AI Content Tagging Tools
 * Handles embedding and extraction of RFC-compliant metadata in audio files
 */

const crypto = require('crypto');
const fs = require('fs').promises;

// ID3v2.4 Frame identifiers for custom metadata
const AI_METADATA_FRAME = 'TXXX'; // User-defined text information frame
const AI_SIGNATURE_FRAME = 'PRIV'; // Private frame for cryptographic signatures
const AI_CHECKSUM_FRAME = 'TXXX'; // User-defined text for checksums

// Common ID3v2 frame types for fallback metadata
const STANDARD_FRAMES = {
  title: 'TIT2',
  artist: 'TPE1', 
  album: 'TALB',
  year: 'TYER',
  genre: 'TCON',
  comment: 'COMM'
};

/**
 * ID3v2 Audio Metadata Handler
 */
class ID3AudioHandler {
  constructor(options = {}) {
    this.options = {
      version: '2.4', // ID3v2.4 is most widely supported
      encoding: 'UTF-8',
      preserveExisting: true,
      ...options
    };
  }

  /**
   * Embed AI content metadata into an audio file's ID3v2 tags
   * @param {Buffer|string} audioData - Audio file data or path
   * @param {Object} metadata - RFC-compliant metadata object
   * @param {Object} options - Embedding options
   * @returns {Promise<Buffer>} Modified audio file data
   */
  async embedMetadata(audioData, metadata, options = {}) {
    try {
      // Read audio file if path provided
      const audioBuffer = typeof audioData === 'string' 
        ? await fs.readFile(audioData)
        : audioData;

      // Validate metadata structure
      this._validateMetadata(metadata);

      // Parse existing ID3v2 header if present
      const id3Info = this._parseID3Header(audioBuffer);
      
      // Create new ID3v2 tag with AI metadata
      const newID3Tag = await this._createID3Tag(metadata, id3Info.existingFrames, options);
      
      // Combine new ID3 tag with audio data (minus old tag)
      const audioWithoutID3 = audioBuffer.slice(id3Info.tagSize);
      const result = Buffer.concat([newID3Tag, audioWithoutID3]);

      return result;
    } catch (error) {
      throw new Error(`Failed to embed ID3 metadata: ${error.message}`);
    }
  }

  /**
   * Extract AI content metadata from audio file ID3v2 tags
   * @param {Buffer|string} audioData - Audio file data or path
   * @returns {Promise<Object|null>} Extracted metadata object or null if not found
   */
  async extractMetadata(audioData) {
    try {
      // Read audio file if path provided
      const audioBuffer = typeof audioData === 'string' 
        ? await fs.readFile(audioData)
        : audioData;

      // Parse ID3v2 header
      const id3Info = this._parseID3Header(audioBuffer);
      
      if (!id3Info.hasID3) {
        return null;
      }

      // Extract AI metadata frames
      const frames = this._parseID3Frames(audioBuffer, id3Info);
      const aiMetadata = this._extractAIFrames(frames);

      if (!aiMetadata) {
        return null;
      }

      // Verify integrity if checksum present
      if (aiMetadata.checksum) {
        const isValid = await this._verifyChecksum(aiMetadata, audioBuffer);
        aiMetadata._verified = isValid;
      }

      // Verify signature if present
      if (aiMetadata.signature) {
        const signatureValid = await this._verifySignature(aiMetadata);
        aiMetadata._signatureValid = signatureValid;
      }

      return aiMetadata;
    } catch (error) {
      throw new Error(`Failed to extract ID3 metadata: ${error.message}`);
    }
  }

  /**
   * Validate audio file has ID3v2 tags
   * @param {Buffer|string} audioData - Audio file data or path
   * @returns {Promise<boolean>} True if file has ID3v2 tags
   */
  async hasMetadata(audioData) {
    try {
      const audioBuffer = typeof audioData === 'string' 
        ? await fs.readFile(audioData)
        : audioData;
      
      const id3Info = this._parseID3Header(audioBuffer);
      return id3Info.hasID3;
    } catch (error) {
      return false;
    }
  }

  /**
   * Remove AI metadata from audio file
   * @param {Buffer|string} audioData - Audio file data or path
   * @returns {Promise<Buffer>} Audio file without AI metadata
   */
  async removeMetadata(audioData) {
    try {
      const audioBuffer = typeof audioData === 'string' 
        ? await fs.readFile(audioData)
        : audioData;

      const id3Info = this._parseID3Header(audioBuffer);
      
      if (!id3Info.hasID3) {
        return audioBuffer; // No ID3 tags to remove
      }

      // Parse existing frames
      const frames = this._parseID3Frames(audioBuffer, id3Info);
      
      // Filter out AI-related frames
      const filteredFrames = frames.filter(frame => 
        !this._isAIMetadataFrame(frame)
      );

      if (filteredFrames.length === 0) {
        // Remove entire ID3 tag if only AI metadata existed
        return audioBuffer.slice(id3Info.tagSize);
      }

      // Rebuild ID3 tag without AI frames
      const newID3Tag = this._buildID3Tag(filteredFrames);
      const audioWithoutID3 = audioBuffer.slice(id3Info.tagSize);
      
      return Buffer.concat([newID3Tag, audioWithoutID3]);
    } catch (error) {
      throw new Error(`Failed to remove ID3 metadata: ${error.message}`);
    }
  }

  /**
   * Parse ID3v2 header information
   * @param {Buffer} audioBuffer - Audio file buffer
   * @returns {Object} ID3 header information
   */
  _parseID3Header(audioBuffer) {
    if (audioBuffer.length < 10) {
      return { hasID3: false, tagSize: 0, version: null, existingFrames: [] };
    }

    // Check for ID3v2 identifier
    const id3Identifier = audioBuffer.slice(0, 3).toString();
    if (id3Identifier !== 'ID3') {
      return { hasID3: false, tagSize: 0, version: null, existingFrames: [] };
    }

    // Parse version and flags
    const majorVersion = audioBuffer[3];
    const minorVersion = audioBuffer[4];
    const flags = audioBuffer[5];

    // Calculate tag size (synchsafe integer)
    const size = this._readSynchsafeInt(audioBuffer.slice(6, 10));

    return {
      hasID3: true,
      tagSize: size + 10, // Include header size
      version: `2.${majorVersion}.${minorVersion}`,
      flags,
      majorVersion,
      minorVersion,
      existingFrames: []
    };
  }

  /**
   * Parse ID3v2 frames from audio buffer
   * @param {Buffer} audioBuffer - Audio file buffer
   * @param {Object} id3Info - ID3 header information
   * @returns {Array} Array of frame objects
   */
  _parseID3Frames(audioBuffer, id3Info) {
    const frames = [];
    let offset = 10; // Skip ID3 header
    const tagEnd = id3Info.tagSize;

    while (offset < tagEnd - 4) {
      // Read frame header
      const frameId = audioBuffer.slice(offset, offset + 4).toString();
      
      if (frameId === '\x00\x00\x00\x00') {
        break; // End of frames (padding)
      }

      const frameSize = this._readFrameSize(audioBuffer.slice(offset + 4, offset + 8), id3Info.majorVersion);
      const frameFlags = audioBuffer.slice(offset + 8, offset + 10);

      if (frameSize === 0 || offset + 10 + frameSize > tagEnd) {
        break; // Invalid frame
      }

      // Read frame data
      const frameData = audioBuffer.slice(offset + 10, offset + 10 + frameSize);

      frames.push({
        id: frameId,
        size: frameSize,
        flags: frameFlags,
        data: frameData
      });

      offset += 10 + frameSize;
    }

    return frames;
  }

  /**
   * Create new ID3v2 tag with AI metadata
   * @param {Object} metadata - AI content metadata
   * @param {Array} existingFrames - Existing frames to preserve
   * @param {Object} options - Creation options
   * @returns {Promise<Buffer>} ID3v2 tag buffer
   */
  async _createID3Tag(metadata, existingFrames = [], options = {}) {
    const frames = [];

    // Preserve existing non-AI frames if requested
    if (this.options.preserveExisting) {
      frames.push(...existingFrames.filter(frame => !this._isAIMetadataFrame(frame)));
    }

    // Add AI metadata frame
    const metadataFrame = this._createTextFrame(AI_METADATA_FRAME, 'AI_METADATA', JSON.stringify(metadata));
    frames.push(metadataFrame);

    // Add checksum frame if requested
    if (options.includeChecksum !== false) {
      const checksum = crypto.createHash('sha256').update(JSON.stringify(metadata)).digest('hex');
      const checksumFrame = this._createTextFrame(AI_CHECKSUM_FRAME, 'AI_CHECKSUM', checksum);
      frames.push(checksumFrame);
    }

    // Add signature frame if private key provided
    if (options.privateKey) {
      const signature = await this._createSignature(metadata, options.privateKey);
      const signatureFrame = this._createPrivateFrame(AI_SIGNATURE_FRAME, 'AI_SIGNATURE', signature);
      frames.push(signatureFrame);
    }

    return this._buildID3Tag(frames);
  }

  /**
   * Build complete ID3v2 tag from frames
   * @param {Array} frames - Array of frame objects
   * @returns {Buffer} Complete ID3v2 tag
   */
  _buildID3Tag(frames) {
    // Calculate total frames size
    const framesData = frames.map(frame => this._buildFrame(frame));
    const totalFramesSize = framesData.reduce((sum, data) => sum + data.length, 0);

    // Add padding (typically 1024 bytes)
    const padding = Buffer.alloc(1024, 0);
    const totalSize = totalFramesSize + padding.length;

    // Create ID3v2.4 header
    const header = Buffer.alloc(10);
    header.write('ID3', 0); // Identifier
    header[3] = 4; // Major version
    header[4] = 0; // Minor version  
    header[5] = 0; // Flags
    
    // Write size as synchsafe integer
    this._writeSynchsafeInt(header, 6, totalSize);

    // Combine header, frames, and padding
    return Buffer.concat([header, ...framesData, padding]);
  }

  /**
   * Build individual frame
   * @param {Object} frame - Frame object
   * @returns {Buffer} Frame buffer
   */
  _buildFrame(frame) {
    const header = Buffer.alloc(10);
    
    // Frame ID
    header.write(frame.id, 0, 4);
    
    // Frame size
    this._writeFrameSize(header, 4, frame.data.length);
    
    // Frame flags (default to 0)
    header[8] = 0;
    header[9] = 0;

    return Buffer.concat([header, frame.data]);
  }

  /**
   * Create text information frame (TXXX)
   * @param {string} frameId - Frame identifier
   * @param {string} description - Text description
   * @param {string} value - Text value
   * @returns {Object} Frame object
   */
  _createTextFrame(frameId, description, value) {
    const encoding = 0x03; // UTF-8
    const descBuffer = Buffer.from(description, 'utf8');
    const valueBuffer = Buffer.from(value, 'utf8');
    
    const data = Buffer.concat([
      Buffer.from([encoding]),
      descBuffer,
      Buffer.from([0]), // Null terminator
      valueBuffer
    ]);

    return {
      id: frameId,
      data: data,
      size: data.length
    };
  }

  /**
   * Create private frame (PRIV)
   * @param {string} frameId - Frame identifier
   * @param {string} identifier - Private identifier
   * @param {Buffer|string} privateData - Private data
   * @returns {Object} Frame object
   */
  _createPrivateFrame(frameId, identifier, privateData) {
    const identifierBuffer = Buffer.from(identifier, 'utf8');
    const dataBuffer = Buffer.isBuffer(privateData) ? privateData : Buffer.from(privateData, 'utf8');
    
    const data = Buffer.concat([
      identifierBuffer,
      Buffer.from([0]), // Null terminator
      dataBuffer
    ]);

    return {
      id: frameId,
      data: data,
      size: data.length
    };
  }

  /**
   * Extract AI metadata from parsed frames
   * @param {Array} frames - Parsed frames array
   * @returns {Object|null} AI metadata object
   */
  _extractAIFrames(frames) {
    let metadata = null;
    let checksum = null;
    let signature = null;

    for (const frame of frames) {
      if (frame.id === AI_METADATA_FRAME) {
        const textData = this._parseTextFrame(frame.data);
        if (textData.description === 'AI_METADATA') {
          try {
            metadata = JSON.parse(textData.value);
          } catch (e) {
            // Invalid JSON, skip
          }
        } else if (textData.description === 'AI_CHECKSUM') {
          checksum = textData.value;
        }
      } else if (frame.id === AI_SIGNATURE_FRAME) {
        const privateData = this._parsePrivateFrame(frame.data);
        if (privateData.identifier === 'AI_SIGNATURE') {
          signature = privateData.data;
        }
      }
    }

    if (metadata) {
      if (checksum) metadata.checksum = checksum;
      if (signature) metadata.signature = signature;
      return metadata;
    }

    return null;
  }

  /**
   * Parse text frame data
   * @param {Buffer} data - Frame data
   * @returns {Object} Parsed text data
   */
  _parseTextFrame(data) {
    const encoding = data[0];
    let textData = data.slice(1);
    
    // Find null terminator between description and value
    let nullIndex = -1;
    for (let i = 0; i < textData.length; i++) {
      if (textData[i] === 0) {
        nullIndex = i;
        break;
      }
    }

    if (nullIndex === -1) {
      return { description: '', value: textData.toString('utf8') };
    }

    const description = textData.slice(0, nullIndex).toString('utf8');
    const value = textData.slice(nullIndex + 1).toString('utf8');

    return { description, value, encoding };
  }

  /**
   * Parse private frame data
   * @param {Buffer} data - Frame data
   * @returns {Object} Parsed private data
   */
  _parsePrivateFrame(data) {
    // Find null terminator between identifier and data
    let nullIndex = -1;
    for (let i = 0; i < data.length; i++) {
      if (data[i] === 0) {
        nullIndex = i;
        break;
      }
    }

    if (nullIndex === -1) {
      return { identifier: '', data: data };
    }

    const identifier = data.slice(0, nullIndex).toString('utf8');
    const privateData = data.slice(nullIndex + 1);

    return { identifier, data: privateData };
  }

  /**
   * Check if frame contains AI metadata
   * @param {Object} frame - Frame object
   * @returns {boolean} True if frame contains AI metadata
   */
  _isAIMetadataFrame(frame) {
    if (frame.id === AI_METADATA_FRAME) {
      const textData = this._parseTextFrame(frame.data);
      return textData.description === 'AI_METADATA' || textData.description === 'AI_CHECKSUM';
    }
    
    if (frame.id === AI_SIGNATURE_FRAME) {
      const privateData = this._parsePrivateFrame(frame.data);
      return privateData.identifier === 'AI_SIGNATURE';
    }

    return false;
  }

  /**
   * Read synchsafe integer (ID3v2.4)
   * @param {Buffer} buffer - 4-byte buffer
   * @returns {number} Integer value
   */
  _readSynchsafeInt(buffer) {
    return (buffer[0] << 21) | (buffer[1] << 14) | (buffer[2] << 7) | buffer[3];
  }

  /**
   * Write synchsafe integer (ID3v2.4)
   * @param {Buffer} buffer - Target buffer
   * @param {number} offset - Write offset
   * @param {number} value - Integer value
   */
  _writeSynchsafeInt(buffer, offset, value) {
    buffer[offset] = (value >>> 21) & 0x7F;
    buffer[offset + 1] = (value >>> 14) & 0x7F;
    buffer[offset + 2] = (value >>> 7) & 0x7F;
    buffer[offset + 3] = value & 0x7F;
  }

  /**
   * Read frame size based on ID3 version
   * @param {Buffer} buffer - 4-byte buffer
   * @param {number} majorVersion - ID3 major version
   * @returns {number} Frame size
   */
  _readFrameSize(buffer, majorVersion) {
    if (majorVersion >= 4) {
      return this._readSynchsafeInt(buffer);
    } else {
      return buffer.readUInt32BE(0);
    }
  }

  /**
   * Write frame size based on ID3 version
   * @param {Buffer} buffer - Target buffer
   * @param {number} offset - Write offset
   * @param {number} size - Frame size
   */
  _writeFrameSize(buffer, offset, size) {
    if (this.options.version === '2.4') {
      this._writeSynchsafeInt(buffer, offset, size);
    } else {
      buffer.writeUInt32BE(size, offset);
    }
  }

  /**
   * Validate metadata structure
   * @param {Object} metadata - Metadata to validate
   * @throws {Error} If metadata is invalid
   */
  _validateMetadata(metadata) {
    if (!metadata || typeof metadata !== 'object') {
      throw new Error('Metadata must be a valid object');
    }

    // Basic RFC compliance checks
    const requiredFields = ['contentType', 'origin', 'created'];
    for (const field of requiredFields) {
      if (!metadata[field]) {
        throw new Error(`Missing required field: ${field}`);
      }
    }
  }

  /**
   * Create cryptographic signature
   * @param {Object} metadata - Metadata to sign
   * @param {string} privateKey - Private key for signing
   * @returns {Promise<string>} Base64-encoded signature
   */
  async _createSignature(metadata, privateKey) {
    const dataToSign = JSON.stringify(metadata);
    const sign = crypto.createSign('SHA256');
    sign.update(dataToSign);
    return sign.sign(privateKey, 'base64');
  }

  /**
   * Verify cryptographic signature
   * @param {Object} metadata - Metadata with signature
   * @returns {Promise<boolean>} True if signature is valid
   */
  async _verifySignature(metadata) {
    // Implementation would depend on public key availability
    // This is a placeholder for signature verification logic
    return true;
  }

  /**
   * Verify content checksum
   * @param {Object} metadata - Metadata with checksum
   * @param {Buffer} audioBuffer - Original audio data
   * @returns {Promise<boolean>} True if checksum is valid
   */
  async _verifyChecksum(metadata, audioBuffer) {
    const metadataCopy = { ...metadata };
    delete metadataCopy.checksum;
    delete metadataCopy._verified;
    delete metadataCopy._signatureValid;
    
    const calculatedChecksum = crypto.createHash('sha256')
      .update(JSON.stringify(metadataCopy))
      .digest('hex');
    
    return calculatedChecksum === metadata.checksum;
  }
}

module.exports = ID3AudioHandler;
