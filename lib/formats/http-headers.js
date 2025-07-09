const { ContentMetadata } = require('../core/metadata');

/**
 * Express middleware for automatic metadata header injection
 * @param {Object} options - Configuration options
 * @param {string} options.origin - Default content origin (human, ai, hybrid)
 * @param {string} options.author - Default content author
 * @param {string} options.license - Default content license
 * @param {boolean} options.autoGenerate - Auto-generate metadata for responses
 * @param {Function} options.filter - Function to determine which responses to tag
 * @returns {Function} Express middleware function
 */
function metadataHeaders(options = {}) {
  const config = {
    origin: options.origin || 'human',
    author: options.author || 'Server',
    license: options.license || null,
    autoGenerate: options.autoGenerate !== false, // Default true
    filter: options.filter || (() => true), // Default: tag everything
    headerPrefix: 'X-Content-',
    ...options
  };

  return (req, res, next) => {
    // Store original send method
    const originalSend = res.send;
    const originalJson = res.json;

    // Override res.send to inject metadata headers
    res.send = function(body) {
      if (config.autoGenerate && config.filter(req, res, body)) {
        injectMetadataHeaders(res, body, config);
      }
      return originalSend.call(this, body);
    };

    // Override res.json to inject metadata headers
    res.json = function(obj) {
      if (config.autoGenerate && config.filter(req, res, obj)) {
        const body = JSON.stringify(obj);
        injectMetadataHeaders(res, body, config);
      }
      return originalJson.call(this, obj);
    };

    // Add helper methods to response object
    res.setContentMetadata = function(metadata) {
      setMetadataHeaders(res, metadata, config);
      return res;
    };

    res.setContentOrigin = function(origin, author, options = {}) {
      const metadata = new ContentMetadata({
        origin,
        author,
        license: options.license || config.license,
        toolchain: options.toolchain,
        model_identifier: options.model_identifier
      });
      return res.setContentMetadata(metadata);
    };

    next();
  };
}

/**
 * Inject metadata headers for response content
 * @param {Object} res - Express response object
 * @param {string|Buffer} content - Response content
 * @param {Object} config - Middleware configuration
 */
function injectMetadataHeaders(res, content, config) {
  try {
    const metadata = ContentMetadata.generateForContent(content, {
      origin: config.origin,
      author: config.author,
      license: config.license,
      toolchain: config.toolchain,
      model_identifier: config.model_identifier
    });

    setMetadataHeaders(res, metadata, config);
  } catch (error) {
    console.warn('Failed to generate metadata headers:', error.message);
  }
}

/**
 * Set metadata headers on response
 * @param {Object} res - Express response object  
 * @param {ContentMetadata} metadata - Metadata instance
 * @param {Object} config - Configuration
 */
function setMetadataHeaders(res, metadata, config) {
  const prefix = config.headerPrefix;
  const metadataObj = metadata.toObject();

  // Set individual headers
  res.set(`${prefix}Origin`, metadataObj.origin);
  res.set(`${prefix}Author`, metadataObj.author);
  res.set(`${prefix}Timestamp`, metadataObj.creation_timestamp);
  res.set(`${prefix}Checksum`, metadataObj.checksum);
  res.set(`${prefix}Version`, metadataObj.version);

  if (metadataObj.license) {
    res.set(`${prefix}License`, metadataObj.license);
  }
  if (metadataObj.toolchain) {
    res.set(`${prefix}Toolchain`, metadataObj.toolchain);
  }
  if (metadataObj.model_identifier) {
    res.set(`${prefix}Model`, metadataObj.model_identifier);
  }

  // Set compact header (all metadata in one header)
  res.set(`${prefix}Metadata`, metadata.toHTTPHeader());
}

/**
 * Express middleware to parse incoming metadata headers
 * @param {Object} options - Configuration options
 * @returns {Function} Express middleware function
 */
function parseMetadataHeaders(options = {}) {
  const config = {
    headerPrefix: 'X-Content-',
    attachTo: 'metadata', // req.metadata
    ...options
  };

  return (req, res, next) => {
    try {
      const metadata = extractMetadataFromHeaders(req, config);
      req[config.attachTo] = metadata;
    } catch (error) {
      console.warn('Failed to parse metadata headers:', error.message);
      req[config.attachTo] = null;
    }
    next();
  };
}

