const { ContentMetadata } = require('../core/metadata');

/**
 * Inject metadata as HTML meta tags into HTML content
 * @param {string} htmlContent - Original HTML content
 * @param {ContentMetadata} metadata - Metadata to inject
 * @param {Object} options - Injection options
 * @returns {string} HTML content with injected meta tags
 */
function injectMetaTags(htmlContent, metadata, options = {}) {
  const config = {
    insertLocation: options.insertLocation || 'head', // 'head' or 'after-title'
    prefix: options.prefix || 'X-Content-',
    indent: options.indent || '  ',
    preserveExisting: options.preserveExisting !== false, // Default true
    ...options
  };

  // Generate meta tags
  const metaTags = generateMetaTags(metadata, config);
  
  // Remove existing meta tags if not preserving
  let processedHtml = htmlContent;
  if (!config.preserveExisting) {
    processedHtml = removeExistingMetaTags(processedHtml, config.prefix);
  }

  // Find insertion point and inject
  switch (config.insertLocation) {
    case 'head':
      return injectIntoHead(processedHtml, metaTags, config);
    case 'after-title':
      return injectAfterTitle(processedHtml, metaTags, config);
    default:
      throw new Error(`Unsupported insertion location: ${config.insertLocation}`);
  }
}

/**
 * Extract metadata from HTML meta tags
 * @param {string} htmlContent - HTML content to parse
 * @param {Object} options - Extraction options
 * @returns {ContentMetadata|null} Extracted metadata or null
 */
function extractMetaTags(htmlContent, options = {}) {
  const config = {
    prefix: options.prefix || 'X-Content-',
    strict: options.strict !== false, // Default true
    ...options
  };

  const metadata = {};
  const prefix = config.prefix.toLowerCase();
  
  // Regex to match meta tags with our prefix
  const metaRegex = new RegExp(
    `<meta\\s+name=["']${escapeRegex(config.prefix)}([^"']+)["']\\s+content=["']([^"']+)["'][^>]*>`,
    'gi'
  );

  let match;
  let foundAny = false;

  while ((match = metaRegex.exec(htmlContent)) !== null) {
    const key = match[1].toLowerCase().replace(/-/g, '_');
    const value = unescapeHtml(match[2]);
    metadata[key] = value;
    foundAny = true;
  }

  if (!foundAny) {
    return null;
  }

  // Validate required fields if strict mode
  if (config.strict) {
    const required = ['version', 'origin', 'author', 'creation_timestamp', 'checksum'];
    const missing = required.filter(field => !metadata[field]);
    if (missing.length > 0) {
      throw new Error(`Missing required metadata fields: ${missing.join(', ')}`);
    }
  }

  return new ContentMetadata(metadata);
}

/**
 * Generate HTML meta tags from metadata
 * @param {ContentMetadata} metadata - Metadata object
 * @param {Object} config - Configuration options
 * @returns {string} HTML meta tags
 */
function generateMetaTags(metadata, config) {
  const metadataObj = metadata.toObject();
  const tags = [];

  // Required fields
  tags.push(createMetaTag('Version', metadataObj.version, config));
  tags.push(createMetaTag('Origin', metadataObj.origin, config));
  tags.push(createMetaTag('Author', metadataObj.author, config));
  tags.push(createMetaTag('Timestamp', metadataObj.creation_timestamp, config));
  tags.push(createMetaTag('Checksum', metadataObj.checksum, config));

  // Optional fields
  if (metadataObj.license) {
    tags.push(createMetaTag('License', metadataObj.license, config));
  }
  if (metadataObj.toolchain) {
    tags.push(createMetaTag('Toolchain', metadataObj.toolchain, config));
  }
  if (metadataObj.model_identifier) {
    tags.push(createMetaTag('Model', metadataObj.model_identifier, config));
  }

  return tags.join('\n');
}

/**
 * Create a single meta tag
 * @param {string} name - Meta tag name (without prefix)
 * @param {string} content - Meta tag content
 * @param {Object} config - Configuration
 * @returns {string} HTML meta tag
 */
function createMetaTag(name, content, config) {
  const escapedContent = escapeHtml(content);
  return `${config.indent}<meta name="${config.prefix}${name}" content="${escapedContent}">`;
}

/**
 * Inject meta tags into HTML head section
 * @param {string} html - HTML content
 * @param {string} metaTags - Meta tags to inject
 * @param {Object} config - Configuration
 * @returns {string} Modified HTML
 */
