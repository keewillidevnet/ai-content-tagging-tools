/**
 * EXIF/XMP Image Metadata Handler for AI Content Tagging Tools
 * Handles embedding and extraction of RFC-compliant metadata in image files
 */

const crypto = require('crypto');
const fs = require('fs').promises;

// EXIF tag constants for AI metadata
const EXIF_AI_METADATA_TAG = 0x9C9B; // UserComment field for AI metadata
const EXIF_COPYRIGHT_TAG = 0x8298; // Copyright field
const EXIF_ARTIST_TAG = 0x013B; // Artist field
const EXIF_SOFTWARE_TAG = 0x0131; // Software field

// XMP namespace for AI content metadata
const AI_XMP_NAMESPACE = 'http://aicontenttagging.org/schemas/1.0/';
const AI_XMP_PREFIX = 'aicontag';

// JPEG markers
const JPEG_SOI = 0xFFD8; // Start of Image
const JPEG_APP1 = 0xFFE1; // Application segment 1 (EXIF/XMP)
const JPEG_SOS = 0xFFDA; // Start of Scan

/**
 * EXIF/XMP Image Metadata Handler
 */
class EXIFImageHandler {
  constructor(options = {}) {
    this.options = {
      preferredFormat: 'xmp', // 'exif' or 'xmp' or 'both'
      preserveExisting: true,
      compressionQuality: 95,
      ...options
    };
  }

  /**
   * Embed AI content metadata into an image file
   * @param {Buffer|string} imageData - Image file data or path
   * @param {Object} metadata - RFC-compliant metadata object
   * @param {Object} options - Embedding options
   * @returns {Promise<Buffer>} Modified image file data
   */
  async embedMetadata(imageData, metadata, options = {}) {
    try {
      // Read image file if path provided
      const imageBuffer = typeof imageData === 'string' 
        ? await fs.readFile(imageData)
        : imageData;

      // Validate metadata structure
      this._validateMetadata(metadata);

      // Detect image format
      const format = this._detectImageFormat(imageBuffer);
      
      if (format === 'jpeg') {
        return await this._embedJPEGMetadata(imageBuffer, metadata, options);
      } else if (format === 'tiff') {
        return await this._embedTIFFMetadata(imageBuffer, metadata, options);
      } else if (format === 'png') {
        return await this._embedPNGMetadata(imageBuffer, metadata, options);
      } else {
        throw new Error(`Unsupported image format: ${format}`);
      }
    } catch (error) {
      throw new Error(`Failed to embed image metadata: ${error.message}`);
    }
  }

  /**
   * Extract AI content metadata from image file
   * @param {Buffer|string} imageData - Image file data or path
   * @returns {Promise<Object|null>} Extracted metadata object or null if not found
   */
  async extractMetadata(imageData) {
    try {
      // Read image file if path provided
      const imageBuffer = typeof imageData === 'string' 
        ? await fs.readFile(imageData)
        : imageData;

      // Detect image format
      const format = this._detectImageFormat(imageBuffer);
      
      let metadata = null;

      if (format === 'jpeg') {
        metadata = await this._extractJPEGMetadata(imageBuffer);
      } else if (format === 'tiff') {
        metadata = await this._extractTIFFMetadata(imageBuffer);
      } else if (format === 'png') {
        metadata = await this._extractPNGMetadata(imageBuffer);
      }

      if (metadata) {
        // Verify integrity if checksum present
        if (metadata.checksum) {
          const isValid = await this._verifyChecksum(metadata, imageBuffer);
          metadata._verified = isValid;
        }

        // Verify signature if present
        if (metadata.signature) {
          const signatureValid = await this._verifySignature(metadata);
          metadata._signatureValid = signatureValid;
        }
      }

      return metadata;
    } catch (error) {
      throw new Error(`Failed to extract image metadata: ${error.message}`);
    }
  }

  /**
   * Check if image has AI metadata
   * @param {Buffer|string} imageData - Image file data or path
   * @returns {Promise<boolean>} True if image has AI metadata
   */
  async hasMetadata(imageData) {
    try {
      const metadata = await this.extractMetadata(imageData);
      return metadata !== null;
    } catch (error) {
      return false;
    }
  }

