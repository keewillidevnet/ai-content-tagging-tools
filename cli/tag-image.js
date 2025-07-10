#!/usr/bin/env node
/**
 * CLI tool for tagging image files with AI content metadata
 * Part of AI Content Tagging Tools
 */

const { Command } = require('commander');
const EXIFImageHandler = require('../lib/formats/exif-image');
const { createMetadata } = require('../lib/core/metadata');
const fs = require('fs').promises;
const path = require('path');

const program = new Command();

program
  .name('tag-image')
  .description('Tag image files with AI content metadata')
  .version('1.0.0');

program
  .argument('<input>', 'Input image file path')
  .option('-o, --output <path>', 'Output file path (default: input-tagged.ext)')
  .option('-a, --author <n>', 'Content author')
  .option('-d, --description <text>', 'Content description')
  .option('--origin <type>', 'Content origin (ai-generated, human-created, hybrid)', 'human-created')
  .option('--model <n>', 'AI model used for generation')
  .option('--license <type>', 'Content license (e.g., CC-BY-4.0, MIT, Proprietary)')
  .option('--prompt <text>', 'Generation prompt (for AI-generated content)')
  .option('--format <type>', 'Metadata format (xmp, exif, both)', 'xmp')
  .option('--no-checksum', 'Skip checksum generation')
  .option('--sign', 'Create digital signature (requires PRIVATE_KEY env var)')
  .option('--no-preserve', 'Don\'t preserve existing metadata')
  .option('-v, --verbose', 'Verbose output')
  .option('-f, --force', 'Overwrite output file if it exists')
  .option('--quality <n>', 'JPEG quality (1-100)', '95')
  .action(async (input, options) => {
    try {
      if (options.verbose) {
        console.log(`🖼️ Tagging image file: ${input}`);
        console.log(`📋 Options:`, options);
      }
      
      // Validate input file exists
      try {
        await fs.access(input);
      } catch (error) {
        console.error(`❌ Error: Input file not found: ${input}`);
        process.exit(1);
      }
      
      // Validate file extension
      const ext = path.extname(input).toLowerCase();
      const supportedFormats = ['.jpg', '.jpeg', '.png', '.tiff', '.tif', '.webp'];
      const fullySupported = ['.jpg', '.jpeg'];
      
      if (!supportedFormats.includes(ext)) {
        console.error(`❌ Error: Unsupported image format: ${ext}`);
        console.error(`   Supported formats: ${supportedFormats.join(', ')}`);
        process.exit(1);
      }
      
      if (!fullySupported.includes(ext)) {
        console.log(`⚠️ Warning: ${ext} support is experimental. JPEG recommended.`);
      }
      
      // Determine output path
      const outputPath = options.output || input.replace(/(\.[^.]+)$/, '-tagged$1');
      
      // Check if output file exists (unless force is used)
      if (!options.force) {
        try {
          await fs.access(outputPath);
          console.error(`❌ Error: Output file already exists: ${outputPath}`);
          console.error('   Use --force to overwrite');
          process.exit(1);
        } catch (error) {
          // File doesn't exist, which is what we want
        }
      }
      
      // Validate metadata format option
      const validFormats = ['xmp', 'exif', 'both'];
      if (!validFormats.includes(options.format)) {
        console.error(`❌ Error: Invalid format option: ${options.format}`);
        console.error(`   Valid formats: ${validFormats.join(', ')}`);
        process.exit(1);
      }
      
      // Validate quality option
      const quality = parseInt(options.quality);
      if (isNaN(quality) || quality < 1 || quality > 100) {
        console.error(`❌ Error: Quality must be between 1 and 100`);
        process.exit(1);
      }
      
      // Create metadata object
      const metadataFields = {
        contentType: 'image',
        origin: options.origin,
        created: new Date().toISOString()
      };
      
      // Add optional fields
      if (options.author) metadataFields.author = options.author;
      if (options.description) metadataFields.description = options.description;
      if (options.model) metadataFields.model = options.model;
      if (options.license) metadataFields.license = options.license;
      if (options.prompt) metadataFields.prompt = options.prompt;
      
      // Add processing steps for AI-generated content
      if (options.origin === 'ai-generated' && options.model) {
        metadataFields.processingSteps = [
          {
            step: 'generation',
            tool: options.model,
            parameters: options.prompt ? { prompt: options.prompt } : {},
            timestamp: new Date().toISOString()
          }
        ];
      }
      
      const metadata = createMetadata(metadataFields);
      
      if (options.verbose) {
        console.log('📋 Metadata to embed:');
        console.log(JSON.stringify(metadata, null, 2));
      }
      
      // Initialize handler
      const handler = new EXIFImageHandler({
        preferredFormat: options.format,
        preserveExisting: options.preserve !== false,
        compressionQuality: quality
      });
      
      // Configure embedding options
      const embedOptions = {
        includeChecksum: options.checksum !== false
      };
      
      // Add signature if requested
      if (options.sign) {
        if (!process.env.PRIVATE_KEY) {
          console.error('❌ Error: --sign requires PRIVATE_KEY environment variable');
          console.error('   Set PRIVATE_KEY to your private key file path or key content');
          process.exit(1);
        }
        embedOptions.privateKey = process.env.PRIVATE_KEY;
        if (options.verbose) {
          console.log('🔐 Digital signature will be added');
        }
      }
      
      // Embed metadata
      if (options.verbose) {
        console.log(`⚙️ Embedding metadata using ${options.format.toUpperCase()} format...`);
      }
      
      const taggedImage = await handler.embedMetadata(input, metadata, embedOptions);
      
      // Save tagged file
      await fs.writeFile(outputPath, taggedImage);
      
      console.log(`✅ Image tagged successfully: ${outputPath}`);
      
      // Verify the tagging if verbose
      if (options.verbose) {
        console.log('🔍 Verifying embedded metadata...');
        const extracted = await handler.extractMetadata(taggedImage);
        
        if (extracted) {
          console.log('📋 Verification results:');
          console.log(`   Content Type: ${extracted.contentType}`);
          console.log(`   Origin: ${extracted.origin}`);
          console.log(`   Author: ${extracted.author || 'N/A'}`);
          console.log(`   Created: ${extracted.created}`);
          console.log(`   Checksum verified: ${extracted._verified ? '✅' : '❌'}`);
          console.log(`   Signature valid: ${extracted._signatureValid ? '✅' : '❌'}`);
        } else {
          console.log('❌ Warning: Could not extract metadata for verification');
        }
      }
      
      // Show file size comparison
      const originalStats = await fs.stat(input);
      const taggedStats = await fs.stat(outputPath);
      const sizeDiff = taggedStats.size - originalStats.size;
      
      if (options.verbose) {
        console.log(`📊 File size: ${originalStats.size} → ${taggedStats.size} bytes (+${sizeDiff} bytes)`);
      }
      
    } catch (error) {
      console.error('❌ Error tagging image:', error.message);
      if (options.verbose) {
        console.error('📊 Stack trace:', error.stack);
      }
      process.exit(1);
    }
  });

