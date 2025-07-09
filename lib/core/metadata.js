const crypto = require('crypto');
const Joi = require('joi');

// Metadata schema validation based on RFC draft
const metadataSchema = Joi.object({
  version: Joi.string().valid('1.0').required(),
  origin: Joi.string().valid('human', 'ai', 'hybrid').required(),
  author: Joi.string().required(),
  creation_timestamp: Joi.string().isoDate().required(),
  license: Joi.string().optional(),
  checksum: Joi.string().pattern(/^[a-f0-9]{64}$/).required(), // SHA-256 hex
  signature: Joi.string().optional(),
  toolchain: Joi.string().optional(),
  model_identifier: Joi.string().optional()
});

class ContentMetadata {
  constructor(options = {}) {
    this.version = '1.0';
    this.origin = options.origin || 'human';
    this.author = options.author || 'Unknown';
    this.creation_timestamp = options.creation_timestamp || new Date().toISOString();
    this.license = options.license;
    this.checksum = options.checksum;
    this.signature = options.signature;
    this.toolchain = options.toolchain;
    this.model_identifier = options.model_identifier;
  }

  /**
   * Generate metadata for content
   * @param {Buffer|string} content - The content to generate metadata for
   * @param {Object} options - Metadata options
   * @returns {ContentMetadata} - Generated metadata instance
   */
  static generateForContent(content, options = {}) {
    const metadata = new ContentMetadata(options);
    
    // Generate SHA-256 checksum
    const hash = crypto.createHash('sha256');
    hash.update(content);
    metadata.checksum = hash.digest('hex');
    
    return metadata;
  }

  /**
   * Validate metadata against RFC schema
   * @returns {Object} - Validation result
   */
  validate() {
    const { error, value } = metadataSchema.validate(this.toObject());
    return {
      isValid: !error,
      error: error?.details?.[0]?.message,
      metadata: value
    };
  }

  /**
   * Convert to plain object
   * @returns {Object} - Metadata as plain object
   */
  toObject() {
    const obj = {
      version: this.version,
      origin: this.origin,
      author: this.author,
      creation_timestamp: this.creation_timestamp,
      checksum: this.checksum
    };

    // Only include optional fields if they exist
    if (this.license) obj.license = this.license;
    if (this.signature) obj.signature = this.signature;
    if (this.toolchain) obj.toolchain = this.toolchain;
    if (this.model_identifier) obj.model_identifier = this.model_identifier;

    return obj;
  }

  /**
   * Convert to XML format for sidecar files
   * @returns {string} - XML representation
   */
  toXML() {
    const obj = this.toObject();
    let xml = '<?xml version="1.0" encoding="UTF-8"?>\n<metadata>\n';
    
    for (const [key, value] of Object.entries(obj)) {
      xml += `  <${key}>${this.escapeXML(value)}</${key}>\n`;
    }
    
    xml += '</metadata>';
    return xml;
  }

  /**
   * Convert to HTTP header format
   * @returns {string} - HTTP header value
   */
  toHTTPHeader() {
    const obj = this.toObject();
    const pairs = Object.entries(obj).map(([key, value]) => 
      `${key}=${this.escapeHeaderValue(value)}`
    );
    return pairs.join(';');
  }

  /**
   * Convert to HTML meta tags
   * @returns {Array<string>} - Array of HTML meta tag strings
   */
  toHTMLMeta() {
    const obj = this.toObject();
    return Object.entries(obj).map(([key, value]) => 
      `<meta name="X-Content-${this.capitalizeFirst(key.replace('_', '-'))}" content="${this.escapeHTML(value)}">`
    );
  }

  /**
   * Parse metadata from various formats
   * @param {string} input - Input string in various formats
   * @param {string} format - Format type ('xml', 'header', 'html')
   * @returns {ContentMetadata} - Parsed metadata instance
   */
  static parse(input, format) {
    switch (format.toLowerCase()) {
      case 'xml':
        return this.parseXML(input);
      case 'header':
        return this.parseHTTPHeader(input);
      case 'html':
        return this.parseHTMLMeta(input);
      default:
        throw new Error(`Unsupported format: ${format}`);
    }
  }

  /**
   * Parse XML metadata
   * @param {string} xml - XML string
   * @returns {ContentMetadata} - Parsed metadata
   */
  static parseXML(xml) {
    const xml2js = require('xml2js');
    const parser = new xml2js.Parser({ explicitArray: false });
    
    return new Promise((resolve, reject) => {
      parser.parseString(xml, (err, result) => {
        if (err) {
          reject(new Error(`XML parsing error: ${err.message}`));
          return;
        }
        
        const metadata = new ContentMetadata(result.metadata);
        resolve(metadata);
      });
    });
  }

  /**
   * Parse HTTP header metadata
   * @param {string} header - HTTP header value
   * @returns {ContentMetadata} - Parsed metadata
   */
  static parseHTTPHeader(header) {
    const pairs = header.split(';');
    const options = {};
    
    for (const pair of pairs) {
      const [key, value] = pair.split('=').map(s => s.trim());
      if (key && value) {
        options[key] = decodeURIComponent(value);
      }
    }
    
    return new ContentMetadata(options);
  }

  /**
   * Verify content integrity against metadata
   * @param {Buffer|string} content - Content to verify
   * @returns {boolean} - True if content matches checksum
   */
  verifyIntegrity(content) {
    const hash = crypto.createHash('sha256');
    hash.update(content);
    const computedChecksum = hash.digest('hex');
    return computedChecksum === this.checksum;
  }

  // Utility methods
  escapeXML(str) {
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  escapeHTML(str) {
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  escapeHeaderValue(str) {
    return encodeURIComponent(String(str));
  }

  capitalizeFirst(str) {
    return str.charAt(0).toUpperCase() + str.slice(1);
  }
}

module.exports = {
  ContentMetadata,
  metadataSchema
};