  /**
   * Remove AI metadata from image file
   * @param {Buffer|string} imageData - Image file data or path
   * @returns {Promise<Buffer>} Image file without AI metadata
   */
  async removeMetadata(imageData) {
    try {
      const imageBuffer = typeof imageData === 'string' 
        ? await fs.readFile(imageData)
        : imageData;

      const format = this._detectImageFormat(imageBuffer);
      
      if (format === 'jpeg') {
        return await this._removeJPEGMetadata(imageBuffer);
      } else if (format === 'tiff') {
        return await this._removeTIFFMetadata(imageBuffer);
      } else if (format === 'png') {
        return await this._removePNGMetadata(imageBuffer);
      } else {
        return imageBuffer; // Return unchanged for unsupported formats
      }
    } catch (error) {
      throw new Error(`Failed to remove image metadata: ${error.message}`);
    }
  }

  /**
   * Detect image format from buffer
   * @param {Buffer} imageBuffer - Image data buffer
   * @returns {string} Image format ('jpeg', 'png', 'tiff', 'unknown')
   */
  _detectImageFormat(imageBuffer) {
    if (imageBuffer.length < 4) return 'unknown';

    // JPEG: FF D8 FF
    if (imageBuffer[0] === 0xFF && imageBuffer[1] === 0xD8 && imageBuffer[2] === 0xFF) {
      return 'jpeg';
    }

    // PNG: 89 50 4E 47
    if (imageBuffer[0] === 0x89 && imageBuffer[1] === 0x50 && 
        imageBuffer[2] === 0x4E && imageBuffer[3] === 0x47) {
      return 'png';
    }

    // TIFF: 49 49 (II) or 4D 4D (MM)
    if ((imageBuffer[0] === 0x49 && imageBuffer[1] === 0x49) ||
        (imageBuffer[0] === 0x4D && imageBuffer[1] === 0x4D)) {
      return 'tiff';
    }

    return 'unknown';
  }

  /**
   * Embed metadata in JPEG file
   * @param {Buffer} imageBuffer - JPEG image buffer
   * @param {Object} metadata - AI metadata
   * @param {Object} options - Embedding options
   * @returns {Promise<Buffer>} Modified JPEG buffer
   */
  async _embedJPEGMetadata(imageBuffer, metadata, options = {}) {
    const segments = this._parseJPEGSegments(imageBuffer);
    
    // Create XMP segment
    const xmpData = this._createXMPData(metadata, options);
    const xmpSegment = this._createAPP1Segment(xmpData, 'XMP');
    
    // Create EXIF segment if requested
    let exifSegment = null;
    if (this.options.preferredFormat === 'exif' || this.options.preferredFormat === 'both') {
      const exifData = this._createEXIFData(metadata, options);
      exifSegment = this._createAPP1Segment(exifData, 'EXIF');
    }

    // Rebuild JPEG with new metadata
    const newSegments = [segments[0]]; // SOI marker

    // Add EXIF segment first if created
    if (exifSegment) {
      newSegments.push(exifSegment);
    }

    // Add XMP segment
    newSegments.push(xmpSegment);

    // Add remaining segments (skip existing EXIF/XMP if not preserving)
    for (let i = 1; i < segments.length; i++) {
      const segment = segments[i];
      
      if (!this.options.preserveExisting && this._isMetadataSegment(segment)) {
        continue; // Skip existing metadata
      }
      
      newSegments.push(segment);
    }

    return Buffer.concat(newSegments);
  }

  /**
   * Extract metadata from JPEG file
   * @param {Buffer} imageBuffer - JPEG image buffer
   * @returns {Promise<Object|null>} Extracted metadata
   */
  async _extractJPEGMetadata(imageBuffer) {
    const segments = this._parseJPEGSegments(imageBuffer);
    
    for (const segment of segments) {
      if (this._isAPP1Segment(segment)) {
        // Check for XMP data
        const xmpData = this._extractXMPFromSegment(segment);
        if (xmpData) {
          const metadata = this._parseXMPData(xmpData);
          if (metadata) return metadata;
        }

        // Check for EXIF data
        const exifData = this._extractEXIFFromSegment(segment);
        if (exifData) {
          const metadata = this._parseEXIFData(exifData);
          if (metadata) return metadata;
        }
      }
    }

    return null;
  }