// Add subcommand for extracting metadata
program
  .command('extract <input>')
  .description('Extract AI metadata from image file')
  .option('-f, --format <type>', 'Output format (json, yaml, table)', 'table')
  .option('-o, --output <path>', 'Save output to file')
  .option('-v, --verbose', 'Verbose output')
  .action(async (input, options) => {
    try {
      if (options.verbose) {
        console.log(`🔍 Extracting metadata from: ${input}`);
      }
      
      // Check file exists
      await fs.access(input);
      
      const handler = new EXIFImageHandler();
      const metadata = await handler.extractMetadata(input);
      
      if (!metadata) {
        console.log('❌ No AI metadata found in file');
        process.exit(1);
      }
      
      let output;
      
      switch (options.format) {
        case 'json':
          output = JSON.stringify(metadata, null, 2);
          break;
          
        case 'yaml':
          // Simple YAML-like output
          output = Object.entries(metadata)
            .map(([key, value]) => `${key}: ${typeof value === 'object' ? JSON.stringify(value) : value}`)
            .join('\n');
          break;
          
        case 'table':
        default:
          output = '📋 AI Content Metadata\n';
          output += '='.repeat(50) + '\n';
          output += `Content Type: ${metadata.contentType}\n`;
          output += `Origin: ${metadata.origin}\n`;
          output += `Author: ${metadata.author || 'N/A'}\n`;
          output += `Created: ${metadata.created}\n`;
          output += `Description: ${metadata.description || 'N/A'}\n`;
          output += `License: ${metadata.license || 'N/A'}\n`;
          if (metadata.model) output += `Model: ${metadata.model}\n`;
          if (metadata.prompt) output += `Prompt: ${metadata.prompt}\n`;
          output += `Checksum verified: ${metadata._verified ? '✅' : '❌'}\n`;
          output += `Signature valid: ${metadata._signatureValid ? '✅' : '❌'}\n`;
          break;
      }
      
      if (options.output) {
        await fs.writeFile(options.output, output);
        console.log(`✅ Metadata saved to: ${options.output}`);
      } else {
        console.log(output);
      }
      
    } catch (error) {
      console.error('❌ Error extracting metadata:', error.message);
      process.exit(1);
    }
  });

