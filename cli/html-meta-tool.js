#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { Command } = require('commander');
const { ContentMetadata } = require('../lib/core/metadata');
const { 
  injectMetaTags, 
  extractMetaTags, 
  hasMetaTags, 
  updateMetaTags,
  batchProcess
} = require('../lib/formats/html-meta');

const program = new Command();

program
  .name('html-meta-tool')
  .description('Inject and extract metadata from HTML meta tags')
  .version('0.1.0');

// Inject command
program
  .command('inject')
  .description('Inject metadata into HTML files')
  .option('-i, --input <file>', 'input HTML file')
  .option('-o, --output <file>', 'output file (defaults to input file)')
  .option('--origin <type>', 'content origin: human, ai, or hybrid', 'human')
  .option('--author <name>', 'content author/creator', 'Unknown')
  .option('--license <license>', 'content license')
  .option('--toolchain <tools>', 'tools used for content creation')
  .option('--model <model>', 'AI model identifier')
  .option('--location <loc>', 'insertion location: head or after-title', 'head')
  .option('--prefix <prefix>', 'meta tag prefix', 'X-Content-')
  .option('--update', 'update existing metadata instead of preserving')
  .option('-v, --verbose', 'verbose output')
  .action(async (options) => {
    await injectCommand(options);
  });

// Extract command
program
  .command('extract')
  .description('Extract metadata from HTML files')
  .option('-i, --input <file>', 'input HTML file')
  .option('--prefix <prefix>', 'meta tag prefix', 'X-Content-')
  .option('--json', 'output as JSON')
  .option('-v, --verbose', 'verbose output')
  .action(async (options) => {
    await extractCommand(options);
  });

// Check command
program
  .command('check')
  .description('Check if HTML file has metadata tags')
  .option('-i, --input <file>', 'input HTML file')
  .option('--prefix <prefix>', 'meta tag prefix', 'X-Content-')
  .action(async (options) => {
    await checkCommand(options);
  });

// Batch command
program
  .command('batch')
  .description('Process multiple HTML files')
  .option('-d, --directory <dir>', 'directory containing HTML files')
  .option('-p, --pattern <pattern>', 'file pattern (glob)', '*.html')
  .option('--origin <type>', 'content origin: human, ai, or hybrid', 'human')
  .option('--author <name>', 'content author/creator', 'Unknown')
  .option('--license <license>', 'content license')
  .option('--skip-existing', 'skip files that already have metadata')
  .option('--update-existing', 'update existing metadata')
  .option('-v, --verbose', 'verbose output')
  .action(async (options) => {
    await batchCommand(options);
  });

async function injectCommand(options) {
  try {
    if (!options.input) {
      console.error('Error: Input file is required. Use -i or --input');
      process.exit(1);
    }

    if (!fs.existsSync(options.input)) {
      console.error(`Error: Input file does not exist: ${options.input}`);
      process.exit(1);
    }

    const htmlContent = fs.readFileSync(options.input, 'utf8');
    
    // Generate metadata
    const metadataOptions = {
      origin: options.origin,
      author: options.author,
      license: options.license,
      toolchain: options.toolchain,
      model_identifier: options.model
    };

    const metadata = ContentMetadata.generateForContent(htmlContent, metadataOptions);
    
    // Inject meta tags
    const injectionOptions = {
      insertLocation: options.location,
      prefix: options.prefix,
      preserveExisting: !options.update
    };

    const processedHtml = options.update ? 
      updateMetaTags(htmlContent, metadata, injectionOptions) :
      injectMetaTags(htmlContent, metadata, injectionOptions);

    // Write output
    const outputFile = options.output || options.input;
    fs.writeFileSync(outputFile, processedHtml);

    if (options.verbose) {
      console.log('✅ Metadata injection successful!');
      console.log(`📄 File: ${outputFile}`);
      console.log(`🏷️  Origin: ${metadata.origin}`);
      console.log(`👤 Author: ${metadata.author}`);
      console.log(`🕒 Timestamp: ${metadata.creation_timestamp}`);
      console.log(`🔐 Checksum: ${metadata.checksum}`);
      if (metadata.license) console.log(`📜 License: ${metadata.license}`);
    } else {
      console.log(`✅ Metadata injected into ${outputFile}`);
    }

  } catch (error) {
    console.error(`Error: ${error.message}`);
    process.exit(1);
  }
}