  /**
   * Remove metadata from JPEG file
   * @param {Buffer} imageBuffer - JPEG image buffer
   * @returns {Promise<Buffer>} JPEG without AI metadata
   */
  async _removeJPEGMetadata(imageBuffer) {
    const segments = this._parseJPEGSegments(imageBuffer);
    const filteredSegments = [];

    for (const segment of segments) {
      if (this._isMetadataSegment(segment) && this._containsAIMetadata(segment)) {
        continue; // Skip AI metadata segments
      }
      filteredSegments.push(segment);
    }

    return Buffer.concat(filteredSegments);
  }

  /**
   * Parse JPEG into segments
   * @param {Buffer} imageBuffer - JPEG image buffer
   * @returns {Array<Buffer>} Array of JPEG segments
   */
  _parseJPEGSegments(imageBuffer) {
    const segments = [];
    let offset = 0;

    // Read SOI marker
    if (imageBuffer.readUInt16BE(0) !== JPEG_SOI) {
      throw new Error('Invalid JPEG file: missing SOI marker');
    }
    
    segments.push(imageBuffer.slice(0, 2));
    offset = 2;

    while (offset < imageBuffer.length) {
      // Read marker
      if (imageBuffer[offset] !== 0xFF) {
        break; // Invalid marker or start of image data
      }

      const marker = imageBuffer.readUInt16BE(offset);
      
      if (marker === JPEG_SOS) {
        // Start of scan - rest is image data
        segments.push(imageBuffer.slice(offset));
        break;
      }

      // Read segment length
      const length = imageBuffer.readUInt16BE(offset + 2);
      const segmentEnd = offset + 2 + length;
      
      if (segmentEnd > imageBuffer.length) {
        break; // Invalid segment
      }

      segments.push(imageBuffer.slice(offset, segmentEnd));
      offset = segmentEnd;
    }

    return segments;
  }

  /**
   * Create APP1 segment for EXIF or XMP data
   * @param {Buffer} data - Metadata data
   * @param {string} type - 'EXIF' or 'XMP'
   * @returns {Buffer} APP1 segment
   */
  _createAPP1Segment(data, type) {
    const identifier = type === 'XMP' 
      ? Buffer.from('http://ns.adobe.com/xap/1.0/\0')
      : Buffer.from('Exif\0\0');
    
    const totalLength = 2 + 2 + identifier.length + data.length; // marker + length + identifier + data
    const segment = Buffer.alloc(totalLength);
    
    let offset = 0;
    segment.writeUInt16BE(JPEG_APP1, offset); // APP1 marker
    offset += 2;
    segment.writeUInt16BE(totalLength - 2, offset); // Length (excluding marker)
    offset += 2;
    identifier.copy(segment, offset); // Identifier
    offset += identifier.length;
    data.copy(segment, offset); // Data

    return segment;
  }

  /**
   * Create XMP data for AI metadata
   * @param {Object} metadata - AI metadata
   * @param {Object} options - Creation options
   * @returns {Buffer} XMP data buffer
   */
  _createXMPData(metadata, options = {}) {
    const xmpTemplate = `<?xml version="1.0" encoding="UTF-8"?>
<x:xmpmeta xmlns:x="adobe:ns:meta/" x:xmptk="AI Content Tagging Tools 1.0">
  <rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">
    <rdf:Description rdf:about="" xmlns:${AI_XMP_PREFIX}="${AI_XMP_NAMESPACE}">
      <${AI_XMP_PREFIX}:contentType>${this._escapeXML(metadata.contentType)}</${AI_XMP_PREFIX}:contentType>
      <${AI_XMP_PREFIX}:origin>${this._escapeXML(metadata.origin)}</${AI_XMP_PREFIX}:origin>
      <${AI_XMP_PREFIX}:created>${this._escapeXML(metadata.created)}</${AI_XMP_PREFIX}:created>
      ${metadata.author ? `<${AI_XMP_PREFIX}:author>${this._escapeXML(metadata.author)}</${AI_XMP_PREFIX}:author>` : ''}
      ${metadata.description ? `<${AI_XMP_PREFIX}:description>${this._escapeXML(metadata.description)}</${AI_XMP_PREFIX}:description>` : ''}
      ${metadata.license ? `<${AI_XMP_PREFIX}:license>${this._escapeXML(metadata.license)}</${AI_XMP_PREFIX}:license>` : ''}
      <${AI_XMP_PREFIX}:metadata>${this._escapeXML(JSON.stringify(metadata))}</${AI_XMP_PREFIX}:metadata>
      ${options.includeChecksum !== false ? `<${AI_XMP_PREFIX}:checksum>${this._createChecksum(metadata)}</${AI_XMP_PREFIX}:checksum>` : ''}
    </rdf:Description>
  </rdf:RDF>
</x:xmpmeta>`;

    return Buffer.from(xmpTemplate, 'utf8');
  }