// Add subcommand for removing metadata
program
  .command('remove <input>')
  .description('Remove AI metadata from image file')
  .option('-o, --output <path>', 'Output file path (default: input-clean.ext)')
  .option('-f, --force', 'Overwrite output file if it exists')
  .option('-v, --verbose', 'Verbose output')
  .action(async (input, options) => {
    try {
      if (options.verbose) {
        console.log(`🗑️ Removing AI metadata from: ${input}`);
      }
      
      // Check file exists
      await fs.access(input);
      
      const outputPath = options.output || input.replace(/(\.[^.]+)$/, '-clean$1');
      
      // Check if output exists
      if (!options.force) {
        try {
          await fs.access(outputPath);
          console.error(`❌ Error: Output file already exists: ${outputPath}`);
          console.error('   Use --force to overwrite');
          process.exit(1);
        } catch (error) {
          // File doesn't exist, which is what we want
        }
      }
      
      const handler = new EXIFImageHandler();
      
      // Check if file has AI metadata
      const hasMetadata = await handler.hasMetadata(input);
      if (!hasMetadata) {
        console.log('ℹ️ No AI metadata found to remove');
        // Copy file as-is
        const original = await fs.readFile(input);
        await fs.writeFile(outputPath, original);
      } else {
        // Remove metadata
        const cleanImage = await handler.removeMetadata(input);
        await fs.writeFile(outputPath, cleanImage);
        
        // Verify removal
        const stillHasMetadata = await handler.hasMetadata(cleanImage);
        if (stillHasMetadata) {
          console.log('⚠️ Warning: Some AI metadata may still remain');
        }
      }
      
      console.log(`✅ Clean image saved: ${outputPath}`);
      
      if (options.verbose) {
        const originalStats = await fs.stat(input);
        const cleanStats = await fs.stat(outputPath);
        const sizeDiff = originalStats.size - cleanStats.size;
        console.log(`📊 File size: ${originalStats.size} → ${cleanStats.size} bytes (-${sizeDiff} bytes)`);
      }
      
    } catch (error) {
      console.error('❌ Error removing metadata:', error.message);
      process.exit(1);
    }
  });

// Add subcommand for validating files
program
  .command('validate <input>')
  .description('Validate AI metadata in image file')
  .option('-v, --verbose', 'Verbose output')
  .action(async (input, options) => {
    try {
      if (options.verbose) {
        console.log(`🔍 Validating: ${input}`);
      }
      
      await fs.access(input);
      
      const handler = new EXIFImageHandler();
      const metadata = await handler.extractMetadata(input);
      
      if (!metadata) {
        console.log('❌ No AI metadata found');
        process.exit(1);
      }
      
      console.log('✅ AI metadata found and validated');
      console.log(`📋 Content: ${metadata.contentType} from ${metadata.origin}`);
      console.log(`🔒 Integrity: ${metadata._verified ? 'Verified' : 'Failed'}`);
      console.log(`✍️ Signature: ${metadata._signatureValid ? 'Valid' : 'Invalid/None'}`);
      
      if (options.verbose) {
        console.log('\n📋 Full metadata:');
        console.log(JSON.stringify(metadata, null, 2));
      }
      
    } catch (error) {
      console.error('❌ Validation failed:', error.message);
      process.exit(1);
    }
  });

// Add subcommand for format information
program
  .command('info <input>')
  .description('Show image format and metadata information')
  .option('-v, --verbose', 'Verbose output')
  .action(async (input, options) => {
    try {
      if (options.verbose) {
        console.log(`ℹ️ Analyzing: ${input}`);
      }
      
      await fs.access(input);
      
      const handler = new EXIFImageHandler();
      const imageBuffer = await fs.readFile(input);
      const format = handler._detectImageFormat(imageBuffer);
      
      console.log(`📊 Image Format Analysis`);
      console.log('='.repeat(30));
      console.log(`File: ${path.basename(input)}`);
      console.log(`Format: ${format.toUpperCase()}`);
      console.log(`Size: ${imageBuffer.length} bytes`);
      
      // Check for AI metadata
      const hasAIMetadata = await handler.hasMetadata(input);
      console.log(`AI Metadata: ${hasAIMetadata ? '✅ Present' : '❌ Not found'}`);
      
      if (hasAIMetadata) {
        const metadata = await handler.extractMetadata(input);
        console.log(`Origin: ${metadata.origin}`);
        console.log(`Created: ${metadata.created}`);
      }
      
      // Format-specific information
      if (format === 'jpeg') {
        console.log(`✅ Full metadata support available`);
      } else if (format === 'png' || format === 'tiff') {
        console.log(`⚠️ Experimental support - JPEG recommended`);
      } else {
        console.log(`❌ Unsupported format for metadata embedding`);
      }
      
    } catch (error) {
      console.error('❌ Error analyzing image:', error.message);
      process.exit(1);
    }
  });