function injectIntoHead(html, metaTags, config) {
  // Try to find existing head section
  const headMatch = html.match(/<head[^>]*>([\s\S]*?)<\/head>/i);
  
  if (headMatch) {
    // Insert at the end of head section
    const headContent = headMatch[1];
    const newHeadContent = headContent + '\n' + metaTags + '\n' + config.indent;
    return html.replace(headMatch[0], `<head>${newHeadContent}</head>`);
  }
  
  // No head section found, try to add after opening html tag
  const htmlMatch = html.match(/<html[^>]*>/i);
  if (htmlMatch) {
    const headSection = `\n<head>\n${metaTags}\n</head>`;
    return html.replace(htmlMatch[0], htmlMatch[0] + headSection);
  }
  
  // No proper HTML structure, prepend tags as comment
  const commentTags = metaTags.replace(/<meta/g, '<!-- <meta').replace(/>/g, '> -->');
  return commentTags + '\n' + html;
}

/**
 * Inject meta tags after title element
 * @param {string} html - HTML content
 * @param {string} metaTags - Meta tags to inject
 * @param {Object} config - Configuration
 * @returns {string} Modified HTML
 */
function injectAfterTitle(html, metaTags, config) {
  const titleMatch = html.match(/<title[^>]*>[\s\S]*?<\/title>/i);
  
  if (titleMatch) {
    return html.replace(titleMatch[0], titleMatch[0] + '\n' + metaTags);
  }
  
  // No title found, fall back to head injection
  return injectIntoHead(html, metaTags, config);
}

/**
 * Remove existing metadata meta tags
 * @param {string} html - HTML content
 * @param {string} prefix - Meta tag prefix
 * @returns {string} HTML with existing meta tags removed
 */
function removeExistingMetaTags(html, prefix) {
  const regex = new RegExp(
    `\\s*<meta\\s+name=["']${escapeRegex(prefix)}[^"']*["'][^>]*>\\s*`,
    'gi'
  );
  return html.replace(regex, '');
}

/**
 * Check if HTML content contains metadata meta tags
 * @param {string} htmlContent - HTML content to check
 * @param {Object} options - Check options
 * @returns {boolean} True if metadata tags found
 */
function hasMetaTags(htmlContent, options = {}) {
  const prefix = options.prefix || 'X-Content-';
  const regex = new RegExp(`<meta\\s+name=["']${escapeRegex(prefix)}`, 'i');
  return regex.test(htmlContent);
}

/**
 * Update existing metadata in HTML content
 * @param {string} htmlContent - HTML content with existing metadata
 * @param {ContentMetadata} newMetadata - New metadata to inject
 * @param {Object} options - Update options
 * @returns {string} Updated HTML content
 */
function updateMetaTags(htmlContent, newMetadata, options = {}) {
  const config = {
    preserveOther: options.preserveOther !== false, // Default true
    ...options
  };

  // Remove existing metadata tags
  const cleanHtml = removeExistingMetaTags(htmlContent, config.prefix || 'X-Content-');
  
  // Inject new metadata
  return injectMetaTags(cleanHtml, newMetadata, config);
}

/**
 * Batch process multiple HTML files
 * @param {Array} files - Array of {path, content} objects
 * @param {ContentMetadata} metadata - Metadata to inject
 * @param {Object} options - Processing options
 * @returns {Array} Array of processed {path, content} objects
 */
function batchProcess(files, metadata, options = {}) {
  const config = {
    skipExisting: options.skipExisting || false,
    updateExisting: options.updateExisting || false,
    ...options
  };

  return files.map(file => {
    try {
      const hasExisting = hasMetaTags(file.content, config);
      
      if (hasExisting && config.skipExisting) {
        return { ...file, processed: false, reason: 'skipped (already has metadata)' };
      }
      
      if (hasExisting && config.updateExisting) {
        return { 
          ...file, 
          content: updateMetaTags(file.content, metadata, config),
          processed: true,
          reason: 'updated existing metadata'
        };
      }
      
      return { 
        ...file, 
        content: injectMetaTags(file.content, metadata, config),
        processed: true,
        reason: 'injected new metadata'
      };
    } catch (error) {
      return { 
        ...file, 
        processed: false, 
        reason: `error: ${error.message}` 
      };
    }
  });
}

// Utility functions
function escapeHtml(text) {
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function unescapeHtml(text) {
  return String(text)
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

function escapeRegex(string) {
  return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

module.exports = {
  injectMetaTags,
  extractMetaTags,
  generateMetaTags,
  hasMetaTags,
  updateMetaTags,
  batchProcess
};