  /**
   * Create EXIF data for AI metadata
   * @param {Object} metadata - AI metadata
   * @param {Object} options - Creation options
   * @returns {Buffer} EXIF data buffer
   */
  _createEXIFData(metadata, options = {}) {
    // Simplified EXIF creation - store AI metadata in UserComment field
    const metadataJson = JSON.stringify(metadata);
    const encodingType = Buffer.from('UNICODE\0', 'ascii');
    const metadataBuffer = Buffer.from(metadataJson, 'utf16le');
    
    // Create minimal EXIF structure
    const exifData = Buffer.concat([encodingType, metadataBuffer]);
    
    return exifData;
  }

  /**
   * Parse XMP data for AI metadata
   * @param {Buffer} xmpData - XMP data buffer
   * @returns {Object|null} Parsed AI metadata
   */
  _parseXMPData(xmpData) {
    try {
      const xmpString = xmpData.toString('utf8');
      
      // Extract AI metadata using regex (simple approach)
      const metadataMatch = xmpString.match(new RegExp(`<${AI_XMP_PREFIX}:metadata>(.*?)</${AI_XMP_PREFIX}:metadata>`, 's'));
      
      if (metadataMatch) {
        const metadataJson = this._unescapeXML(metadataMatch[1]);
        return JSON.parse(metadataJson);
      }
    } catch (error) {
      // Failed to parse XMP
    }
    
    return null;
  }

  /**
   * Parse EXIF data for AI metadata
   * @param {Buffer} exifData - EXIF data buffer
   * @returns {Object|null} Parsed AI metadata
   */
  _parseEXIFData(exifData) {
    try {
      // Look for UNICODE encoding marker
      if (exifData.slice(0, 8).toString('ascii') === 'UNICODE\0') {
        const metadataJson = exifData.slice(8).toString('utf16le');
        return JSON.parse(metadataJson);
      }
    } catch (error) {
      // Failed to parse EXIF
    }
    
    return null;
  }

  /**
   * Check if segment is APP1 (EXIF/XMP)
   * @param {Buffer} segment - JPEG segment
   * @returns {boolean} True if APP1 segment
   */
  _isAPP1Segment(segment) {
    return segment.length >= 2 && segment.readUInt16BE(0) === JPEG_APP1;
  }

  /**
   * Check if segment contains metadata
   * @param {Buffer} segment - JPEG segment
   * @returns {boolean} True if metadata segment
   */
  _isMetadataSegment(segment) {
    if (!this._isAPP1Segment(segment)) return false;
    
    const identifier = segment.slice(4, 20).toString('ascii');
    return identifier.startsWith('Exif') || identifier.startsWith('http://ns.adobe.com/xap/1.0/');
  }

  /**
   * Check if segment contains AI metadata
   * @param {Buffer} segment - JPEG segment
   * @returns {boolean} True if contains AI metadata
   */
  _containsAIMetadata(segment) {
    if (!this._isMetadataSegment(segment)) return false;
    
    const segmentString = segment.toString('utf8');
    return segmentString.includes(AI_XMP_NAMESPACE) || 
           segmentString.includes('AI_METADATA') ||
           segmentString.includes('"contentType"');
  }