// Add subcommand for batch processing
program
  .command('batch <directory>')
  .description('Batch process images in directory')
  .option('-o, --output <dir>', 'Output directory (default: input-tagged/)')
  .option('--origin <type>', 'Content origin for all files', 'human-created')
  .option('--author <n>', 'Content author for all files')
  .option('--format <type>', 'Metadata format (xmp, exif, both)', 'xmp')
  .option('-f, --force', 'Overwrite existing files')
  .option('-v, --verbose', 'Verbose output')
  .option('--dry-run', 'Show what would be processed without doing it')
  .action(async (directory, options) => {
    try {
      if (options.verbose) {
        console.log(`📦 Batch processing directory: ${directory}`);
      }
      
      // Check directory exists
      await fs.access(directory);
      
      const outputDir = options.output || path.join(path.dirname(directory), path.basename(directory) + '-tagged');
      
      if (!options.dryRun) {
        await fs.mkdir(outputDir, { recursive: true });
      }
      
      const files = await fs.readdir(directory);
      const imageFiles = files.filter(file => {
        const ext = path.extname(file).toLowerCase();
        return ['.jpg', '.jpeg', '.png', '.tiff', '.tif', '.webp'].includes(ext);
      });
      
      console.log(`Found ${imageFiles.length} image files to process`);
      
      if (options.dryRun) {
        console.log('\n🔍 Dry run - files that would be processed:');
        imageFiles.forEach(file => console.log(`  - ${file}`));
        return;
      }
      
      const handler = new EXIFImageHandler({
        preferredFormat: options.format,
        preserveExisting: true
      });
      
      let processed = 0;
      let errors = 0;
      
      for (const file of imageFiles) {
        try {
          const inputPath = path.join(directory, file);
          const outputPath = path.join(outputDir, file);
          
          if (options.verbose) {
            console.log(`Processing: ${file}`);
          }
          
          // Check if output exists
          if (!options.force) {
            try {
              await fs.access(outputPath);
              console.log(`⏭️ Skipping ${file} (output exists, use --force to overwrite)`);
              continue;
            } catch (error) {
              // File doesn't exist, proceed
            }
          }
          
          // Create metadata
          const metadata = createMetadata({
            contentType: 'image',
            origin: options.origin,
            author: options.author,
            created: new Date().toISOString(),
            description: `Batch processed: ${file}`
          });
          
          // Process file
          const taggedImage = await handler.embedMetadata(inputPath, metadata);
          await fs.writeFile(outputPath, taggedImage);
          
          processed++;
          if (options.verbose) {
            console.log(`✅ ${file}`);
          }
          
        } catch (error) {
          errors++;
          console.error(`❌ Error processing ${file}: ${error.message}`);
        }
      }
      
      console.log(`\n📊 Batch processing complete:`);
      console.log(`   Processed: ${processed} files`);
      console.log(`   Errors: ${errors} files`);
      console.log(`   Output directory: ${outputDir}`);
      
    } catch (error) {
      console.error('❌ Batch processing failed:', error.message);
      process.exit(1);
    }
  });

// Add help examples
program.addHelpText('after', `
Examples:
  $ tag-image photo.jpg --author "AI Artist" --origin ai-generated
  $ tag-image picture.jpg -o tagged.jpg --model "DALL-E-3" --format xmp
  $ tag-image extract tagged-photo.jpg --format json
  $ tag-image remove tagged-photo.jpg -o clean-photo.jpg
  $ tag-image validate tagged-photo.jpg
  $ tag-image info photo.jpg
  $ tag-image batch ./photos --author "Studio" --output ./tagged-photos

Environment Variables:
  PRIVATE_KEY    Path to private key file or key content for signing

Supported Formats:
  .jpg, .jpeg (full support)
  .png, .tiff, .tif, .webp (experimental)

Metadata Formats:
  xmp   - Adobe XMP format (recommended, full feature support)
  exif  - EXIF UserComment field (basic support)
  both  - Embed in both XMP and EXIF formats
`);

program.parse();
