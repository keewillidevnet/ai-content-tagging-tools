#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { Command } = require('commander');
const { ContentMetadata } = require('../lib/core/metadata');

const program = new Command();

program
  .name('validate-content')
  .description('Validate and verify tagged digital content')
  .version('0.1.0');

program
  .option('-i, --input <file>', 'input file to validate')
  .option('-m, --metadata <file>', 'metadata file (if not auto-detected)')
  .option('--format <format>', 'metadata format: sidecar, header, html', 'auto')
  .option('-v, --verbose', 'verbose output with full metadata display')
  .option('--strict', 'strict validation mode (fail on any issues)')
  .option('--json', 'output results as JSON');

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

    const validationResult = await validateContent(options.input, options);
    
    if (options.json) {
      console.log(JSON.stringify(validationResult, null, 2));
    } else {
      displayResults(validationResult, options);
    }

    // Exit with appropriate code
    if (validationResult.overall.valid) {
      process.exit(0);
    } else {
      process.exit(options.strict ? 1 : 0);
    }

  } catch (error) {
    console.error(`Error: ${error.message}`);
    process.exit(1);
  }
});

async function validateContent(inputFile, options) {
  const result = {
    file: inputFile,
    timestamp: new Date().toISOString(),
    metadata: null,
    checks: {
      file_exists: false,
      metadata_found: false,
      metadata_valid: false,
      checksum_valid: false,
      schema_valid: false
    },
    overall: {
      valid: false,
      score: 0,
      issues: []
    }
  };

  try {
    // Check if file exists
    result.checks.file_exists = fs.existsSync(inputFile);
    if (!result.checks.file_exists) {
      result.overall.issues.push('Input file does not exist');
      return result;
    }

    // Try to locate metadata
    const metadataFile = await findMetadata(inputFile, options);
    if (!metadataFile) {
      result.overall.issues.push('No metadata found for this file');
      return result;
    }

    result.checks.metadata_found = true;
    if (options.verbose) {
      result.metadata_source = metadataFile;
    }

    // Parse metadata
    const metadata = await parseMetadata(metadataFile, options);
    if (!metadata) {
      result.overall.issues.push('Failed to parse metadata');
      return result;
    }

    result.metadata = metadata.toObject();
    result.checks.metadata_valid = true;

    // Validate metadata schema
    const schemaValidation = metadata.validate();
    result.checks.schema_valid = schemaValidation.isValid;
    if (!schemaValidation.isValid) {
      result.overall.issues.push(`Schema validation failed: ${schemaValidation.error}`);
    }

    // Verify content integrity
    const content = fs.readFileSync(inputFile);
    const integrityValid = metadata.verifyIntegrity(content);
    result.checks.checksum_valid = integrityValid;
    
    if (!integrityValid) {
      result.overall.issues.push('Content checksum does not match - file may have been modified');
    }

    // Calculate overall validity
    const checkCount = Object.values(result.checks).filter(Boolean).length;
    result.overall.score = checkCount / Object.keys(result.checks).length;
    result.overall.valid = result.checks.metadata_found && 
                           result.checks.metadata_valid && 
                           result.checks.checksum_valid && 
                           result.checks.schema_valid;

  } catch (error) {
    result.overall.issues.push(`Validation error: ${error.message}`);
  }

  return result;
}

async function findMetadata(inputFile, options) {
  // If metadata file explicitly specified
  if (options.metadata) {
    return fs.existsSync(options.metadata) ? options.metadata : null;
  }

  // Auto-detect metadata based on format
  const candidates = [
    `${inputFile}.meta.xml`,  // Sidecar format
    `${inputFile}.tagged.meta.xml`,  // Our tagging tool format
    inputFile  // Embedded format (HTML, etc.)
  ];

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      // For embedded formats, check if file contains metadata
      if (candidate === inputFile) {
        const content = fs.readFileSync(inputFile, 'utf8');
        if (content.includes('X-Content-') || content.includes('<metadata>')) {
          return candidate;
        }
      } else {
        return candidate;
      }
    }
  }

  return null;
}