  /**
   * Extract XMP data from APP1 segment
   * @param {Buffer} segment - APP1 segment
   * @returns {Buffer|null} XMP data or null
   */
  _extractXMPFromSegment(segment) {
    const xmpIdentifier = 'http://ns.adobe.com/xap/1.0/\0';
    const identifierStart = 4; // Skip marker and length
    
    if (segment.slice(identifierStart, identifierStart + xmpIdentifier.length).toString('ascii') === xmpIdentifier) {
      return segment.slice(identifierStart + xmpIdentifier.length);
    }
    
    return null;
  }

  /**
   * Extract EXIF data from APP1 segment
   * @param {Buffer} segment - APP1 segment
   * @returns {Buffer|null} EXIF data or null
   */
  _extractEXIFFromSegment(segment) {
    const exifIdentifier = 'Exif\0\0';
    const identifierStart = 4; // Skip marker and length
    
    if (segment.slice(identifierStart, identifierStart + exifIdentifier.length).toString('ascii') === exifIdentifier) {
      return segment.slice(identifierStart + exifIdentifier.length);
    }
    
    return null;
  }

  /**
   * Embed metadata in TIFF file (placeholder)
   * @param {Buffer} imageBuffer - TIFF image buffer
   * @param {Object} metadata - AI metadata
   * @param {Object} options - Embedding options
   * @returns {Promise<Buffer>} Modified TIFF buffer
   */
  async _embedTIFFMetadata(imageBuffer, metadata, options = {}) {
    // TIFF metadata embedding implementation
    // This is a complex format that would require full TIFF parsing
    throw new Error('TIFF metadata embedding not yet implemented');
  }

  /**
   * Extract metadata from TIFF file (placeholder)
   * @param {Buffer} imageBuffer - TIFF image buffer
   * @returns {Promise<Object|null>} Extracted metadata
   */
  async _extractTIFFMetadata(imageBuffer) {
    // TIFF metadata extraction implementation
    throw new Error('TIFF metadata extraction not yet implemented');
  }

  /**
   * Remove metadata from TIFF file (placeholder)
   * @param {Buffer} imageBuffer - TIFF image buffer
   * @returns {Promise<Buffer>} TIFF without AI metadata
   */
  async _removeTIFFMetadata(imageBuffer) {
    return imageBuffer; // Return unchanged for now
  }

  /**
   * Embed metadata in PNG file (placeholder)
   * @param {Buffer} imageBuffer - PNG image buffer
   * @param {Object} metadata - AI metadata
   * @param {Object} options - Embedding options
   * @returns {Promise<Buffer>} Modified PNG buffer
   */
  async _embedPNGMetadata(imageBuffer, metadata, options = {}) {
    // PNG metadata embedding using tEXt or iTXt chunks
    // This would require PNG chunk parsing and reconstruction
    throw new Error('PNG metadata embedding not yet implemented');
  }

  /**
   * Extract metadata from PNG file (placeholder)
   * @param {Buffer} imageBuffer - PNG image buffer
   * @returns {Promise<Object|null>} Extracted metadata
   */
  async _extractPNGMetadata(imageBuffer) {
    // PNG metadata extraction implementation
    throw new Error('PNG metadata extraction not yet implemented');
  }

  /**
   * Remove metadata from PNG file (placeholder)
   * @param {Buffer} imageBuffer - PNG image buffer
   * @returns {Promise<Buffer>} PNG without AI metadata
   */
  async _removePNGMetadata(imageBuffer) {
    return imageBuffer; // Return unchanged for now
  }

  /**
   * Escape XML special characters
   * @param {string} text - Text to escape
   * @returns {string} Escaped text
   */
  _escapeXML(text) {
    return text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&apos;');
  }

  /**
   * Unescape XML special characters
   * @param {string} text - Text to unescape
   * @returns {string} Unescaped text
   */
  _unescapeXML(text) {
    return text
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&apos;/g, "'");
  }

  /**
   * Create checksum for metadata
   * @param {Object} metadata - Metadata to checksum
   * @returns {string} Hex checksum
   */
  _createChecksum(metadata) {
    return crypto.createHash('sha256').update(JSON.stringify(metadata)).digest('hex');
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
   * @param {Buffer} imageBuffer - Original image data
   * @returns {Promise<boolean>} True if checksum is valid
   */
  async _verifyChecksum(metadata, imageBuffer) {
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

module.exports = EXIFImageHandler;
