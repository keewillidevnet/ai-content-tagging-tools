#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { Command } = require('commander');
const { ContentMetadata } = require('../lib/core/metadata');

const program = new Command();

program
  .name('extract-metadata')
  .description('Extract metadata from tagged digital content')
  .version('0.1.0');

program
  .option('-i, --input <file>', 'input file to extract metadata from')
  .option('-m, --metadata <file>', 'explicit metadata file (sidecar)')
  .option('--format <format>', 'force metadata format: auto, sidecar, html, header', 'auto')
  .option('--json', 'output metadata as JSON')
  .option('-v, --verbose', 'verbose output with extraction details')
  .option('--verify', 'verify content integrity against extracted metadata');

program.action(async (options) => {
  try {
    // Validate required options
    if (!options.input) {
      console.error('Error: Input file is required. Use -i or --input');
      process.exit(1);
    }

    if (!fs.existsSync(options.input)) {
      console.error(`Error: Input file does not exist: ${options.input}`);
      process.exit(1);
    }

    const extractionResult = await extractMetadata(options.input, options);
    
    if (options.json) {
      console.log(JSON.stringify(extractionResult, null, 2));
    } else {
      displayResults(extractionResult, options);
    }

    // Exit based on success
    process.exit(extractionResult.success ? 0 : 1);

  } catch (error) {
    console.error(`Error: ${error.message}`);
    process.exit(1);
  }
});

async function extractMetadata(inputFile, options) {
  const result = {
    file: inputFile,
    timestamp: new Date().toISOString(),
    success: false,
    metadata: null,
    source: null,
    verification: null,
    errors: []
  };

  try {
    let metadata = null;
    let source = null;

    // Try explicit metadata file first
    if (options.metadata) {
      if (!fs.existsSync(options.metadata)) {
        result.errors.push(`Explicit metadata file not found: ${options.metadata}`);
        return result;
      }
      
      const metadataContent = fs.readFileSync(options.metadata, 'utf8');
      metadata = await ContentMetadata.parseXML(metadataContent);
      source = `sidecar: ${options.metadata}`;
    } 
    // Auto-detect metadata
    else if (options.format === 'auto' || !options.format) {
      const detection = await autoDetectMetadata(inputFile);
      metadata = detection.metadata;
      source = detection.source;
    }
    // Force specific format
    else {
      const forced = await forceFormat(inputFile, options.format);
      metadata = forced.metadata;
      source = forced.source;
    }

    if (!metadata) {
      result.errors.push('No metadata found in any supported format');
      return result;
    }

    result.metadata = metadata.toObject();
    result.source = source;
    result.success = true;

    // Verify content integrity if requested
    if (options.verify) {
      const content = fs.readFileSync(inputFile);
      const integrityValid = metadata.verifyIntegrity(content);
      result.verification = {
        integrity: integrityValid,
        checksum_match: integrityValid,
        message: integrityValid ? 'Content integrity verified' : 'Content has been modified since tagging'
      };
    }

  } catch (error) {
    result.errors.push(`Extraction failed: ${error.message}`);
  }

  return result;
}

async function autoDetectMetadata(inputFile) {
  const attempts = [
    // Try sidecar files first
    () => tryExternalSidecar(inputFile),
    // Try embedded metadata
    () => tryEmbeddedMetadata(inputFile)
  ];

  for (const attempt of attempts) {
    try {
      const result = await attempt();
      if (result.metadata) {
        return result;
      }
    } catch (error) {
      // Continue to next attempt
      continue;
    }
  }

  return { metadata: null, source: 'not found' };
}

async function tryExternalSidecar(inputFile) {
  const sidecarPaths = [
    `${inputFile}.meta.xml`,
    `${inputFile}.tagged.meta.xml`,
    `${path.dirname(inputFile)}/${path.basename(inputFile, path.extname(inputFile))}.meta.xml`
  ];

  for (const sidecarPath of sidecarPaths) {
    if (fs.existsSync(sidecarPath)) {
      try {
        const xmlContent = fs.readFileSync(sidecarPath, 'utf8');
        const metadata = await ContentMetadata.parseXML(xmlContent);
        return { 
          metadata, 
          source: `sidecar: ${path.basename(sidecarPath)}` 
        };
      } catch (error) {
        continue;
      }
    }
  }

  return { metadata: null, source: null };
}

async function tryEmbeddedMetadata(inputFile) {
  try {
    const content = fs.readFileSync(inputFile, 'utf8');
    
    // Try HTML meta tags
    if (content.includes('X-Content-')) {
      const metadata = parseHTMLMetadata(content);
      if (metadata) {
        return { 
          metadata, 
          source: 'embedded: HTML meta tags' 
        };
      }
    }
    
    // Try HTTP header format
    if (content.includes('X-Content-Metadata:')) {
      const headerMatch = content.match(/X-Content-Metadata:\s*(.+)/);
      if (headerMatch) {
        const metadata = ContentMetadata.parseHTTPHeader(headerMatch[1]);
        return { 
          metadata, 
          source: 'embedded: HTTP header comment' 
        };
      }
    }

    // Try XML embedded in document
    if (content.includes('<metadata>')) {
      const xmlMatch = content.match(/<metadata>[\s\S]*?<\/metadata>/);
      if (xmlMatch) {
        const metadata = await ContentMetadata.parseXML(xmlMatch[0]);
        return { 
          metadata, 
          source: 'embedded: XML block' 
        };
      }
    }

  } catch (error) {
    // File might be binary or not readable as text
  }

  return { metadata: null, source: null };
}