async function extractCommand(options) {
  try {
    if (!options.input) {
      console.error('Error: Input file is required. Use -i or --input');
      process.exit(1);
    }

    if (!fs.existsSync(options.input)) {
      console.error(`Error: Input file does not exist: ${options.input}`);
      process.exit(1);
    }

    const htmlContent = fs.readFileSync(options.input, 'utf8');
    const metadata = extractMetaTags(htmlContent, {
      prefix: options.prefix,
      strict: false
    });

    if (!metadata) {
      console.log('❌ No metadata found in HTML file');
      process.exit(1);
    }

    if (options.json) {
      console.log(JSON.stringify(metadata.toObject(), null, 2));
    } else {
      console.log('📋 Extracted Metadata');
      console.log('═'.repeat(30));
      console.log(`📄 File: ${options.input}`);
      console.log(`🏷️  Origin: ${metadata.origin.toUpperCase()}`);
      console.log(`👤 Author: ${metadata.author}`);
      console.log(`🕒 Created: ${new Date(metadata.creation_timestamp).toLocaleString()}`);
      console.log(`🔐 Checksum: ${metadata.checksum}`);
      console.log(`📋 Version: ${metadata.version}`);
      
      if (metadata.license) console.log(`📜 License: ${metadata.license}`);
      if (metadata.toolchain) console.log(`🔧 Toolchain: ${metadata.toolchain}`);
      if (metadata.model_identifier) console.log(`🤖 Model: ${metadata.model_identifier}`);

      if (options.verbose) {
        console.log('\n🔧 Raw JSON:');
        console.log(JSON.stringify(metadata.toObject(), null, 2));
      }
    }

  } catch (error) {
    console.error(`Error: ${error.message}`);
    process.exit(1);
  }
}

async function checkCommand(options) {
  try {
    if (!options.input) {
      console.error('Error: Input file is required. Use -i or --input');
      process.exit(1);
    }

    if (!fs.existsSync(options.input)) {
      console.error(`Error: Input file does not exist: ${options.input}`);
      process.exit(1);
    }

    const htmlContent = fs.readFileSync(options.input, 'utf8');
    const hasMetadata = hasMetaTags(htmlContent, { prefix: options.prefix });

    if (hasMetadata) {
      console.log(`✅ ${options.input} contains metadata tags`);
      
      // Try to extract and show summary
      try {
        const metadata = extractMetaTags(htmlContent, { prefix: options.prefix, strict: false });
        if (metadata) {
          console.log(`🏷️  Origin: ${metadata.origin}`);
          console.log(`👤 Author: ${metadata.author}`);
          console.log(`🕒 Created: ${new Date(metadata.creation_timestamp).toLocaleString()}`);
        }
      } catch (e) {
        console.log('⚠️  Metadata tags found but parsing failed');
      }
    } else {
      console.log(`❌ ${options.input} does not contain metadata tags`);
    }

  } catch (error) {
    console.error(`Error: ${error.message}`);
    process.exit(1);
  }
}

async function batchCommand(options) {
  try {
    if (!options.directory) {
      console.error('Error: Directory is required. Use -d or --directory');
      process.exit(1);
    }

    if (!fs.existsSync(options.directory)) {
      console.error(`Error: Directory does not exist: ${options.directory}`);
      process.exit(1);
    }

    // Find HTML files
    const glob = require('glob');
    const pattern = path.join(options.directory, options.pattern);
    const files = glob.sync(pattern);

    if (files.length === 0) {
      console.log(`❌ No HTML files found matching pattern: ${options.pattern}`);
      process.exit(1);
    }

    console.log(`📁 Found ${files.length} HTML files to process`);
    
    // Read files
    const fileContents = files.map(filePath => ({
      path: filePath,
      content: fs.readFileSync(filePath, 'utf8')
    }));

    // Generate metadata
    const metadataOptions = {
      origin: options.origin,
      author: options.author,
      license: options.license
    };

    const metadata = new ContentMetadata(metadataOptions);

    // Process files
    const batchOptions = {
      skipExisting: options.skipExisting,
      updateExisting: options.updateExisting,
      prefix: 'X-Content-'
    };

    const results = batchProcess(fileContents, metadata, batchOptions);

    // Write results and show summary
    let processed = 0;
    let skipped = 0;
    let errors = 0;

    results.forEach(result => {
      if (result.processed) {
        fs.writeFileSync(result.path, result.content);
        processed++;
        
        if (options.verbose) {
          console.log(`✅ ${result.path} - ${result.reason}`);
        }
      } else {
        if (result.reason.includes('skipped')) {
          skipped++;
          if (options.verbose) {
            console.log(`⏭️  ${result.path} - ${result.reason}`);
          }
        } else {
          errors++;
          if (options.verbose) {
            console.log(`❌ ${result.path} - ${result.reason}`);
          }
        }
      }
    });

    console.log('\n📊 Batch Processing Summary:');
    console.log(`✅ Processed: ${processed}`);
    console.log(`⏭️  Skipped: ${skipped}`);
    console.log(`❌ Errors: ${errors}`);

  } catch (error) {
    console.error(`Error: ${error.message}`);
    process.exit(1);
  }
}

// Help examples
program.on('--help', () => {
  console.log('');
  console.log('Examples:');
  console.log('  $ html-meta-tool inject -i index.html --origin human --author "Jane Doe"');
  console.log('  $ html-meta-tool extract -i tagged.html --verbose');
  console.log('  $ html-meta-tool check -i page.html');
  console.log('  $ html-meta-tool batch -d ./website --origin human --author "Web Team"');
  console.log('');
  console.log('Injection locations:');
  console.log('  head        - Insert at end of <head> section (default)');
  console.log('  after-title - Insert after <title> element');
  console.log('');
  console.log('Batch processing:');
  console.log('  --skip-existing    - Skip files that already have metadata');
  console.log('  --update-existing  - Update existing metadata with new values');
  console.log('');
});

program.parse();