async function parseMetadata(metadataFile, options) {
  try {
    if (metadataFile.endsWith('.xml')) {
      // Parse XML sidecar file
      const xmlContent = fs.readFileSync(metadataFile, 'utf8');
      return await ContentMetadata.parseXML(xmlContent);
    } else {
      // Try to extract embedded metadata
      const content = fs.readFileSync(metadataFile, 'utf8');
      
      // Check for HTML meta tags
      if (content.includes('X-Content-')) {
        return parseHTMLMetadata(content);
      }
      
      // Check for HTTP header format
      if (content.includes('X-Content-Metadata:')) {
        return parseHeaderMetadata(content);
      }
    }
  } catch (error) {
    throw new Error(`Failed to parse metadata: ${error.message}`);
  }

  return null;
}

function parseHTMLMetadata(content) {
  const metadata = {};
  
  // Extract meta tags
  const metaRegex = /<meta\s+name="X-Content-([^"]+)"\s+content="([^"]+)"/g;
  let match;
  
  while ((match = metaRegex.exec(content)) !== null) {
    const key = match[1].toLowerCase().replace('-', '_');
    metadata[key] = match[2];
  }
  
  return new ContentMetadata(metadata);
}

function parseHeaderMetadata(content) {
  // Extract header value
  const headerMatch = content.match(/X-Content-Metadata:\s*(.+)/);
  if (headerMatch) {
    return ContentMetadata.parseHTTPHeader(headerMatch[1]);
  }
  return null;
}

function displayResults(result, options) {
  console.log('\n📋 Content Validation Report');
  console.log('═'.repeat(50));
  
  console.log(`📄 File: ${result.file}`);
  console.log(`🕒 Validated: ${new Date(result.timestamp).toLocaleString()}`);
  
  // Overall status
  if (result.overall.valid) {
    console.log('✅ Overall Status: VALID');
  } else {
    console.log('❌ Overall Status: INVALID');
  }
  
  console.log(`📊 Validation Score: ${Math.round(result.overall.score * 100)}%`);
  
  // Individual checks
  console.log('\n🔍 Validation Checks:');
  console.log(`  📁 File exists: ${result.checks.file_exists ? '✅' : '❌'}`);
  console.log(`  📋 Metadata found: ${result.checks.metadata_found ? '✅' : '❌'}`);
  console.log(`  📝 Metadata valid: ${result.checks.metadata_valid ? '✅' : '❌'}`);
  console.log(`  🔒 Checksum valid: ${result.checks.checksum_valid ? '✅' : '❌'}`);
  console.log(`  📐 Schema valid: ${result.checks.schema_valid ? '✅' : '❌'}`);
  
  // Issues
  if (result.overall.issues.length > 0) {
    console.log('\n⚠️  Issues Found:');
    result.overall.issues.forEach((issue, index) => {
      console.log(`  ${index + 1}. ${issue}`);
    });
  }
  
  // Metadata display
  if (result.metadata && options.verbose) {
    console.log('\n📖 Metadata Details:');
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
  }
  
  console.log('');
}

// Help examples
program.on('--help', () => {
  console.log('');
  console.log('Examples:');
  console.log('  $ validate-content -i tagged-file.txt --verbose');
  console.log('  $ validate-content -i image.jpg -m image.jpg.meta.xml');
  console.log('  $ validate-content -i article.html --format html');
  console.log('  $ validate-content -i content.txt --json > validation-report.json');
  console.log('');
  console.log('Exit codes:');
  console.log('  0 - Content is valid or validation passed');
  console.log('  1 - Content is invalid (only in --strict mode)');
  console.log('');
  console.log('Validation checks:');
  console.log('  ✅ File existence');
  console.log('  ✅ Metadata presence and parsing');
  console.log('  ✅ Schema compliance (RFC specification)');
  console.log('  ✅ Content integrity (SHA-256 checksum)');
});

program.parse();