async function forceFormat(inputFile, format) {
  switch (format.toLowerCase()) {
    case 'sidecar':
      return await tryExternalSidecar(inputFile);
    case 'html':
      return await tryHTMLFormat(inputFile);
    case 'header':
      return await tryHeaderFormat(inputFile);
    default:
      throw new Error(`Unsupported format: ${format}`);
  }
}

async function tryHTMLFormat(inputFile) {
  const content = fs.readFileSync(inputFile, 'utf8');
  const metadata = parseHTMLMetadata(content);
  return { 
    metadata, 
    source: metadata ? 'forced: HTML meta tags' : null 
  };
}

async function tryHeaderFormat(inputFile) {
  const content = fs.readFileSync(inputFile, 'utf8');
  const headerMatch = content.match(/X-Content-Metadata:\s*(.+)/);
  if (headerMatch) {
    const metadata = ContentMetadata.parseHTTPHeader(headerMatch[1]);
    return { 
      metadata, 
      source: 'forced: HTTP header' 
    };
  }
  return { metadata: null, source: null };
}

function parseHTMLMetadata(content) {
  const metadata = {};
  
  const metaRegex = /<meta\s+name="X-Content-([^"]+)"\s+content="([^"]+)"/g;
  let match;
  let foundAny = false;
  
  while ((match = metaRegex.exec(content)) !== null) {
    const key = match[1].toLowerCase().replace('-', '_');
    metadata[key] = match[2];
    foundAny = true;
  }
  
  return foundAny ? new ContentMetadata(metadata) : null;
}

function displayResults(result, options) {
  console.log('\n📋 Metadata Extraction Report');
  console.log('═'.repeat(50));
  
  console.log(`📄 File: ${result.file}`);
  console.log(`🕒 Extracted: ${new Date(result.timestamp).toLocaleString()}`);
  
  if (result.success) {
    console.log('✅ Status: SUCCESS');
    console.log(`📍 Source: ${result.source}`);
    
    // Display metadata
    console.log('\n📖 Extracted Metadata:');
    console.log('─'.repeat(30));
    console.log(`  Version: ${result.metadata.version}`);
    console.log(`  Origin: ${result.metadata.origin.toUpperCase()}`);
    console.log(`  Author: ${result.metadata.author}`);
    console.log(`  Created: ${new Date(result.metadata.creation_timestamp).toLocaleString()}`);
    console.log(`  Checksum: ${result.metadata.checksum}`);
    
    if (result.metadata.license) {
      console.log(`  License: ${result.metadata.license}`);
    }
    if (result.metadata.toolchain) {
      console.log(`  Toolchain: ${result.metadata.toolchain}`);
    }
    if (result.metadata.model_identifier) {
      console.log(`  Model: ${result.metadata.model_identifier}`);
    }

    // Display verification results
    if (result.verification) {
      console.log('\n🔍 Content Verification:');
      console.log('─'.repeat(30));
      if (result.verification.integrity) {
        console.log('✅ Integrity: VERIFIED');
        console.log('✅ Content matches original checksum');
      } else {
        console.log('❌ Integrity: FAILED');
        console.log('⚠️  Content has been modified since tagging');
      }
    }

    if (options.verbose) {
      console.log('\n🔧 Raw Metadata JSON:');
      console.log(JSON.stringify(result.metadata, null, 2));
    }

  } else {
    console.log('❌ Status: FAILED');
    console.log('\n⚠️  Errors:');
    result.errors.forEach((error, index) => {
      console.log(`  ${index + 1}. ${error}`);
    });
  }
  
  console.log('');
}

// Help examples
program.on('--help', () => {
  console.log('');
  console.log('Examples:');
  console.log('  $ extract-metadata -i tagged-file.txt');
  console.log('  $ extract-metadata -i image.jpg -m image.jpg.meta.xml');
  console.log('  $ extract-metadata -i article.html --format html');
  console.log('  $ extract-metadata -i content.txt --verify --verbose');
  console.log('  $ extract-metadata -i data.txt --json > metadata.json');
  console.log('');
  console.log('Detection methods:');
  console.log('  📁 Sidecar files (.meta.xml, .tagged.meta.xml)');
  console.log('  🌐 HTML meta tags (X-Content-* attributes)');
  console.log('  📄 HTTP header comments (X-Content-Metadata)');
  console.log('  📋 Embedded XML blocks (<metadata>...</metadata>)');
  console.log('');
  console.log('Output formats:');
  console.log('  📊 Human-readable report (default)');
  console.log('  📋 JSON output (--json flag)');
  console.log('');
  console.log('Exit codes:');
  console.log('  0 - Metadata extracted successfully');
  console.log('  1 - No metadata found or extraction failed');
});

program.parse();