/**
 * Extract metadata from request headers
 * @param {Object} req - Express request object
 * @param {Object} config - Configuration
 * @returns {ContentMetadata|null} Parsed metadata or null
 */
function extractMetadataFromHeaders(req, config) {
  const prefix = config.headerPrefix.toLowerCase();
  const headers = {};

  // Extract individual headers
  for (const [key, value] of Object.entries(req.headers)) {
    if (key.startsWith(prefix)) {
      const metadataKey = key.substring(prefix.length).replace('-', '_');
      headers[metadataKey] = value;
    }
  }

  // Try compact header first
  const compactHeader = req.headers[`${prefix}metadata`];
  if (compactHeader) {
    try {
      return ContentMetadata.parseHTTPHeader(compactHeader);
    } catch (error) {
      // Fall back to individual headers
    }
  }

  // Build from individual headers
  if (Object.keys(headers).length > 0) {
    return new ContentMetadata(headers);
  }

  return null;
}

/**
 * Middleware to validate content integrity against metadata headers
 * @param {Object} options - Configuration options
 * @returns {Function} Express middleware function
 */
function validateContentIntegrity(options = {}) {
  const config = {
    onValidationFail: options.onValidationFail || ((req, res) => {
      res.status(400).json({ error: 'Content integrity validation failed' });
    }),
    skipValidation: options.skipValidation || (() => false),
    ...options
  };

  return (req, res, next) => {
    if (config.skipValidation(req, res)) {
      return next();
    }

    if (!req.metadata) {
      return next(); // No metadata to validate against
    }

    // Capture request body for validation
    let bodyChunks = [];
    const originalWrite = req.write;
    const originalEnd = req.end;

    req.write = function(chunk) {
      bodyChunks.push(chunk);
      return originalWrite.call(this, chunk);
    };

    req.end = function(chunk) {
      if (chunk) bodyChunks.push(chunk);
      
      const body = Buffer.concat(bodyChunks);
      const isValid = req.metadata.verifyIntegrity(body);
      
      if (!isValid) {
        return config.onValidationFail(req, res);
      }

      return originalEnd.call(this, chunk);
    };

    next();
  };
}

/**
 * Create a filter function for selective metadata injection
 * @param {Object} criteria - Filter criteria
 * @returns {Function} Filter function
 */
function createFilter(criteria) {
  return (req, res, body) => {
    // Filter by content type
    if (criteria.contentTypes) {
      const contentType = res.get('Content-Type') || '';
      if (!criteria.contentTypes.some(type => contentType.includes(type))) {
        return false;
      }
    }

    // Filter by route pattern
    if (criteria.routes) {
      const path = req.path;
      if (!criteria.routes.some(route => path.match(route))) {
        return false;
      }
    }

    // Filter by response size
    if (criteria.minSize && body && body.length < criteria.minSize) {
      return false;
    }

    if (criteria.maxSize && body && body.length > criteria.maxSize) {
      return false;
    }

    // Custom filter function
    if (criteria.custom && !criteria.custom(req, res, body)) {
      return false;
    }

    return true;
  };
}

/**
 * Utility to manually generate metadata headers for any content
 * @param {string|Buffer} content - Content to generate metadata for
 * @param {Object} options - Metadata options
 * @returns {Object} Headers object
 */
function generateHeaders(content, options = {}) {
  const metadata = ContentMetadata.generateForContent(content, options);
  const prefix = options.headerPrefix || 'X-Content-';
  
  const headers = {};
  const metadataObj = metadata.toObject();

  headers[`${prefix}Origin`] = metadataObj.origin;
  headers[`${prefix}Author`] = metadataObj.author;
  headers[`${prefix}Timestamp`] = metadataObj.creation_timestamp;
  headers[`${prefix}Checksum`] = metadataObj.checksum;
  headers[`${prefix}Version`] = metadataObj.version;
  headers[`${prefix}Metadata`] = metadata.toHTTPHeader();

  if (metadataObj.license) {
    headers[`${prefix}License`] = metadataObj.license;
  }
  if (metadataObj.toolchain) {
    headers[`${prefix}Toolchain`] = metadataObj.toolchain;
  }
  if (metadataObj.model_identifier) {
    headers[`${prefix}Model`] = metadataObj.model_identifier;
  }

  return headers;
}

module.exports = {
  metadataHeaders,
  parseMetadataHeaders,
  validateContentIntegrity,
  createFilter,
  generateHeaders
}